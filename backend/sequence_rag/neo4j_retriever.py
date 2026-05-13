from __future__ import annotations

import logging
import os
from functools import lru_cache
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

NEO4J_URI = os.getenv("SEQUENCE_NEO4J_URI", "bolt://localhost:7687").strip()
NEO4J_USER = os.getenv("SEQUENCE_NEO4J_USER", "neo4j").strip()
NEO4J_PASSWORD = os.getenv("SEQUENCE_NEO4J_PASSWORD", "").strip()
NEO4J_DATABASE = os.getenv("SEQUENCE_NEO4J_DATABASE", "neo4j").strip()
NEO4J_TIMEOUT_SECONDS = float(os.getenv("SEQUENCE_NEO4J_TIMEOUT_SECONDS", "5"))


def _emit_neo4j_log(message: str) -> None:
    return


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


def _score_window(
    anchor_part_ids: Sequence[str],
    process_labels: Sequence[str],
    selected_part_ids: Sequence[str],
    allowed_process_labels: Sequence[str],
) -> Tuple[int, int, int, int]:
    selected_set = {_normalize_text(value) for value in selected_part_ids if _normalize_text(value)}
    allowed_process_set = {_normalize_text(value) for value in allowed_process_labels if _normalize_text(value)}

    normalized_anchor_parts = [_normalize_text(value) for value in anchor_part_ids]
    normalized_process_labels = [_normalize_text(value) for value in process_labels]

    anchor_hits = sum(1 for value in normalized_anchor_parts if value in selected_set)
    unique_process_hits = sum(
        1 for value in _dedupe_preserve_order(normalized_process_labels) if value in allowed_process_set
    )
    repeated_process_bonus = sum(1 for value in normalized_process_labels if value in allowed_process_set)
    exact_order_hit = int(normalized_anchor_parts == [_normalize_text(value) for value in selected_part_ids])
    return (exact_order_hit, anchor_hits, unique_process_hits, repeated_process_bonus)


def is_neo4j_configured() -> bool:
    return bool(NEO4J_URI and NEO4J_USER and NEO4J_PASSWORD)


@lru_cache(maxsize=1)
def _get_driver() -> Optional[Any]:
    if not is_neo4j_configured():
        _emit_neo4j_log("not_configured")
        return None

    try:
        from neo4j import GraphDatabase
    except Exception:
        _emit_neo4j_log("driver_not_installed")
        return None

    _emit_neo4j_log(f"configured uri={NEO4J_URI} user={NEO4J_USER} database={NEO4J_DATABASE}")
    return GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
        connection_timeout=NEO4J_TIMEOUT_SECONDS,
    )


