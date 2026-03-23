import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";

import SequencePalette from "./SequencePalette";
import SequenceCanvas from "./SequenceCanvas";
import SequenceInspector from "./SequenceInspector";

const API_BASE = "http://localhost:8000";
const SEQUENCE_DRAFT_STORAGE_PREFIX = "sequence_editor_draft_v1";

function getSequenceDraftStorageKey(bomId, spec) {
  if (!bomId || !spec) return null;
  return `${SEQUENCE_DRAFT_STORAGE_PREFIX}:${bomId}:${spec}`;
}

function createSerializableFlowState(flowState = {}) {
  return {
    nodes: Array.isArray(flowState.nodes)
      ? flowState.nodes.map((node, idx) => ({
          id: node.id,
          type: node.type,
          position:
            node.position &&
            typeof node.position.x === "number" &&
            typeof node.position.y === "number"
              ? node.position
              : {
                  x: 100 + (idx % 5) * 220,
                  y: 100 + Math.floor(idx / 5) * 120,
                },
          data: node.data || {},
        }))
      : [],
    edges: Array.isArray(flowState.edges)
      ? flowState.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type || "smoothstep",
          sourceHandle: edge.sourceHandle ?? "out",
          targetHandle: edge.targetHandle ?? "in",
          data: edge.data || {},
        }))
      : [],
    groups: Array.isArray(flowState.groups)
      ? flowState.groups.map((group) => ({
          id: group.id,
          label: group.label || "",
          nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds : [],
        }))
      : [],
    workerGroups: Array.isArray(flowState.workerGroups)
      ? flowState.workerGroups.map((group) => ({
          id: group.id,
          label: group.label || "",
          nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds : [],
        }))
      : [],
  };
}

function getFlowStateSnapshot(flowState = {}) {
  return JSON.stringify(createSerializableFlowState(flowState));
}

function loadSequenceDraft(bomId, spec) {
  const storageKey = getSequenceDraftStorageKey(bomId, spec);
  if (!storageKey) return null;

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      flowState: createSerializableFlowState(parsed.flowState || {}),
      selectedNodeId: parsed.selectedNodeId ?? null,
      selectedEdgeId: parsed.selectedEdgeId ?? null,
      lastSavedSnapshot:
        typeof parsed.lastSavedSnapshot === "string"
          ? parsed.lastSavedSnapshot
          : null,
    };
  } catch (error) {
    console.error("Failed to load sequence draft", error);
    return null;
  }
}

function persistSequenceDraft({
  bomId,
  spec,
  flowState,
  selectedNodeId,
  selectedEdgeId,
  lastSavedSnapshot,
}) {
  const storageKey = getSequenceDraftStorageKey(bomId, spec);
  if (!storageKey) return;

  localStorage.setItem(
    storageKey,
    JSON.stringify({
      flowState: createSerializableFlowState(flowState),
      selectedNodeId,
      selectedEdgeId,
      lastSavedSnapshot: lastSavedSnapshot ?? null,
      savedAt: Date.now(),
    })
  );
}

function isTextEditingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

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
  const [flowState, setFlowState] = useState({
    nodes: [],
    edges: [],
    groups: [],
    workerGroups: [],
  });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);

  const historyRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const flowStateRef = useRef(flowState);
  const lastSavedSnapshotRef = useRef(getFlowStateSnapshot(flowState));
  const restoredDraftKeyRef = useRef(null);
  const HISTORY_LIMIT = 80;

  const nodes = flowState.nodes;
  const edges = flowState.edges;
  const groups = flowState.groups;
  const workerGroups = flowState.workerGroups;

  const cloneFlowState = useCallback((value) => JSON.parse(JSON.stringify(value)), []);

  useEffect(() => {
    flowStateRef.current = flowState;
  }, [flowState]);

  useEffect(() => {
    const storageKey = getSequenceDraftStorageKey(bomId, spec);

    if (!storageKey) {
      restoredDraftKeyRef.current = null;
      return;
    }

    if (restoredDraftKeyRef.current === storageKey) {
      return;
    }

    const draft = loadSequenceDraft(bomId, spec);
    if (draft) {
      setFlowState(draft.flowState);
      flowStateRef.current = draft.flowState;
      setSelectedNodeId(draft.selectedNodeId);
      setSelectedEdgeId(draft.selectedEdgeId);
      lastSavedSnapshotRef.current =
        draft.lastSavedSnapshot ?? getFlowStateSnapshot(draft.flowState);
    } else {
      const emptyFlowState = {
        nodes: [],
        edges: [],
        groups: [],
        workerGroups: [],
      };
      setFlowState(emptyFlowState);
      flowStateRef.current = emptyFlowState;
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      lastSavedSnapshotRef.current = getFlowStateSnapshot(emptyFlowState);
    }

    historyRef.current = [];
    redoHistoryRef.current = [];
    restoredDraftKeyRef.current = storageKey;
  }, [bomId, spec]);

  useEffect(() => {
    const storageKey = getSequenceDraftStorageKey(bomId, spec);
    if (!storageKey) {
      return;
    }

    if (restoredDraftKeyRef.current !== storageKey) {
      return;
    }

    persistSequenceDraft({
      bomId,
      spec,
      flowState,
      selectedNodeId,
      selectedEdgeId,
      lastSavedSnapshot: lastSavedSnapshotRef.current,
    });
  }, [bomId, flowState, selectedEdgeId, selectedNodeId, spec]);

  const applyFlowChange = useCallback(
    (updater, options = {}) => {
      const { recordHistory = true } = options;
      setFlowState((prev) => {
        const next =
          typeof updater === "function"
            ? updater(prev)
            : {
                ...prev,
                ...updater,
              };

        if (recordHistory) {
          historyRef.current.push(cloneFlowState(prev));
          if (historyRef.current.length > HISTORY_LIMIT) {
            historyRef.current.shift();
          }
          redoHistoryRef.current = [];
        }

        return next;
      });
    },
    [cloneFlowState]
  );

  const replaceFlowState = useCallback(
    (nextState, options = {}) => {
      applyFlowChange(
        () => ({
          nodes: Array.isArray(nextState.nodes) ? nextState.nodes : [],
          edges: Array.isArray(nextState.edges) ? nextState.edges : [],
          groups: Array.isArray(nextState.groups) ? nextState.groups : [],
          workerGroups: Array.isArray(nextState.workerGroups)
            ? nextState.workerGroups
            : [],
        }),
        options
      );
    },
    [applyFlowChange]
  );

  const setNodes = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        nodes: typeof updater === "function" ? updater(prev.nodes) : updater,
      }));
    },
    [applyFlowChange]
  );

  const setEdges = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        edges: typeof updater === "function" ? updater(prev.edges) : updater,
      }));
    },
    [applyFlowChange]
  );

  const setGroups = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        groups: typeof updater === "function" ? updater(prev.groups) : updater,
      }));
    },
    [applyFlowChange]
  );

  const setWorkerGroups = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        workerGroups:
          typeof updater === "function" ? updater(prev.workerGroups) : updater,
      }));
    },
    [applyFlowChange]
  );

  const undoFlowChange = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoHistoryRef.current.push(cloneFlowState(flowStateRef.current));
    setFlowState(previous);
  }, [cloneFlowState]);

  const redoFlowChange = useCallback(() => {
    const next = redoHistoryRef.current.pop();
    if (!next) return;
    historyRef.current.push(cloneFlowState(flowStateRef.current));
    setFlowState(next);
  }, [cloneFlowState]);

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

  const saveSequence = useCallback(
    async ({ showAlert = true } = {}) => {
      if (!bomId || !spec) {
        if (showAlert) {
          alert("bomId / spec 없음");
        }
        return false;
      }

      const latestFlowState = flowStateRef.current || {
        nodes: [],
        edges: [],
        groups: [],
        workerGroups: [],
      };
      const serializedFlowState = createSerializableFlowState(latestFlowState);

      try {
        const res = await fetch(`${API_BASE}/api/sequence/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            bomId,
            spec,
            nodes: serializedFlowState.nodes,
            edges: serializedFlowState.edges,
            groups: serializedFlowState.groups,
            workerGroups: serializedFlowState.workerGroups,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "시퀀스 저장 실패");
        }

        if (showAlert) {
          alert("시퀀스 저장 완료");
        }
        lastSavedSnapshotRef.current = JSON.stringify(serializedFlowState);
        persistSequenceDraft({
          bomId,
          spec,
          flowState: latestFlowState,
          selectedNodeId,
          selectedEdgeId,
          lastSavedSnapshot: lastSavedSnapshotRef.current,
        });
        return true;
      } catch (error) {
        console.error(error);
        if (showAlert) {
          alert(`저장 실패: ${error.message || "알 수 없는 오류"}`);
        }
        return false;
      }
    },
    [bomId, spec]
  );

  // ===============================
  // Helpers
  // ===============================
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  const addManualPartNode = useCallback(() => {
    if (!manualSheet || !manualPartBase) {
      alert("시트, 부품 기준을 모두 선택하세요.");
      return;
    }

    applyFlowChange((prev) => ({
      ...prev,
      nodes: [
        ...prev.nodes,
        {
          id: `N-${Date.now()}`,
          type: "PART",
          position: {
            x: 120 + (prev.nodes.length % 4) * 220,
            y: 120 + Math.floor(prev.nodes.length / 4) * 120,
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
      ],
    }));
  }, [applyFlowChange, manualSheet, manualPartBase]);

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redoFlowChange();
          return;
        }
        undoFlowChange();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoFlowChange();
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      if (selectedEdgeId) {
        applyFlowChange((prev) => ({
          ...prev,
          edges: prev.edges.filter((edge) => edge.id !== selectedEdgeId),
        }));
        setSelectedEdgeId(null);
        return;
      }

      if (selectedNodeId) {
        applyFlowChange((prev) => ({
          ...prev,
          nodes: prev.nodes.filter((node) => node.id !== selectedNodeId),
          edges: prev.edges.filter(
            (edge) =>
              edge.source !== selectedNodeId && edge.target !== selectedNodeId
          ),
          groups: prev.groups
            .map((group) => ({
              ...group,
              nodeIds: (group.nodeIds || []).filter((id) => id !== selectedNodeId),
            }))
            .filter((group) => (group.nodeIds || []).length >= 2),
          workerGroups: prev.workerGroups
            .map((group) => ({
              ...group,
              nodeIds: (group.nodeIds || []).filter((id) => id !== selectedNodeId),
            }))
            .filter((group) => (group.nodeIds || []).length >= 1),
        }));
        setSelectedNodeId(null);
      }
    },
    [applyFlowChange, selectedNodeId, selectedEdgeId, undoFlowChange]
  );

  const flowControls = useMemo(
    () => ({
      applyFlowChange,
      replaceFlowState,
      getFlowState: () => flowStateRef.current,
      undoFlowChange,
      redoFlowChange,
    }),
    [applyFlowChange, replaceFlowState, undoFlowChange, redoFlowChange]
  );

  useEffect(() => {
    const handleWindowKeyDown = (e) => {
      if (e.defaultPrevented) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      onKeyDown(e);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    const handleSaveRequest = async (event) => {
      const result = await saveSequence({ showAlert: false });
      event.detail?.respond?.(result);
    };

    window.addEventListener("app:sequence-save-request", handleSaveRequest);
    return () => {
      window.removeEventListener("app:sequence-save-request", handleSaveRequest);
    };
  }, [saveSequence]);

  useEffect(() => {
    const handleDirtyCheckRequest = (event) => {
      const currentSnapshot = getFlowStateSnapshot(flowStateRef.current);
      event.detail?.respond?.(currentSnapshot !== lastSavedSnapshotRef.current);
    };

    window.addEventListener("app:sequence-dirty-check-request", handleDirtyCheckRequest);
    return () => {
      window.removeEventListener("app:sequence-dirty-check-request", handleDirtyCheckRequest);
    };
  }, []);

  useEffect(() => {
    const handleMarkSaved = (event) => {
      lastSavedSnapshotRef.current = getFlowStateSnapshot(event.detail?.flowState || {});
      persistSequenceDraft({
        bomId,
        spec,
        flowState: flowStateRef.current,
        selectedNodeId,
        selectedEdgeId,
        lastSavedSnapshot: lastSavedSnapshotRef.current,
      });
    };

    window.addEventListener("app:sequence-mark-saved", handleMarkSaved);
    return () => {
      window.removeEventListener("app:sequence-mark-saved", handleMarkSaved);
    };
  }, [bomId, selectedEdgeId, selectedNodeId, spec]);

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
            workerGroups={workerGroups}
            setNodes={setNodes}
            setEdges={setEdges}
            setGroups={setGroups}
            setWorkerGroups={setWorkerGroups}
            flowControls={flowControls}
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
          workerGroups={workerGroups}
          setGroups={setGroups}
          setWorkerGroups={setWorkerGroups}
          flowControls={flowControls}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          setNodes={setNodes}
          setEdges={setEdges}
          bomId={bomId}
          spec={spec}
          onSaveSequence={saveSequence}
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
