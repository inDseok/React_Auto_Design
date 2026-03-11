from fastapi import APIRouter, HTTPException, Request, Response
from backend.Assembly.excel_db import load_workbook_readonly
from backend.Assembly.constants import REQUIRED_COLUMNS

from backend.Sub.session_store import get_or_create_sid, refresh_session_state, save_session_state, SESSION_STATE

from typing import List, Dict, Any, Optional
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
    raise HTTPException(status_code=400, detail=f"Column not found: {target}")


# -----------------------------
# 캐시 빌드
# -----------------------------
EXCLUDE_SHEETS = {"대형랩프 DB"}

def build_assembly_cache():
    wb = load_workbook_readonly()

    sheets = [s for s in wb.sheetnames if s not in EXCLUDE_SHEETS]

    parts_map = {}
    options_map = {}
    tasks_map = {}

    for sheet in sheets:
        ws = wb[sheet]
        print(sheet)
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


def _as_clean_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _to_positive_number(value: Any) -> Optional[float]:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _to_float_or_none(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_sequence_entries(root_dir: Path, spec: str) -> List[Dict[str, Any]]:
    sequence_json_path = root_dir / f"{spec}_sequence.json"
    if not sequence_json_path.exists():
        raise HTTPException(404, f"Sequence JSON not found: {sequence_json_path}")

    try:
        data = json.loads(sequence_json_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Failed to parse sequence JSON: {e}")

    nodes = data.get("nodes", [])
    if not isinstance(nodes, list):
        raise HTTPException(500, "Invalid sequence JSON: nodes must be a list.")

    edges = data.get("edges", [])
    if not isinstance(edges, list):
        edges = []

    groups = data.get("groups", [])
    if not isinstance(groups, list):
        groups = []

    node_by_id: Dict[str, Dict[str, Any]] = {}
    node_order: List[str] = []

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = _as_clean_str(node.get("id"))
        if not node_id:
            continue
        node_by_id[node_id] = node
        node_order.append(node_id)

    entries: List[Dict[str, Any]] = []
    index_by_key: Dict[tuple, int] = {}
    ungrouped = set(node_by_id.keys())

    def order_group_node_ids(node_ids: List[Any]) -> List[str]:
        normalized_node_ids = [
            _as_clean_str(node_id)
            for node_id in node_ids
            if _as_clean_str(node_id)
        ]
        if len(normalized_node_ids) <= 1:
            return normalized_node_ids

        node_set = set(normalized_node_ids)
        node_index = {node_id: idx for idx, node_id in enumerate(normalized_node_ids)}
        indegree = {node_id: 0 for node_id in normalized_node_ids}
        adjacency = {node_id: [] for node_id in normalized_node_ids}

        for edge_idx, edge in enumerate(edges):
            if not isinstance(edge, dict):
                continue

            source = _as_clean_str(edge.get("source"))
            target = _as_clean_str(edge.get("target"))
            if source not in node_set or target not in node_set:
                continue

            adjacency[source].append((edge_idx, target))
            indegree[target] += 1

        for source in adjacency:
            adjacency[source].sort(key=lambda item: item[0])

        queue = [node_id for node_id in normalized_node_ids if indegree[node_id] == 0]
        ordered = []
        seen = set()

        while queue:
            current = queue.pop(0)
            if current in seen:
                continue
            seen.add(current)
            ordered.append(current)

            for _, target in adjacency[current]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    queue.append(target)

            queue.sort(key=lambda node_id: node_index[node_id])

        for node_id in normalized_node_ids:
            if node_id not in seen:
                ordered.append(node_id)

        return ordered

    def add_entry(
        group_key: str,
        group_label: str,
        instance_key: str,
        part_base: str,
        option: str,
        source_sheet: str,
        repeat_weight: Optional[float],
    ) -> None:
        key = (group_key, instance_key, part_base, option)
        if key in index_by_key:
            idx = index_by_key[key]
            if entries[idx].get("repeatWeight") is None and repeat_weight is not None:
                entries[idx]["repeatWeight"] = repeat_weight
            return

        index_by_key[key] = len(entries)
        entries.append({
            "groupKey": group_key,
            "groupLabel": group_label,
            "instanceKey": instance_key,
            "partBase": part_base,
            "option": option,
            "sourceSheet": source_sheet,
            "repeatWeight": repeat_weight,
        })

    for i, group in enumerate(groups):
        if not isinstance(group, dict):
            continue

        group_id = _as_clean_str(group.get("id")) or f"group-{i + 1}"
        group_label = _as_clean_str(group.get("label"))
        group_key = f"SEQ-GRP::{group_id}"

        raw_node_ids = group.get("nodeIds", [])
        if not isinstance(raw_node_ids, list):
            continue

        node_ids = order_group_node_ids(raw_node_ids)

        for raw_node_id in node_ids:
            node_id = _as_clean_str(raw_node_id)
            node = node_by_id.get(node_id)
            if not node:
                continue

            ungrouped.discard(node_id)

            payload = node.get("data", {})
            if not isinstance(payload, dict):
                continue

            part_base = _as_clean_str(payload.get("partBase"))
            option = _as_clean_str(payload.get("option"))
            source_sheet = _as_clean_str(payload.get("sourceSheet"))
            if not part_base or not option:
                continue

            rw = _to_positive_number(payload.get("repeatWeight"))

            add_entry(
                group_key=group_key,
                group_label=group_label,
                instance_key=f"{group_key}::{node_id}",
                part_base=part_base,
                option=option,
                source_sheet=source_sheet,
                repeat_weight=rw,
            )

    for node_id in node_order:
        if node_id not in ungrouped:
            continue
        node = node_by_id[node_id]
        payload = node.get("data", {})
        if not isinstance(payload, dict):
            continue

        part_base = _as_clean_str(payload.get("partBase"))
        option = _as_clean_str(payload.get("option"))
        source_sheet = _as_clean_str(payload.get("sourceSheet"))
        if not part_base or not option:
            continue

        rw = _to_positive_number(payload.get("repeatWeight"))
        add_entry(
            group_key=f"SEQ-NODE::{node_id}",
            group_label="",
            instance_key=f"SEQ-NODE::{node_id}",
            part_base=part_base,
            option=option,
            source_sheet=source_sheet,
            repeat_weight=rw,
        )

    return entries


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
        raise HTTPException(status_code=404, detail="Sheet not found")

    return ASSEMBLY_CACHE["parts"][sheet]


@router.get("/options")
def get_options(sheet: str, part_base: str):
    ensure_assembly_cache()

    if sheet not in ASSEMBLY_CACHE["options"]:
        raise HTTPException(status_code=404, detail="Sheet not found")

    return ASSEMBLY_CACHE["options"][sheet].get(part_base, [])


@router.get("/tasks")
def get_tasks(
    sheet: str,
    part_base: str,
    option: str,
):
    ensure_assembly_cache()

    if sheet not in ASSEMBLY_CACHE["tasks"]:
        raise HTTPException(status_code=404, detail="Sheet not found")

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
    ensure_assembly_cache()

    sequence_entries = _load_sequence_entries(root_dir, spec)
    if not sequence_entries:
        return {
            "count_sequence_entries": 0,
            "count_added": 0,
            "count_skipped": 0,
            "added": [],
            "skipped": [],
        }

    added = []
    skipped = []
    seen_rows = set()

    tasks_by_sheet = ASSEMBLY_CACHE["tasks"]
    part_key = REQUIRED_COLUMNS[0]
    option_key = REQUIRED_COLUMNS[2]
    repeat_key = REQUIRED_COLUMNS[6]
    sec_key = REQUIRED_COLUMNS[7]
    total_key = REQUIRED_COLUMNS[8]

    for entry in sequence_entries:
        part_base = entry["partBase"]
        option = entry["option"]
        source_sheet = entry["sourceSheet"]
        sequence_group_key = entry["groupKey"]
        sequence_group_label = entry["groupLabel"]
        sequence_instance_key = entry["instanceKey"]
        repeat_weight = entry.get("repeatWeight")

        matched_rows = []
        candidate_sheets = (
            [source_sheet]
            if source_sheet and source_sheet in tasks_by_sheet
            else list(tasks_by_sheet.keys())
        )

        for sheet in candidate_sheets:
            rows = tasks_by_sheet.get(sheet, {}).get(part_base, {}).get(option, [])
            if rows:
                matched_rows = rows
                break

        if not matched_rows:
            skipped.append({
                "partBase": part_base,
                "option": option,
                "sourceSheet": source_sheet,
                "groupKey": sequence_group_key,
            })
            continue

        for row in matched_rows:
            out_row = dict(row)
            out_row["__groupKey"] = sequence_group_key
            out_row["__sequenceGroupLabel"] = sequence_group_label
            out_row["__partInstanceKey"] = sequence_instance_key

            if repeat_weight is not None:
                out_row[repeat_key] = repeat_weight
                sec = _to_float_or_none(out_row.get(sec_key))
                if sec is not None:
                    out_row[total_key] = sec * repeat_weight

            row_key = (
                sequence_group_key,
                _as_clean_str(out_row.get(part_key)),
                _as_clean_str(out_row.get(option_key)),
                json.dumps(out_row, ensure_ascii=False, sort_keys=True),
            )
            if row_key in seen_rows:
                continue
            seen_rows.add(row_key)
            added.append(out_row)

    return {
        "count_sequence_entries": len(sequence_entries),
        "count_added": len(added),
        "count_skipped": len(skipped),
        "added": added,
        "skipped": skipped,
    }