def retrieve_references_from_neo4j(
    *,
    selected_part_ids: Sequence[str],
    allowed_process_labels: Sequence[str],
    limit: int = 5,
) -> Dict[str, List[Dict[str, Any]]]:
    driver = _get_driver()
    if driver is None:
        return {
            "referenceWindows": [],
            "processCandidates": [],
        }

    selected_part_ids = [_normalize_text(value) for value in selected_part_ids if _normalize_text(value)]
    allowed_process_labels = [_normalize_text(value) for value in allowed_process_labels if _normalize_text(value)]
    if not selected_part_ids:
        return {
            "referenceWindows": [],
            "processCandidates": [],
        }

    candidate_fetch_limit = max(limit * 6, 20)

    window_query = """
    MATCH (w:Window)
    WITH
      w,
      [partId IN coalesce(w.anchorPartIds, []) WHERE trim(partId) IN $selected_part_ids] AS matchedAnchorPartIds
    WHERE size(matchedAnchorPartIds) > 0
    RETURN
      w.docId AS docId,
      w.sourceName AS sourceName,
      toInteger(w.windowIndex) AS windowIndex,
      coalesce(w.anchorPartIds, []) AS anchorPartIds,
      coalesce(w.processLabels, []) AS processLabels,
      coalesce(w.transitions, []) AS transitions
    """

    snippet_query = """
    UNWIND $doc_ids AS docId
    MATCH (w:Window {docId: docId})-[rel:IN_WINDOW]->(node)
    WITH docId, rel, node
    ORDER BY docId, rel.position
    RETURN
      docId,
      collect({
        type: CASE WHEN node:Process THEN 'PROCESS' ELSE 'PART' END,
        key: CASE WHEN node:Process THEN node.key ELSE node.partId END,
        label: coalesce(node.label, CASE WHEN node:Process THEN node.key ELSE node.partId END),
        reason: coalesce(node.lastReason, ''),
        index: toInteger(rel.position)
      }) AS snippet
    """

    process_query = """
    UNWIND $selected_part_ids AS partId
    MATCH (p:Part {partId: partId})-[rel:NEXT_PROCESS|NEXT]->(proc:Process)
    WITH
      rel,
      proc,
      trim(coalesce(proc.label, proc.key, '')) AS processLabel,
      trim(coalesce(proc.key, proc.label, '')) AS processKey
    WHERE
      processLabel <> ''
      AND (
        size($allowed_process_labels) = 0
        OR processLabel IN $allowed_process_labels
        OR processKey IN $allowed_process_labels
      )
    RETURN processLabel AS processLabel, sum(coalesce(rel.count, 1)) AS matchedWindows
    ORDER BY matchedWindows DESC, processLabel ASC
    LIMIT $limit
    """

    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            connectivity_row = session.run("RETURN 1 AS ok").single()
            if not connectivity_row or int(connectivity_row["ok"]) != 1:
                _emit_neo4j_log("connected_but_ping_failed")
            else:
                _emit_neo4j_log("connected_ok")

            window_rows = [
                record.data()
                for record in session.run(
                    window_query,
                    selected_part_ids=selected_part_ids,
                )
            ]

            scored_rows = []
            for row in window_rows:
                score = _score_window(
                    row.get("anchorPartIds") or [],
                    row.get("processLabels") or [],
                    selected_part_ids,
                    allowed_process_labels,
                )
                scored_rows.append((score, row))

            scored_rows.sort(
                key=lambda item: (
                    item[0][0],
                    item[0][1],
                    item[0][2],
                    item[0][3],
                    -(item[1].get("windowIndex") or 0),
                ),
                reverse=True,
            )

            top_rows = [row for _, row in scored_rows[:candidate_fetch_limit]]
            top_doc_ids = [str(row.get("docId") or "").strip() for row in top_rows if str(row.get("docId") or "").strip()]
            snippet_map: Dict[str, List[Dict[str, Any]]] = {}
            if top_doc_ids:
                for record in session.run(snippet_query, doc_ids=top_doc_ids):
                    snippet_map[str(record["docId"])] = list(record["snippet"] or [])

            recommendations: List[Dict[str, Any]] = []
            seen_doc_ids = set()
            covered_processes = set()

            for score, row in scored_rows:
                doc_id = str(row.get("docId") or "").strip()
                if not doc_id or doc_id not in top_doc_ids:
                    continue
                unique_processes = _dedupe_preserve_order(row.get("processLabels") or [])
                if unique_processes and not any(process not in covered_processes for process in unique_processes):
                    continue
                recommendations.append(
                    {
                        "docId": doc_id,
                        "sourceName": row.get("sourceName"),
                        "windowIndex": row.get("windowIndex"),
                        "anchorPartIds": list(row.get("anchorPartIds") or []),
                        "anchorLabels": list(row.get("anchorPartIds") or []),
                        "processLabels": unique_processes,
                        "snippet": snippet_map.get(doc_id, []),
                        "transitions": list(row.get("transitions") or []),
                        "score": {
                            "exactOrderHit": score[0],
                            "anchorHits": score[1],
                            "uniqueAllowedProcessHits": score[2],
                            "repeatedAllowedProcessHits": score[3],
                        },
                        "retrievalBackend": "neo4j",
                    }
                )
                seen_doc_ids.add(doc_id)
                covered_processes.update(unique_processes)
                if len(recommendations) >= limit:
                    break

            for score, row in scored_rows:
                doc_id = str(row.get("docId") or "").strip()
                if not doc_id or doc_id in seen_doc_ids or doc_id not in top_doc_ids:
                    continue
                unique_processes = _dedupe_preserve_order(row.get("processLabels") or [])
                recommendations.append(
                    {
                        "docId": doc_id,
                        "sourceName": row.get("sourceName"),
                        "windowIndex": row.get("windowIndex"),
                        "anchorPartIds": list(row.get("anchorPartIds") or []),
                        "anchorLabels": list(row.get("anchorPartIds") or []),
                        "processLabels": unique_processes,
                        "snippet": snippet_map.get(doc_id, []),
                        "transitions": list(row.get("transitions") or []),
                        "score": {
                            "exactOrderHit": score[0],
                            "anchorHits": score[1],
                            "uniqueAllowedProcessHits": score[2],
                            "repeatedAllowedProcessHits": score[3],
                        },
                        "retrievalBackend": "neo4j",
                    }
                )
                if len(recommendations) >= limit:
                    break

            process_candidates = [
                {
                    "processLabel": record["processLabel"],
                    "matchedWindows": int(record["matchedWindows"]),
                    "retrievalBackend": "neo4j",
                }
                for record in session.run(
                    process_query,
                    selected_part_ids=selected_part_ids,
                    allowed_process_labels=allowed_process_labels,
                    limit=max(limit, 3),
                )
            ]

            _emit_neo4j_log(
                f"query_ok referenceWindows={len(recommendations)} processCandidates={len(process_candidates)}"
            )
            if not recommendations and not process_candidates:
                _emit_neo4j_log("query_ok_no_match")

            return {
                "referenceWindows": recommendations,
                "processCandidates": process_candidates,
            }
    except Exception as exc:
        _emit_neo4j_log(f"query_failed error={exc}")
        return {
            "referenceWindows": [],
            "processCandidates": [],
        }


