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

  // ===============================
  // Helpers
  // ===============================
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

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
        gap: 12,
        padding: 12,
        boxSizing: "border-box",
      }}
      onClick={() => {
        // 바깥 클릭 시 선택 해제 원하면 사용 (필요 없으면 제거 가능)
        // clearSelection();
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
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        setNodes={setNodes}
        setEdges={setEdges}
        bomId={bomId}
        spec={spec}
      />
    </div>
  );
}
