import React from "react";
import { useSequenceDnD } from "./SequenceDnDContext";

export default function SequencePalette({   parts = [], processes = [], }) {
  const [, setDragItem] = useSequenceDnD();

  const onDragStart = (e, payload) => {
    setDragItem(payload);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      style={{
        width: 240,
        borderRight: "1px solid #e2e8f0",
        padding: 12,
        overflowY: "auto",
        background: "#ffffff",
      }}
    >
      
      {/* PART 섹션 */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          PART
        </div>

        {parts.length === 0 && (
          <div style={{ fontSize: 12, color: "#64748b" }}>
            사용 가능한 부품 없음
          </div>
        )}

        {parts.map((part) => (
          <div
            key={part.partId}
            draggable
            onDragStart={(e) =>
              onDragStart(e, {
                nodeType: "PART",
                data: {
                  partId: part.partId,
                  partName: part.partName,
                  inhouse: part.inhouse,
                  statusLabel: "",
                },
              })
            }
            style={{
              padding: "6px 8px",
              marginBottom: 6,
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              cursor: "grab",
              background: "#f8fafc",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={part.partName}
          >
            {part.partId}
          </div>
        ))}
      </div>

      {/* PROCESS 섹션 */}
      <div>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          PROCESS
        </div>

        {processes.map((p) => (
          <div
            key={p.processKey}
            draggable
            onDragStart={(e) =>
              onDragStart(e, {
                nodeType: "PROCESS",
                data: {
                  processKey: p.processKey,
                  processType: p.processType,   // STANDARD
                  label: p.label,               // ⭐ part_base (공정명)
                  sourceSheet: p.sourceSheet,
                  partBase: p.partBase,
                },
              })              
            }
            style={{
              padding: "6px 8px",
              marginBottom: 6,
              borderRadius: 6,
              border: "1px solid #fed7aa",
              cursor: "grab",
              background: "#fff7ed",
              fontSize: 12,
            }}
            title={`${p.sourceSheet} / ${p.partBase}`}
          >
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}

