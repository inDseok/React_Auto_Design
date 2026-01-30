// SequenceInspector.jsx
// - PART  → /part/options
// - PROCESS → /process/options
// - type에 따라 API 분기

import React, { useMemo, useEffect, useState } from "react";

const API_BASE = "http://localhost:8000";

export default function SequenceInspector({
  nodes,
  edges,
  groups,       
  setGroups,     
  selectedNodeId,
  selectedEdgeId,
  setNodes,
  setEdges,
  bomId,
  spec,
}) {
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId),
    [edges, selectedEdgeId]
  );

  /* =========================
     update utils
  ========================= */
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

  /* =========================
     OPTION state
  ========================= */
  const [options, setOptions] = useState([]);
  const [optionLoading, setOptionLoading] = useState(false);
  const [optionError, setOptionError] = useState(null);

  // nodeId -> options cache
  const [optionCache, setOptionCache] = useState({});

  /* =========================
     OPTION fetch (type별 분기)
  ========================= */
  useEffect(() => {
    if (!selectedNode) return;

    const { type, data } = selectedNode;
    const { partBase, sourceSheet } = data || {};
    if (!partBase || !sourceSheet) return;

    const nodeId = selectedNode.id;

    if (optionCache[nodeId]) {
      setOptions(optionCache[nodeId]);
      return;
    }

    let endpoint = null;
    if (type === "PART") endpoint = "/api/sequence/part/options";
    if (type === "PROCESS") endpoint = "/api/sequence/process/options";
    if (!endpoint) return;

    setOptionLoading(true);
    setOptionError(null);

    fetch(
      `${API_BASE}${endpoint}?partBase=${encodeURIComponent(
        partBase
      )}&sourceSheet=${encodeURIComponent(sourceSheet)}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("OPTION 조회 실패");
        return res.json();
      })
      .then((data) => {
        const opts = data.options || [];

        setOptionCache((prev) => ({
          ...prev,
          [nodeId]: opts,
        }));

        setOptions(opts);
      })
      .catch((err) => {
        console.error(err);
        setOptions([]);
        setOptionError(err.message);
      })
      .finally(() => {
        setOptionLoading(false);
      });
  }, [selectedNodeId]);

  const saveSequence = async () => {
    if (!bomId || !spec) {
      alert("bomId / spec 없음");
      return;
    }
  
    const safeNodes = nodes.map((n, idx) => ({
      ...n,
      position: n.position ?? {
        x: 100 + (idx % 5) * 220,
        y: 100 + Math.floor(idx / 5) * 120,
      },
    }));
  
    try {
      await fetch(`${API_BASE}/api/sequence/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bomId,
          spec,
          nodes: safeNodes,
          edges,
        }),
      });
  
      alert("시퀀스 저장 완료");
    } catch (e) {
      console.error(e);
      alert("저장 실패");
    }
  };
  
  
  const loadSequence = async () => {
    if (!bomId || !spec) {
      alert("bomId / spec 없음");
      return;
    }
  
    try {
      const res = await fetch(
        `${API_BASE}/api/sequence/load?bomId=${bomId}&spec=${spec}`,
        { credentials: "include" }
      );
  
      if (!res.ok) throw new Error("로드 실패");
  
      const data = await res.json();
  
      // 🔑 핵심: position 보정
      const safeNodes = (data.nodes || []).map((n, idx) => ({
        ...n,
        position: n.position && typeof n.position.x === "number"
          ? n.position
          : {
              x: 100 + (idx % 5) * 220,
              y: 100 + Math.floor(idx / 5) * 120,
            },
      }));
  
      setNodes(safeNodes);
      setEdges(data.edges || []);
  
      alert("시퀀스 불러오기 완료");
    } catch (e) {
      console.error(e);
      alert("불러오기 실패");
    }
  };
  
  /* =========================
     empty
  ========================= */
  return (
    <div style={panelStyle}>
      {/* =========================
          항상 표시되는 영역
         ========================= */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <button
          onClick={async () => {
            await fetch(`${API_BASE}/api/sequence/save`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                bomId,
                spec,
                nodes,
                edges,
                groups, // ✅ 핵심
              }),
            });
          }}
        >
          저장
        </button>
        <button onClick={loadSequence}>불러오기</button>
      </div>
  
      {/* =========================
          아무것도 선택 안 됐을 때
         ========================= */}
      {!selectedNode && !selectedEdge && (
        <div style={emptyStyle}>노드를 선택하세요</div>
      )}
  
      {/* =========================
          EDGE
         ========================= */}
      {selectedEdge && (
        <Section title="EDGE">
          <Label>연결</Label>
          <Value>
            {selectedEdge.source} → {selectedEdge.target}
          </Value>
  
          <Label>메모</Label>
          <input
            style={inputStyle}
            value={selectedEdge.data?.note || ""}
            onChange={(e) => updateEdgeData({ note: e.target.value })}
          />
        </Section>
      )}
  
      {/* =========================
          NODE
         ========================= */}
      {selectedNode && (() => {
        const { type, data } = selectedNode;
  
        if (type !== "PART" && type !== "PROCESS") return null;
  
        return (
          <Section title={type}>
            {type === "PROCESS" && (
              <>
                <Label>공정 타입</Label>
                <Value>{data.processType}</Value>
              </>
            )}
  
            <Label>부품 기준</Label>
            <Value>{data.partBase ?? data.partId}</Value>
  
            <Label>OPTION</Label>
  
            {optionLoading && <Value>불러오는 중...</Value>}
  
            {!optionLoading && options.length === 0 && (
              <Value>선택 가능한 OPTION 없음</Value>
            )}
  
            {!optionLoading && options.length > 0 && (
              <select
                style={inputStyle}
                value={data.option || ""}
                onChange={(e) =>
                  updateNodeData({ option: e.target.value })
                }
              >
                <option value="">선택 안 함</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
  
            {type === "PROCESS" && (
              <>
                <Label>반복 횟수 가중치</Label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  style={inputStyle}
                  value={data.repeatWeight ?? 1}
                  onChange={(e) =>
                    updateNodeData({
                      repeatWeight: Math.max(
                        1,
                        Number(e.target.value)
                      ),
                    })
                  }
                />
              </>
            )}
          </Section>
        );
      })()}
    </div>
  );
}



/* =========================
   styles
========================= */

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

const btnStyle = {
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  cursor: "pointer",
};


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
