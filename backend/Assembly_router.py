from fastapi import APIRouter, HTTPException, Request, Response
from backend.Assembly.excel_db import load_workbook_readonly
from backend.Assembly.constants import REQUIRED_COLUMNS
from backend.Assembly.auto_match import load_db_rows,load_tree_nodes_json, extract_json_ids,match_one_best,JW_THRESHOLD,TOPK,get_db_meta_rows_for_part,load_excel_rows_for_matches, normalize_merged_rows
from backend.Sub.session_excel import get_or_create_sid

from backend.Sub.session_store import get_or_create_sid, refresh_session_state, save_session_state, SESSION_STATE

from typing import List, Dict, Any
from pathlib import Path
import json
import threading

router = APIRouter(prefix="/assembly", tags=["assembly"])
DATA_DIR = Path("backend/data")

# -----------------------------
# 캐시 구조
# -----------------------------
ASSEMBLY_CACHE = {
    "ready": False,
    "sheets": [],
    "parts": {},
    "options": {},
    "tasks": {},
}
_CACHE_LOCK = threading.Lock()


# -----------------------------
# 유틸
# -----------------------------
def normalize(s):
    if s is None:
        return ""
    return str(s).replace("\n", "").replace("\r", "").replace(" ", "")


def find_col(headers, target):
    t = normalize(target)
    for i, h in enumerate(headers):
        if normalize(h) == t:
            return i
    raise HTTPException(status_code=400, detail=f"컬럼 없음: {target}")


# -----------------------------
# 캐시 빌드
# -----------------------------
def build_assembly_cache():
    wb = load_workbook_readonly()

    sheets = wb.sheetnames
    parts_map = {}
    options_map = {}
    tasks_map = {}

    for sheet in sheets:
        ws = wb[sheet]
        headers = [cell.value for cell in ws[2]]

        col_idx = {}
        for col in REQUIRED_COLUMNS:
            col_idx[col] = find_col(headers, col)

        i_part = col_idx["부품 기준"]
        i_option = col_idx["OPTION"]

        part_set = set()
        option_set_by_part = {}
        tasks_by_part_option = {}

        current_part = None
        current_option = None

        for row in ws.iter_rows(min_row=3, values_only=True):
            if row[i_part] is not None:
                current_part = row[i_part]
            if row[i_option] is not None:
                current_option = row[i_option]

            if current_part is None or current_option is None:
                continue

            part_key = str(current_part)
            opt_key = str(current_option)

            part_set.add(part_key)

            if part_key not in option_set_by_part:
                option_set_by_part[part_key] = set()
            option_set_by_part[part_key].add(opt_key)

            if part_key not in tasks_by_part_option:
                tasks_by_part_option[part_key] = {}
            if opt_key not in tasks_by_part_option[part_key]:
                tasks_by_part_option[part_key][opt_key] = []

            item = {
                "부품 기준": current_part,
                "요소작업": row[col_idx["요소작업"]],
                "OPTION": current_option,
                "작업자": row[col_idx["작업자\n(작업분배)"]],
                "no": row[col_idx["no"]],
                "동작요소": row[col_idx["동작요소"]],
                "반복횟수": row[col_idx["반복횟수"]],
                "SEC": row[col_idx["SEC"]],
                "TOTAL": row[col_idx["TOTAL"]],
            }

            tasks_by_part_option[part_key][opt_key].append(item)

        parts_map[sheet] = sorted(part_set)

        options_map[sheet] = {}
        for p, sset in option_set_by_part.items():
            options_map[sheet][p] = sorted(sset)

        tasks_map[sheet] = tasks_by_part_option

    ASSEMBLY_CACHE["sheets"] = sheets
    ASSEMBLY_CACHE["parts"] = parts_map
    ASSEMBLY_CACHE["options"] = options_map
    ASSEMBLY_CACHE["tasks"] = tasks_map
    ASSEMBLY_CACHE["ready"] = True


def ensure_assembly_cache():
    if ASSEMBLY_CACHE.get("ready"):
        return

    with _CACHE_LOCK:
        if ASSEMBLY_CACHE.get("ready"):
            return
        build_assembly_cache()


