import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { apiGet, apiPatch } from "../api/client";
import UploadBom from "./UploadBom";
import SpecSelector from "./SpecSelector";
import TreeView from "./TreeView";
import SelectedPartPanel from "./SelectedPartPanel";
import { Layout, Row, Col } from "antd";

const { Content } = Layout;
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

  const [nodes, setNodes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [dragNodeId, setDragNodeId] = useState(null);

  // ⛳ bomId lock
  const fixedBomIdRef = useRef(null);
  const hasLoadedRef = useRef(false);

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

  // tree(nodes) 로드
  useEffect(() => {
    if (!activeBomId || !state.selectedSpec) return;
    if (hasLoadedRef.current) false;

    hasLoadedRef.current = true;

    async function loadTree() {
      setLoading(true);
      setErr("");

      try {
        const raw = await apiGet(
          `/api/bom/${encodeURIComponent(
            activeBomId
          )}/tree?spec=${encodeURIComponent(state.selectedSpec)}`
        );

        console.log("RAW TREE RESPONSE =", raw);

        if (!raw?.nodes || !Array.isArray(raw.nodes)) {
          throw new Error("Invalid tree structure");
        }

        setNodes(raw.nodes);
      } catch (e) {
        setNodes(null);
        setErr(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    }

    loadTree();
  }, [activeBomId, state.selectedSpec]);

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

  /* =========================
     render
  ========================= */
  return (
    <div style={{ padding: 16, height: "100vh", boxSizing: "border-box" }}>

      <UploadBom />
      <SpecSelector />

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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

        <Link to="/summary">요약 페이지로 이동</Link>
      </div>

      {(!state.bomId || !state.selectedSpec) && (
        <div>사양을 선택하세요.</div>
      )}

      {loading && <div>트리 로딩 중...</div>}
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
            <TreeView
              tree={treeRoots}
              selectedNodeId={state.selectedNodeId}
              onSelect={(node) => actions.setSelectedNode(node.id)}
              onDragStartNode={handleDragStartNode}
              onDropNode={handleDropNode}
            />
          </div>

          {/* 오른쪽 패널 */}
          <div style={{ width: 360 }}>
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
