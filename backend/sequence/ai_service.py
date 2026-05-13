from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Set

from fastapi import HTTPException

from backend.sequence.ai_provider import generate_sequence_draft
from backend.sequence.schema import (
    SequenceAIDraftRequest,
    SequenceAIDraftResponse,
    SequenceAIDraftStep,
)


DATA_DIR = Path("backend")
logger = logging.getLogger(__name__)
FASTENER_KEYWORDS = (
    "SCREW",
    "BOLT",
    "NUT",
    "FASTENER",
    "TIGHTEN",
    "체결",
    "스크류",
    "볼트",
    "나사",
    "너트",
)
DEFAULT_REASON_TEXT = "AI 추천"
DEFAULT_SUMMARY_TEXT = "선택 부품과 트리 구조를 바탕으로 생성한 시퀀스 초안입니다."
DEFAULT_WARNING_TEXT = "AI 응답 문구를 한국어 기본값으로 정리했습니다."
PROCESS_HINT_GROUPS = (
    ("PCB", "LDM", "기판"),
    ("플라스틱", "PLASTIC", "HOUSING", "HSG"),
    ("비철", "금속", "METAL", "HEAT SINK", "BRKT", "BRACKET"),
)
PART_NAME_STOP_TOKENS = {
    "LH",
    "RH",
    "STD",
    "ECE",
    "LHD",
    "RHD",
    "LD",
    "HD",
    "EC",
    "LEFT",
    "RIGHT",
    "TYPE",
    "TYP",
    "ASSY",
    "S/A",
}
PART_NAME_SYNONYMS = {
    "OTR": "MAIN",
    "OUTER": "MAIN",
    "INR": "INNER",
    "HSG": "HOUSING",
    "BRKT": "BRACKET",
    "BPR": "BUMPER",
    "WIRG": "WIRING",
    "WIRE": "WIRING",
    "TURN": "T/SIG",
    "SIGNAL": "",
}


def _is_manual_barcode_reading_process_text(*values: Any) -> bool:
    haystack = " ".join(str(value or "") for value in values)
    normalized = re.sub(r"\s+", " ", haystack).strip().upper()
    compact = re.sub(r"[^A-Z0-9가-힣]+", "", normalized)
    has_barcode = any(keyword in normalized for keyword in ("바코드", "BAR CODE", "BAR-CODE", "BARCODE"))
    has_reading = any(keyword in normalized for keyword in ("리딩", "READ", "READING", "SCAN", "스캔"))
    return (has_barcode and has_reading) or "단순 리딩 작업" in normalized or "단순리딩작업" in compact


def _is_manual_barcode_reading_process_template(item: Any) -> bool:
    return _is_manual_barcode_reading_process_text(
        getattr(item, "processKey", None),
        getattr(item, "label", None),
        getattr(item, "partBase", None),
        getattr(item, "sourceSheet", None),
    )


def _emit_progress(tag: str, message: str) -> None:
    return


def _stringify_node(node: Dict[str, Any]) -> str:
    return " ".join(
        str(node.get(key) or "").strip()
        for key in ("id", "name", "part_no", "material")
    ).upper()


def _is_fastener_like(node: Dict[str, Any]) -> bool:
    haystack = _stringify_node(node)
    return any(keyword.upper() in haystack for keyword in FASTENER_KEYWORDS)


def _load_tree_nodes(bom_id: str, spec: str) -> List[Dict[str, Any]]:
    json_path = DATA_DIR / "data" / "bom_runs" / bom_id / f"{spec}.json"
    if not json_path.exists():
        return []

    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    nodes = payload.get("nodes", [])
    return nodes if isinstance(nodes, list) else []


def _selected_node_names_in_request_order(payload: SequenceAIDraftRequest) -> List[str]:
    ordered_names: List[str] = []
    seen = set()
    for item in payload.selectedParts:
        node_name = str(item.nodeName or "").strip()
        if not node_name or node_name in seen:
            continue
        seen.add(node_name)
        ordered_names.append(node_name)
    return ordered_names


