from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


def _sorted_sequence_nodes(sequence_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    nodes = sequence_json.get("nodes", []) or []
    return sorted(
        nodes,
        key=lambda node: (
            float(node.get("position", {}).get("y", 0) or 0),
            float(node.get("position", {}).get("x", 0) or 0),
            str(node.get("id") or ""),
        ),
    )


def _node_to_step(node: Dict[str, Any]) -> Dict[str, Any]:
    node_type = str(node.get("type") or "").strip().upper()
    data = node.get("data", {}) or {}

    if node_type == "PROCESS":
        return {
            "type": "PROCESS",
            "processKey": str(data.get("processKey") or data.get("label") or "").strip(),
            "reason": str(data.get("statusLabel") or "").strip() or None,
        }

    return {
        "type": "PART",
        "nodeName": str(data.get("partName") or data.get("nodeName") or data.get("partId") or "").strip(),
        "reason": str(data.get("statusLabel") or "").strip() or None,
    }


def _node_to_source_item(node: Dict[str, Any]) -> Dict[str, Any]:
    node_type = str(node.get("type") or "").strip().upper()
    data = node.get("data", {}) or {}

    return {
        "type": node_type or "PART",
        "label": str(data.get("label") or data.get("partName") or data.get("nodeName") or data.get("partId") or "").strip(),
        "task": str(data.get("statusLabel") or data.get("partBase") or "").strip(),
        "option": str(data.get("option") or "").strip(),
        "worker": str(data.get("worker") or "").strip(),
    }


def convert_sequence_json_to_case(
    source_path: Path,
    *,
    case_id: str,
    split: str = "train",
    source_type: str = "sequence_json",
    group_index: int = 0,
) -> Dict[str, Any]:
    source_payload = json.loads(source_path.read_text(encoding="utf-8"))
    sequence_nodes = _sorted_sequence_nodes(source_payload)

    output_sequence: List[Dict[str, Any]] = []
    group_label = "전체 시퀀스"
    input_source_items: List[Dict[str, Any]] = []
    if sequence_nodes:
        output_sequence = [_node_to_step(node) for node in sequence_nodes]
        input_source_items = [_node_to_source_item(node) for node in sequence_nodes]

    return {
        "caseId": case_id,
        "split": split,
        "sourceType": source_type,
        "sourcePath": str(source_path),
        "bomId": str(source_payload.get("bomId") or "").strip(),
        "spec": str(source_payload.get("spec") or "").strip(),
        "input": {
            "sourceGroupLabel": group_label,
            "sourceItems": input_source_items,
        },
        "output": {
            "groupLabel": group_label,
            "sequence": output_sequence,
        },
        "notes": [
            "This case is simplified for sequence-order learning.",
            "Review the order and PART/PROCESS labels before training.",
        ],
    }


def convert_sequence_json_to_cases(
    source_path: Path,
    *,
    case_id_prefix: str,
    split: str = "train",
    source_type: str = "sequence_json",
) -> List[Dict[str, Any]]:
    return [
        convert_sequence_json_to_case(
            source_path,
            case_id=f"{case_id_prefix}-g1",
            split=split,
            source_type=source_type,
            group_index=0,
        )
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--split", default="train")
    parser.add_argument("--source-type", default="sequence_json")
    parser.add_argument("--group-index", type=int, default=0)
    args = parser.parse_args()

    payload = convert_sequence_json_to_case(
        Path(args.source),
        case_id=args.case_id,
        split=args.split,
        source_type=args.source_type,
        group_index=args.group_index,
    )
    Path(args.output).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
