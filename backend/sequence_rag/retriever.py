from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

from .models import GraphIndex, WindowDocument


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _dedupe_preserve_order(values: Sequence[str]) -> List[str]:
    seen = set()
    deduped: List[str] = []
    for value in values:
        normalized = _normalize_text(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _score_document(
    document: WindowDocument,
    selected_part_ids: Sequence[str],
    allowed_process_labels: Sequence[str],
) -> Tuple[int, int, int, int]:
    selected_set = {_normalize_text(value) for value in selected_part_ids if _normalize_text(value)}
    allowed_process_set = {_normalize_text(value) for value in allowed_process_labels if _normalize_text(value)}

    anchor_hits = sum(1 for value in document.anchor_part_ids if _normalize_text(value) in selected_set)
    unique_process_hits = sum(
        1 for value in _dedupe_preserve_order(document.process_labels) if value in allowed_process_set
    )
    repeated_process_bonus = sum(1 for value in document.process_labels if _normalize_text(value) in allowed_process_set)
    exact_order_hit = int(document.anchor_part_ids == list(selected_part_ids))
    return (exact_order_hit, anchor_hits, unique_process_hits, repeated_process_bonus)


def _matched_documents(
    index: GraphIndex,
    selected_part_ids: Sequence[str],
    allowed_process_labels: Sequence[str],
) -> List[Tuple[Tuple[int, int, int, int], WindowDocument]]:
    ranked: List[Tuple[Tuple[int, int, int, int], WindowDocument]] = []

    for document in index.documents:
        score = _score_document(document, selected_part_ids, allowed_process_labels)
        if score[1] == 0:
            continue
        ranked.append((score, document))

    ranked.sort(
        key=lambda item: (
            item[0][0],
            item[0][1],
            item[0][2],
            item[0][3],
            -item[1].window_index,
        ),
        reverse=True,
    )
    return ranked


def recommend_windows(
    index: GraphIndex,
    *,
    selected_part_ids: Sequence[str],
    allowed_process_labels: Sequence[str],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    ranked = _matched_documents(index, selected_part_ids, allowed_process_labels)
    recommendations: List[Dict[str, Any]] = []
    seen_doc_ids = set()
    covered_processes = set()

    for score, document in ranked:
        unique_processes = _dedupe_preserve_order(document.process_labels)
        if unique_processes and not any(process not in covered_processes for process in unique_processes):
            continue
        recommendations.append(
            {
                "docId": document.doc_id,
                "sourceName": document.source_name,
                "windowIndex": document.window_index,
                "anchorPartIds": document.anchor_part_ids,
                "anchorLabels": document.anchor_labels,
                "processLabels": unique_processes,
                "snippet": document.snippet,
                "score": {
                    "exactOrderHit": score[0],
                    "anchorHits": score[1],
                    "uniqueAllowedProcessHits": score[2],
                    "repeatedAllowedProcessHits": score[3],
                },
            }
        )
        seen_doc_ids.add(document.doc_id)
        covered_processes.update(unique_processes)
        if len(recommendations) >= limit:
            return recommendations

    for score, document in ranked:
        if document.doc_id in seen_doc_ids:
            continue
        unique_processes = _dedupe_preserve_order(document.process_labels)
        recommendations.append(
            {
                "docId": document.doc_id,
                "sourceName": document.source_name,
                "windowIndex": document.window_index,
                "anchorPartIds": document.anchor_part_ids,
                "anchorLabels": document.anchor_labels,
                "processLabels": unique_processes,
                "snippet": document.snippet,
                "score": {
                    "exactOrderHit": score[0],
                    "anchorHits": score[1],
                    "uniqueAllowedProcessHits": score[2],
                    "repeatedAllowedProcessHits": score[3],
                },
            }
        )
        if len(recommendations) >= limit:
            break

    return recommendations


def summarize_process_candidates(
    index: GraphIndex,
    *,
    selected_part_ids: Sequence[str],
    allowed_process_labels: Sequence[str],
    limit: int = 8,
) -> List[Dict[str, Any]]:
    allowed_process_set = {_normalize_text(value) for value in allowed_process_labels if _normalize_text(value)}
    candidate_counts: Dict[str, int] = {}

    for _, document in _matched_documents(index, selected_part_ids, allowed_process_labels):
        for process_label in _dedupe_preserve_order(document.process_labels):
            if process_label not in allowed_process_set:
                continue
            candidate_counts[process_label] = candidate_counts.get(process_label, 0) + 1

    ranked = sorted(candidate_counts.items(), key=lambda item: (-item[1], item[0]))
    return [
        {"processLabel": process_label, "matchedWindows": count}
        for process_label, count in ranked[:limit]
    ]


def summarize_next_process_candidates(
    index: GraphIndex,
    part_id: str,
    *,
    limit: int = 5,
) -> List[Dict[str, Any]]:
    candidates = index.part_to_process_counts.get(_normalize_text(part_id), {})
    ranked = sorted(candidates.items(), key=lambda item: item[1], reverse=True)
    return [
        {"processLabel": process_label, "count": count}
        for process_label, count in ranked[:limit]
    ]
