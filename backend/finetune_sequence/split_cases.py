from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _load_case(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _group_key(payload: Dict[str, Any], mode: str) -> str:
    if mode == "bom":
        return str(payload.get("bomId") or payload.get("spec") or payload.get("caseId") or "")
    if mode == "source":
        return str(payload.get("sourcePath") or payload.get("bomId") or payload.get("caseId") or "")
    return str(payload.get("caseId") or "")


def _assign_splits(
    grouped_cases: List[Tuple[str, List[Tuple[Path, Dict[str, Any]]]]],
    valid_ratio: float,
    seed: int,
) -> None:
    random.Random(seed).shuffle(grouped_cases)
    total_cases = sum(len(items) for _, items in grouped_cases)
    target_valid = max(1, int(total_cases * valid_ratio)) if total_cases > 1 and valid_ratio > 0 else 0

    current_valid = 0
    for _, items in grouped_cases:
        split = "valid" if current_valid < target_valid else "train"
        if split == "valid":
            current_valid += len(items)
        for path, payload in items:
            payload["split"] = split
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def split_cases(case_dir: Path, mode: str, valid_ratio: float, seed: int) -> Dict[str, int]:
    grouped: Dict[str, List[Tuple[Path, Dict[str, Any]]]] = {}
    for case_path in sorted(case_dir.glob("*.json")):
        payload = _load_case(case_path)
        key = _group_key(payload, mode)
        grouped.setdefault(key, []).append((case_path, payload))

    grouped_cases = list(grouped.items())
    _assign_splits(grouped_cases, valid_ratio=valid_ratio, seed=seed)

    counts = {"train": 0, "valid": 0}
    for case_path in sorted(case_dir.glob("*.json")):
        payload = _load_case(case_path)
        split = str(payload.get("split") or "train")
        counts[split] = counts.get(split, 0) + 1
    return counts


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-dir", default=str(base_dir / "cases"))
    parser.add_argument("--mode", default="source", choices=["source", "bom", "case"])
    parser.add_argument("--valid-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    counts = split_cases(
        Path(args.case_dir),
        mode=args.mode,
        valid_ratio=args.valid_ratio,
        seed=args.seed,
    )
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
