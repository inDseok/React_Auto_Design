from pydantic import BaseModel
from typing import List, Optional, Literal
from enum import Enum
from typing import Dict, Any


class NodeType(str, Enum):
    SUB = "SUB"
    PART = "PART"


class SubNode(BaseModel):
    id: str
    parent_name: Optional[str] = None
    order: int
    type: NodeType = NodeType.PART
    name: str
    part_no: Optional[str] = None
    material: Optional[str] = None
    qty: Optional[float] = None
    inhouse: Optional[bool] = False
    recommended_part_base: Optional[str] = None
    recommended_source_sheet: Optional[str] = None
    recommended_match_score: Optional[Dict[str, Any]] = None


class TreeMeta(BaseModel):
    bom_id: str
    spec_name: str
    bom_filename: Optional[str] = None


class SubTree(BaseModel):
    meta: TreeMeta
    nodes: List[SubNode]


class SubNodePatch(BaseModel):
    parent_name: Optional[str] = None
    order: Optional[int] = None
    id: Optional[str] = None
    part_no: Optional[str] = None
    material: Optional[str] = None
    qty: Optional[float] = None
    type: Optional[NodeType] = None   # ← 추가
    inhouse: Optional[bool] = None
    recommended_part_base: Optional[str] = None
    recommended_source_sheet: Optional[str] = None
    recommended_match_score: Optional[Dict[str, Any]] = None

class MoveNodeRequest(BaseModel):
    node_id: str
    new_parent_name: Optional[str] = None   # root도 허용
    new_index: int
