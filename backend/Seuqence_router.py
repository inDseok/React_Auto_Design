from fastapi import APIRouter, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pathlib import Path
import json
import os
from openpyxl import load_workbook
from typing import List, Dict
from functools import lru_cache
from backend.Assembly.auto_match import (
    load_db_rows,
    match_one_best,
    COMBINED_THRESHOLD,
    TOPK,
)
from backend.sequence.schema import SequenceSaveRequest

router = APIRouter(
    prefix="/sequence",
    tags=["sequence"]
)

DATA_DIR = Path("backend")


def _write_json_atomic(path: Path, payload: Dict) -> None:
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    content = json.dumps(payload, ensure_ascii=False, indent=2)

    try:
        temp_path.write_text(content, encoding="utf-8")
        os.replace(temp_path, path)
    except PermissionError:
        path.write_text(content, encoding="utf-8")
        if temp_path.exists():
            temp_path.unlink()


@lru_cache(maxsize=4)
def _get_cached_db_rows(excel_path_str: str, mtime: float):
    return load_db_rows(Path(excel_path_str))


def _format_tree_label(node: Dict) -> str:
    for key in ("id", "part_no", "name"):
        value = node.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return "ROOT"


def _build_tree_path_map(nodes: List[Dict]) -> Dict[str, List[str]]:
    node_by_name = {}
    for node in nodes:
        node_name = str(node.get("name") or "").strip()
        if node_name:
            node_by_name[node_name] = node

    path_cache: Dict[str, List[str]] = {}

    def resolve_path(node_name: str) -> List[str]:
        if not node_name:
            return []
        if node_name in path_cache:
            return path_cache[node_name]

        node = node_by_name.get(node_name)
        if not node:
            path_cache[node_name] = []
            return []

        parent_name = str(node.get("parent_name") or "").strip()
        parent_path = resolve_path(parent_name) if parent_name else []
        current_label = _format_tree_label(node)
        path_cache[node_name] = [*parent_path, current_label]
        return path_cache[node_name]

    for node_name in node_by_name:
        resolve_path(node_name)

    return path_cache


@router.get("/inhouse-parts")
def get_inhouse_parts(bomId: str, spec: str):
    """
    Sequence 구성용 inhouse PART 목록 반환
    + 작업시간 DB 기준 partBase / sourceSheet 자동 매칭
    (Assembly row 생성은 하지 않음)
    """

    # =========================
    # 경로 설정 (auto-match API와 통일)
    # =========================
    root_dir = DATA_DIR / "data"/ "bom_runs" / bomId
    json_path = root_dir / f"{spec}.json"
    excel_path = DATA_DIR / "작업시간분석표DB.xlsx"

    if not json_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"SUB 트리 JSON 없음: {json_path}"
        )

    if not excel_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"작업시간 분석표 DB 엑셀 없음: {excel_path}"
        )

    # =========================
    # 1. 트리 로드
    # =========================
    try:
        tree = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"JSON 로드 실패: {str(e)}")

    nodes = tree.get("nodes", [])

    # =========================
    # 2. 작업시간 DB 로드 (1회)
    # =========================
    db_rows, db_choices = _get_cached_db_rows(
        str(excel_path.resolve()),
        excel_path.stat().st_mtime,
    )

    parts = []
    query_cache = {}
    tree_path_map = _build_tree_path_map(nodes)

    # =========================
    # 3. inhouse PART + auto-match
    # =========================
    for n in nodes:
        if n.get("type") != "PART":
            continue
        if n.get("inhouse") is not True:
            continue

        part_id = n.get("id")
        part_name = n.get("name") or part_id
        node_name = str(n.get("name") or "").strip()
        recommended_part_base = n.get("recommended_part_base")
        recommended_source_sheet = n.get("recommended_source_sheet")
        recommended_match_score = n.get("recommended_match_score")

        # Sequence에서는 사용자가 SUB에서 바꾼 이름을 우선 매칭 기준으로 사용한다.
        best = None
        if recommended_part_base and recommended_source_sheet:
            part_base = recommended_part_base
            source_sheet = recommended_source_sheet
            match_score = recommended_match_score or {
                "source": "manual-recommendation",
            }
        else:
            for query_raw in [part_name, part_id]:
                if not query_raw:
                    continue

                if query_raw in query_cache:
                    candidate = query_cache[query_raw]
                else:
                    candidate = match_one_best(
                        query_raw=query_raw,
                        db_rows=db_rows,
                        db_choices=db_choices,
                        topk=TOPK,
                    )
                    query_cache[query_raw] = candidate

                if candidate and candidate["score_combined"] >= COMBINED_THRESHOLD:
                    best = candidate
                    break

        if recommended_part_base and recommended_source_sheet:
            pass
        elif best and best["score_combined"] >= COMBINED_THRESHOLD:
            part_base = best["db_part_raw"]
            source_sheet = best["sheet"]
            match_score = {
                "combined": float(best["score_combined"]),
                "rapidfuzz": float(best["score_rapidfuzz"]),
                "jaro_winkler": float(best["score_jw"]),
            }
        else:
            part_base = None
            source_sheet = None
            match_score = None

        parts.append({
            "partId": part_id,
            "partName": part_name,
            "inhouse": True,
            "treePath": tree_path_map.get(node_name, []),
            "parentName": n.get("parent_name"),
            "nodeName": node_name,

            # 🔑 Inspector / Palette 핵심 메타
            "partBase": part_base,
            "sourceSheet": source_sheet,
            "matchScore": match_score,

            # SUB 트리 메타
            "parentId": n.get("parent_id"),
            "order": n.get("order"),
        })

    return {
        "bomId": bomId,
        "spec": spec,
        "source": "sub-tree + auto-match",
        "count": len(parts),
        "parts": parts,
    }



