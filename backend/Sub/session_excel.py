from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from threading import RLock
import json
from uuid import uuid4
from pydantic import BaseModel
from fastapi import Cookie
from typing import Dict, List, Optional, Any
from backend.Sub.models import SubTree
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File

SESSION_COOKIE = "sid"

def utc_now_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Seoul")).isoformat()


class ExcelUploadResponse(BaseModel):
    excel_id: str
    filename: str
    subs: List[str]


class ExcelInfo(BaseModel):
    excel_id: str
    filename: str
    uploaded_at: Optional[str] = None
    subs: List[str] = []


class SessionState(BaseModel):
    excel_id: Optional[str] = None
    sub_name: Optional[str] = None
    selected_id: Optional[str] = None


def merge_user_edits(base_tree: SubTree, saved_tree: SubTree) -> SubTree:
    saved_map = {n.id: n for n in saved_tree.nodes}

    for i, n in enumerate(base_tree.nodes):
        if n.id in saved_map:
            sn = saved_map[n.id]
            base_tree.nodes[i].name = sn.name
            base_tree.nodes[i].type = sn.type
            base_tree.nodes[i].part_no = sn.part_no
            base_tree.nodes[i].material = sn.material
            base_tree.nodes[i].qty = sn.qty

    return base_tree


@dataclass
class ExcelStorePaths:
    root: Path
    meta_path: Path
    tree_store_path: Path
    excel_path: Path


class ExcelStore:
    """
    excel_id 단위로 분리된 저장소

    디스크 구조
    backend/data/excels/{excel_id}/
      meta.json
      tree_store.json
      uploaded.xlsx
    """

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.lock = RLock()

        self._trees: Dict[str, Dict[str, SubTree]] = {}  # excel_id -> { sub_name -> SubTree }
        self._meta: Dict[str, Dict[str, Any]] = {}        # excel_id -> meta dict

    def _paths(self, excel_id: str) -> ExcelStorePaths:
        root = self.base_dir / excel_id
        return ExcelStorePaths(
            root=root,
            meta_path=root / "meta.json",
            tree_store_path=root / "tree_store.json",
            excel_path=root / "uploaded.xlsx",
        )

    def _ensure_dir(self, excel_id: str) -> ExcelStorePaths:
        p = self._paths(excel_id)
        p.root.mkdir(parents=True, exist_ok=True)
        return p

    def _load_meta_from_disk(self, excel_id: str) -> Dict[str, Any]:
        p = self._paths(excel_id)
        if not p.meta_path.exists():
            return {}
        try:
            return json.loads(p.meta_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_meta_to_disk(self, excel_id: str, meta: Dict[str, Any]) -> None:
        p = self._ensure_dir(excel_id)
        try:
            p.meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print("META 저장 실패:", e)

    def _load_trees_from_disk(self, excel_id: str) -> Dict[str, SubTree]:
        p = self._paths(excel_id)
        if not p.tree_store_path.exists():
            return {}
        try:
            raw = json.loads(p.tree_store_path.read_text(encoding="utf-8"))
            out: Dict[str, SubTree] = {}
            for sub_name, tree_obj in raw.items():
                out[sub_name] = SubTree.model_validate(tree_obj)
            return out
        except Exception as e:
            print("TREE_STORE 로딩 실패:", e)
            return {}

    def _save_trees_to_disk(self, excel_id: str, trees: Dict[str, SubTree]) -> None:
        p = self._ensure_dir(excel_id)
        try:
            raw = {k: v.model_dump() for k, v in trees.items()}
            p.tree_store_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print("TREE_STORE 저장 실패:", e)

    def _warm_cache(self, excel_id: str) -> None:
        if excel_id not in self._trees:
            self._trees[excel_id] = self._load_trees_from_disk(excel_id)
        if excel_id not in self._meta:
            self._meta[excel_id] = self._load_meta_from_disk(excel_id)

    def list_excels(self) -> List[ExcelInfo]:
        infos: List[ExcelInfo] = []
        if not self.base_dir.exists():
            return infos

        for d in self.base_dir.iterdir():
            if not d.is_dir():
                continue
            excel_id = d.name
            meta = self._load_meta_from_disk(excel_id)
            subs = []
            try:
                trees = self._load_trees_from_disk(excel_id)
                subs = sorted(list(trees.keys()))
            except Exception:
                subs = []

            infos.append(
                ExcelInfo(
                    excel_id=excel_id,
                    filename=str(meta.get("filename") or meta.get("original_filename") or ""),
                    uploaded_at=meta.get("uploaded_at"),
                    subs=subs,
                )
            )

        infos.sort(key=lambda x: (x.uploaded_at or "", x.excel_id), reverse=True)
        return infos

    def create_excel(self, filename: str, excel_bytes: bytes, tree: SubTree) -> ExcelUploadResponse:
        with self.lock:
            excel_id = str(uuid4())
            p = self._ensure_dir(excel_id)

            try:
                p.excel_path.write_bytes(excel_bytes)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"엑셀 저장 실패: {e}")

            meta = {
                "excel_id": excel_id,
                "filename": filename,
                "uploaded_at": utc_now_iso(),
            }
            self._meta[excel_id] = meta
            self._save_meta_to_disk(excel_id, meta)

            self._trees[excel_id] = {tree.sub_name: tree}
            self._save_trees_to_disk(excel_id, self._trees[excel_id])

            return ExcelUploadResponse(excel_id=excel_id, filename=filename, subs=[tree.sub_name])

    def get_sub_list(self, excel_id: str) -> List[str]:
        with self.lock:
            self._warm_cache(excel_id)
            return sorted(list(self._trees.get(excel_id, {}).keys()))


    def upsert_tree_from_upload(self, excel_id: str, parsed_tree: SubTree) -> SubTree:
        with self.lock:
            self._warm_cache(excel_id)
            if excel_id not in self._trees:
                raise HTTPException(status_code=404, detail="Unknown excel_id")

            trees = self._trees[excel_id]
            if parsed_tree.sub_name in trees:
                parsed_tree = merge_user_edits(parsed_tree, trees[parsed_tree.sub_name])

            trees[parsed_tree.sub_name] = parsed_tree
            self._save_trees_to_disk(excel_id, trees)
            return parsed_tree


    def save_now(self, excel_id: str) -> None:
        with self.lock:
            self._warm_cache(excel_id)
            trees = self._trees.get(excel_id)
            if trees is None:
                raise HTTPException(status_code=404, detail="Unknown excel_id")
            self._save_trees_to_disk(excel_id, trees)


def get_or_create_sid(request: Request, response: Response) -> str:
    sid = request.cookies.get(SESSION_COOKIE)
    print("[SID IN COOKIE]", sid)

    if not sid:
        sid = str(uuid4())
        print("[NEW SID ISSUED]", sid)
        response.set_cookie(
            key=SESSION_COOKIE,
            value=sid,
            httponly=True,
            samesite="lax",
            path="/",
        )
    return sid