def _build_tree_context(payload: SequenceAIDraftRequest) -> Dict[str, Any]:
    nodes = _load_tree_nodes(payload.bomId, payload.spec)
    if not nodes:
        return {}

    node_by_name = {
        str(node.get("name") or "").strip(): node
        for node in nodes
        if str(node.get("name") or "").strip()
    }

    children_by_parent: Dict[str, List[Dict[str, Any]]] = {}
    for node in nodes:
        parent_name = str(node.get("parent_name") or "").strip()
        children_by_parent.setdefault(parent_name, []).append(node)

    def collect_descendants(node_name: str) -> List[Dict[str, Any]]:
        collected: List[Dict[str, Any]] = []
        queue = list(children_by_parent.get(node_name, []))
        while queue:
            current = queue.pop(0)
            collected.append(current)
            queue.extend(children_by_parent.get(str(current.get("name") or "").strip(), []))
        return collected

    selected_contexts: List[Dict[str, Any]] = []
    selected_parent_names: List[str] = []

    for selected in payload.selectedParts:
        node_name = selected.nodeName
        tree_node = node_by_name.get(node_name)
        if not tree_node:
            continue

        parent_name = str(tree_node.get("parent_name") or "").strip()
        if parent_name:
            selected_parent_names.append(parent_name)

        descendants = collect_descendants(node_name)
        descendant_hardware = [
            {
                "id": node.get("id"),
                "name": node.get("name"),
                "part_no": node.get("part_no"),
            }
            for node in descendants
            if _is_fastener_like(node)
        ][:10]

        sibling_hardware = [
            {
                "id": node.get("id"),
                "name": node.get("name"),
                "part_no": node.get("part_no"),
            }
            for node in children_by_parent.get(parent_name, [])
            if str(node.get("name") or "").strip() != node_name and _is_fastener_like(node)
        ][:10]

        selected_contexts.append(
            {
                "nodeName": node_name,
                "treeNodeId": tree_node.get("id"),
                "parentName": parent_name or None,
                "descendantHardware": descendant_hardware,
                "siblingHardware": sibling_hardware,
            }
        )

    common_parent_name = None
    unique_parent_names = {name for name in selected_parent_names if name}
    if len(unique_parent_names) == 1:
        common_parent_name = next(iter(unique_parent_names))

    fastening_process_candidates = [
        {
            "processKey": item.processKey,
            "label": item.label,
            "sourceSheet": item.sourceSheet,
        }
        for item in (payload.processTemplates or [])
        if any(keyword.upper() in f"{item.processKey} {item.label} {item.partBase or ''}".upper() for keyword in FASTENER_KEYWORDS)
    ][:20]

    return {
        "commonParentName": common_parent_name,
        "selectedPartContexts": selected_contexts,
        "fasteningProcessCandidates": fastening_process_candidates,
    }


def _looks_korean(text: str) -> bool:
    if not text:
        return False
    return any("\uac00" <= char <= "\ud7a3" for char in text)


def _sanitize_korean_text(text: Any, fallback: str) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return fallback
    if _looks_korean(normalized):
        return normalized
    return fallback


