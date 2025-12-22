import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { apiGet } from "../api/client";
import UploadBom from "./UploadBom";
import SpecSelector from "./SpecSelector";
import TreeView from "./TreeView";
import SelectedPartPanel from "./SelectedPartPanel";

function normalizeTreeTypes(tree) {
    if (!tree || !Array.isArray(tree.nodes)) return tree;
  
    return {
      ...tree,
      nodes: tree.nodes.map((n) => ({
        ...n,
  
        // ✅ 문자열 ID 그대로 유지
        id: n.id,
        parent_id: n.parent_id,
  
        // order만 숫자로
        order:
          n.order === null || n.order === undefined || n.order === ""
            ? 0
            : Number(n.order),
      })),
    };
  }

function findNodeById(node, targetId) {
    if (!node) return null;
    
    if (node._id === targetId) return node;
    
    if (!Array.isArray(node.children)) return null;
    
    for (const child of node.children) {
    const found = findNodeById(child, targetId);
    if (found) return found;
    }
    
    return null;
}
export default function SubPage() {
  const { state, actions } = useApp();
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const canLoadTree = Boolean(state.bomId && state.selectedSpec);

  const selectedNode = useMemo(() => {
    if (!tree || !state.selectedNodeId) return null;
    return findNodeById(tree, state.selectedNodeId);
    }, [tree, state.selectedNodeId]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setErr("");

      if (!canLoadTree) {
        setTree(null);
        return;
      }

      // 1) 캐시 우선
      if (state.treeCache && state.treeCache?.spec === state.selectedSpec) {
        setTree(state.treeCache.tree);
        return;
      }

      // 2) 없으면 서버에서 로드
      setLoading(true);
      try {
        const raw = await apiGet(
          `/api/bom/${encodeURIComponent(state.bomId)}/tree?spec=${encodeURIComponent(
            state.selectedSpec
          )}`
        );

        const normalized = normalizeTreeTypes(raw);

        if (ignore) return;

        setTree(normalized);

        // 캐시 저장(선택)
        actions.setTreeCache({ spec: state.selectedSpec, tree: normalized });
      } catch (e) {
        if (ignore) return;
        setTree(null);
        setErr(String(e?.message ?? e));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [canLoadTree, state.bomId, state.selectedSpec, state.treeCache, actions]);


  
  return (
    <div style={{ padding: 16 }}>
      <h2>SUB PAGE</h2>

      <div style={{ marginBottom: 12 }}>
        <div>bomId: {String(state.bomId)}</div>
        <div>selectedSpec: {String(state.selectedSpec)}</div>
        <div>sourceSheet: {String(state.sourceSheet)}</div>
        <div>selectedNodeId: {String(state.selectedNodeId)}</div>
      </div>
    {/* ✅ BOM 업로드 */}
      <UploadBom />
      <SpecSelector />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => actions.clearTreeCache()}>트리 캐시 비우기</button>
        <button onClick={() => actions.resetAll()}>전체 초기화</button>
        <Link to="/summary">요약 페이지로 이동</Link>
      </div>

      {!canLoadTree && (
        <div>사양을 먼저 선택하세요. (bomId와 selectedSpec 필요)</div>
      )}

      {loading && <div>트리 로딩 중...</div>}
      {err && <div style={{ color: "crimson" }}>{err}</div>}

      {tree && (
        <div style={{ marginTop: 12 }}>
          <div>nodes: {tree.nodes?.length ?? 0}</div>

          {tree && (
            <>
                <TreeView
                tree={buildTree(tree.nodes)}
                selectedNodeId={state.selectedNodeId}
                onSelect={(node) => actions.setSelectedNode(node._id)}
                />
            </>
           )}
        <SelectedPartPanel node={selectedNode} />
        </div>
      )}
    </div>
  );
}
export function buildTree(nodes) {
    const nodeMap = new Map();
    const roots = [];
  
    // 1. 노드 복사 + children 초기화
    nodes.forEach((n, idx) => {
      const id = n.id ?? idx; // id가 null이면 임시 id
      nodeMap.set(id, { ...n, _id: id, children: [] });
    });
  
    // 2. 부모-자식 연결
    nodeMap.forEach((node) => {
      if (node.parent_id === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(node.parent_id);
        if (parent) {
          parent.children.push(node);
        } else {
          // 부모가 없는 경우 → 루트 취급
          roots.push(node);
        }
      }
    });
  
    // 3. order 기준 정렬
    function sortRecursively(list) {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      list.forEach((n) => sortRecursively(n.children));
    }
  
    sortRecursively(roots);
  
    return roots;
  }
  