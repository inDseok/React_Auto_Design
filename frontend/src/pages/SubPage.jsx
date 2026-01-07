import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { apiGet, apiPatch, apiPost } from "../api/client";
import TreeView from "./TreeView";
import SelectedPartPanel from "./SelectedPartPanel";
import SpecSelector from "./SpecSelector";
import UploadBom from "./UploadBom";
import { Button, Spin, Alert, Card, Row, Col, Space } from "antd";

/* =========================
   utils
========================= */

// flat nodes → tree (렌더링 전용)
function buildTree(nodes) {
  if (!Array.isArray(nodes)) return [];

  const map = new Map();
  const roots = [];

  nodes.forEach((n) => {
    map.set(n.id, { ...n, children: [] });
  });

  map.forEach((node) => {
    if (node.parent_id === null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parent_id);
      parent ? parent.children.push(node) : roots.push(node);
    }
  });

  const sortRecursively = (list) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    list.forEach((n) => sortRecursively(n.children));
  };

  sortRecursively(roots);
  return roots;
}

// flat nodes에서 단일 노드 찾기
function findNodeById(nodes, id) {
  if (!Array.isArray(nodes) || !id) return null;
  return nodes.find((n) => n.id === id) ?? null;
}


/* =========================
   SubPage
========================= */

export default function SubPage() {
  const { state, actions } = useApp();
  const hasLoadedRef = useRef(false);
  const [nodes, setNodes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [dragNodeId, setDragNodeId] = useState(null);

  // ⛳ bomId lock
  const fixedBomIdRef = useRef(null);

  useEffect(() => {
    actions.setSelectedNode(null);
  }, [state.selectedSpec]);
  
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

  useEffect(() => {
    if (!state.bomId || !state.selectedSpec) {
      setNodes(null);
      return;
    }
  
    const myReqId = ++reqIdRef.current;
  
    async function loadTree() {
      setLoading(true);
      setErr("");
  
      try {
        const res = await fetch(
          `http://localhost:8000/api/bom/${state.bomId}/tree?spec=${encodeURIComponent(
            state.selectedSpec
          )}`,
          { credentials: "include" }
        );
  
        if (!res.ok) {
          throw new Error(await res.text());
        }
  
        const data = await res.json();
  
        // 🔥 요청 ID가 최신 요청이 아닐 경우 — 응답 버리기
        if (myReqId !== reqIdRef.current) return;
  
        setNodes(data.nodes ?? []);
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
  }, [state.bomId, state.selectedSpec]);
  

  /* ---------------------------------
     선택 노드
  --------------------------------- */
  const selectedNode = useMemo(() => {
    return findNodeById(nodes, state.selectedNodeId);
  }, [nodes, state.selectedNodeId]);

  const treeRoots = useMemo(() => buildTree(nodes), [nodes]);

  // Drag 시작 핸들러
  function handleDragStartNode(nodeId) {
    setDragNodeId(nodeId);
  }

  // Drop 핸들러
  async function handleDropNode(parentId, index) {
    if (!dragNodeId) return;
    if (!state.bomId || !state.selectedSpec) return;

    try {
      const payload = {
        node_id: dragNodeId,
        new_parent_id: parentId,
        new_index: index,
      };

      const updatedTree = await apiPatch(
        `/api/bom/${state.bomId}/move-node?spec=${encodeURIComponent(
          state.selectedSpec
        )}`,
        payload
      );

      // 서버에서 nodes 내려준다고 가정
      if (updatedTree?.nodes) {
        setNodes(updatedTree.nodes);
      }
    } catch (e) {
      console.error("노드 이동 실패:", e);
      alert("노드 이동 실패. 콘솔을 확인하세요.");
    } finally {
      setDragNodeId(null);
    }
  }
  async function handleAddRootNode() {
    if (!state?.bomId || !state?.selectedSpec) {
      alert("BOM과 사양을 먼저 선택하세요.");
      return;
    }
  
    try {
      const roots = nodes?.filter(n => n.parent_id === null) ?? [];
      const maxOrder = roots.reduce(
        (m, n) => Math.max(m, n.order ?? 0),
        0
      );
  
      const body = {
        id:"",
        parent_id: null,
        order: maxOrder + 1,
        name: "새 루트 노드",
        part_no: "",
        qty: 1,
        material: "",
        type: "PART",
        inhouse: false
      };
  
      const created = await apiPost(
        `/api/bom/${state.bomId}/nodes?spec=${encodeURIComponent(
          state.selectedSpec
        )}`,
        body
      );
  
      // UI에 반영
      setNodes(prev => [...prev, created]);
  
    } catch (e) {
      alert("노드 추가 실패: " + String(e?.message ?? e));
    }
  }
  
  
  /* =========================
     render
  ========================= */
  return (
    <div style={{ padding: 16, height: "100vh", boxSizing: "border-box" }}>
      
      <div className="top-left">
        <UploadBom />
      </div>

      <div className="spec-panel">
        <SpecSelector />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <Space style={{ marginBottom: 8 }}>
          <button
            onClick={() => {
              fixedBomIdRef.current = null;
              hasLoadedRef.current = false;
              setNodes(null);
              actions.resetAll();
            }}
          >
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
          message="사양을 선택하세요."
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
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 8,
            }}
          >
            <Spin spinning={loading} tip="트리 불러오는 중...">
              {treeRoots.length > 0 && (
                <>
                {state.selectedSpec && (
                    <div
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontWeight: 600,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                        zIndex: 10
                      }}
                    >
                      현재 사양: {state.selectedSpec}
                    </div>
                  )}
                  <TreeView
                    tree={treeRoots}
                    selectedNodeId={state.selectedNodeId}
                    onSelect={(node) => actions.setSelectedNode(node.id)}
                    onDragStartNode={handleDragStartNode}
                    onDropNode={handleDropNode}
                  />
                </>
              )}
            </Spin>
          </div>

          {/* 오른쪽 패널 */}
          <div style={{ width: 480}}>
            <SelectedPartPanel
              node={selectedNode}
              onUpdateNodes={(newNodes) => setNodes(newNodes)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
