from fastapi import APIRouter, HTTPException, Request, Response
from backend.Assembly.excel_db import load_workbook_readonly
from backend.Assembly.constants import REQUIRED_COLUMNS

from backend.Sub.session_store import get_or_create_sid, refresh_session_state, save_session_state, SESSION_STATE

from typing import List, Dict, Any, Optional
from pathlib import Path
import json
import time
import threading
from uuid import uuid4

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
        headers = [cell.value for cell in ws[2]]

        col_idx = {}
        for col in REQUIRED_COLUMNS:
            col_idx[col] = find_col(headers, col)

        i_part = col_idx["부품 기준"]
        i_task = col_idx["요소작업"]
        i_option = col_idx["OPTION"]

        part_set = set()
        option_set_by_part = {}
        tasks_by_part_option = {}

        current_part = None
        current_task = None
        current_option = None

        for row in ws.iter_rows(min_row=3, values_only=True):
            if row[i_part] is not None:
                current_part = row[i_part]
                current_task = None
                current_option = None
            if row[i_task] is not None:
                current_task = row[i_task]
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
                "요소작업": current_task,
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
    return n if n >= 0 else None


def _to_float_or_none(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _compact_number(value: Any) -> Any:
    number = _to_float_or_none(value)
    if number is None:
        return value
    rounded = round(number, 4)
    if float(rounded).is_integer():
        return int(rounded)
    return rounded


def _extract_node_id_from_instance_key(instance_key: str) -> Optional[str]:
    key = _as_clean_str(instance_key)
    if not key or "::" not in key:
        return None
    return key.split("::")[-1] or None


def _is_part_like_sequence_label(*values: Any) -> bool:
    haystack = " ".join(_as_clean_str(value).upper() for value in values if _as_clean_str(value)).strip()
    if not haystack:
        return False
    return "T/SCREW" in haystack


def _infer_sequence_node_type(source_sheet: str, part_base: str = "") -> str:
    if _is_part_like_sequence_label(part_base):
        return "PART"
    normalized = _as_clean_str(source_sheet)
    if normalized in {"공통 DB", "표준 동작", "부품 결합 DB"}:
        return "PROCESS"
    return "PART"


def _fallback_first_option(part_base: str, source_sheet: str) -> str:
    """option이 빈 문자열일 때 캐시에서 첫 번째 사용 가능한 옵션을 반환."""
    ensure_assembly_cache()
    options_by_sheet = ASSEMBLY_CACHE.get("options", {})
    # 지정된 시트 우선
    if source_sheet:
        opts = options_by_sheet.get(source_sheet, {}).get(part_base, [])
        if opts:
            return _as_clean_str(opts[0])
    # 전체 시트에서 탐색
    for sh_opts in options_by_sheet.values():
        opts = sh_opts.get(part_base, [])
        if opts:
            return _as_clean_str(opts[0])
    return ""


def _resolve_sequence_option(
    part_base: str,
    option: str,
    source_sheet: str,
) -> tuple[str, str]:
    normalized_part = _as_clean_str(part_base)
    normalized_option = _as_clean_str(option)
    normalized_sheet = _as_clean_str(source_sheet)

    if not normalized_part:
        return "", normalized_sheet

    if normalized_option:
        return normalized_option, normalized_sheet

    ensure_assembly_cache()
    options_by_sheet = ASSEMBLY_CACHE.get("options", {})

    if normalized_sheet and normalized_sheet in options_by_sheet:
        sheet_options = options_by_sheet[normalized_sheet].get(normalized_part, [])
        if len(sheet_options) == 1:
            return _as_clean_str(sheet_options[0]), normalized_sheet

    candidate_pairs = []
    unique_options = []
    seen_options = set()
    for sheet_name, by_part in options_by_sheet.items():
        part_options = by_part.get(normalized_part, [])
        for part_option in part_options:
            clean_option = _as_clean_str(part_option)
            if not clean_option:
                continue
            candidate_pairs.append((sheet_name, clean_option))
            if clean_option not in seen_options:
                seen_options.add(clean_option)
                unique_options.append(clean_option)

    if len(candidate_pairs) == 1:
        sheet_name, clean_option = candidate_pairs[0]
        return clean_option, normalized_sheet or sheet_name

    if len(unique_options) == 1:
        return unique_options[0], normalized_sheet

    return "", normalized_sheet


def _find_task_rows_for_sequence_entry(
    tasks_by_sheet: Dict[str, Any],
    sheet: str,
    part_base: str,
    option: str,
    process_label: str = "",
) -> List[Dict[str, Any]]:
    def _filter_rows_by_process_label(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not process_label:
            return rows
        normalized_process = normalize(process_label)
        if not normalized_process:
            return rows
        filtered = [
            row
            for row in rows
            if normalize(row.get("요소작업")) == normalized_process
        ]
        return filtered

    by_part = tasks_by_sheet.get(sheet, {})
    if not isinstance(by_part, dict):
        return []

    if part_base in by_part:
        by_option = by_part.get(part_base, {})
        if isinstance(by_option, dict):
            if option in by_option:
                rows = by_option.get(option, [])
                if isinstance(rows, list) and rows:
                    return _filter_rows_by_process_label(rows)

            normalized_option = normalize(option)
            if normalized_option:
                for raw_option, rows in by_option.items():
                    if normalize(raw_option) == normalized_option and isinstance(rows, list) and rows:
                        return _filter_rows_by_process_label(rows)

    normalized_part = normalize(part_base)
    normalized_option = normalize(option)
    if not normalized_part:
        return []

    for raw_part, by_option in by_part.items():
        if normalize(raw_part) != normalized_part or not isinstance(by_option, dict):
            continue

        if option in by_option:
            rows = by_option.get(option, [])
            if isinstance(rows, list) and rows:
                return _filter_rows_by_process_label(rows)

        for raw_option, rows in by_option.items():
            if normalize(raw_option) == normalized_option and isinstance(rows, list) and rows:
                return _filter_rows_by_process_label(rows)

    return []


def _derive_sequence_process_label(payload: Dict[str, Any], node_type: str) -> str:
    if node_type != "PROCESS":
        return ""

    part_base = _as_clean_str(payload.get("partBase"))
    operation_label = _as_clean_str(payload.get("operationLabel"))
    if operation_label and operation_label == part_base:
        return ""
    if operation_label:
        return operation_label

    process_key = _as_clean_str(payload.get("processKey"))
    if process_key and ":" in process_key:
        candidate = _as_clean_str(process_key.split(":")[-1])
        if candidate and candidate != _as_clean_str(payload.get("label")) and candidate != part_base:
            return candidate

    fallback = _as_clean_str(payload.get("label") or payload.get("processKey"))
    if fallback == part_base:
        return ""
    return fallback


def _build_effective_assembly_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    effective_rows = [dict(row) for row in rows if isinstance(row, dict)]
    columns = ["부품 기준", "요소작업", "OPTION"]

    for col in columns:
        last_value = None
        last_group_key = None

        for row in effective_rows:
            group_key = row.get("__groupKey")
            if group_key != last_group_key:
                last_group_key = group_key
                last_value = None

            current = row.get(col)
            if (current is None or current == "") and last_value not in (None, ""):
                row[col] = last_value
            else:
                last_value = current

    return effective_rows


def _iter_effective_assembly_rows_with_block_meta(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    effective_rows = _build_effective_assembly_rows(rows)
    current_block_key = None
    current_group_key = None
    current_part_base = ""
    group_part_counts: Dict[str, int] = {}
    block_repeat_weights: Dict[str, Optional[float]] = {}
    row_items: List[Dict[str, Any]] = []

    for row in effective_rows:
        group_key = _as_clean_str(row.get("__groupKey")) or str(uuid4())
        part_base = _as_clean_str(row.get("부품 기준"))
        option = _as_clean_str(row.get("OPTION"))
        group_label = _as_clean_str(
            row.get("__groupLabel") or row.get("__sequenceGroupLabel")
        )
        instance_key = _as_clean_str(row.get("__partInstanceKey"))
        source_sheet = _as_clean_str(row.get("__sourceSheet") or row.get("sourceSheet"))
        repeat_weight = _to_float_or_none(row.get("반복횟수"))
        worker = _as_clean_str(row.get("작업자"))

        if group_key not in group_part_counts:
            group_part_counts[group_key] = 0

        if instance_key:
            block_key = instance_key
        else:
            if (
                current_group_key == group_key
                and current_block_key
                and current_part_base == part_base
            ):
                block_key = current_block_key
            else:
                group_part_counts[group_key] += 1
                block_key = f"{group_key}::{part_base}::{group_part_counts[group_key]}"

        current_group_key = group_key
        current_block_key = block_key
        current_part_base = part_base

        if repeat_weight is not None:
            if block_key not in block_repeat_weights:
                block_repeat_weights[block_key] = repeat_weight
            elif repeat_weight > block_repeat_weights[block_key]:
                block_repeat_weights[block_key] = repeat_weight

        row_items.append({
            "row": row,
            "groupKey": group_key,
            "partBase": part_base,
            "option": option,
            "groupLabel": group_label,
            "instanceKey": instance_key,
            "sourceSheet": source_sheet,
            "repeatWeight": repeat_weight,
            "worker": worker,
            "blockKey": block_key,
        })

    for item in row_items:
        if item["repeatWeight"] is None:
            item["effectiveRepeatWeight"] = block_repeat_weights.get(item["blockKey"])
        else:
            item["effectiveRepeatWeight"] = item["repeatWeight"]

    return row_items


def _build_sequence_groups_from_assembly_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    row_items = _iter_effective_assembly_rows_with_block_meta(rows)
    groups: List[Dict[str, Any]] = []
    current_group = None
    current_block = None

    for item in row_items:
        group_key = item["groupKey"]
        part_base = item["partBase"]
        option = item["option"]
        group_label = item["groupLabel"]
        instance_key = item["instanceKey"]
        source_sheet = item["sourceSheet"]
        worker = item["worker"]
        block_key = item["blockKey"]
        repeat_weight = item.get("effectiveRepeatWeight")

        if current_group is None or current_group["groupKey"] != group_key:
            current_group = {
                "groupKey": group_key,
                "groupLabel": group_label,
                "blocks": [],
            }
            groups.append(current_group)
            current_block = None

        if not group_label and not current_group["groupLabel"]:
            current_group["groupLabel"] = ""

        if not current_block or current_block["syncKey"] != block_key:
            current_block = {
                "groupKey": group_key,
                "groupLabel": current_group["groupLabel"],
                "syncKey": block_key,
                "instanceKey": instance_key or "",
                "partBase": part_base,
                "option": option,
                "repeatWeight": repeat_weight,
                "sourceSheet": source_sheet,
                "worker": worker,
            }
            current_group["blocks"].append(current_block)
        else:
            if repeat_weight is not None and (
                current_block["repeatWeight"] is None
                or repeat_weight > current_block["repeatWeight"]
            ):
                current_block["repeatWeight"] = repeat_weight
            if not current_block["option"] and option:
                current_block["option"] = option
            if not current_block["sourceSheet"] and source_sheet:
                current_block["sourceSheet"] = source_sheet
            if not current_block["worker"] and worker:
                current_block["worker"] = worker

    return [group for group in groups if group.get("blocks")]


def _build_worker_group_key(group_key: str, worker: str) -> str:
    return f"{group_key}::WORKER::{worker}"


def _resolve_group_anchor_position(
    existing_group_nodes: List[Dict[str, Any]],
    group_index: int,
) -> Dict[str, float]:
    positions = [
        node.get("position")
        for node in (existing_group_nodes or [])
        if isinstance(node, dict) and isinstance(node.get("position"), dict)
    ]
    if not positions:
        return {
            "x": 80.0,
            "y": float(120 + group_index * 180),
        }

    xs = [float(pos.get("x", 0) or 0) for pos in positions]
    ys = [float(pos.get("y", 0) or 0) for pos in positions]
    return {
        "x": min(xs) if xs else 80.0,
        "y": min(ys) if ys else float(120 + group_index * 180),
    }


def _sync_sequence_json_from_assembly_rows(bom_id: str, spec: str, rows: List[Dict[str, Any]]) -> None:
    sequence_path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_sequence.json"
    if not sequence_path.exists():
        return

    try:
        payload = json.loads(sequence_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load sequence JSON for sync: {exc}")

    existing_nodes = payload.get("nodes", [])
    existing_groups = payload.get("groups", [])
    existing_worker_groups = payload.get("workerGroups", [])
    deleted_nodes_by_sync_key: Dict[str, Dict[str, Any]] = {
        _as_clean_str(n.get("data", {}).get("syncKey")): n
        for n in payload.get("deletedNodes", [])
        if isinstance(n, dict) and _as_clean_str(n.get("data", {}).get("syncKey"))
    }
    if not isinstance(existing_nodes, list):
        existing_nodes = []
    if not isinstance(existing_groups, list):
        existing_groups = []
    if not isinstance(existing_worker_groups, list):
        existing_worker_groups = []

    node_by_id: Dict[str, Dict[str, Any]] = {}
    node_by_sync_key: Dict[str, Dict[str, Any]] = {}
    for node in existing_nodes:
        if not isinstance(node, dict):
            continue
        node_id = _as_clean_str(node.get("id"))
        if node_id:
            node_by_id[node_id] = node

        node_data = node.get("data")
        if isinstance(node_data, dict):
            sync_key = _as_clean_str(node_data.get("syncKey"))
            if sync_key:
                node_by_sync_key[sync_key] = node

    group_meta_by_key: Dict[str, Dict[str, Any]] = {}
    existing_group_nodes_by_key: Dict[str, List[Dict[str, Any]]] = {}
    for group in existing_groups:
        if not isinstance(group, dict):
            continue
        assembly_group_key = _as_clean_str(group.get("assemblyGroupKey"))
        group_id = _as_clean_str(group.get("id"))
        if assembly_group_key:
            normalized_group_key = assembly_group_key
        elif group_id:
            normalized_group_key = f"SEQ-GRP::{group_id}"
        else:
            normalized_group_key = ""

        if normalized_group_key:
            group_meta_by_key[normalized_group_key] = group

            raw_node_ids = group.get("nodeIds", [])
            ordered_nodes = []
            if isinstance(raw_node_ids, list):
                for raw_node_id in raw_node_ids:
                    node = node_by_id.get(_as_clean_str(raw_node_id))
                    if node:
                        ordered_nodes.append(node)
            existing_group_nodes_by_key[normalized_group_key] = ordered_nodes

    worker_group_meta_by_key: Dict[str, Dict[str, Any]] = {}
    for worker_group in existing_worker_groups:
        if not isinstance(worker_group, dict):
            continue
        worker_group_key = _as_clean_str(worker_group.get("assemblyWorkerKey"))
        if worker_group_key:
            worker_group_meta_by_key[worker_group_key] = worker_group

    rebuilt_groups = _build_sequence_groups_from_assembly_rows(rows)
    next_nodes: List[Dict[str, Any]] = []
    next_deleted_nodes: List[Dict[str, Any]] = []
    next_groups: List[Dict[str, Any]] = []
    next_worker_groups: List[Dict[str, Any]] = []
    next_edges: List[Dict[str, Any]] = []

    for group_index, group in enumerate(rebuilt_groups):
        group_key = group["groupKey"]
        existing_group = group_meta_by_key.get(group_key, {})
        ordered_group_nodes = existing_group_nodes_by_key.get(group_key, [])
        group_anchor = _resolve_group_anchor_position(ordered_group_nodes, group_index)
        existing_group_id = _as_clean_str(existing_group.get("id"))

        if group_key.startswith("SEQ-GRP::"):
            group_id = group_key.replace("SEQ-GRP::", "", 1)
        else:
            group_id = existing_group_id or f"grp-{uuid4()}"

        node_ids: List[str] = []
        worker_node_ids: Dict[str, List[str]] = {}

        for block_index, block in enumerate(group["blocks"]):
            instance_key = _as_clean_str(block.get("instanceKey"))
            sync_key = _as_clean_str(block.get("syncKey"))
            existing_node = None

            if instance_key:
                node_id = _extract_node_id_from_instance_key(instance_key)
                if node_id:
                    existing_node = node_by_id.get(node_id)

            if existing_node is None and sync_key:
                existing_node = node_by_sync_key.get(sync_key)

            if existing_node is None and sync_key:
                existing_node = deleted_nodes_by_sync_key.get(sync_key)

            if existing_node is None:
                if block_index < len(ordered_group_nodes):
                    existing_node = ordered_group_nodes[block_index]

            part_base = _as_clean_str(block.get("partBase"))
            option = _as_clean_str(block.get("option"))
            source_sheet = _as_clean_str(block.get("sourceSheet"))
            repeat_weight = block.get("repeatWeight")
            worker = _as_clean_str(block.get("worker"))

            node_type = _as_clean_str(existing_node.get("type")) if existing_node else ""
            if not node_type:
                node_type = _infer_sequence_node_type(source_sheet, part_base)

            node_id = (
                _as_clean_str(existing_node.get("id"))
                if existing_node
                else f"N-{uuid4().hex[:12]}"
            )
            is_assembly_imported = existing_node is None

            position = {
                "x": float(group_anchor["x"]) + block_index * 240,
                "y": float(group_anchor["y"]),
            }

            node_data = {}
            if existing_node and isinstance(existing_node.get("data"), dict):
                node_data.update(existing_node["data"])

            node_data.update({
                "label": part_base or node_data.get("label") or "노드",
                "partBase": part_base,
                "sourceSheet": source_sheet,
                "option": option,
                "syncKey": sync_key,
                "instanceKey": instance_key,
                "worker": worker,
                "isAssemblyImported": is_assembly_imported,
            })

            if repeat_weight is not None:
                node_data["repeatWeight"] = repeat_weight

            if node_type == "PROCESS":
                node_data["processKey"] = node_data.get("processKey") or f"{source_sheet or 'ASSEMBLY'}:{part_base}"
                node_data["processType"] = node_data.get("processType") or "STANDARD"
            else:
                node_data["partId"] = node_data.get("partId") or part_base
                node_data["partName"] = node_data.get("partName") or part_base
                node_data["inhouse"] = node_data.get("inhouse", True)
                node_data["statusLabel"] = node_data.get("statusLabel", "")

            next_node = {
                "id": node_id,
                "type": node_type,
                "position": position,
                "data": node_data,
            }

            for field in ("measured", "selected", "dragging"):
                if existing_node and field in existing_node:
                    next_node[field] = existing_node[field]

            effective_repeat = repeat_weight if repeat_weight is not None else 1
            try:
                effective_repeat = float(effective_repeat)
            except (TypeError, ValueError):
                effective_repeat = 1.0

            if effective_repeat <= 0:
                next_deleted_nodes.append(next_node)
            else:
                next_nodes.append(next_node)
                node_ids.append(node_id)
                if worker:
                    worker_node_ids.setdefault(worker, []).append(node_id)

        next_groups.append({
            "id": group_id,
            "nodeIds": node_ids,
            "label": group.get("groupLabel", ""),
            "assemblyGroupKey": group_key,
        })

        for worker_label, worker_node_id_list in worker_node_ids.items():
            worker_group_key = _build_worker_group_key(group_key, worker_label)
            existing_worker_group = worker_group_meta_by_key.get(worker_group_key, {})
            worker_group_id = _as_clean_str(existing_worker_group.get("id")) or f"wrk-{uuid4()}"
            next_worker_groups.append({
                "id": worker_group_id,
                "nodeIds": worker_node_id_list,
                "label": worker_label,
                "assemblyGroupKey": group_key,
                "assemblyWorkerKey": worker_group_key,
                "parentGroupId": group_id,
            })

        for index in range(len(node_ids) - 1):
            source_id = node_ids[index]
            target_id = node_ids[index + 1]
            next_edges.append({
                "source": source_id,
                "target": target_id,
                "type": "smoothstep",
                "id": f"xy-edge__{source_id}-{target_id}",
            })

    # Assembly rows에서 누락된 기존 노드(수동 추가 등) 보존
    rebuilt_ids = {_as_clean_str(n.get("id")) for n in next_nodes if isinstance(n, dict)}
    deleted_ids = {_as_clean_str(n.get("id")) for n in next_deleted_nodes if isinstance(n, dict)}
    orphaned_nodes = []
    for node in existing_nodes:
        if not isinstance(node, dict):
            continue

        node_id = _as_clean_str(node.get("id"))
        if node_id in rebuilt_ids or node_id in deleted_ids:
            continue

        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        # Assembly rows에서 생성된 노드는 Assembly에서 삭제되면 다시 보존하지 않는다.
        if node_data.get("isAssemblyImported") is True:
            continue

        orphaned_nodes.append(node)
    next_nodes.extend(orphaned_nodes)

    # orphaned 노드와 연결된 기존 엣지 보존
    all_next_ids = {_as_clean_str(n.get("id")) for n in next_nodes if isinstance(n, dict)}
    existing_edges = payload.get("edges", [])
    if isinstance(existing_edges, list):
        for edge in existing_edges:
            if not isinstance(edge, dict):
                continue
            src = _as_clean_str(edge.get("source"))
            tgt = _as_clean_str(edge.get("target"))
            if src in all_next_ids and tgt in all_next_ids:
                if not any(
                    _as_clean_str(e.get("source")) == src and _as_clean_str(e.get("target")) == tgt
                    for e in next_edges
                ):
                    next_edges.append(edge)

    payload["nodes"] = next_nodes
    payload["groups"] = next_groups
    payload["workerGroups"] = next_worker_groups
    payload["edges"] = next_edges
    payload["deletedNodes"] = next_deleted_nodes
    sequence_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_sequence_entries(root_dir: Path, spec: str) -> List[Dict[str, Any]]:
    sequence_json_path = root_dir / f"{spec}_sequence.json"
    if not sequence_json_path.exists():
        return []

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
    worker_groups = data.get("workerGroups", [])
    if not isinstance(groups, list):
        groups = []
    if not isinstance(worker_groups, list):
        worker_groups = []

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
    worker_by_node_id: Dict[str, str] = {}

    for worker_group in worker_groups:
        if not isinstance(worker_group, dict):
            continue
        worker_label = _as_clean_str(worker_group.get("label"))
        raw_node_ids = worker_group.get("nodeIds", [])
        if not worker_label or not isinstance(raw_node_ids, list):
            continue
        for raw_node_id in raw_node_ids:
            node_id = _as_clean_str(raw_node_id)
            if node_id:
                worker_by_node_id[node_id] = worker_label

    def order_group_node_ids(node_ids: List[Any]) -> List[str]:
        normalized_node_ids = [
            _as_clean_str(node_id)
            for node_id in node_ids
            if _as_clean_str(node_id)
        ]
        # 시퀀스 캔버스에서 정리된 group.nodeIds 순서를 그대로 사용한다.
        # 추가 위상 정렬을 하면 수동 추가 노드가 의도치 않게 앞쪽으로 재배치될 수 있다.
        return normalized_node_ids

    def add_entry(
        group_key: str,
        group_label: str,
        instance_key: str,
        node_type: str,
        part_base: str,
        option: str,
        process_label: str,
        source_sheet: str,
        repeat_weight: Optional[float],
        worker: str,
        manual_custom: bool = False,
    ) -> None:
        key = (group_key, instance_key, node_type, part_base, option, process_label, manual_custom)
        if key in index_by_key:
            idx = index_by_key[key]
            if entries[idx].get("repeatWeight") is None and repeat_weight is not None:
                entries[idx]["repeatWeight"] = repeat_weight
            if not entries[idx].get("worker") and worker:
                entries[idx]["worker"] = worker
            return

        index_by_key[key] = len(entries)
        entries.append({
            "groupKey": group_key,
            "groupLabel": group_label,
            "instanceKey": instance_key,
            "nodeType": node_type,
            "partBase": part_base,
            "option": option,
            "processLabel": process_label,
            "sourceSheet": source_sheet,
            "repeatWeight": repeat_weight,
            "worker": worker,
            "manualCustom": manual_custom,
        })

    for i, group in enumerate(groups):
        if not isinstance(group, dict):
            continue

        group_id = _as_clean_str(group.get("id")) or f"group-{i + 1}"
        group_label = _as_clean_str(group.get("label"))
        group_key = _as_clean_str(group.get("assemblyGroupKey")) or f"SEQ-GRP::{group_id}"

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
            node_type = _as_clean_str(node.get("type")).upper() or "PART"
            manual_custom = payload.get("manualCustom") is True

            part_base = _as_clean_str(payload.get("partBase"))
            source_sheet = _as_clean_str(payload.get("sourceSheet"))
            process_label = _derive_sequence_process_label(payload, node_type)
            if not part_base:
                continue

            if manual_custom:
                option = ""
            else:
                option, source_sheet = _resolve_sequence_option(
                    part_base=part_base,
                    option=payload.get("option"),
                    source_sheet=source_sheet,
                )
                if not option:
                    option = _fallback_first_option(part_base, source_sheet)
                if not option:
                    continue

            rw = _to_positive_number(payload.get("repeatWeight"))
            worker = _as_clean_str(payload.get("worker")) or worker_by_node_id.get(node_id, "")

            add_entry(
                group_key=group_key,
                group_label=group_label,
                instance_key=f"{group_key}::{node_id}",
                node_type=node_type,
                part_base=part_base,
                option=option,
                process_label=process_label,
                source_sheet=source_sheet,
                repeat_weight=rw,
                worker=worker,
                manual_custom=manual_custom,
            )

    for node_id in node_order:
        if node_id not in ungrouped:
            continue
        node = node_by_id[node_id]
        payload = node.get("data", {})
        if not isinstance(payload, dict):
            continue
        node_type = _as_clean_str(node.get("type")).upper() or "PART"
        manual_custom = payload.get("manualCustom") is True

        part_base = _as_clean_str(payload.get("partBase"))
        source_sheet = _as_clean_str(payload.get("sourceSheet"))
        process_label = _derive_sequence_process_label(payload, node_type)
        if not part_base:
            continue

        if manual_custom:
            option = ""
        else:
            option, source_sheet = _resolve_sequence_option(
                part_base=part_base,
                option=payload.get("option"),
                source_sheet=source_sheet,
            )
            if not option:
                option = _fallback_first_option(part_base, source_sheet)
            if not option:
                continue

        rw = _to_positive_number(payload.get("repeatWeight"))
        worker = _as_clean_str(payload.get("worker")) or worker_by_node_id.get(node_id, "")
        add_entry(
            group_key=f"SEQ-NODE::{node_id}",
            group_label="",
            instance_key=f"SEQ-NODE::{node_id}",
            node_type=node_type,
            part_base=part_base,
            option=option,
            process_label=process_label,
            source_sheet=source_sheet,
            repeat_weight=rw,
            worker=worker,
            manual_custom=manual_custom,
        )

    return entries


def _build_assembly_rows_from_sequence_entries(
    sequence_entries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not sequence_entries:
        return {
            "count_sequence_entries": 0,
            "count_added": 0,
            "count_skipped": 0,
            "added": [],
            "skipped": [],
        }

    ensure_assembly_cache()

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
        process_label = _as_clean_str(entry.get("processLabel"))
        source_sheet = entry["sourceSheet"]
        sequence_group_key = entry["groupKey"]
        sequence_group_label = entry["groupLabel"]
        sequence_instance_key = entry["instanceKey"]
        repeat_weight = entry.get("repeatWeight")
        worker = _as_clean_str(entry.get("worker"))
        manual_custom = entry.get("manualCustom") is True

        if manual_custom:
            out_row = {
                "부품 기준": part_base,
                "요소작업": "",
                "OPTION": "",
                "작업자": worker,
                "no": "",
                "동작요소": "",
                "반복횟수": "",
                "SEC": "",
                "TOTAL": "",
            }
            out_row["__groupKey"] = sequence_group_key
            out_row["__sequenceGroupLabel"] = sequence_group_label
            out_row["__partInstanceKey"] = sequence_instance_key
            out_row["__sourceSheet"] = source_sheet
            out_row["__manualCustom"] = True
            added.append(out_row)
            continue

        matched_rows = []
        candidate_sheets = (
            [source_sheet]
            if source_sheet and source_sheet in tasks_by_sheet
            else list(tasks_by_sheet.keys())
        )

        for sheet in candidate_sheets:
            rows = _find_task_rows_for_sequence_entry(
                tasks_by_sheet=tasks_by_sheet,
                sheet=sheet,
                part_base=part_base,
                option=option,
                process_label=process_label,
            )
            if rows:
                matched_rows = rows
                break

        if not matched_rows:
            skipped.append({
                "partBase": part_base,
                "option": option,
                "processLabel": process_label,
                "sourceSheet": source_sheet,
                "groupKey": sequence_group_key,
            })
            continue

        for row in matched_rows:
            out_row = dict(row)
            out_row["__groupKey"] = sequence_group_key
            out_row["__sequenceGroupLabel"] = sequence_group_label
            out_row["__partInstanceKey"] = sequence_instance_key
            if worker:
                out_row["작업자"] = worker

            if repeat_weight is not None:
                out_row[repeat_key] = _compact_number(repeat_weight)
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


def build_assembly_rows_from_sequence(bom_id: str, spec: str) -> Dict[str, Any]:
    root_dir = DATA_DIR / "bom_runs" / bom_id
    sequence_entries = _load_sequence_entries(root_dir, spec)
    return _build_assembly_rows_from_sequence_entries(sequence_entries)


def write_assembly_rows_json(bom_id: str, spec: str, rows: List[Dict[str, Any]]) -> Path:
    dir_path = DATA_DIR / "bom_runs" / bom_id
    dir_path.mkdir(parents=True, exist_ok=True)
    path = dir_path / f"{spec}_assembly.json"
    normalized_rows = []
    for row in rows:
        next_row = dict(row)
        if "반복횟수" in next_row:
            next_row["반복횟수"] = _compact_number(next_row.get("반복횟수"))
        if "repeatWeight" in next_row:
            next_row["repeatWeight"] = _compact_number(next_row.get("repeatWeight"))
        normalized_rows.append(next_row)
    path.write_text(
        json.dumps({"rows": normalized_rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


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


@router.get("/all-part-bases")
def get_all_part_bases():
    ensure_assembly_cache()
    result = []
    for sheet, parts in ASSEMBLY_CACHE["parts"].items():
        for part_base in parts:
            result.append({"partBase": part_base, "sheet": sheet})
    return result


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
    sequence_path = dir_path / f"{spec}_sequence.json"

    if not rows:
        if path.exists() or sequence_path.exists():
            raise HTTPException(
                status_code=400,
                detail="빈 조립 총공수 데이터는 기존 파일을 덮어쓸 수 없습니다."
            )
        raise HTTPException(
            status_code=400,
            detail="저장할 조립 총공수 데이터가 없습니다."
        )

    normalized_rows = []
    for row in rows:
        next_row = dict(row)
        if "반복횟수" in next_row:
            next_row["반복횟수"] = _compact_number(next_row.get("반복횟수"))
        if "repeatWeight" in next_row:
            next_row["repeatWeight"] = _compact_number(next_row.get("repeatWeight"))
        normalized_rows.append(next_row)

    payload = {
        "rows": normalized_rows,
        "assemblyVersion": int(time.time() * 1000),
    }

    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    _sync_sequence_json_from_assembly_rows(bom_id, spec, normalized_rows)

    return {"status": "ok"}



@router.get("/bom/{bom_id}/spec/{spec}/version-info")
def get_version_info(bom_id: str, spec: str):
    assembly_path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_assembly.json"
    sequence_path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_sequence.json"

    assembly_version = 0
    if assembly_path.exists():
        try:
            data = json.loads(assembly_path.read_text(encoding="utf-8"))
            assembly_version = int(data.get("assemblyVersion") or 0)
        except Exception:
            pass

    sequence_version = 0
    if sequence_path.exists():
        try:
            data = json.loads(sequence_path.read_text(encoding="utf-8"))
            sequence_version = int(data.get("sequenceVersion") or 0)
        except Exception:
            pass

    return {
        "assemblyVersion": assembly_version,
        "sequenceVersion": sequence_version,
        "hasAssembly": assembly_path.exists(),
        "hasSequence": sequence_path.exists(),
    }


@router.get("/bom/{bom_id}/spec/{spec}/load")
def load_assembly(bom_id: str, spec: str):
    path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_assembly.json"

    if not path.exists():
        return {"rows": []}

    data = json.loads(path.read_text(encoding="utf-8"))
    return data


@router.get("/bom/{bom_id}/spec/{spec}/action-elements")
def get_assembly_action_elements(
    bom_id: str,
    spec: str,
    part_base: str = "",
    option: str = "",
    process_label: str = "",
    instance_key: str = "",
):
    path = DATA_DIR / "bom_runs" / bom_id / f"{spec}_assembly.json"
    if not path.exists():
        return {"rows": [], "count": 0}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"rows": [], "count": 0}

    raw_rows = data.get("rows", []) if isinstance(data, dict) else []
    effective_rows = _build_effective_assembly_rows(raw_rows)

    norm_part = _as_clean_str(part_base).lower()
    norm_option = _as_clean_str(option).lower()
    norm_process = _as_clean_str(process_label).lower()
    norm_instance = _as_clean_str(instance_key)

    result_rows = []
    part_found = False
    for row in effective_rows:
        row_part = _as_clean_str(row.get("부품 기준", "")).lower()
        if not norm_part or row_part != norm_part:
            continue

        if norm_option:
            row_option = _as_clean_str(row.get("OPTION", "")).lower()
            if row_option != norm_option:
                continue

        if norm_process:
            row_process = _as_clean_str(row.get("요소작업", "")).lower()
            if row_process != norm_process:
                continue

        if norm_instance:
            row_instance = _as_clean_str(row.get("__partInstanceKey", ""))
            if row_instance != norm_instance:
                continue

        # 파트가 조립 JSON에 존재함 (반복횟수/동작요소 필터 전에 표시)
        part_found = True

        action_element = _as_clean_str(row.get("동작요소", ""))
        if not action_element:
            continue

        repeat_val = row.get("반복횟수")
        try:
            repeat = float(repeat_val) if repeat_val is not None else 1
        except (TypeError, ValueError):
            repeat = 1
        if repeat == 0:
            continue

        result_rows.append({
            "partBase": row.get("부품 기준", ""),
            "processLabel": row.get("요소작업", ""),
            "option": row.get("OPTION", ""),
            "worker": row.get("작업자", ""),
            "category": row.get("no", ""),
            "actionElement": action_element,
        })

    return {
        "partBase": part_base,
        "option": option,
        "rows": result_rows,
        "count": len(result_rows),
        "partFound": part_found,
    }


@router.get("/session-info")
def get_session_info(request: Request, response: Response):
    sid = get_or_create_sid(request, response)
    refresh_session_state()
    state = SESSION_STATE.get(sid)

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
    return build_assembly_rows_from_sequence(bom_id, spec)



