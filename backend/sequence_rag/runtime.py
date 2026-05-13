from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.sequence.schema import SequenceAIDraftRequest

from .builder import build_index_from_sequence_dir, write_index
from .models import GraphIndex
from .neo4j_retriever import retrieve_references_from_neo4j
from .retriever import recommend_windows, summarize_process_candidates

_INDEX_CACHE: Optional[GraphIndex] = None
_INDEX_PATH_CACHE: str = ""
logger = logging.getLogger(__name__)
RAG_BACKEND = os.getenv("SEQUENCE_RAG_BACKEND", "hybrid").strip().lower()


def _default_sequence_dir() -> Path:
    configured_dir = os.getenv("SEQUENCE_SOURCE_SEQUENCE_DIR", "").strip()
    if configured_dir:
        return Path(configured_dir)
    return Path(__file__).resolve().parent / "source_sequences"


def _default_index_path() -> Path:
    configured_path = os.getenv("SEQUENCE_GRAPH_INDEX_PATH", "").strip()
    if configured_path:
        return Path(configured_path)
    return Path(__file__).resolve().parent / "data" / "graph_index.json"


def _extract_selected_part_ids(payload: SequenceAIDraftRequest) -> List[str]:
    selected_part_ids: List[str] = []
    seen = set()
    for item in (payload.selectedParts or []):
        candidate = " ".join(
            str(item.partBase or item.partId or item.nodeName or "").split()
        ).strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        selected_part_ids.append(candidate)
    return selected_part_ids


def _extract_allowed_process_labels(payload: SequenceAIDraftRequest) -> List[str]:
    return [
        " ".join(str(item.label or "").split()).strip()
        for item in (payload.processTemplates or [])
        if str(item.label or "").strip()
    ]


def _summarize_reference_windows(items: List[Dict[str, Any]], *, limit: int = 5) -> List[str]:
    summaries: List[str] = []
    for item in items[:limit]:
        doc_id = " ".join(str(item.get("docId") or "").split()).strip()
        source_name = " ".join(str(item.get("sourceName") or "").split()).strip()
        window_index = item.get("windowIndex")
        backend = " ".join(str(item.get("retrievalBackend") or "").split()).strip()
        parts = list(item.get("anchorPartIds") or [])
        processes = list(item.get("processLabels") or [])
        summaries.append(
            f"docId={doc_id or '-'} source={source_name or '-'} window={window_index} "
            f"backend={backend or '-'} parts={parts[:3]} processes={processes[:3]}"
        )
    return summaries


def _summarize_process_candidates(items: List[Dict[str, Any]], *, limit: int = 5) -> List[str]:
    summaries: List[str] = []
    for item in items[:limit]:
        process_label = " ".join(str(item.get("processLabel") or "").split()).strip()
        matched_windows = int(item.get("matchedWindows") or item.get("count") or 0)
        backend = " ".join(str(item.get("retrievalBackend") or "").split()).strip()
        summaries.append(
            f"processLabel={process_label or '-'} matchedWindows={matched_windows} backend={backend or '-'}"
        )
    return summaries


def _log_rag_result(
    stage: str,
    result: Dict[str, List[Dict[str, Any]]],
    *,
    selected_part_ids: List[str],
    allowed_process_labels: List[str],
) -> None:
    return


