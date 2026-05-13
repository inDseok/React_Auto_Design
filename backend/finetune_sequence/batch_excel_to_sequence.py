from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.sequence.excel_to_sequence import convert_excel_to_sequence


def convert_directory(source_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    for excel_path in sorted(source_dir.glob("*.xlsx")):
        if excel_path.name.startswith("~$"):
            continue
        output_path = output_dir / f"{excel_path.stem}_sequence.json"
        payload = convert_excel_to_sequence(
            excel_path,
            bom_id=excel_path.stem,
            spec="Sheet1",
        )
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        default=str(base_dir / "sources"),
    )
    parser.add_argument(
        "--output-dir",
        default=str(base_dir / "sequences"),
    )
    args = parser.parse_args()
    convert_directory(Path(args.source_dir), Path(args.output_dir))


if __name__ == "__main__":
    main()
