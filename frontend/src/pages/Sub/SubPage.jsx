import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../state/AppContext";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client";
import TreeView from "./TreeView";
import SelectedPartPanel from "./SelectedPartPanel";
import SpecSelector from "./SpecSelector";
import UploadBom from "./UploadBom";
import { Button, Spin, Alert, Card, Row, Col, Space, message } from "antd";
import { getDisplaySpecName, isManualSequenceSpec } from "../Sequence/sequenceEditorUtils";
import { showPopup } from "../../template/popupUtils";
import ConfirmPopup from "../../template/ConfirmPopup";

/* =========================
   utils
========================= */

function buildTree(nodes) {
  if (!Array.isArray(nodes)) return [];

  const map = new Map();
  const roots = [];

  // 1) name 기준으로 node map 구성
  nodes.forEach((n) => {
    const key = n.name;     // ⭐ UI name이 key
    map.set(key, { ...n, children: [] });
  });

  // 2) parent_name 기준으로 부모 연결
  map.forEach((node) => {
    if (!node.parent_name) {
      // 부모 없으면 root
      roots.push(node);
      return;
    }

    const parent = map.get(node.parent_name);

    if (parent) {
      parent.children.push(node);
    } else {
      // 부모 못 찾으면 root 취급
      roots.push(node);
    }
  });

  // 3) order 기준 정렬
  const sortRecursively = (list) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    list.forEach((n) => sortRecursively(n.children));
  };

  sortRecursively(roots);

  return roots;
}

function makeTreeCacheKey(bomId, spec) {
  if (!bomId || !spec) return "";
  return `${bomId}::${spec}`;
}

function getSubSpecDisplayName(spec) {
  return isManualSequenceSpec(spec) ? "수동" : getDisplaySpecName(spec);
}

function cloneNodesSnapshot(nodes) {
  return JSON.parse(JSON.stringify(Array.isArray(nodes) ? nodes : []));
}


/* =========================
   SubPage
========================= */

