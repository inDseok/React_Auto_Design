from pathlib import Path
from backend.models import SubTree
import json
from typing import Dict, List, Optional, Any
from threading import Lock

_TREE_CACHE: Dict[str, tuple[float, SubTree]] = {}
_TREE_CACHE_LOCK = Lock()

def find_node_by_id(node, target_id):
    if node.id == target_id:
        return node
    for child in node.children:
        found = find_node_by_id(child, target_id)
        if found:
            return found
    return None

def load_tree_json(root_dir, spec) -> SubTree:
    path = root_dir / f"{spec}.json"
    if not path.exists():
        raise FileNotFoundError(path)

    cache_key = str(path.resolve())
    mtime = path.stat().st_mtime

    with _TREE_CACHE_LOCK:
        cached = _TREE_CACHE.get(cache_key)
        if cached and cached[0] == mtime:
            return cached[1]

    tree = SubTree.model_validate_json(path.read_text(encoding="utf-8"))

    with _TREE_CACHE_LOCK:
        _TREE_CACHE[cache_key] = (mtime, tree)

    return tree


def save_tree_json(root_dir: Path, spec: str, tree: SubTree):
    path = root_dir / f"{spec}.json"
    payload = tree.model_dump_json(indent=2, ensure_ascii=False)
    path.write_text(payload, encoding="utf-8")

    cache_key = str(path.resolve())
    with _TREE_CACHE_LOCK:
      _TREE_CACHE[cache_key] = (path.stat().st_mtime, tree)

def read_bom_meta(root: Path) -> dict:
    meta_path = root / "bom_meta.json"
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

def read_spec_meta(root: Path) -> dict:
    meta_path = root / "meta_spec.json"
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
