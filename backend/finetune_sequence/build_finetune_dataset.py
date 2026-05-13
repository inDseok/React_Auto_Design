from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List


SYSTEM_PROMPT = (
    "You are a manufacturing process planning assistant. "
    "Learn the order pattern from the provided source group label and source items. "
    "Return JSON only with groupLabel and sequence."
)


def _iter_case_files(case_dir: Path) -> Iterable[Path]:
    return sorted(path for path in case_dir.glob("*.json") if path.is_file())


def _validate_case_payload(payload: Dict[str, Any], path: Path) -> None:
    if not str(payload.get("caseId") or "").strip():
        raise ValueError(f"caseId missing: {path}")
    if payload.get("split") not in {"train", "valid"}:
        raise ValueError(f"split must be train/valid: {path}")
    if not isinstance(payload.get("input"), dict):
        raise ValueError(f"input must be object: {path}")
    if not isinstance(payload.get("output"), dict):
        raise ValueError(f"output must be object: {path}")
    if not isinstance(payload["output"].get("sequence"), list):
        raise ValueError(f"output.sequence must be list: {path}")


def _build_record(payload: Dict[str, Any]) -> Dict[str, Any]:
    user_content = {
        "bomId": payload.get("bomId"),
        "spec": payload.get("spec"),
        "sourceGroupLabel": (payload.get("input") or {}).get("sourceGroupLabel", ""),
        "sourceItems": (payload.get("input") or {}).get("sourceItems", []),
    }
    assistant_content = {
        "groupLabel": (payload.get("output") or {}).get("groupLabel", "AI 추천 그룹"),
        "sequence": (payload.get("output") or {}).get("sequence", []),
    }

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
            {"role": "assistant", "content": json.dumps(assistant_content, ensure_ascii=False)},
        ],
        "metadata": {
            "caseId": payload.get("caseId"),
            "bomId": payload.get("bomId"),
            "spec": payload.get("spec"),
            "sourceType": payload.get("sourceType"),
        },
    }


def build_jsonl(case_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    grouped_records: Dict[str, List[Dict[str, Any]]] = {"train": [], "valid": []}

    for case_path in _iter_case_files(case_dir):
        payload = json.loads(case_path.read_text(encoding="utf-8"))
        _validate_case_payload(payload, case_path)
        grouped_records[payload["split"]].append(_build_record(payload))

    for split, records in grouped_records.items():
        target_path = output_dir / f"{split}.jsonl"
        with target_path.open("w", encoding="utf-8") as file:
            for record in records:
                file.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--case-dir",
        default=str(base_dir / "cases"),
    )
    parser.add_argument(
        "--output-dir",
        default=str(base_dir / "jsonl"),
    )
    args = parser.parse_args()
    build_jsonl(Path(args.case_dir), Path(args.output_dir))


if __name__ == "__main__":
    main()
