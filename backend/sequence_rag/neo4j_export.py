from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _escape_cypher_string(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\\", "\\\\").replace("'", "\\'")
    return text


def _quote(value: Any) -> str:
    return f"'{_escape_cypher_string(value)}'"


def _iter_snippet_relationships(snippet: List[Dict[str, Any]]) -> Iterable[tuple[Dict[str, Any], Dict[str, Any]]]:
    for left, right in zip(snippet, snippet[1:]):
        yield left, right


def _transition_relationship_name(left_type: str, right_type: str) -> str:
    if left_type == "PART" and right_type == "PROCESS":
        return "NEXT_PROCESS"
    if left_type == "PROCESS" and right_type == "PROCESS":
        return "NEXT_PROCESS"
    if left_type == "PROCESS" and right_type == "PART":
        return "NEXT_PART"
    if left_type == "PART" and right_type == "PART":
        return "NEXT_PART"
    return "NEXT"


def _node_merge_lines(step: Dict[str, Any]) -> List[str]:
    node_type = str(step.get("type") or "").upper()
    key = str(step.get("key") or "").strip()
    label = str(step.get("label") or key).strip()
    reason = str(step.get("reason") or "").strip()

    if not key:
        return []

    if node_type == "PROCESS":
        return [
            (
                f"MERGE (p:Process {{key: {_quote(key)}}}) "
                f"SET p.label = {_quote(label)}, p.lastReason = {_quote(reason)}"
            ),
        ]

    return [
        (
            f"MERGE (p:Part {{partId: {_quote(key)}}}) "
            f"SET p.label = {_quote(label)}, p.lastReason = {_quote(reason)}"
        ),
    ]


def _transition_lines(snippet: List[Dict[str, Any]]) -> List[str]:
    lines: List[str] = []
    for left, right in _iter_snippet_relationships(snippet):
        left_type = str(left.get("type") or "").upper()
        right_type = str(right.get("type") or "").upper()
        left_key = str(left.get("key") or "").strip()
        right_key = str(right.get("key") or "").strip()
        if not left_key or not right_key:
            continue

        left_alias = "l"
        right_alias = "r"
        left_label = "Process" if left_type == "PROCESS" else "Part"
        right_label = "Process" if right_type == "PROCESS" else "Part"
        left_field = "key" if left_type == "PROCESS" else "partId"
        right_field = "key" if right_type == "PROCESS" else "partId"
        rel_name = _transition_relationship_name(left_type, right_type)

        lines.append(
            f"MATCH ({left_alias}:{left_label} {{{left_field}: {_quote(left_key)}}}), "
            f"({right_alias}:{right_label} {{{right_field}: {_quote(right_key)}}}) "
            f"MERGE ({left_alias})-[n:{rel_name}]->({right_alias}) "
            "ON CREATE SET n.count = 1 "
            "ON MATCH SET n.count = coalesce(n.count, 0) + 1"
        )
    return lines


def build_cypher_from_index(index_payload: Dict[str, Any]) -> str:
    statements: List[str] = [
        "CREATE CONSTRAINT part_partId IF NOT EXISTS FOR (p:Part) REQUIRE p.partId IS UNIQUE",
        "CREATE CONSTRAINT process_key IF NOT EXISTS FOR (p:Process) REQUIRE p.key IS UNIQUE",
    ]

    for document in index_payload.get("documents", []):
        snippet = document.get("snippet") or []
        for step in snippet:
            statements.extend(_node_merge_lines(step))
        statements.extend(_transition_lines(snippet))

    return "\n".join(f"{statement};" for statement in statements)


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--index",
        default=str(base_dir / "data" / "graph_index.json"),
    )
    parser.add_argument(
        "--output",
        default=str(base_dir / "data" / "neo4j_import.cypher"),
    )
    args = parser.parse_args()

    index_path = Path(args.index)
    output_path = Path(args.output)
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    cypher = build_cypher_from_index(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(cypher, encoding="utf-8")
    print(f"cypher_written={output_path}")


if __name__ == "__main__":
    main()