def _normalize_token_text(value: Any) -> str:
    text = " ".join(str(value or "").split()).strip().upper()
    if not text:
        return ""
    text = text.replace("-", " ").replace("_", " ")
    text = re.sub(r"[^A-Z0-9/ ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _token_set(value: Any) -> set[str]:
    return {token for token in _normalize_token_text(value).split(" ") if token}


def _is_manual_barcode_reading_process(*values: Any) -> bool:
    haystack = " ".join(str(value or "") for value in values)
    normalized = " ".join(haystack.split()).strip().upper()
    compact = re.sub(r"[^A-Z0-9가-힣]+", "", normalized)
    has_barcode = any(keyword in normalized for keyword in ("바코드", "BAR CODE", "BAR-CODE", "BARCODE"))
    has_reading = any(keyword in normalized for keyword in ("리딩", "READ", "READING", "SCAN", "스캔"))
    return (has_barcode and has_reading) or "단순 리딩 작업" in normalized or "단순리딩작업" in compact


def summarize_part_process_recommendations(
    payload: SequenceAIDraftRequest,
    *,
    per_part_limit: int = 5,
) -> List[Dict[str, Any]]:
    recommendations: List[Dict[str, Any]] = []
    process_templates = list(payload.processTemplates or [])

    for part in payload.selectedParts or []:
        node_name = " ".join(str(part.nodeName or "").split()).strip()
        if not node_name:
            continue

        part_base = " ".join(str(part.partBase or "").split()).strip()
        part_source_sheet = " ".join(str(part.sourceSheet or "").split()).strip()
        part_tokens = (
            _token_set(node_name)
            | _token_set(part.partId)
            | _token_set(part.partName)
            | _token_set(part_base)
        )

        ranked: List[Dict[str, Any]] = []
        for process in process_templates:
            process_key = " ".join(str(process.processKey or "").split()).strip()
            if not process_key:
                continue

            process_label = " ".join(str(process.label or "").split()).strip()
            process_part_base = " ".join(str(process.partBase or "").split()).strip()
            process_source_sheet = " ".join(str(process.sourceSheet or "").split()).strip()
            if _is_manual_barcode_reading_process(
                process_key,
                process_label,
                process_part_base,
                process_source_sheet,
            ):
                continue
            process_tokens = (
                _token_set(process_key)
                | _token_set(process_label)
                | _token_set(process_part_base)
            )

            score = 0
            reasons: List[str] = []

            if part_source_sheet and process_source_sheet and part_source_sheet == process_source_sheet:
                score += 5
                reasons.append("same_source_sheet")

            if part_base and process_part_base and part_base == process_part_base:
                score += 7
                reasons.append("same_part_base")

            overlap = sorted(part_tokens & process_tokens)
            if overlap:
                score += min(len(overlap), 4)
                reasons.append(f"token_overlap:{', '.join(overlap[:4])}")

            if score <= 0:
                continue

            ranked.append(
                {
                    "processKey": process_key,
                    "label": process_label,
                    "partBase": process_part_base,
                    "sourceSheet": process_source_sheet,
                    "score": score,
                    "reasons": reasons,
                }
            )

        ranked.sort(key=lambda item: (-item["score"], item["label"], item["processKey"]))
        recommendations.append(
            {
                "nodeName": node_name,
                "partBase": part_base or None,
                "sourceSheet": part_source_sheet or None,
                "recommendedProcesses": ranked[:per_part_limit],
            }
        )

    return recommendations


def _retrieve_from_json_index(
    payload: SequenceAIDraftRequest,
    *,
    limit: int,
) -> Dict[str, List[Dict[str, Any]]]:
    index = get_or_build_index()
    selected_part_ids = _extract_selected_part_ids(payload)
    allowed_process_labels = _extract_allowed_process_labels(payload)
    return {
        "referenceWindows": recommend_windows(
            index,
            selected_part_ids=selected_part_ids,
            allowed_process_labels=allowed_process_labels,
            limit=limit,
        ),
        "processCandidates": summarize_process_candidates(
            index,
            selected_part_ids=selected_part_ids,
            allowed_process_labels=allowed_process_labels,
            limit=max(limit, 3),
        ),
        "partProcessRecommendations": summarize_part_process_recommendations(payload),
    }


def _merge_reference_windows(
    primary: List[Dict[str, Any]],
    secondary: List[Dict[str, Any]],
    *,
    limit: int,
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen = set()

    for item in [*primary, *secondary]:
        doc_id = str(item.get("docId") or "").strip()
        if not doc_id or doc_id in seen:
            continue
        seen.add(doc_id)
        merged.append(item)
        if len(merged) >= limit:
            break

    return merged


def _merge_process_candidates(
    primary: List[Dict[str, Any]],
    secondary: List[Dict[str, Any]],
    *,
    limit: int,
) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    samples: Dict[str, Dict[str, Any]] = {}

    for item in [*primary, *secondary]:
        label = " ".join(str(item.get("processLabel") or "").split()).strip()
        if not label:
            continue
        count = int(item.get("matchedWindows") or item.get("count") or 0)
        counts[label] = counts.get(label, 0) + count
        samples[label] = item

    ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    merged: List[Dict[str, Any]] = []
    for process_label, count in ranked[:limit]:
        sample = dict(samples[process_label])
        sample["processLabel"] = process_label
        sample["matchedWindows"] = count
        merged.append(sample)
    return merged


def get_or_build_index(
    *,
    sequence_dir: Optional[Path] = None,
    index_path: Optional[Path] = None,
) -> GraphIndex:
    global _INDEX_CACHE
    global _INDEX_PATH_CACHE

    resolved_index_path = (index_path or _default_index_path()).resolve()
    if _INDEX_CACHE is not None and _INDEX_PATH_CACHE == str(resolved_index_path):
        return _INDEX_CACHE

    if resolved_index_path.exists():
        payload = json.loads(resolved_index_path.read_text(encoding="utf-8"))
        _INDEX_CACHE = GraphIndex.from_dict(payload)
        _INDEX_PATH_CACHE = str(resolved_index_path)
        return _INDEX_CACHE

    resolved_sequence_dir = (sequence_dir or _default_sequence_dir()).resolve()
    if not resolved_sequence_dir.exists():
        raise FileNotFoundError(
            "시퀀스 RAG 인덱스를 만들 원본 디렉터리를 찾을 수 없습니다. "
            f"SEQUENCE_SOURCE_SEQUENCE_DIR 또는 --sequence-dir로 경로를 지정해주세요: {resolved_sequence_dir}"
        )

    built_index = build_index_from_sequence_dir(resolved_sequence_dir)
    write_index(built_index, resolved_index_path)
    _INDEX_CACHE = built_index
    _INDEX_PATH_CACHE = str(resolved_index_path)
    return built_index


def retrieve_references_for_request(
    payload: SequenceAIDraftRequest,
    *,
    limit: int = 3,
) -> Dict[str, List[Dict[str, Any]]]:
    selected_part_ids = _extract_selected_part_ids(payload)
    allowed_process_labels = _extract_allowed_process_labels(payload)

    use_neo4j = RAG_BACKEND in {"neo4j", "hybrid"}
    use_json = RAG_BACKEND in {"json", "hybrid"}

    neo4j_result = {
        "referenceWindows": [],
        "processCandidates": [],
    }
    if use_neo4j:
        neo4j_result = retrieve_references_from_neo4j(
            selected_part_ids=selected_part_ids,
            allowed_process_labels=allowed_process_labels,
            limit=limit,
        )
        _log_rag_result(
            "NEO4J",
            neo4j_result,
            selected_part_ids=selected_part_ids,
            allowed_process_labels=allowed_process_labels,
        )

    if RAG_BACKEND == "neo4j" and neo4j_result.get("referenceWindows"):
        return neo4j_result

    json_result = {
        "referenceWindows": [],
        "processCandidates": [],
    }
    if use_json or not neo4j_result.get("referenceWindows"):
        json_result = _retrieve_from_json_index(payload, limit=limit)
        _log_rag_result(
            "JSON",
            json_result,
            selected_part_ids=selected_part_ids,
            allowed_process_labels=allowed_process_labels,
        )

    if RAG_BACKEND == "json":
        return json_result

    if RAG_BACKEND == "neo4j":
        return json_result

    merged_result = {
        "referenceWindows": _merge_reference_windows(
            neo4j_result.get("referenceWindows") or [],
            json_result.get("referenceWindows") or [],
            limit=limit,
        ),
        "processCandidates": _merge_process_candidates(
            neo4j_result.get("processCandidates") or [],
            json_result.get("processCandidates") or [],
            limit=max(limit, 3),
        ),
        "partProcessRecommendations": summarize_part_process_recommendations(payload),
    }
    _log_rag_result(
        "MERGED",
        merged_result,
        selected_part_ids=selected_part_ids,
        allowed_process_labels=allowed_process_labels,
    )
    return merged_result
