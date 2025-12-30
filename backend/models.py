from pydantic import BaseModel
from typing import List, Optional
from enum import Enum


class NodeType(str, Enum):
    ASSY = "ASSY"
    PART = "PART"


class SubNode(BaseModel):
    id: str
    parent_id: Optional[str] = None
    order: int
    type: NodeType
    name: str
    part_no: Optional[str] = None
    material: Optional[str] = None
    qty: Optional[float] = None


class TreeMeta(BaseModel):
    bom_id: str
    spec_name: str
    bom_filename: Optional[str] = None


class SubTree(BaseModel):
    meta: TreeMeta
    nodes: List[SubNode]


class SubNodePatch(BaseModel):
    parent_id: Optional[str] = None
    order: Optional[int] = None
    id: Optional[str] = None
    part_no: Optional[str] = None
    material: Optional[str] = None
    qty: Optional[float] = None

class MoveNodeRequest(BaseModel):
    node_id: str
    new_parent_id: Optional[str] = None   # root도 허용
    new_index: int