def _normalize_part_text(text: Any) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return ""

    normalized = re.sub(r"\[[^\]]*\]", " ", normalized)
    normalized = normalized.replace("-", " ").replace("_", " ")
    normalized = normalized.upper()
    normalized = re.sub(r"[^A-Z0-9/ ]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    tokens: List[str] = []
    for token in normalized.split(" "):
        if not token:
            continue
        if token in PART_NAME_STOP_TOKENS:
            break
        token = PART_NAME_SYNONYMS.get(token, token)
        if token:
            tokens.append(token)

    return " ".join(tokens).strip()


def _resolve_selected_part_name(node_name: str, payload: SequenceAIDraftRequest) -> str:
    raw_name = str(node_name or "").strip()
    if not raw_name:
        return ""

    selected_names = {
        str(item.nodeName or "").strip(): str(item.nodeName or "").strip()
        for item in payload.selectedParts
        if str(item.nodeName or "").strip()
    }
    if raw_name in selected_names:
        return raw_name

    normalized_target = _normalize_part_text(raw_name)
    if not normalized_target:
        return ""

    best_name = ""
    best_score = -1

    for item in payload.selectedParts:
        candidate_names = [
            str(item.nodeName or "").strip(),
            str(item.partId or "").strip(),
            str(item.partName or "").strip(),
            str(item.partBase or "").strip(),
        ]
        matched = False
        candidate_score = 0

        for candidate in candidate_names:
            if not candidate:
                continue
            normalized_candidate = _normalize_part_text(candidate)
            if not normalized_candidate:
                continue
            if normalized_candidate == normalized_target:
                return str(item.nodeName or "").strip()
            if normalized_candidate in normalized_target or normalized_target in normalized_candidate:
                matched = True
                candidate_score = max(candidate_score, min(len(normalized_candidate), len(normalized_target)))
                continue

            target_tokens = set(normalized_target.split())
            candidate_tokens = set(normalized_candidate.split())
            overlap = len(target_tokens & candidate_tokens)
            if overlap > 0:
                matched = True
                candidate_score = max(candidate_score, overlap)

        if matched and candidate_score > best_score:
            best_score = candidate_score
            best_name = str(item.nodeName or "").strip()

    return best_name


def _extract_screw_length(text: str) -> int | None:
    normalized = str(text or "").upper()
    match = re.search(r"M\d+(?:\.\d+)?\s*X\s*(\d+)", normalized)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None

    match = re.search(r"(\d+)\s*MM", normalized)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None

    return None


def _infer_process_preferences(text: str) -> Dict[str, bool]:
    normalized = str(text or "").upper()
    screw_length = _extract_screw_length(normalized)

    return {
        "pcb": any(keyword in normalized for keyword in ("PCB", "LDM", "기판")),
        "plastic": any(keyword in normalized for keyword in ("PLASTIC", "플라스틱", "HOUSING", "HSG", "BEZEL", "LENS")),
        "nonferrous": any(
            keyword in normalized
            for keyword in ("비철", "금속", "METAL", "HEAT SINK", "BRKT", "BRACKET", "AL", "ALUMINUM")
        ),
        "length_ge_15": screw_length is not None and screw_length >= 15,
        "length_lt_15": screw_length is not None and screw_length < 15,
    }


def _tokenize_process_text(text: str) -> Set[str]:
    normalized = str(text or "").upper()
    tokens = {
        token
        for token in re.findall(r"[A-Z0-9/]+|[가-힣]+", normalized)
        if len(token) >= 2
    }
    return {
        token
        for token in tokens
        if token not in {"PROCESS", "PART", "WORK", "작업", "공정", "조립", "ASSY"}
    }


def _score_process_template(process: Any, text: str) -> int:
    haystack = f"{process.processKey} {process.label or ''} {process.partBase or ''}".upper()
    source_text = text.upper()
    score = 0
    preferences = _infer_process_preferences(source_text)
    source_tokens = _tokenize_process_text(source_text)
    template_tokens = _tokenize_process_text(haystack)

    if process.processKey and process.processKey.upper() in source_text:
        score += 100
    label = str(process.label or "").strip()
    if label and label.upper() in source_text:
        score += 80

    token_overlap = len(source_tokens & template_tokens)
    if token_overlap:
        score += min(token_overlap, 4) * 12

    for keyword in FASTENER_KEYWORDS:
        if keyword.upper() in haystack and keyword.upper() in source_text:
            score += 20

    for index, keyword_group in enumerate(PROCESS_HINT_GROUPS):
        if any(keyword.upper() in source_text for keyword in keyword_group):
            if any(keyword.upper() in haystack for keyword in keyword_group):
                score += 15 - index

    if preferences["pcb"]:
        if "PCB" in haystack:
            score += 45
        elif any(keyword in haystack for keyword in ("플라스틱", "PLASTIC", "비철", "금속", "METAL")):
            score -= 10

    if preferences["plastic"]:
        if any(keyword in haystack for keyword in ("플라스틱", "PLASTIC")):
            score += 30
        elif "PCB" in haystack:
            score -= 5

    if preferences["nonferrous"]:
        if any(keyword in haystack for keyword in ("비철", "금속", "METAL")):
            score += 35
        elif any(keyword in haystack for keyword in ("플라스틱", "PLASTIC")):
            score -= 5

    if preferences["length_ge_15"]:
        if any(keyword in haystack for keyword in ("15MM", "15MM이상", "15MM 이상", "15", "이상")):
            score += 40
    elif preferences["length_lt_15"]:
        if any(keyword in haystack for keyword in ("15MM", "15MM이상", "15MM 이상", "이상")):
            score -= 20

    if "T/SCREW" in haystack:
        score += 5

    return score


def _match_process_key_from_text(
    text: str,
    process_templates: List[Any],
    preferred_keys: Set[str] | None = None,
) -> str:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return ""

    best_key = ""
    best_score = 0
    preferred_keys = preferred_keys or set()

    for item in process_templates:
        if preferred_keys and item.processKey not in preferred_keys:
            continue
        score = _score_process_template(item, normalized_text)
        if score > best_score:
            best_score = score
            best_key = item.processKey

    if best_key and best_score > 0:
        return best_key

    return ""


def _is_fastening_process(process: Any) -> bool:
    haystack = f"{process.processKey} {process.label or ''} {process.partBase or ''}".upper()
    return any(keyword.upper() in haystack for keyword in FASTENER_KEYWORDS)


def _is_fastening_process_key(process_key: str) -> bool:
    haystack = str(process_key or "").upper()
    return any(keyword.upper() in haystack for keyword in FASTENER_KEYWORDS)


def _normalize_process_family(process_key: str) -> str:
    normalized = str(process_key or "").strip().upper()
    if not normalized:
        return ""

    normalized = normalized.replace("엑셀 변환:", " ").replace("EXCEL IMPORT:", " ")
    normalized = re.sub(r"\([^)]*\)", " ", normalized)
    normalized = re.sub(r"#\s*\d+\b", " ", normalized)
    normalized = re.sub(r"\b\d+MM(?:이상)?\b", " ", normalized)
    normalized = re.sub(r"[^A-Z0-9/ ]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _dedupe_consecutive_process_steps(
    steps: List[SequenceAIDraftStep],
) -> List[SequenceAIDraftStep]:
    deduped_steps: List[SequenceAIDraftStep] = []

    for step in steps:
        previous = deduped_steps[-1] if deduped_steps else None
        previous_key = str(previous.processKey or "").strip() if previous else ""
        current_key = str(step.processKey or "").strip()

        if (
            previous
            and previous.type == "PROCESS"
            and step.type == "PROCESS"
            and previous_key == current_key
        ):
            _emit_progress(
                "[PROCESS_DEDUPED]",
                f"processKey={step.processKey}",
            )
            continue

        if (
            previous
            and previous.type == "PROCESS"
            and step.type == "PROCESS"
            and _normalize_process_family(previous_key)
            and _normalize_process_family(previous_key) == _normalize_process_family(current_key)
        ):
            _emit_progress(
                "[PROCESS_FAMILY_DEDUPED]",
                f"previous={previous_key} current={current_key}",
            )
            continue

        deduped_steps.append(step)

    return deduped_steps


def _build_fallback_sequence_steps(
    draft: Dict[str, Any],
    payload: SequenceAIDraftRequest,
) -> List[SequenceAIDraftStep]:
    selected_node_names: Set[str] = {item.nodeName for item in payload.selectedParts}
    process_keys: Set[str] = {
        item.processKey
        for item in (payload.processTemplates or [])
        if not _is_manual_barcode_reading_process_template(item)
    }
    process_templates = [
        item
        for item in (payload.processTemplates or [])
        if not _is_manual_barcode_reading_process_template(item)
    ]
    ordered_selected_node_names = [
        node_name
        for node_name in _selected_node_names_in_request_order(payload)
        if node_name in selected_node_names
    ]
    if not ordered_selected_node_names:
        ordered_selected_node_names = _selected_node_names_in_request_order(payload)
    fallback_steps: List[SequenceAIDraftStep] = []
    used_part_names: Set[str] = set()
    used_process_keys: Set[str] = set()

    def append_part_once(node_name: str) -> None:
        if (
            node_name
            and node_name in selected_node_names
            and node_name not in used_part_names
        ):
            fallback_steps.append(
                SequenceAIDraftStep(
                    type="PART",
                    nodeName=node_name,
                    reason=DEFAULT_REASON_TEXT,
                )
            )
            used_part_names.add(node_name)

    def append_process_once(process_key: str) -> None:
        if (
            process_key
            and process_key in process_keys
            and process_key not in used_process_keys
        ):
            fallback_steps.append(
                SequenceAIDraftStep(
                    type="PROCESS",
                    processKey=process_key,
                    reason=DEFAULT_REASON_TEXT,
                )
            )
            used_process_keys.add(process_key)

    raw_processes = draft.get("processes", []) or []
    if not isinstance(raw_processes, list):
        raw_processes = []

    for raw_process in raw_processes:
        process_key = str(raw_process.get("processKey") or "").strip()
        if not process_key or process_key in used_process_keys:
            process_key = _match_process_key_from_text(
                " ".join(
                    str(raw_process.get(key) or "").strip()
                    for key in ("processKey", "label", "sourceSheet")
                ),
                process_templates,
                process_keys,
            )
        if not process_key or process_key not in process_keys or process_key in used_process_keys:
            continue

        applied_parts = [
            str(node_name or "").strip()
            for node_name in (raw_process.get("appliedToParts", []) or [])
            if str(node_name or "").strip() in selected_node_names
        ]

        if not applied_parts:
            continue

        ordered_applied_parts: List[str] = []
        for node_name in ordered_selected_node_names:
            if node_name in applied_parts and node_name not in ordered_applied_parts:
                ordered_applied_parts.append(node_name)

        if not ordered_applied_parts:
            continue

        for node_name in ordered_applied_parts:
            append_part_once(node_name)

        append_process_once(process_key)

    raw_assembly_steps = draft.get("assemblySteps", []) or []
    if not isinstance(raw_assembly_steps, list):
        raw_assembly_steps = []

    for raw_step in raw_assembly_steps:
        text = " ".join(
            str(raw_step.get(key) or "").strip()
            for key in ("description", "details")
        )
        if not text:
            continue

        matched_parts = [
            item.nodeName
            for item in payload.selectedParts
            if item.nodeName in text
        ]
        preferred_process_keys = {
            item.processKey
            for item in process_templates
            if matched_parts and _is_fastening_process(item)
        }
        matched_process_key = _match_process_key_from_text(
            text,
            process_templates,
            preferred_process_keys,
        )

        for node_name in matched_parts:
            append_part_once(node_name)
        append_process_once(matched_process_key)

    if not used_process_keys:
        fallback_text = json.dumps(draft, ensure_ascii=False)
        fallback_process_key = _match_process_key_from_text(
            fallback_text,
            process_templates,
            process_keys,
        )
        if fallback_process_key:
            inserted = False
            for node_name in ordered_selected_node_names:
                if node_name in used_part_names:
                    append_process_once(fallback_process_key)
                    inserted = True
                    break
            if not inserted and ordered_selected_node_names:
                append_part_once(ordered_selected_node_names[0])
                append_process_once(fallback_process_key)

    for node_name in ordered_selected_node_names:
        append_part_once(node_name)

    return fallback_steps


def _normalize_sequence_steps(
    draft: Dict[str, Any],
    payload: SequenceAIDraftRequest,
) -> List[SequenceAIDraftStep]:
    selected_node_names: Set[str] = {item.nodeName for item in payload.selectedParts}
    process_keys: Set[str] = {
        item.processKey
        for item in (payload.processTemplates or [])
        if not _is_manual_barcode_reading_process_template(item)
    }

    normalized_steps: List[SequenceAIDraftStep] = []

    for raw_step in draft.get("sequence", []) or []:
        step_type = str(raw_step.get("type") or "").strip().upper()
        node_name = str(raw_step.get("nodeName") or "").strip()
        process_key = str(raw_step.get("processKey") or "").strip()

        if not step_type:
            if node_name:
                step_type = "PART"
            elif process_key:
                step_type = "PROCESS"

        if step_type == "PART":
            resolved_node_name = _resolve_selected_part_name(node_name, payload)
            if not resolved_node_name or resolved_node_name not in selected_node_names:
                _emit_progress(
                    "[PART_REJECTED]",
                    f"returned={node_name or '(empty)'} selected={list(selected_node_names)}",
                )
                raise HTTPException(
                    status_code=422,
                    detail=f"AI가 허용되지 않은 PART를 반환했습니다: {node_name or '(empty)'}",
                )
            if resolved_node_name != node_name:
                _emit_progress(
                    "[PART_NORMALIZED]",
                    f"returned={node_name} resolved={resolved_node_name}",
                )
            normalized_steps.append(
                SequenceAIDraftStep(
                    type="PART",
                    nodeName=resolved_node_name,
                    reason=_sanitize_korean_text(raw_step.get("reason"), DEFAULT_REASON_TEXT),
                )
            )
            continue

        if step_type == "PROCESS":
            if not process_key or process_key not in process_keys:
                resolved_process_key = _match_process_key_from_text(
                    " ".join(
                        str(raw_step.get(key) or "").strip()
                        for key in ("processKey", "label", "reason")
                    ),
                    list(payload.processTemplates or []),
                    process_keys,
                )
                if resolved_process_key:
                    _emit_progress(
                        "[PROCESS_NORMALIZED]",
                        f"returned={process_key or '(empty)'} resolved={resolved_process_key}",
                    )
                    process_key = resolved_process_key

            if not process_key or process_key not in process_keys:
                raise HTTPException(
                    status_code=422,
                    detail=f"AI가 허용되지 않은 PROCESS를 반환했습니다: {process_key or '(empty)'}",
                )
            if _is_manual_barcode_reading_process_text(
                process_key,
                raw_step.get("label"),
                raw_step.get("reason"),
            ):
                continue
            normalized_steps.append(
                SequenceAIDraftStep(
                    type="PROCESS",
                    processKey=process_key,
                    reason=_sanitize_korean_text(raw_step.get("reason"), DEFAULT_REASON_TEXT),
                )
            )
            continue

        continue

    if not normalized_steps:
        normalized_steps = _build_fallback_sequence_steps(draft, payload)

    if not normalized_steps:
        raise HTTPException(status_code=422, detail="AI sequence 결과가 비어 있습니다.")

    normalized_steps = _dedupe_consecutive_process_steps(normalized_steps)

    part_step_by_name: Dict[str, SequenceAIDraftStep] = {}
    process_entries: List[tuple[int, SequenceAIDraftStep, int]] = []
    seen_part_count = 0

    for index, step in enumerate(normalized_steps):
        if step.type == "PART":
            seen_part_count += 1
            if step.nodeName and step.nodeName not in part_step_by_name:
                part_step_by_name[step.nodeName] = step
            continue
        if step.type == "PROCESS":
            process_entries.append((index, step, seen_part_count))

    # Preserve the AI-produced PART order instead of reordering by tree position.
    ordered_part_steps = list(part_step_by_name.values())

    if not ordered_part_steps:
        return normalized_steps

    process_slots: Dict[int, List[SequenceAIDraftStep]] = {}
    total_parts = len(ordered_part_steps)
    for index, step, preceding_part_count in process_entries:
        slot = min(max(preceding_part_count, 1), total_parts)
        if total_parts >= 2 and _is_fastening_process_key(step.processKey or ""):
            slot = min(max(slot, 2), total_parts)
        process_slots.setdefault(slot, []).append(step)

    stabilized_steps: List[SequenceAIDraftStep] = []
    for part_index, part_step in enumerate(ordered_part_steps, start=1):
        stabilized_steps.append(part_step)
        stabilized_steps.extend(process_slots.get(part_index, []))

    return _dedupe_consecutive_process_steps(stabilized_steps)


def generate_sequence_ai_draft(
    payload: SequenceAIDraftRequest,
) -> SequenceAIDraftResponse:
    started_at = time.perf_counter()
    if not payload.selectedParts:
        raise HTTPException(status_code=400, detail="selectedParts가 비어 있습니다.")
    if not payload.processTemplates:
        raise HTTPException(status_code=400, detail="processTemplates가 비어 있습니다.")

    _emit_progress(
        "[START]",
        f"bomId={payload.bomId} spec={payload.spec} "
        f"selectedParts={len(payload.selectedParts or [])} "
        f"processTemplates={len(payload.processTemplates or [])}",
    )
    tree_context = _build_tree_context(payload)
    _emit_progress(
        "[TREE_CONTEXT]",
        f"commonParent={tree_context.get('commonParentName')} "
        f"selectedContexts={len(tree_context.get('selectedPartContexts', []) or [])} "
        f"fasteningCandidates={len(tree_context.get('fasteningProcessCandidates', []) or [])}",
    )
    provider_result = generate_sequence_draft(payload, tree_context)
    draft = provider_result["draft"]
    _emit_progress(
        "[PROVIDER_RESULT]",
        f"provider={provider_result.get('provider')} model={provider_result.get('model')} "
        f"draftSequence={len(draft.get('sequence', []) or [])} "
        f"draftWarnings={len(draft.get('warnings', []) or [])}",
    )

    sequence = _normalize_sequence_steps(draft, payload)
    confidence = draft.get("confidence", 0.0)
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0

    warnings = []
    replaced_non_korean_text = False
    for item in (draft.get("warnings", []) or []):
        normalized_warning = str(item or "").strip()
        if not normalized_warning:
            continue
        if _looks_korean(normalized_warning):
            warnings.append(normalized_warning)
            continue
        replaced_non_korean_text = True

    reasoning_summary = _sanitize_korean_text(
        draft.get("reasoningSummary"),
        DEFAULT_SUMMARY_TEXT,
    )
    if reasoning_summary == DEFAULT_SUMMARY_TEXT and str(draft.get("reasoningSummary") or "").strip():
        replaced_non_korean_text = True

    if replaced_non_korean_text:
        warnings.append(DEFAULT_WARNING_TEXT)

    response = SequenceAIDraftResponse(
        provider=provider_result["provider"],
        model=provider_result["model"],
        groupLabel=str(draft.get("groupLabel") or "AI 추천 그룹").strip() or "AI 추천 그룹",
        confidence=max(0.0, min(confidence, 1.0)),
        reasoningSummary=reasoning_summary,
        sequence=sequence,
        warnings=warnings,
        raw=provider_result.get("raw"),
    )
    elapsed = time.perf_counter() - started_at
    _emit_progress(
        "[DONE]",
        f"bomId={payload.bomId} spec={payload.spec} "
        f"steps={len(response.sequence or [])} warnings={len(response.warnings or [])} "
        f"confidence={response.confidence:.3f} elapsed={elapsed:.2f}s",
    )
    return response
