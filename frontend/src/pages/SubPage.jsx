import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { apiGet, apiPatch } from "../api/client";
import UploadBom from "./UploadBom";
import SpecSelector from "./SpecSelector";
import TreeView from "./TreeView";
import SelectedPartPanel from "./SelectedPartPanel";

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
    if (hasLoadedRef.current) return;

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
    if (!dragNodeId) {
      console.warn("dragNodeId가 없습니다. 드래그 시작이 제대로 안 된 것 같습니다.");
      return;
    }

    if (!state.bomId) {
      console.warn("bomId가 없습니다.");
      return;
    }

    try {
      // 1) 서버에 이동 요청 (API는 실제 구현에 맞게 변경 필요)
      // 예: body에 source_id, new_parent_id, new_index 전달
      const payload = {
        node_id: dragNodeId,
        new_parent_id: parentId,
        new_index: index,
      };

      const updated = await apiPatch(
        `/api/bom/${state.bomId}/move-node?spec=${encodeURIComponent(state.selectedSpec)}`,
        payload
      );      

      // 2) 서버에서 전체 nodes를 내려준다고 가정
      if (updatedTree?.nodes && Array.isArray(updatedTree.nodes)) {
        setNodes(updatedTree.nodes);
      } else {
        console.warn("updatedTree.nodes 구조가 예상과 다릅니다.", updatedTree);
      }
    } catch (e) {
      console.error("노드 이동 실패:", e);
      alert("노드 이동에 실패했습니다. 콘솔 로그를 확인하세요.");
    } finally {
      // 드래그 끝
      setDragNodeId(null);
    }
  }

  /* =========================
     render
  ========================= */
  return (
    <div style={{ padding: 16 }}>
      <h2>SUB PAGE</h2>

      <div style={{ marginBottom: 12 }}>
        <div>bomId: {String(state.bomId)}</div>
        <div>selectedSpec: {String(state.selectedSpec)}</div>
        <div>selectedNodeId: {String(state.selectedNodeId)}</div>
      </div>

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

      {treeRoots.length > 0 && (
        <>
          <TreeView
            tree={treeRoots}
            selectedNodeId={state.selectedNodeId}
            onSelect={(node) => actions.setSelectedNode(node.id)}
            onDragStartNode={handleDragStartNode}
            onDropNode={handleDropNode}
          />
          <SelectedPartPanel node={selectedNode}
          onUpdateNodes={(newNodes) => setNodes(newNodes)}
          />
        </>
      )}
    </div>
  );
}