# -----------------------------
# API
# -----------------------------
@router.get("/sheets")
def get_sheets():
    ensure_assembly_cache()
    return ASSEMBLY_CACHE["sheets"]


@router.get("/part-bases")
def get_part_bases(sheet: str):
    ensure_assembly_cache()

    if sheet not in ASSEMBLY_CACHE["parts"]:
        raise HTTPException(status_code=404, detail="시트 없음")

    return ASSEMBLY_CACHE["parts"][sheet]


@router.get("/options")
def get_options(sheet: str, part_base: str):
    ensure_assembly_cache()

    if sheet not in ASSEMBLY_CACHE["options"]:
        raise HTTPException(status_code=404, detail="시트 없음")

    return ASSEMBLY_CACHE["options"][sheet].get(part_base, [])


@router.get("/tasks")
def get_tasks(
    sheet: str,
    part_base: str,
    option: str,
):
    ensure_assembly_cache()

    if sheet not in ASSEMBLY_CACHE["tasks"]:
        raise HTTPException(status_code=404, detail="시트 없음")

    by_part = ASSEMBLY_CACHE["tasks"][sheet]
    by_opt = by_part.get(part_base, {})
    return by_opt.get(option, [])


# -----------------------------
# JSON 저장 / 로드 (기존 유지)
# -----------------------------
@router.post("/bom/{bom_id}/spec/{spec}/save")
def save_assembly(
    bom_id: str,
    spec: str,
    rows: List[Dict]
):
    dir_path = DATA_DIR / "bom_runs" / bom_id
    dir_path.mkdir(parents=True, exist_ok=True)

    path = dir_path / f"{spec}_assembly.json"

    payload = {
        "rows": rows
    }

    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    return {"status": "ok"}



@router.get("/bom/{bom_id}/spec/{spec}/load")
def load_assembly(bom_id: str, spec: str):
    path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_assembly.json"

    if not path.exists():
        return {"rows": []}

    data = json.loads(path.read_text(encoding="utf-8"))
    return data


@router.get("/session-info")
def get_session_info(request: Request, response: Response):
    sid = get_or_create_sid(request, response)
    refresh_session_state()
    state = SESSION_STATE.get(sid)

    print("COOKIE SID:", sid)
    print("SESSION_STATE keys:", list(SESSION_STATE.keys())[:5])

    if not state:
        return {"ok": False}

    bom_id = state.get("bom_id")
    spec = state.get("spec")

    if not bom_id or not spec:
        return {"ok": False}

    return {
        "ok": True,
        "bom_id": bom_id,
        "spec": spec,
    }


@router.post("/bom/{bom_id}/spec/{spec}/auto-match")
def auto_match_assembly(bom_id: str, spec: str):
    root_dir = DATA_DIR / "bom_runs" / bom_id
    tree_json_path = root_dir / f"{spec}.json"

    if not tree_json_path.exists():
        raise HTTPException(404, f"트리 JSON 없음: {tree_json_path}")

    excel_path = DATA_DIR.parent / "작업시간분석표DB.xlsx"
    if not excel_path.exists():
        raise HTTPException(500, f"DB 엑셀 없음: {excel_path}")

    db_rows, db_choices = load_db_rows(excel_path)

    nodes = load_tree_nodes_json(root_dir, spec)
    json_ids = extract_json_ids(nodes)

    added = []
    skipped = []

    for j in json_ids:
        best = match_one_best(j, db_rows, db_choices, topk=TOPK)
        if not best:
            continue

        if best["score_jw"] >= JW_THRESHOLD:
            matched_meta_rows = get_db_meta_rows_for_part(
                db_rows, best["db_part_raw"]
            )

            real_rows = load_excel_rows_for_matches(
                excel_path, matched_meta_rows
            )

            # 🔥 여기서 nan 상속 정규화
            real_rows = normalize_merged_rows(real_rows)

            for r in real_rows:
                added.append(r)

        else:
            skipped.append({
                "json_id": j,
                "best_score": float(best["score_jw"]),
            })

    return {
        "threshold": JW_THRESHOLD,
        "count_json_ids": len(json_ids),
        "count_added": len(added),
        "count_skipped": len(skipped),
        "added": added,
        "skipped": skipped,
    }

