import React, { useMemo } from "react";

export default function SequenceInspector({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  setNodes,
  setEdges,
}) {
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId),
    [edges, selectedEdgeId]
  );

  // =========================
  // 공통 업데이트 유틸
  // =========================
  const updateNodeData = (patch) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, ...patch } }
          : n
      )
    );
  };

  const updateEdgeData = (patch) => {
    setEdges((eds) =>
      eds.map((e) =>
        e.id === selectedEdgeId
          ? { ...e, data: { ...e.data, ...patch } }
          : e
      )
    );
  };

  // =========================
  // 아무것도 선택 안 됨
  // =========================
  if (!selectedNode && !selectedEdge) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>노드를 선택하세요</div>
      </div>
    );
  }

  // =========================
  // Edge 선택
  // =========================
  if (selectedEdge) {
    return (
      <div style={panelStyle}>
        <Section title="EDGE">
          <Label>연결</Label>
          <Value>
            {selectedEdge.source} → {selectedEdge.target}
          </Value>

          <Label>메모</Label>
          <input
            style={inputStyle}
            value={selectedEdge.data?.note || ""}
            onChange={(e) =>
              updateEdgeData({ note: e.target.value })
            }
            placeholder="메모"
          />
        </Section>
      </div>
    );
  }

  // =========================
  // Node 선택
  // =========================
  const { type, data } = selectedNode;

  return (
    <div style={panelStyle}>
      {type === "PART" && (
        <Section title="PART">
          <Label>부품명</Label>
          <Value>{data.partName}</Value>

          <Label>Inhouse</Label>
          <Value>{data.inhouse ? "YES" : "NO"}</Value>

          <Label>상태 라벨</Label>
          <input
            style={inputStyle}
            value={data.statusLabel || ""}
            onChange={(e) =>
              updateNodeData({ statusLabel: e.target.value })
            }
            placeholder="예: 렌즈 결합 전"
          />
        </Section>
      )}

      {type === "PROCESS" && (
        <Section title="PROCESS">
          <Label>공정 타입</Label>
          <Value>{data.processType}</Value>

          <Label>설명</Label>
          <input
            style={inputStyle}
            value={data.description || ""}
            onChange={(e) =>
              updateNodeData({ description: e.target.value })
            }
            placeholder="작업 설명"
          />

          <Label>Takt Time (s)</Label>
          <input
            style={inputStyle}
            type="number"
            value={data.taktTime ?? ""}
            onChange={(e) =>
              updateNodeData({
                taktTime:
                  e.target.value === ""
                    ? null
                    : Number(e.target.value),
              })
            }
            placeholder="초"
          />
        </Section>
      )}
    </div>
  );
}

// =========================
// UI Components
// =========================

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function Label({ children }) {
  return <div style={labelStyle}>{children}</div>;
}

function Value({ children }) {
  return <div style={valueStyle}>{children}</div>;
}

// =========================
// Styles
// =========================

const panelStyle = {
  width: 280,
  borderLeft: "1px solid #e2e8f0",
  padding: 12,
  background: "#ffffff",
  overflowY: "auto",
};

const sectionTitleStyle = {
  fontWeight: 600,
  fontSize: 13,
  marginBottom: 8,
};

const labelStyle = {
  fontSize: 12,
  color: "#475569",
  marginBottom: 4,
};

const valueStyle = {
  fontSize: 12,
  marginBottom: 8,
};

const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12,
  marginBottom: 12,
  borderRadius: 6,
  border: "1px solid #cbd5e1",
};

const emptyStyle = {
  fontSize: 12,
  color: "#64748b",
  textAlign: "center",
  marginTop: 40,
};
