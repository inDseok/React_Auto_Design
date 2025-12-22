from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from pydantic import Field

class TreeNode(BaseModel):
    id: str
    name: Optional[str] = None
    part_no: Optional[str] = None
    qty: float = 1
    material: Optional[str] = None
    children: List["TreeNode"] = Field(default_factory=list)

TreeNode.model_rebuild()

class TreeMeta(BaseModel):
    bom_id: str
    bom_filename: str
    spec_name: str
    created_at: datetime

class SubTree(BaseModel):
    meta: TreeMeta
    root: TreeNode

class TreeNodePatch(BaseModel):
    name: Optional[str] = None
    part_no: Optional[str] = None
    material: Optional[str] = None
    qty: Optional[float] = None