EXCEL_DB_PATH = Path("backend/작업시간분석표DB.xlsx")


def collect_options_for_part(ws, part_col: int, option_col: int, header_row: int, part_base: str):
    options = set()
    current_part = None

    for row in range(header_row + 1, ws.max_row + 1):
        p = ws.cell(row=row, column=part_col).value
        if p is not None and str(p).strip():
            current_part = str(p).strip()

        if current_part != part_base:
            continue

        opt = ws.cell(row=row, column=option_col).value
        if opt is not None and str(opt).strip():
            options.add(str(opt).strip())

    return sorted(options)

@router.get("/process-templates")
def get_process_templates():
    """
    Sequence 구성용 PROCESS 템플릿
    - 공통 DB, 표준 동작 시트
    - 2행에 '부품 기준' 컬럼 존재
    """

    if not EXCEL_DB_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="작업시간 분석표 DB 엑셀 파일 없음"
        )

    wb = load_workbook(EXCEL_DB_PATH, data_only=True)

    TARGET_SHEETS = ["공통 DB", "표준 동작","부품 결합 DB"]
    processes = []
    seen = set()

    for sheet_name in TARGET_SHEETS:
        if sheet_name not in wb.sheetnames:
            continue

        ws = wb[sheet_name]

        header_row = 2  # ⭐ 핵심 수정
        headers = {}

        # 1️⃣ 헤더 파싱 (2행)
        for col in range(1, ws.max_column + 1):
            v = ws.cell(row=header_row, column=col).value
            if v:
                headers[str(v).strip()] = col

        # 2️⃣ 부품 기준 컬럼 찾기
        part_col = None
        for k, c in headers.items():
            if "부품" in k.replace(" ", ""):
                part_col = c
                break

        if not part_col:
            continue

        # 3️⃣ 데이터 행 순회 (3행부터)
        for row in range(header_row + 1, ws.max_row + 1):
            val = ws.cell(row=row, column=part_col).value
            if not val:
                continue

            part_base = str(val).strip()
            key = (sheet_name, part_base)

            if key in seen:
                continue
            seen.add(key)

            processes.append({
                "processKey": f"{sheet_name}:{part_base}",
                "processType": "STANDARD",
                "label": part_base,
                "sourceSheet": sheet_name,
                "partBase": part_base,
            })

    return {
        "source": "assembly-db",
        "processes": processes,
        "count": len(processes),
    }


