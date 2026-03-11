import React, { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";

import SequencePalette from "./SequencePalette";
import SequenceCanvas from "./SequenceCanvas";
import SequenceInspector from "./SequenceInspector";

const API_BASE = "http://localhost:8000";

export default function SequenceEditor() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const bomId = params.get("bomId");
  const spec = params.get("spec");

  // ===============================
  // Data state
  // ===============================
  const [inhouseParts, setInhouseParts] = useState([]);
  const [processTemplates, setProcessTemplates] = useState([]);

  // ===============================
  // React Flow state
  // ===============================
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

  // ===============================
  // UI state
  // ===============================
  const [loadingParts, setLoadingParts] = useState(false);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [error, setError] = useState(null);
  const [manualOpen, setManualOpen] = useState(true);
  const [manualSheets, setManualSheets] = useState([]);
  const [manualPartBases, setManualPartBases] = useState([]);
  const [manualSheet, setManualSheet] = useState("");
  const [manualPartBase, setManualPartBase] = useState("");

  // ===============================
  // Helpers
  // ===============================
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const addManualPartNode = useCallback(() => {
    if (!manualSheet || !manualPartBase) {
      alert("시트, 부품 기준을 모두 선택하세요.");
      return;
    }

    setNodes((prev) => [
      ...prev,
      {
        id: `N-${Date.now()}`,
        type: "PART",
        position: {
          x: 120 + (prev.length % 4) * 220,
          y: 120 + Math.floor(prev.length / 4) * 120,
        },
        data: {
          partId: manualPartBase,
          partName: manualPartBase,
          inhouse: true,
          partBase: manualPartBase,
          sourceSheet: manualSheet,
          option: "",
          statusLabel: "",
          label: manualPartBase,
        },
      },
    ]);
  }, [manualSheet, manualPartBase, setNodes]);

  // ===============================
  // PROCESS templates 로드
  // ===============================
  useEffect(() => {
    if (!bomId || !spec) return;

    let cancelled = false;
    setLoadingProcesses(true);

    fetch(`${API_BASE}/api/sequence/process-templates`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("process 템플릿 로드 실패");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setProcessTemplates(Array.isArray(data.processes) ? data.processes : []);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setProcessTemplates([]);
        setError((prev) => prev || err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingProcesses(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bomId, spec]);

  useEffect(() => {
    let cancelled = false;

    fetch("http://localhost:8000/api/assembly/sheets", {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("시트 로딩 실패");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setManualSheets(Array.isArray(data) ? data : []);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setManualSheets([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!manualSheet) {
      setManualPartBases([]);
      setManualPartBase("");
      return;
    }

    let cancelled = false;

    fetch(
      `http://localhost:8000/api/assembly/part-bases?sheet=${encodeURIComponent(
        manualSheet
      )}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("부품 기준 로딩 실패");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setManualPartBases(Array.isArray(data) ? data : []);
          setManualPartBase("");
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setManualPartBases([]);
          setManualPartBase("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manualSheet]);

  // ===============================
  // inhouse PART 로드
  // ===============================
  useEffect(() => {
    if (!bomId || !spec) return;

    let cancelled = false;

    setLoadingParts(true);
    setError(null);

    fetch(
      `${API_BASE}/api/sequence/inhouse-parts?bomId=${encodeURIComponent(
        bomId
      )}&spec=${encodeURIComponent(spec)}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("inhouse 부품 로드 실패");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        const parts = Array.isArray(data.parts) ? data.parts : [];

        // ✅ 핵심: 서버가 내려주는 partBase/sourceSheet 보존
        // (Palette에서 이 값을 payload에 포함시키면 PART OPTION이 동작함)
        setInhouseParts(parts);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setInhouseParts([]);
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingParts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bomId, spec]);

  // ===============================
  // Delete / Backspace 삭제
  // ===============================
  const onKeyDown = useCallback(
    (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;

      if (selectedEdgeId) {
        setEdges((eds) => eds.filter((edge) => edge.id !== selectedEdgeId));
        setSelectedEdgeId(null);
        return;
      }

      if (selectedNodeId) {
        setNodes((nds) => nds.filter((node) => node.id !== selectedNodeId));
        setEdges((eds) =>
          eds.filter(
            (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId
          )
        );
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId, selectedEdgeId, setNodes, setEdges]
  );

  // ===============================
  // bomId/spec 없을 때 가드 UI
  // ===============================
  if (!bomId || !spec) {
    return (
      <div style={{ padding: 16 }}>
        bomId 또는 spec 파라미터가 없습니다. (URL 쿼리: ?bomId=...&spec=...)
      </div>
    );
  }

  const loading = loadingParts || loadingProcesses;
  // ===============================
  // UI
  // ===============================
  return (
    <div
      style={{
        height: "calc(100vh - 80px)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        boxSizing: "border-box",
      }}
      onClick={() => {
        // 바깥 클릭 시 선택 해제 원하면 사용 (필요 없으면 제거 가능)
        // clearSelection();
      }}
    >
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          background: "#fff",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setManualOpen((prev) => !prev)}
          style={{
            width: "100%",
            border: 0,
            background: "#f8fafc",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          수동 부품 추가 {manualOpen ? "▾" : "▸"}
        </button>

        {manualOpen && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              padding: 12,
              borderTop: "1px solid #e5e7eb",
            }}
          >
            <select
              value={manualSheet}
              onChange={(e) => setManualSheet(e.target.value)}
              style={selectStyle}
            >
              <option value="">시트 선택</option>
              {manualSheets.map((sheet) => (
                <option key={sheet} value={sheet}>
                  {sheet}
                </option>
              ))}
            </select>

            <select
              value={manualPartBase}
              onChange={(e) => setManualPartBase(e.target.value)}
              disabled={!manualSheet}
              style={selectStyle}
            >
              <option value="">부품 기준 선택</option>
              {manualPartBases.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={addManualPartNode}
              disabled={!manualSheet || !manualPartBase}
              style={actionButtonStyle}
            >
              노드 추가
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: 12,
        }}
      >
        {/* ===============================
            Left : Palette
           =============================== */}
        <div
          style={{
            width: 320,
            minWidth: 320,
            height: "100%",
            overflow: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            background: "#fff",
          }}
        >
          <SequencePalette
            parts={inhouseParts}
            processes={processTemplates}
            loading={loading}
            error={error}
          />
        </div>

        {/* ===============================
            Center : Canvas
           =============================== */}
        <div
          style={{
            flex: 1,
            height: "100%",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            overflow: "hidden",
            background: "#fff",
            minWidth: 0,
          }}
        >
          <SequenceCanvas
            nodes={nodes}
            edges={edges}
            groups={groups}
            setNodes={setNodes}
            setEdges={setEdges}
            setGroups={setGroups}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
            onKeyDown={onKeyDown}
          />
        </div>

        {/* ===============================
            Right : Inspector
           =============================== */}
        <SequenceInspector
          nodes={nodes}
          edges={edges}
          groups={groups}
          setGroups={setGroups}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          setNodes={setNodes}
          setEdges={setEdges}
          bomId={bomId}
          spec={spec}
        />
      </div>
    </div>
  );
}

const selectStyle = {
  minWidth: 220,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  fontSize: 13,
};

const actionButtonStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: 0,
  background: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
