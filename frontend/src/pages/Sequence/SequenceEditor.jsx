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

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

  // ===============================
  // UI state
  // ===============================
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ===============================
  // PROCESS templates 로드
  // ===============================
  useEffect(() => {
    if (!bomId || !spec) return;

    fetch(`${API_BASE}/api/sequence/process-templates`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("process 템플릿 로드 실패");
        return res.json();
      })
      .then((data) => {
        setProcessTemplates(data.processes || []);
      })
      .catch((err) => {
        console.error(err);
      });
  }, [bomId, spec]);

  // ===============================
  // inhouse PART 로드
  // ===============================
  useEffect(() => {
    if (!bomId || !spec) return;

    setLoading(true);
    setError(null);

    fetch(
      `${API_BASE}/api/sequence/inhouse-parts?bomId=${bomId}&spec=${encodeURIComponent(
        spec
      )}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("inhouse 부품 로드 실패");
        return res.json();
      })
      .then((data) => {
        setInhouseParts(data.parts || []);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [bomId, spec]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
  
      if (selectedEdgeId) {
        setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
        setSelectedEdgeId(null);
        return;
      }
  
      if (selectedNodeId) {
        setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
        setEdges((eds) =>
          eds.filter(
            (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
          )
        );
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId, selectedEdgeId, setNodes, setEdges]
  );
  
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
          setNodes={setNodes}
          setEdges={setEdges}
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
      />
    </div>
  );
}
