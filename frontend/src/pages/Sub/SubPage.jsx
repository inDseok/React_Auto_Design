import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../state/AppContext";
import { apiGet, apiPatch, apiPost } from "../../api/client";
import TreeView from "./TreeView";
import SelectedPartPanel from "./SelectedPartPanel";
import SpecSelector from "./SpecSelector";
import UploadBom from "./UploadBom";
import { Button, Spin, Alert, Card, Row, Col, Space } from "antd";

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

  function updateNodesAndCache(nextNodes) {
    setNodes(nextNodes);
    if (state.bomId && state.selectedSpec) {
      actions.setTreeCacheEntry?.(
        makeTreeCacheKey(state.bomId, state.selectedSpec),
        { nodes: nextNodes }
      );
    }
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
        const res = await fetch(
          `http://localhost:8000/api/sub/bom/${state.bomId}/tree?spec=${encodeURIComponent(
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
      alert("노드 추가 실패: " + String(e?.message ?? e));
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
            />
          </div>
        </div>
      )}
    </div>
  );
}
