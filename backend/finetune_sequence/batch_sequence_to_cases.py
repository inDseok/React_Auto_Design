from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.finetune_sequence.sequence_to_case import convert_sequence_json_to_cases


def build_cases(sequence_dir: Path, case_dir: Path, split: str = "train") -> None:
    case_dir.mkdir(parents=True, exist_ok=True)

    for sequence_path in sorted(sequence_dir.glob("*_sequence.json")):
        case_prefix = sequence_path.stem.replace("_sequence", "")
        cases = convert_sequence_json_to_cases(
            sequence_path,
            case_id_prefix=case_prefix,
            split=split,
            source_type="excel_sequence",
        )
        for case in cases:
            case_path = case_dir / f"{case['caseId']}.json"
            case_path.write_text(
                json.dumps(case, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sequence-dir",
        default=str(base_dir / "sequences"),
    )
    parser.add_argument(
        "--case-dir",
        default=str(base_dir / "cases"),
    )
    parser.add_argument("--split", default="train")
    args = parser.parse_args()
    build_cases(Path(args.sequence_dir), Path(args.case_dir), split=args.split)


if __name__ == "__main__":
    main()
