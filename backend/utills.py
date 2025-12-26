from pathlib import Path
from backend.models import SubTree
import json

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
