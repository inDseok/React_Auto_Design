from __future__ import annotations

import argparse
from pathlib import Path

from .builder import build_index_from_sequence_dir, write_index


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sequence-dir",
        default=str(base_dir / "source_sequences"),
    )
    parser.add_argument(
        "--output",
        default=str(base_dir / "data" / "graph_index.json"),
    )
    args = parser.parse_args()

    index = build_index_from_sequence_dir(Path(args.sequence_dir))
    write_index(index, Path(args.output))
    print(f"documents={len(index.documents)}")


if __name__ == "__main__":
    main()
