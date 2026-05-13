from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List


@dataclass
class SequenceStep:
    type: str
    key: str
    label: str
    reason: str = ""
    source_id: str = ""
    index: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class WindowDocument:
    doc_id: str
    source_file: str
    source_name: str
    window_index: int
    anchor_part_ids: List[str]
    anchor_labels: List[str]
    process_labels: List[str]
    snippet: List[Dict[str, Any]]
    transitions: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "WindowDocument":
        return cls(
            doc_id=str(payload.get("doc_id") or ""),
            source_file=str(payload.get("source_file") or ""),
            source_name=str(payload.get("source_name") or ""),
            window_index=int(payload.get("window_index") or 0),
            anchor_part_ids=list(payload.get("anchor_part_ids") or []),
            anchor_labels=list(payload.get("anchor_labels") or []),
            process_labels=list(payload.get("process_labels") or []),
            snippet=list(payload.get("snippet") or []),
            transitions=list(payload.get("transitions") or []),
        )


@dataclass
class GraphIndex:
    documents: List[WindowDocument] = field(default_factory=list)
    transition_counts: Dict[str, int] = field(default_factory=dict)
    part_to_process_counts: Dict[str, Dict[str, int]] = field(default_factory=dict)
    process_to_part_counts: Dict[str, Dict[str, int]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "documents": [document.to_dict() for document in self.documents],
            "transitionCounts": self.transition_counts,
            "partToProcessCounts": self.part_to_process_counts,
            "processToPartCounts": self.process_to_part_counts,
        }

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "GraphIndex":
        return cls(
            documents=[
                WindowDocument.from_dict(item)
                for item in (payload.get("documents") or [])
                if isinstance(item, dict)
            ],
            transition_counts=dict(payload.get("transitionCounts") or {}),
            part_to_process_counts=dict(payload.get("partToProcessCounts") or {}),
            process_to_part_counts=dict(payload.get("processToPartCounts") or {}),
        )
