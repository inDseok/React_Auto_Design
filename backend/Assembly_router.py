from fastapi import APIRouter, HTTPException, Request, Response
from backend.Assembly.excel_db import load_workbook_readonly
from backend.Assembly.constants import REQUIRED_COLUMNS
from backend.Sub.session_excel import get_or_create_sid
from backend.Sub.session_store import SESSION_STATE
from typing import List, Dict
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
                "반복횟수": row[col_idx["반복횟수\n(가중치)"]],
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
@router.post("/save")
def save_assembly(rows: List[Dict], request: Request, response: Response):
    sid = get_or_create_sid(request, response)
    state = SESSION_STATE.get(sid)

    if not state:
        raise HTTPException(400, "세션 없음")

    bom_id = state.get("bom_id")
    spec = state.get("spec")

    if not bom_id or not spec:
        raise HTTPException(400, "bom_id 또는 spec 없음")

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


@router.get("/load")
def load_assembly(request: Request, response: Response):
    sid = get_or_create_sid(request, response)
    state = SESSION_STATE.get(sid)

    if not state:
        raise HTTPException(400, "세션 없음")

    bom_id = state.get("bom_id")
    spec = state.get("spec")

    if not bom_id or not spec:
        raise HTTPException(400, "bom_id 또는 spec 없음")

    path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_assembly.json"

    if not path.exists():
        return {"rows": []}

    data = json.loads(path.read_text(encoding="utf-8"))
    return data
