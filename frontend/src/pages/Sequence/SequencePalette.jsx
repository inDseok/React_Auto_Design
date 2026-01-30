import React from "react";
import { useSequenceDnD } from "./SequenceDnDContext";

export default function SequencePalette({ parts = [], processes = [] }) {
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
      {/* ===============================
          PART 섹션
         =============================== */}
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

        {parts.map((part) => {
          const displayLabel = part.partBase ?? part.partId;
          const isMatched = Boolean(part.partBase);

          return (
            <div
              key={part.partBase ?? part.partId}
              draggable
              onDragStart={(e) =>
                onDragStart(e, {
                  nodeType: "PART",
                  data: {
                    // 원본 BOM 기준
                    partId: part.partId,
                    partName: part.partName,
                    inhouse: part.inhouse,

                    // 🔑 auto-match 결과
                    partBase: part.partBase,
                    sourceSheet: part.sourceSheet,

                    // 노드 상태용
                    option: "",
                    statusLabel: "",
                  },
                })
              }
              style={{
                padding: "6px 8px",
                marginBottom: 6,
                borderRadius: 6,
                border: isMatched
                  ? "1px solid #cbd5e1"
                  : "1px dashed #fca5a5",
                cursor: "grab",
                background: isMatched ? "#f8fafc" : "#fef2f2",
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={
                isMatched
                  ? `DB 기준: ${part.partBase}\n원본: ${part.partId}\n시트: ${part.sourceSheet}`
                  : `매칭 실패\n원본: ${part.partId}`
              }
            >
              {displayLabel}
            </div>
          );
        })}
      </div>

      {/* ===============================
          PROCESS 섹션
         =============================== */}
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
                  processType: p.processType,
                  label: p.label,          // 공정 표시명
                  partBase: p.partBase,
                  sourceSheet: p.sourceSheet,
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
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
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