export default function SubPage() {
  const { state, actions } = useApp();
  const hasLoadedRef = useRef(false);
  const treeScrollRef = useRef(null);
  const [nodes, setNodes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmInit, setShowConfirmInit] = useState(false);
  const [err, setErr] = useState("");
  const [dragNodeId, setDragNodeId] = useState(null);
  const undoStackRef = useRef([]);
  const isUndoingRef = useRef(false);

  // ⛳ bomId lock
  const fixedBomIdRef = useRef(null);

  useEffect(() => {
    actions.setSelectedNode(null);
  }, [state.selectedSpec]);

  useEffect(() => {
    undoStackRef.current = [];
    isUndoingRef.current = false;
  }, [state.bomId, state.selectedSpec]);
  
  // bomId 고정 / 교체 로직
  useEffect(() => {
    if (!state.bomId) return;

    if (!fixedBomIdRef.current) {
      fixedBomIdRef.current = state.bomId;
      console.log("고정된 bomId:", fixedBomIdRef.current);
      return;
    }

    if (state.bomId !== fixedBomIdRef.current) {
      const isNewRun =
        !state.selectedSpec && !state.selectedNodeId;

      if (isNewRun) {
        fixedBomIdRef.current = state.bomId;
        hasLoadedRef.current = false;
        setNodes(null);
        setErr("");
        console.log("bomId 갱신:", fixedBomIdRef.current);
      } else {
        console.warn("새로운 bomId 무시:", state.bomId);
      }
    }
  }, [state.bomId, state.selectedSpec, state.selectedNodeId]);

  const activeBomId = fixedBomIdRef.current;

  const reqIdRef = useRef(0);

  function updateNodesAndCache(nextNodes) {
    setNodes(nextNodes);
    if (state.bomId && state.selectedSpec) {
      actions.setTreeCacheEntry?.(
        makeTreeCacheKey(state.bomId, state.selectedSpec),
        { nodes: nextNodes }
      );
    }
  }

  function handleTreeDragAutoScroll(event) {
    if (!dragNodeId) {
      return;
    }

    const container = treeScrollRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const threshold = 72;
    const maxStep = 22;
    const pointerY = event.clientY;
    let nextScrollDelta = 0;

    if (pointerY < rect.top + threshold) {
      const intensity = (rect.top + threshold - pointerY) / threshold;
      nextScrollDelta = -Math.ceil(maxStep * Math.min(1, intensity));
    } else if (pointerY > rect.bottom - threshold) {
      const intensity = (pointerY - (rect.bottom - threshold)) / threshold;
      nextScrollDelta = Math.ceil(maxStep * Math.min(1, intensity));
    }

    if (nextScrollDelta !== 0) {
      container.scrollTop += nextScrollDelta;
    }
  }

  function beginUndoCheckpoint() {
    const snapshot = cloneNodesSnapshot(nodes);
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > 30) {
      undoStackRef.current = undoStackRef.current.slice(-30);
    }

    return () => {
      const stack = undoStackRef.current;
      if (stack[stack.length - 1] === snapshot) {
        stack.pop();
      } else {
        undoStackRef.current = stack.filter((entry) => entry !== snapshot);
      }
    };
  }

  useEffect(() => {
    if (!state.bomId || !state.selectedSpec) {
      setNodes(null);
      return;
    }

    const cacheKey = makeTreeCacheKey(state.bomId, state.selectedSpec);
    const cachedNodes = state.treeCache?.[cacheKey]?.nodes;
    if (Array.isArray(cachedNodes)) {
      setNodes(cachedNodes);
      setLoading(false);
      setErr("");
      return;
    }

    const myReqId = ++reqIdRef.current;
  
    async function loadTree() {
      setLoading(true);
      setErr("");
  
      try {
        const data = await apiGet(
          `/api/sub/bom/${state.bomId}/tree?spec=${encodeURIComponent(state.selectedSpec)}`
        );
  
        // 🔥 요청 ID가 최신 요청이 아닐 경우 — 응답 버리기
        if (myReqId !== reqIdRef.current) return;
  
        const nextNodes = data.nodes ?? [];
        setNodes(nextNodes);
        actions.setTreeCacheEntry?.(cacheKey, { nodes: nextNodes });
      } catch (e) {
        if (myReqId !== reqIdRef.current) return;
        setErr(String(e?.message ?? e));
      } finally {
        if (myReqId === reqIdRef.current) {
          setLoading(false);
        }
      }
    }
  
    loadTree();
  }, [state.bomId, state.selectedSpec, state.treeCache]);
  

  /* ---------------------------------
     선택 노드
  --------------------------------- */
  const selectedNode = useMemo(() => {
    return nodes?.find(n => n.name === state.selectedNodeId) ?? null;
  }, [nodes, state.selectedNodeId]);
  

  const treeRoots = useMemo(() => buildTree(nodes), [nodes]);
  const selectedSpecLabel = getSubSpecDisplayName(state.selectedSpec);

  async function handleDeleteSelectedNode() {
    if (!state.bomId || !state.selectedSpec || !selectedNode) {
      return;
    }

    const rollbackUndo = beginUndoCheckpoint();

    try {
      const deletedTree = await apiDelete(
        `/api/sub/bom/${encodeURIComponent(
          state.bomId
        )}/node/${encodeURIComponent(selectedNode.name)}?spec=${encodeURIComponent(
          state.selectedSpec
        )}`
      );

      if (deletedTree?.nodes) {
        updateNodesAndCache(deletedTree.nodes);
      }

      actions.setSelectedNode(null);
    } catch (e) {
      rollbackUndo?.();
      throw e;
    }
  }

  useEffect(() => {
    async function handleUndoShortcut(event) {
      const target = event.target;
      const tagName = String(target?.tagName || "").toLowerCase();
      const isTypingTarget =
        target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";

      if (isTypingTarget || isUndoingRef.current) {
        return;
      }

      const isUndoKey =
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z" &&
        !event.shiftKey;

      if (isUndoKey) {
        if (!state.bomId || !state.selectedSpec || undoStackRef.current.length === 0) {
          return;
        }

        event.preventDefault();

        const snapshot = undoStackRef.current.pop();
        if (!snapshot) {
          return;
        }

        isUndoingRef.current = true;

        try {
          const restoredTree = await apiPost(
            `/api/sub/bom/${encodeURIComponent(state.bomId)}/tree/restore?spec=${encodeURIComponent(
              state.selectedSpec
            )}`,
            { nodes: snapshot }
          );

          const restoredNodes = restoredTree?.nodes ?? [];
          updateNodesAndCache(restoredNodes);
          setDragNodeId(null);

          if (state.selectedNodeId) {
            const stillExists = restoredNodes.some((item) => item.name === state.selectedNodeId);
            if (!stillExists) {
              actions.setSelectedNode(null);
            }
          }
        } catch (e) {
          undoStackRef.current.push(snapshot);
          message.error(String(e?.message ?? e));
        } finally {
          isUndoingRef.current = false;
        }
        return;
      }

      if (event.key !== "Delete" || !selectedNode) {
        return;
      }

      event.preventDefault();

      try {
        await handleDeleteSelectedNode();
      } catch (e) {
        message.error(String(e?.message ?? e));
      }
    }

    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [actions, selectedNode, state.bomId, state.selectedNodeId, state.selectedSpec]);

  // Drag 시작 핸들러
  function handleDragStartNode(nodeId) {
    setDragNodeId(nodeId);
  }

  // Drop 핸들러
  async function handleDropNode(parentId, index) {
    if (!dragNodeId) return;
    if (!state.bomId || !state.selectedSpec) return;

    const rollbackUndo = beginUndoCheckpoint();

    try {
      const payload = {
        node_id: dragNodeId,
        new_parent_name: parentId,
        new_index: index,
      };

      const updatedTree = await apiPatch(
        `/api/sub/bom/${state.bomId}/move-node?spec=${encodeURIComponent(
          state.selectedSpec
        )}`,
        payload
      );

      // 서버에서 nodes 내려준다고 가정
      if (updatedTree?.nodes) {
        updateNodesAndCache(updatedTree.nodes);
      }
    } catch (e) {
      rollbackUndo();
      console.error("노드 이동 실패:", e);
      showPopup("노드 이동 실패. 콘솔을 확인하세요.", "error");
    } finally {
      setDragNodeId(null);
    }
  }
  async function handleAddRootNode() {
    if (!state?.bomId || !state?.selectedSpec) {
      showPopup("BOM과 사양을 먼저 선택하세요.", "warning");
      return;
    }
 
    const rollbackUndo = beginUndoCheckpoint();
  
    try {
      const roots = nodes?.filter(n => n.parent_name === null) ?? [];
      const maxOrder = roots.reduce(
        (m, n) => Math.max(m, n.order ?? 0),
        0
      );
  
      const body = {
        id:"",
        parent_name: null,
        order: maxOrder + 1,
        name: "새 루트 노드",
        part_no: "",
        qty: 1,
        material: "",
        type: "PART",
        inhouse: false
      };
  
      const created = await apiPost(
        `/api/sub/bom/${state.bomId}/nodes?spec=${encodeURIComponent(
          state.selectedSpec
        )}`,
        body
      );
  
      // UI에 반영
      setNodes(prev => {
        const next = [...prev, created];
        actions.setTreeCacheEntry?.(
          makeTreeCacheKey(state.bomId, state.selectedSpec),
          { nodes: next }
        );
        return next;
      });
  
    } catch (e) {
      rollbackUndo();
      showPopup("노드 추가 실패: " + String(e?.message ?? e), "error");
    }
  }
  
  /* =========================
     render
  ========================= */
  return (
    <div style={{ padding: 16, height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1.1fr) minmax(320px, 0.9fr)",
          gap: 16,
          alignItems: "start",
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <UploadBom />
        </div>

        <div style={{ minWidth: 0 }}>
          <SpecSelector />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <Space style={{ marginBottom: 8, flexWrap: "wrap" }}>
          <button onClick={() => setShowConfirmInit(true)}>
            전체 초기화
          </button>

          <button onClick={handleAddRootNode}>
            추가
          </button>
        </Space>
      </div>

      {!state.selectedSpec && (
        <Alert
          type="info"
          title="사양을 선택하세요."
          showIcon
        />
      )}


      <Spin spinning={loading} tip="트리를 불러오는 중입니다...">
        {/* 아래 카드 포함 */}
      </Spin>

      {err && <div style={{ color: "crimson" }}>{err}</div>}

      {/* 🔥 여기부터 하단 스크롤 영역 */}
      {treeRoots.length > 0 && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            gap: 12,
            marginTop: 12,
            overflow: "hidden",
            height: "100%",
          }}
        >
          {/* 트리 패널 - 여기서만 스크롤 */}
          <div
            ref={treeScrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              position: "relative",
              border: "1px solid #dbe4f0",
              borderRadius: 20,
              padding: 14,
              background:
                "linear-gradient(180deg, #fcfdff 0%, #f8fafc 100%)",
              boxShadow: "0 20px 42px rgba(15, 23, 42, 0.07)",
            }}
            onDragOver={handleTreeDragAutoScroll}
          >
            <Spin spinning={loading} tip="트리 불러오는 중...">
              {treeRoots.length > 0 && (
                <>
                {selectedSpecLabel && (
                    <div
                      style={{
                        position: "absolute",
                        top: 14,
                        right: 14,
                        background: "rgba(255, 255, 255, 0.92)",
                        border: "1px solid #dbe4f0",
                        borderRadius: 999,
                        padding: "7px 12px",
                        fontWeight: 700,
                        color: "#334155",
                        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                        zIndex: 10
                      }}
                    >
                      현재 사양: {selectedSpecLabel}
                    </div>
                  )}
                  <TreeView
                    tree={treeRoots}
                    selectedNodeId={state.selectedNodeId}
                    onSelect={(node) => actions.setSelectedNode(node.name)}
                    onDragStartNode={handleDragStartNode}
                    onDropNode={handleDropNode}
                  />
                </>
              )}
            </Spin>
          </div>

          {/* 오른쪽 패널 */}
          <div style={{ width: 480, minHeight: 0 }}>
            <SelectedPartPanel
              node={selectedNode}
              onUpdateNodes={updateNodesAndCache}
              onBeforeMutate={beginUndoCheckpoint}
            />
          </div>
        </div>
      )}

      {showConfirmInit && (
        <ConfirmPopup
          message="전체 초기화하시겠습니까? BOM 및 모든 작업 내용이 초기화됩니다."
          confirmLabel="초기화"
          danger
          onConfirm={() => {
            fixedBomIdRef.current = null;
            hasLoadedRef.current = false;
            setNodes(null);
            actions.resetAll();
            setShowConfirmInit(false);
          }}
          onCancel={() => setShowConfirmInit(false)}
        />
      )}
    </div>
  );
}
