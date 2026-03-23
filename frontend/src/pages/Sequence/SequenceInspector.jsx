// SequenceInspector.jsx
// - PART  → /part/options
// - PROCESS → /process/options
// - type에 따라 API 분기

import React, { useMemo, useEffect, useState, useRef } from "react";

const API_BASE = "http://localhost:8000";

function serializeSequenceNode(node, idx) {
  return {
    id: node.id,
    type: node.type,
    position:
      node.position && typeof node.position.x === "number" && typeof node.position.y === "number"
        ? node.position
        : {
            x: 100 + (idx % 5) * 220,
            y: 100 + Math.floor(idx / 5) * 120,
          },
    data: node.data || {},
  };
}

function serializeSequenceEdge(edge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type || "smoothstep",
    sourceHandle: edge.sourceHandle ?? "out",
    targetHandle: edge.targetHandle ?? "in",
    data: edge.data || {},
  };
}

function serializeSequenceGroup(group) {
  return {
    id: group.id,
    label: group.label || "",
    nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds : [],
  };
}

function normalizeRepeatWeightValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.max(1, Math.round(numericValue * 10) / 10);
}

function formatRepeatWeightInput(value) {
  return String(normalizeRepeatWeightValue(value));
}

export default function SequenceInspector({
  nodes,
  edges,
  groups,
  workerGroups,
  setGroups,
  setWorkerGroups,
  flowControls,
  selectedNodeId,
  selectedEdgeId,
  setNodes,
  setEdges,
  bomId,
  spec,
  onSaveSequence,
}) {
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId),
    [edges, selectedEdgeId]
  );

  const selectedWorkerGroup = useMemo(
    () =>
      workerGroups.find((group) =>
        (group.nodeIds || []).includes(selectedNodeId)
      ) || null,
    [workerGroups, selectedNodeId]
  );
  const selectedNodeType = selectedNode?.type || "";
  const selectedNodePartBase = selectedNode?.data?.partBase || "";
  const selectedNodeSourceSheet = selectedNode?.data?.sourceSheet || "";
  const [repeatWeightInput, setRepeatWeightInput] = useState("1");

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

  useEffect(() => {
    if (selectedNode?.type === "PART" || selectedNode?.type === "PROCESS") {
      setRepeatWeightInput(formatRepeatWeightInput(selectedNode.data?.repeatWeight ?? 1));
      return;
    }

    setRepeatWeightInput("1");
  }, [selectedNode]);

  const commitRepeatWeight = (rawValue) => {
    updateNodeData({
      repeatWeight: normalizeRepeatWeightValue(rawValue),
    });
    setRepeatWeightInput(formatRepeatWeightInput(rawValue));
  };

  const updateWorkerForNode = (workerLabel) => {
    if (!selectedNodeId) return;

    const normalizedLabel = String(workerLabel || "").trim();

    flowControls?.applyFlowChange((prev) => {
      const nextNodes = prev.nodes.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                worker: normalizedLabel,
              },
            }
          : node
      );

      const strippedWorkerGroups = (prev.workerGroups || [])
        .map((group) => ({
          ...group,
          nodeIds: (group.nodeIds || []).filter((nodeId) => nodeId !== selectedNodeId),
        }))
        .filter((group) => (group.nodeIds || []).length > 0);

      if (!normalizedLabel) {
        return {
          ...prev,
          nodes: nextNodes,
          workerGroups: strippedWorkerGroups,
        };
      }

      const existingGroup = strippedWorkerGroups.find(
        (group) => String(group.label || "").trim() === normalizedLabel
      );

      let nextWorkerGroups;
      if (existingGroup) {
        nextWorkerGroups = strippedWorkerGroups.map((group) =>
          group.id === existingGroup.id
            ? {
                ...group,
                nodeIds: [...(group.nodeIds || []), selectedNodeId],
              }
            : group
        );
      } else {
        nextWorkerGroups = [
          ...strippedWorkerGroups,
          {
            id: `wrk-${crypto.randomUUID()}`,
            nodeIds: [selectedNodeId],
            label: normalizedLabel,
          },
        ];
      }

      return {
        ...prev,
        nodes: nextNodes,
        workerGroups: nextWorkerGroups,
      };
    });
  };

  const deleteSelectedWorkerGroup = () => {
    if (!selectedWorkerGroup) return;

    const nodeIdsInGroup = new Set(selectedWorkerGroup.nodeIds || []);
    flowControls?.applyFlowChange((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) =>
        nodeIdsInGroup.has(node.id)
          ? {
              ...node,
              data: {
                ...node.data,
                worker: "",
              },
            }
          : node
      ),
      workerGroups: (prev.workerGroups || []).filter(
        (group) => group.id !== selectedWorkerGroup.id
      ),
    }));
  };

  /* =========================
     OPTION state
  ========================= */
  const [options, setOptions] = useState([]);
  const [optionLoading, setOptionLoading] = useState(false);
  const [optionError, setOptionError] = useState(null);
  // nodeId -> options cache
  const [optionCache, setOptionCache] = useState({});
  const [optionQueryCache, setOptionQueryCache] = useState({});
  const inFlightOptionRequestsRef = useRef({});

  /* =========================
     OPTION fetch (type별 분기)
  ========================= */
  useEffect(() => {
    if (!selectedNodeId) {
      setOptions([]);
      setOptionLoading(false);
      setOptionError(null);
      return;
    }

    const type = selectedNodeType;
    const partBase = selectedNodePartBase;
    const sourceSheet = selectedNodeSourceSheet;
    if (!partBase) {
      setOptions([]);
      setOptionLoading(false);
      setOptionError(null);
      return;
    }

    const nodeId = selectedNodeId;
    const normalizedSourceSheet = String(sourceSheet || "").trim();
    const requestKey = `${type}:${partBase}:${normalizedSourceSheet || "*"}`;

    if (optionCache[nodeId]) {
      setOptions(optionCache[nodeId]);
      return;
    }

    if (optionQueryCache[requestKey]) {
      const cachedOptions = optionQueryCache[requestKey];
      setOptionCache((prev) => ({
        ...prev,
        [nodeId]: cachedOptions,
      }));
      setOptions(cachedOptions);
      return;
    }

    let endpoint = null;
    if (type === "PART") endpoint = "/api/sequence/part/options";
    if (type === "PROCESS") endpoint = "/api/sequence/process/options";
    if (!endpoint) return;

    setOptionLoading(true);
    setOptionError(null);

    const pendingRequest = inFlightOptionRequestsRef.current[requestKey];
    const requestPromise =
      pendingRequest ||
      fetch(
        `${API_BASE}${endpoint}?partBase=${encodeURIComponent(partBase)}${
          normalizedSourceSheet
            ? `&sourceSheet=${encodeURIComponent(normalizedSourceSheet)}`
            : ""
        }`,
        { credentials: "include" }
      )
        .then((res) => {
          if (!res.ok) throw new Error("OPTION 조회 실패");
          return res.json();
        })
        .finally(() => {
          delete inFlightOptionRequestsRef.current[requestKey];
        });

    if (!pendingRequest) {
      inFlightOptionRequestsRef.current[requestKey] = requestPromise;
    }

    requestPromise
      .then((data) => {
        const opts = data.options || [];

        setOptionCache((prev) => ({
          ...prev,
          [nodeId]: opts,
        }));
        setOptionQueryCache((prev) => ({
          ...prev,
          [requestKey]: opts,
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
  }, [
    optionCache,
    optionQueryCache,
    selectedNodeId,
    selectedNodePartBase,
    selectedNodeSourceSheet,
    selectedNodeType,
  ]);

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
      const safeEdges = (data.edges || []).map((edge) => ({
        ...edge,
        sourceHandle: edge.sourceHandle ?? "out",
        targetHandle: edge.targetHandle ?? "in",
      }));

      setOptions([]);
      setOptionLoading(false);
      setOptionError(null);
      setOptionCache({});
      setOptionQueryCache({});
      inFlightOptionRequestsRef.current = {};
  
      flowControls?.replaceFlowState(
        {
          nodes: safeNodes,
          edges: safeEdges,
          groups: data.groups || [],
          workerGroups: data.workerGroups || [],
        },
        { recordHistory: false }
      );

      window.dispatchEvent(
        new CustomEvent("app:sequence-mark-saved", {
          detail: {
            flowState: {
              nodes: safeNodes,
              edges: safeEdges,
              groups: data.groups || [],
              workerGroups: data.workerGroups || [],
            },
          },
        })
      );
  
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
        <button onClick={() => onSaveSequence?.({ showAlert: true })}>
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
  
            {(type === "PART" || type === "PROCESS") && (
              <>
                <Label>작업자</Label>
                <input
                  style={inputStyle}
                  value={data.worker || ""}
                  placeholder="예: 1"
                  onChange={(e) => updateWorkerForNode(e.target.value)}
                />

                <Label>반복 횟수 가중치</Label>
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  style={inputStyle}
                  value={repeatWeightInput}
                  onChange={(e) => setRepeatWeightInput(e.target.value)}
                  onBlur={(e) => commitRepeatWeight(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitRepeatWeight(e.currentTarget.value);
                      e.currentTarget.blur();
                    }
                  }}
                />

                {selectedWorkerGroup && (
                  <button
                    type="button"
                    style={dangerButtonStyle}
                    onClick={deleteSelectedWorkerGroup}
                  >
                    현재 작업자 그룹 삭제
                  </button>
                )}
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

const dangerButtonStyle = {
  ...btnStyle,
  width: "100%",
  marginBottom: 12,
  border: "1px solid #f5c2c7",
  background: "#fff5f5",
  color: "#b42318",
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
