from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
import json
from openpyxl import load_workbook
from typing import List, Dict
from backend.Assembly.auto_match import (
    load_db_rows,
    match_one_best,
    JW_THRESHOLD,
    TOPK,
)
from backend.sequence.schema import SequenceSaveRequest

router = APIRouter(
    prefix="/sequence",
    tags=["sequence"]
)

DATA_DIR = Path("backend")


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
    db_rows, db_choices = load_db_rows(excel_path)

    parts = []

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

        # ⚠️ Sequence 용도이므로 "name" 기준으로 매칭
        best = match_one_best(
            query_raw=part_id,
            db_rows=db_rows,
            db_choices=db_choices,
            topk=TOPK,
        )

        if best and best["score_jw"] >= JW_THRESHOLD:
            part_base = best["db_part_raw"]
            source_sheet = best["sheet"]
            match_score = {
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

    options = set()

    for row in range(header_row + 1, ws.max_row + 1):
        p = ws.cell(row=row, column=part_col).value
        if not p:
            continue

        if str(p).strip() != part_base:
            continue

        opt = ws.cell(row=row, column=option_col).value
        if opt:
            options.add(str(opt).strip())

    return {
        "partBase": part_base,
        "sourceSheet": source_sheet,
        "options": sorted(options),
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

    options = set()

    for row in range(header_row + 1, ws.max_row + 1):
        p = ws.cell(row=row, column=part_col).value
        if not p:
            continue

        if str(p).strip() != part_base:
            continue

        opt = ws.cell(row=row, column=option_col).value
        if opt:
            options.add(str(opt).strip())

    return {
        "partBase": part_base,
        "sourceSheet": source_sheet,
        "options": sorted(options),
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

    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "bomId": bom_id,
                "spec": spec,
                "nodes": req.nodes,
                "edges": req.edges,
                "groups": req.groups or [],
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    return {"status": "ok"}



