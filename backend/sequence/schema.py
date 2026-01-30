# backend/sequence/schema.py
from pydantic import BaseModel
from typing import List, Dict, Any

class Position(BaseModel):
    x: float
    y: float

class Node(BaseModel):
    id: str
    type: str
    position: Position
    data: Dict[str, Any]

class Edge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    data: Dict[str, Any] = {}

class Group(BaseModel):
    id: str
    label: str
    nodeIds: List[str]

class SequencePayload(BaseModel):
    bomId: str
    spec: str
    nodes: List[Node]
    edges: List[Edge]
    groups: List[Group]

class SequenceSaveRequest(BaseModel):
    bomId: str
    spec: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    groups: Optional[List[Dict[str, Any]]] = []
