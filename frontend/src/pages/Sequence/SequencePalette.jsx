import React from "react";
import { useSequenceDnD } from "./SequenceDnDContext";

export default function SequencePalette({
  parts = [],
  processes = [],
  loading = false,
  error = null,
}) {
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
      <style>
        {`
          @keyframes sequence-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
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

        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              fontSize: 12,
              color: "#475569",
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid #cbd5e1",
                borderTopColor: "#2563eb",
                animation: "sequence-spin 0.8s linear infinite",
              }}
            />
            PART 조회 중...
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {!loading && parts.length === 0 && (
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
