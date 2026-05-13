import os
import json
import tempfile
import hashlib
import shutil
from uuid import uuid4
from typing import Dict, Any, Optional
from pathlib import Path

from backend.models import SubNode, SubTree, TreeMeta
from backend.Sub.BOM_to_Tree import run_bom_to_tree
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(__file__).resolve().parents[1] / "data/bom_runs"
CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "bom_cache"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

SUPPORTED_SUFFIX = {".xlsx", ".xlsm", ".xltx", ".xltm"}

def _ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


def _compute_binary_hash(binary_data: bytes) -> str:
    return hashlib.sha256(binary_data).hexdigest()


def _resolve_cached_xlsx_path(binary_hash: str, original_filename: str) -> Path:
    stem = Path(original_filename).stem
    safe_stem = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in stem).strip("_")
    if not safe_stem:
        safe_stem = "bom"
    return CACHE_DIR / f"{safe_stem}_{binary_hash[:16]}_converted.xlsx"


def _convert_raw_tree_to_subtree(
    raw_tree: Any,
    *,
    bom_id: str,
    bom_filename: str,
    spec_name: str,
) -> SubTree:
    nodes: list[SubNode] = []

    def visit(children: Any, parent_name: Optional[str] = None) -> None:
        if not isinstance(children, list):
            return

        for index, item in enumerate(children):
            if not isinstance(item, dict):
                continue

            row_value = item.get("행번호")
            row_token = str(row_value).strip() if row_value is not None else f"idx{len(nodes)}"
            ui_name = f"{spec_name}:{row_token}:{len(nodes)}"
            node_id = str(item.get("품명") or item.get("품번") or ui_name).strip() or ui_name

            qty_value = item.get("수량")
            try:
                qty = float(qty_value) if qty_value not in (None, "") else None
            except (TypeError, ValueError):
                qty = None

            nodes.append(
                SubNode(
                    id=node_id,
                    parent_name=parent_name,
                    order=index,
                    type="PART",
                    name=ui_name,
                    part_no=str(item.get("품번") or "").strip() or None,
                    material=str(item.get("재질") or "").strip() or None,
                    qty=qty,
                    inhouse=False,
                )
            )

            visit(item.get("자식", []), ui_name)

    visit(raw_tree)

    return SubTree(
        meta=TreeMeta(
            bom_id=bom_id,
            spec_name=spec_name,
            bom_filename=bom_filename,
        ),
        nodes=nodes,
    )


def create_bom_run(binary_data: bytes, original_filename: str) -> Dict[str, Any]:
    """
    BOM 업로드 → BOM_to_Tree 내부 변환(xlsb/xls/xlsm → xlsx)
               → 임시 트리 엑셀 생성
               → 변환된 xlsx 기준으로 사양 추출
               → 사양별 트리를 단일 캐시 파일에 저장
    """
    suffix = Path(original_filename).suffix.lower()
    binary_hash = _compute_binary_hash(binary_data)

    bom_id = str(uuid4())
    root = DATA_DIR / bom_id
    _ensure_dir(root)

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        bom_path = temp_dir / original_filename
        bom_path.write_bytes(binary_data)

        if suffix == ".xlsb":
            cached_xlsx_path = _resolve_cached_xlsx_path(binary_hash, original_filename)
            if cached_xlsx_path.exists():
                local_cached_xlsx = temp_dir / cached_xlsx_path.name
                shutil.copy2(cached_xlsx_path, local_cached_xlsx)
                run_result = run_bom_to_tree(
                    str(local_cached_xlsx),
                    save_output=False,
                )
            else:
                run_result = run_bom_to_tree(
                    str(bom_path),
                    save_output=False,
                )
                source_xlsx_path = str(run_result.get("source_xlsx_path") or "").strip()
                if source_xlsx_path and Path(source_xlsx_path).exists():
                    shutil.copy2(source_xlsx_path, cached_xlsx_path)
        else:
            run_result = run_bom_to_tree(
                str(bom_path),
                save_output=False,
            )

        spec_info = run_result.get("spec_info", {})
        if not spec_info.get("sheets"):
            raise RuntimeError("사양 추출 결과가 비어 있음")

        tree_cache: Dict[str, Any] = {}
        for spec_name, raw_tree in (run_result.get("spec_trees", {}) or {}).items():
            normalized_spec_name = str(spec_name or "").strip()
            if not normalized_spec_name:
                continue

            tree = _convert_raw_tree_to_subtree(
                raw_tree,
                bom_id=bom_id,
                bom_filename=original_filename,
                spec_name=normalized_spec_name,
            )
            tree_cache[normalized_spec_name] = tree.model_dump(mode="json")

        (root / "tree_specs_cache.json").write_text(
            json.dumps(tree_cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # 5. meta.json
    meta = {
        "bom_id": bom_id,
        "original_filename": original_filename,
        "converted_xlsx": None,
        "tree_excel": None,
        "spec_info": spec_info,
    }

    (root / "meta_spec.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return meta