@router.get("/process/options")
def get_options(
    part_base: str = Query(..., alias="partBase"),
    source_sheet: str = Query(..., alias="sourceSheet"),
):
    if not EXCEL_DB_PATH.exists():
        raise HTTPException(404, "작업시간 분석표 DB 엑셀 파일 없음")

    wb = load_workbook(EXCEL_DB_PATH, data_only=True)

    if source_sheet not in wb.sheetnames:
        return {
            "partBase": part_base,
            "sourceSheet": source_sheet,
            "options": [],
        }

    ws = wb[source_sheet]

    header_row = 2
    headers = {}

    for col in range(1, ws.max_column + 1):
        v = ws.cell(row=header_row, column=col).value
        if v:
            headers[str(v).strip()] = col

    # OPTION 컬럼 찾기
    option_col = None
    for k, c in headers.items():
        if "OPTION" in k.upper():
            option_col = c
            break

    if not option_col:
        return {
            "partBase": part_base,
            "sourceSheet": source_sheet,
            "options": [],
        }

    # 부품 기준 컬럼 찾기
    part_col = None
    for k, c in headers.items():
        if "부품" in k.replace(" ", ""):
            part_col = c
            break

    if not part_col:
        return {
            "partBase": part_base,
            "sourceSheet": source_sheet,
            "options": [],
        }

    options = collect_options_for_part(
        ws=ws,
        part_col=part_col,
        option_col=option_col,
        header_row=header_row,
        part_base=part_base,
    )

    return {
        "partBase": part_base,
        "sourceSheet": source_sheet,
        "options": options,
    }

@router.get("/part/options")
def get_part_options(
    part_base: str = Query(..., alias="partBase"),
    source_sheet: str = Query(..., alias="sourceSheet"),
):
    """
    부품 기준 OPTION 조회
    source: 작업시간 분석표 DB 엑셀
    """

    if not EXCEL_DB_PATH.exists():
        raise HTTPException(404, "작업시간 분석표 DB 엑셀 파일 없음")

    wb = load_workbook(EXCEL_DB_PATH, data_only=True)

    if source_sheet not in wb.sheetnames:
        return {
            "partBase": part_base,
            "sourceSheet": source_sheet,
            "options": [],
            "count": 0,
        }

    ws = wb[source_sheet]

    header_row = 2
    headers = {}

    for col in range(1, ws.max_column + 1):
        v = ws.cell(row=header_row, column=col).value
        if v:
            headers[str(v).strip()] = col

    # OPTION 컬럼
    option_col = None
    for k, c in headers.items():
        if "OPTION" in k.upper():
            option_col = c
            break

    # 부품 기준 컬럼
    part_col = None
    for k, c in headers.items():
        if "부품" in k.replace(" ", ""):
            part_col = c
            break

    if not option_col or not part_col:
        return {
            "partBase": part_base,
            "sourceSheet": source_sheet,
            "options": [],
            "count": 0,
        }

    options = collect_options_for_part(
        ws=ws,
        part_col=part_col,
        option_col=option_col,
        header_row=header_row,
        part_base=part_base,
    )

    return {
        "partBase": part_base,
        "sourceSheet": source_sheet,
        "options": options,
        "count": len(options),
    }

@router.get("/load")
def load_sequence(bomId: str, spec: str):
    path = DATA_DIR / "data"/ "bom_runs" / bomId / f"{spec}_sequence.json"

    if not path.exists():
        raise HTTPException(404, "시퀀스 파일 없음")

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@router.post("/save")
def save_sequence(req: SequenceSaveRequest):
    bom_id = req.bomId
    spec = req.spec

    save_dir = DATA_DIR / "data"/ "bom_runs" / bom_id
    save_dir.mkdir(parents=True, exist_ok=True)

    save_path = save_dir / f"{spec}_sequence.json"

    payload = jsonable_encoder(
        {
            "bomId": bom_id,
            "spec": spec,
            "nodes": req.nodes,
            "edges": req.edges,
            "groups": req.groups or [],
            "workerGroups": req.workerGroups or [],
        }
    )

    _write_json_atomic(save_path, payload)

    return {"status": "ok"}



