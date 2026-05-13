from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional


NEO4J_URI = os.getenv("SEQUENCE_NEO4J_URI", "bolt://localhost:7687").strip()
NEO4J_USER = os.getenv("SEQUENCE_NEO4J_USER", "neo4j").strip()
NEO4J_PASSWORD = os.getenv("SEQUENCE_NEO4J_PASSWORD", "").strip()
NEO4J_DATABASE = os.getenv("SEQUENCE_NEO4J_DATABASE", "neo4j").strip()
NEO4J_TIMEOUT_SECONDS = float(os.getenv("SEQUENCE_NEO4J_TIMEOUT_SECONDS", "5"))


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _node_type(labels: List[str]) -> str:
    return "PROCESS" if "Process" in set(labels or []) else "PART"


def _transition_label(left: Dict[str, Any], right: Dict[str, Any]) -> str:
    return (
        f"{left.get('type')}:{left.get('key')} -> "
        f"{right.get('type')}:{right.get('key')}"
    )


def _dedupe_preserve_order(values: List[Any]) -> List[str]:
    seen = set()
    result: List[str] = []
    for value in values:
        normalized = _normalize_text(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _clean_snippet(raw_snippet: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    snippet: List[Dict[str, Any]] = []
    for index, item in enumerate(raw_snippet or []):
        labels = list(item.get("labels") or [])
        step_type = _node_type(labels)
        key = _normalize_text(item.get("key"))
        if not key:
            continue
        label = _normalize_text(item.get("label")) or key
        snippet.append(
            {
                "type": step_type,
                "key": key,
                "label": label,
                "reason": _normalize_text(item.get("reason")),
                "source_id": _normalize_text(item.get("sourceId")),
                "index": int(item.get("position") if item.get("position") is not None else index),
            }
        )
    return snippet


def _build_transitions(snippet: List[Dict[str, Any]]) -> List[str]:
    transitions: List[str] = []
    for left, right in zip(snippet, snippet[1:]):
        left_key = _normalize_text(left.get("key"))
        right_key = _normalize_text(right.get("key"))
        if not left_key or not right_key:
            continue
        transitions.append(_transition_label(left, right))
    return transitions


def _build_counts(documents: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    transition_counts: Dict[str, int] = defaultdict(int)
    part_to_process_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    process_to_part_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for document in documents:
        snippet = list(document.get("snippet") or [])
        for left, right in zip(snippet, snippet[1:]):
            left_key = _normalize_text(left.get("key"))
            right_key = _normalize_text(right.get("key"))
            if not left_key or not right_key:
                continue

            transition = _transition_label(left, right)
            transition_counts[transition] += 1

            if left.get("type") == "PART" and right.get("type") == "PROCESS":
                part_to_process_counts[left_key][right_key] += 1
            if left.get("type") == "PROCESS" and right.get("type") == "PART":
                process_to_part_counts[left_key][right_key] += 1

    return {
        "transitionCounts": dict(transition_counts),
        "partToProcessCounts": {
            key: dict(value) for key, value in part_to_process_counts.items()
        },
        "processToPartCounts": {
            key: dict(value) for key, value in process_to_part_counts.items()
        },
    }


def _get_driver() -> Any:
    if not NEO4J_URI or not NEO4J_USER or not NEO4J_PASSWORD:
        raise RuntimeError(
            "Neo4j 접속 환경변수(SEQUENCE_NEO4J_URI/USER/PASSWORD)가 필요합니다."
        )

    try:
        from neo4j import GraphDatabase
    except Exception as exc:
        raise RuntimeError("neo4j Python 패키지가 필요합니다. pip install neo4j") from exc

    return GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
        connection_timeout=NEO4J_TIMEOUT_SECONDS,
    )


def _fetch_window_documents(driver: Any) -> List[Dict[str, Any]]:
    query = """
    MATCH (w:Window)-[rel:IN_WINDOW]->(node)
    WHERE node:Part OR node:Process
    WITH w, rel, node
    ORDER BY w.docId, rel.position
    WITH
      w,
      collect({
        position: toInteger(coalesce(rel.position, 0)),
        labels: labels(node),
        key: CASE WHEN node:Process THEN node.key ELSE node.partId END,
        label: coalesce(node.label, CASE WHEN node:Process THEN node.key ELSE node.partId END),
        reason: coalesce(node.lastReason, ''),
        sourceId: coalesce(node.sourceId, node.source_id, '')
      }) AS rawSnippet
    RETURN
      w.docId AS docId,
      coalesce(w.sourceFile, '') AS sourceFile,
      coalesce(w.sourceName, '') AS sourceName,
      toInteger(coalesce(w.windowIndex, 0)) AS windowIndex,
      coalesce(w.anchorPartIds, []) AS anchorPartIds,
      coalesce(w.anchorLabels, []) AS anchorLabels,
      coalesce(w.processLabels, []) AS processLabels,
      coalesce(w.transitions, []) AS transitions,
      rawSnippet
    ORDER BY sourceName, windowIndex, docId
    """

    documents: List[Dict[str, Any]] = []
    with driver.session(database=NEO4J_DATABASE) as session:
        for record in session.run(query):
            snippet = _clean_snippet(list(record["rawSnippet"] or []))
            if not snippet:
                continue

            anchor_part_ids = _dedupe_preserve_order(
                list(record["anchorPartIds"] or [])
                or [item.get("key") for item in snippet if item.get("type") == "PART"]
            )
            anchor_labels = _dedupe_preserve_order(
                list(record["anchorLabels"] or []) or anchor_part_ids
            )
            process_labels = _dedupe_preserve_order(
                list(record["processLabels"] or [])
                or [item.get("label") for item in snippet if item.get("type") == "PROCESS"]
            )
            transitions = _dedupe_preserve_order(
                list(record["transitions"] or []) or _build_transitions(snippet)
            )

            documents.append(
                {
                    "doc_id": _normalize_text(record["docId"]),
                    "source_file": _normalize_text(record["sourceFile"]),
                    "source_name": _normalize_text(record["sourceName"]),
                    "window_index": int(record["windowIndex"] or 0),
                    "anchor_part_ids": anchor_part_ids,
                    "anchor_labels": anchor_labels,
                    "process_labels": process_labels,
                    "snippet": snippet,
                    "transitions": transitions,
                }
            )

    return documents


def _fetch_relationship_fallback_document(driver: Any) -> List[Dict[str, Any]]:
    query = """
    MATCH (left)-[rel:NEXT_PROCESS|NEXT_PART|NEXT]->(right)
    WHERE (left:Part OR left:Process) AND (right:Part OR right:Process)
    RETURN
      labels(left) AS leftLabels,
      CASE WHEN left:Process THEN left.key ELSE left.partId END AS leftKey,
      coalesce(left.label, CASE WHEN left:Process THEN left.key ELSE left.partId END) AS leftLabel,
      coalesce(left.lastReason, '') AS leftReason,
      labels(right) AS rightLabels,
      CASE WHEN right:Process THEN right.key ELSE right.partId END AS rightKey,
      coalesce(right.label, CASE WHEN right:Process THEN right.key ELSE right.partId END) AS rightLabel,
      coalesce(right.lastReason, '') AS rightReason,
      type(rel) AS relType,
      toInteger(coalesce(rel.count, 1)) AS relCount
    ORDER BY relType, leftLabel, rightLabel
    """

    raw_steps: List[Dict[str, Any]] = []
    transitions: List[str] = []
    with driver.session(database=NEO4J_DATABASE) as session:
        for record in session.run(query):
            left = {
                "labels": list(record["leftLabels"] or []),
                "key": record["leftKey"],
                "label": record["leftLabel"],
                "reason": record["leftReason"],
                "position": len(raw_steps),
            }
            right = {
                "labels": list(record["rightLabels"] or []),
                "key": record["rightKey"],
                "label": record["rightLabel"],
                "reason": record["rightReason"],
                "position": len(raw_steps) + 1,
            }
            left_step = _clean_snippet([left])
            right_step = _clean_snippet([right])
            if not left_step or not right_step:
                continue

            if not raw_steps or raw_steps[-1].get("key") != left_step[0].get("key"):
                raw_steps.extend(left_step)
            raw_steps.extend(right_step)
            transitions.append(_transition_label(left_step[0], right_step[0]))

    if not raw_steps:
        return []

    for index, step in enumerate(raw_steps):
        step["index"] = index

    return [
        {
            "doc_id": "neo4j-global-w1",
            "source_file": "",
            "source_name": "neo4j-global",
            "window_index": 1,
            "anchor_part_ids": _dedupe_preserve_order(
                [item.get("key") for item in raw_steps if item.get("type") == "PART"]
            ),
            "anchor_labels": _dedupe_preserve_order(
                [item.get("label") for item in raw_steps if item.get("type") == "PART"]
            ),
            "process_labels": _dedupe_preserve_order(
                [item.get("label") for item in raw_steps if item.get("type") == "PROCESS"]
            ),
            "snippet": raw_steps,
            "transitions": _dedupe_preserve_order(transitions),
        }
    ]


def export_neo4j_to_index() -> Dict[str, Any]:
    driver = _get_driver()
    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            session.run("RETURN 1 AS ok").single()

        documents = _fetch_window_documents(driver)
        if not documents:
            documents = _fetch_relationship_fallback_document(driver)

        counts = _build_counts(documents)
        return {
            "documents": documents,
            "transitionCounts": counts["transitionCounts"],
            "partToProcessCounts": counts["partToProcessCounts"],
            "processToPartCounts": counts["processToPartCounts"],
        }
    finally:
        driver.close()


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=str(base_dir / "data" / "neo4j_2_graph_index.json"),
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    payload = export_neo4j_to_index()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"graph_index_written={output_path}")
    print(f"documents={len(payload.get('documents') or [])}")


if __name__ == "__main__":
    main()