def retrieve_expanded_nodes_from_neo4j(
    *,
    seed_part_ids: Sequence[str],
    seed_process_keys: Sequence[str],
    allowed_process_labels: Sequence[str],
    limit: int = 30,
    max_depth: int = 3,
) -> Dict[str, List[Dict[str, Any]]]:
    seed_part_ids = _dedupe_preserve_order([_normalize_text(value) for value in seed_part_ids])
    seed_process_keys = _dedupe_preserve_order([_normalize_text(value) for value in seed_process_keys])
    allowed_process_labels = _dedupe_preserve_order([_normalize_text(value) for value in allowed_process_labels])
    if not seed_part_ids and not seed_process_keys:
        return {
            "partCandidates": [],
            "processCandidates": [],
        }

    depth = max(1, min(int(max_depth or 3), 5))
    candidate_limit = max(int(limit or 30), 10)
    return _retrieve_expanded_nodes_from_neo4j_cached(
        tuple(seed_part_ids),
        tuple(seed_process_keys),
        tuple(allowed_process_labels),
        candidate_limit,
        depth,
    )


@lru_cache(maxsize=128)
def _retrieve_expanded_nodes_from_neo4j_cached(
    seed_part_ids: Tuple[str, ...],
    seed_process_keys: Tuple[str, ...],
    allowed_process_labels: Tuple[str, ...],
    candidate_limit: int,
    depth: int,
) -> Dict[str, List[Dict[str, Any]]]:
    driver = _get_driver()
    if driver is None:
        return {
            "partCandidates": [],
            "processCandidates": [],
        }

    process_query = f"""
    CALL () {{
      WITH $seed_part_ids AS seedPartIds
      UNWIND seedPartIds AS seedKey
      MATCH (seed:Part {{partId: seedKey}})
      MATCH path=(seed)-[:NEXT_PROCESS|NEXT_PART|NEXT*1..{depth}]->(node:Process)
      RETURN
        node AS node,
        length(path) AS depth,
        seedKey AS seedKey,
        'part_seed' AS seedType
      UNION ALL
      WITH $seed_process_keys AS seedProcessKeys
      UNWIND seedProcessKeys AS seedKey
      MATCH (seed:Process {{key: seedKey}})
      MATCH path=(seed)-[:NEXT_PROCESS|NEXT_PART|NEXT*1..{depth}]->(node:Process)
      RETURN
        node AS node,
        length(path) AS depth,
        seedKey AS seedKey,
        'process_seed' AS seedType
    }}
    WITH
      trim(coalesce(node.label, node.key, '')) AS processLabel,
      trim(coalesce(node.key, node.label, '')) AS processKey,
      min(depth) AS minDepth,
      count(*) AS pathCount,
      collect(DISTINCT seedKey)[..5] AS seedKeys
    WHERE
      processLabel <> ''
      AND processKey <> ''
      AND (
        size($allowed_process_labels) = 0
        OR processLabel IN $allowed_process_labels
        OR processKey IN $allowed_process_labels
      )
    RETURN
      processLabel AS processLabel,
      processKey AS processKey,
      minDepth AS depth,
      pathCount AS matchedPaths,
      seedKeys AS seedKeys
    ORDER BY minDepth ASC, matchedPaths DESC, processLabel ASC
    LIMIT $limit
    """

    part_query = f"""
    CALL () {{
      WITH $seed_part_ids AS seedPartIds
      UNWIND seedPartIds AS seedKey
      MATCH (seed:Part {{partId: seedKey}})
      MATCH path=(seed)-[:NEXT_PROCESS|NEXT_PART|NEXT*1..{depth}]->(node:Part)
      RETURN
        node AS node,
        length(path) AS depth,
        seedKey AS seedKey
      UNION ALL
      WITH $seed_process_keys AS seedProcessKeys
      UNWIND seedProcessKeys AS seedKey
      MATCH (seed:Process {{key: seedKey}})
      MATCH path=(seed)-[:NEXT_PROCESS|NEXT_PART|NEXT*1..{depth}]->(node:Part)
      RETURN
        node AS node,
        length(path) AS depth,
        seedKey AS seedKey
    }}
    WITH
      trim(coalesce(node.partId, node.label, '')) AS partId,
      trim(coalesce(node.label, node.partId, '')) AS label,
      min(depth) AS minDepth,
      count(*) AS pathCount,
      collect(DISTINCT seedKey)[..5] AS seedKeys
    WHERE partId <> '' AND NOT partId IN $seed_part_ids
    RETURN
      partId AS partId,
      label AS label,
      minDepth AS depth,
      pathCount AS matchedPaths,
      seedKeys AS seedKeys
    ORDER BY minDepth ASC, matchedPaths DESC, label ASC
    LIMIT $limit
    """

    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            process_candidates = [
                {
                    "processLabel": record["processLabel"],
                    "processKey": record["processKey"],
                    "matchedWindows": int(record["matchedPaths"] or 0),
                    "depth": int(record["depth"] or 0),
                    "seedKeys": list(record["seedKeys"] or []),
                    "retrievalBackend": "neo4j-traversal",
                }
                for record in session.run(
                    process_query,
                    seed_part_ids=seed_part_ids,
                    seed_process_keys=seed_process_keys,
                    allowed_process_labels=allowed_process_labels,
                    limit=candidate_limit,
                )
            ]
            part_candidates = [
                {
                    "partId": record["partId"],
                    "label": record["label"],
                    "matchedPaths": int(record["matchedPaths"] or 0),
                    "depth": int(record["depth"] or 0),
                    "seedKeys": list(record["seedKeys"] or []),
                    "retrievalBackend": "neo4j-traversal",
                }
                for record in session.run(
                    part_query,
                    seed_part_ids=seed_part_ids,
                    seed_process_keys=seed_process_keys,
                    limit=max(candidate_limit // 2, 10),
                )
            ]

            result = {
                "partCandidates": part_candidates,
                "processCandidates": process_candidates,
            }
            return json.loads(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        _emit_neo4j_log(f"traversal_failed error={exc}")
        return {
            "partCandidates": [],
            "processCandidates": [],
        }
