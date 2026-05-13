# backend/sequence/schema.py
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

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
    skippedAutoEdgeIds: Optional[List[str]] = []

class SequencePayload(BaseModel):
    bomId: str
    spec: str
    nodes: List[Node]
    edges: List[Edge]
    groups: List[Group]
    workerGroups: Optional[List[Group]] = []

class SequenceSaveRequest(BaseModel):
    bomId: str
    spec: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    groups: Optional[List[Dict[str, Any]]] = []
    workerGroups: Optional[List[Dict[str, Any]]] = []


class SequenceAIPartInput(BaseModel):
    nodeName: str
    partId: Optional[str] = None
    partName: Optional[str] = None
    partBase: Optional[str] = None
    sourceSheet: Optional[str] = None
    treePath: Optional[List[str]] = []
    parentName: Optional[str] = None


class SequenceAIProcessTemplate(BaseModel):
    processKey: str
    processType: Optional[str] = "STANDARD"
    label: str
    partBase: Optional[str] = None
    sourceSheet: Optional[str] = None


class SequenceAIDraftOptions(BaseModel):
    maxProcesses: Optional[int] = 5
    layoutDirection: Optional[str] = "LR"
    autoConnect: Optional[bool] = True


class SequenceAIDraftRequest(BaseModel):
    bomId: str
    spec: str
    selectedParts: List[SequenceAIPartInput]
    processTemplates: Optional[List[SequenceAIProcessTemplate]] = []
    options: Optional[SequenceAIDraftOptions] = None


class SequenceAIDraftStep(BaseModel):
    type: str
    nodeName: Optional[str] = None
    processKey: Optional[str] = None
    reason: Optional[str] = None


class SequenceAIDraftResponse(BaseModel):
    provider: str
    model: str
    groupLabel: str
    confidence: float
    reasoningSummary: str
    sequence: List[SequenceAIDraftStep]
    warnings: List[str]
    raw: Optional[Dict[str, Any]] = None


class SequenceChatRequest(BaseModel):
    bomId: str
    spec: str
    message: str
    candidateParts: Optional[List[SequenceAIPartInput]] = []
    selectedParts: Optional[List[SequenceAIPartInput]] = []
    processTemplates: Optional[List[SequenceAIProcessTemplate]] = []
    limit: Optional[int] = 3
    expandSelectedParts: Optional[bool] = True
    includePerPartRecommendations: Optional[bool] = False


class SequenceChatPartRecommendation(BaseModel):
    nodeName: str
    displayLabel: Optional[str] = None
    partBase: Optional[str] = None
    partName: Optional[str] = None
    partId: Optional[str] = None
    sourceSheet: Optional[str] = None
    reason: str
    score: float


class SequenceChatProcessRecommendation(BaseModel):
    processKey: str
    label: str
    displayLabel: Optional[str] = None
    operationLabel: Optional[str] = None
    partBase: Optional[str] = None
    contextPartBase: Optional[str] = None
    sourceSheet: Optional[str] = None
    reason: str
    score: float


class SequenceChatOptionRecommendation(BaseModel):
    targetType: str
    targetKey: str
    sourceSheet: Optional[str] = None
    options: List[str]


class SequenceChatPerPartRecommendation(BaseModel):
    part: SequenceChatPartRecommendation
    recommendedProcesses: List[SequenceChatProcessRecommendation]
    recommendedOptions: List[SequenceChatOptionRecommendation] = []
    reply: Optional[str] = None


class SequenceChatResponse(BaseModel):
    reply: str
    recommendedParts: List[SequenceChatPartRecommendation]
    recommendedProcesses: List[SequenceChatProcessRecommendation]
    recommendedOptions: List[SequenceChatOptionRecommendation]
    perPartRecommendations: List[SequenceChatPerPartRecommendation] = []


class SequenceChatPerPartRequest(BaseModel):
    bomId: str
    spec: str
    message: str
    selectedParts: List[SequenceAIPartInput]
    processTemplates: Optional[List[SequenceAIProcessTemplate]] = []
    limit: Optional[int] = 5


class SequenceChatPerPartResponse(BaseModel):
    perPartRecommendations: List[SequenceChatPerPartRecommendation] = []


class SequenceNextProcessRecommendationRequest(BaseModel):
    bomId: str
    spec: str
    selectedParts: List[SequenceAIPartInput]
    processTemplates: Optional[List[SequenceAIProcessTemplate]] = []
    limit: Optional[int] = 5


class SequenceNextProcessRecommendationResponse(BaseModel):
    recommendedProcesses: List[SequenceChatProcessRecommendation]
    recommendedSequence: List[Dict[str, Any]] = []


class SequenceDebugPrintRequest(BaseModel):
    stage: str
    payload: Optional[Dict[str, Any]] = None
