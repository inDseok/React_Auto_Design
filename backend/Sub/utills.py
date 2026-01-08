from pathlib import Path
from backend.Sub.models import SubTree
import json
from typing import Dict, List, Optional, Any

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
    data = json.loads(path.read_text(encoding="utf-8"))
    return SubTree(**data)


def save_tree_json(root_dir: Path, spec: str, tree: SubTree):
    path = root_dir / f"{spec}.json"
    path.write_text(
        tree.model_dump_json(indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

def read_bom_meta(root: Path) -> dict:
    meta_path = root / "bom_meta.json"
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_session_state():
    if not SESSION_STORE_PATH.exists():
        return {}
    try:
        return json.loads(SESSION_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

DATA_DIR = Path("backend/data")

SESSION_STORE_PATH = DATA_DIR / "session_state.json"
SESSION_STATE: Dict[str, Dict[str, Optional[str]]] = load_session_state()

def save_session_state():
    SESSION_STORE_PATH.write_text(
        json.dumps(SESSION_STATE, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )