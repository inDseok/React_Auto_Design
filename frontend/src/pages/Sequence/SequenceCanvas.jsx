// SequenceCanvas.jsx (완성본)
// - Shift+G: 선택된 노드 2개 이상 → 그룹 생성(영구 표시)
// - 그룹 박스는 pan/zoom 동기화
// - 그룹 라벨 더블클릭 → 이름 편집(Enter 저장, Esc 취소)
// - 편집 중 다른 곳 클릭(노드/엣지/빈공간/selection 변화) 시 편집 종료
// - Backspace로 노드 삭제 방지(텍스트 편집 사고 방지)
// - 노드를 드래그해서 그룹 안으로 넣으면 자동으로 해당 그룹에 포함(드래그 종료 시 판정)

import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSequenceDnD } from "./SequenceDnDContext";
import PartNode from "./nodes/PartNode";
import ProcessNode from "./nodes/ProcessNode";

/* ===============================
   GROUP utils
================================ */
function getNodeSize(node) {
  const w = node.measured?.width ?? node.width ?? 180;
  const h = node.measured?.height ?? node.height ?? 70;
  return { w, h };
}

function getNodeCenter(node) {
  const { w, h } = getNodeSize(node);
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

function computeGroupBBox(nodeIds, nodes) {
  const targets = nodes.filter((n) => nodeIds.includes(n.id));
  if (targets.length === 0) return null;

  const xs = targets.map((n) => n.position.x);
  const ys = targets.map((n) => n.position.y);

  const ws = targets.map((n) => n.measured?.width ?? n.width ?? 180);
  const hs = targets.map((n) => n.measured?.height ?? n.height ?? 70);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs.map((x, i) => x + ws[i]));
  const maxY = Math.max(...ys.map((y, i) => y + hs[i]));

  const pad = 16;

  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

function isPointInsideBBox(point, bbox) {
  return (
    point.x >= bbox.x &&
    point.x <= bbox.x + bbox.width &&
    point.y >= bbox.y &&
    point.y <= bbox.y + bbox.height
  );
}

function uniqueKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/* ===============================
   GroupLayer (overlay)
   - ReactFlow 밖에서 렌더링
   - viewport transform 동기화
   - 라벨만 pointer-events 허용
================================ */
function GroupLayer({
  groups = [],      // ⭐ 기본값
  nodes = [],
  setNodes,
  setGroups,
  onEditingChange,
}) {
  const transform = useStore((s) => s.transform);
  const [tx, ty, zoom] = transform;

  const [editingGroupId, setEditingGroupId] = useState(null);
  const [tempLabel, setTempLabel] = useState("");

  const dragRef = React.useRef(null);

  const [contextMenuGroupId, setContextMenuGroupId] = useState(null);

  useEffect(() => {
    const cancelEdit = () => setEditingGroupId(null);
    window.addEventListener("group-edit-cancel", cancelEdit);
    return () => window.removeEventListener("group-edit-cancel", cancelEdit);
  }, []);

  useEffect(() => {
    const close = () => setContextMenuGroupId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  
  
  const startEdit = (group) => {
    setEditingGroupId(group.id);
    setTempLabel(group.label ?? "");
    onEditingChange?.(true);
  };

  const commitEdit = () => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === editingGroupId ? { ...g, label: tempLabel } : g
      )
    );
    setEditingGroupId(null);
    onEditingChange?.(false);
  };
  

  /* =========================
     그룹 드래그 시작
  ========================= */
  const onGroupMouseDown = (e, group) => {
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      groupId: group.id,
      startX: e.clientX,
      startY: e.clientY,
    };

    window.addEventListener("mousemove", onGroupMouseMove);
    window.addEventListener("mouseup", onGroupMouseUp);
  };

  const onGroupMouseMove = (e) => {
    if (!dragRef.current) return;

    const { groupId, startX, startY } = dragRef.current;

    const dx = (e.clientX - startX) / zoom;
    const dy = (e.clientY - startY) / zoom;

    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;

    setNodes((prev) =>
      prev.map((n) => {
        const g = groups.find((x) => x.id === groupId);
        if (!g || !g.nodeIds.includes(n.id)) return n;

        return {
          ...n,
          position: {
            x: n.position.x + dx,
            y: n.position.y + dy,
          },
        };
      })
    );
  };

  const onGroupMouseUp = () => {
    dragRef.current = null;
    window.removeEventListener("mousemove", onGroupMouseMove);
    window.removeEventListener("mouseup", onGroupMouseUp);
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
        transformOrigin: "0 0",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {groups.map((g) => {
        const bbox = computeGroupBBox(g.nodeIds, nodes);
        if (!bbox) return null;

        const isEditing = editingGroupId === g.id;
        
        return (
          <React.Fragment key={g.id}>
            {/* 그룹 박스 */}
            <div
              style={{
                position: "absolute",
                left: bbox.x,
                top: bbox.y,
                width: bbox.width,
                height: bbox.height,
                border: "2px dashed #2563eb",
                background: "rgba(37,99,235,0.08)",
                borderRadius: 10,
                pointerEvents: "none",
              }}
            />

            {/* 그룹 라벨 + 드래그 핸들 */}
            <div
              style={{
                position: "absolute",
                left: bbox.x + 8,
                top: bbox.y + 8,
                pointerEvents: "auto",
                cursor: "move",
              }}
              onMouseDown={(e) => onGroupMouseDown(e, g)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit(g);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenuGroupId(g.id);
              }}
              
            >
              {isEditing ? (
                <input
                  value={tempLabel}
                  autoFocus
                  onChange={(e) => setTempLabel(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingGroupId(null);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 12,
                    padding: "2px 6px",
                    borderRadius: 6,
                    border: "1px solid #2563eb",
                    outline: "none",
                    width: Math.max(60, tempLabel.length * 8),
                  }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    background: "rgba(255,255,255,0.95)",
                    padding: "2px 8px",
                    borderRadius: 999,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  {g.label || "이름 없음"}
                </div>
              )}
              {contextMenuGroupId === g.id && (
                <div
                  style={{
                    position: "absolute",
                    left: "100%",       // 라벨 오른쪽
                    top: 0,
                    marginLeft: 6,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 6,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
                    fontSize: 13,
                    zIndex: 100,
                    whiteSpace: "nowrap",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      padding: "6px 12px",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setGroups((prev) =>
                        prev.filter((x) => x.id !== g.id)
                      );
                      setContextMenuGroupId(null);
                    }}
                  >
                    🗑 그룹 삭제
                  </div>
                </div>
              )}

            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}


/* ===============================
   SequenceCanvas
================================ */
export default function SequenceCanvas({
  nodes,
  edges,
  setNodes,
  setEdges,
  groups = [],     // ⭐ 기본값
  setGroups,
  onSelectNode,   // ⭐ 반드시 포함
  onSelectEdge,   // ⭐ 반드시 포함
  onKeyDown,
}) {

  const [dragItem] = useSequenceDnD();
  const { screenToFlowPosition } = useReactFlow();

  const [linkFromNodeId, setLinkFromNodeId] = useState(null);

  const [isGroupEditing, setIsGroupEditing] = useState(false);

  const nodeTypes = useMemo(
    () => ({
      PART: PartNode,
      PROCESS: ProcessNode,
    }),
    []
  );

  const dispatchCancelGroupEdit = useCallback(() => {
    window.dispatchEvent(new Event("group-edit-cancel"));
  }, []);

  const cancelGroupEdit = useCallback(() => {
    if (isGroupEditing) return;
    dispatchCancelGroupEdit();
  }, [isGroupEditing, dispatchCancelGroupEdit]);

  const onNodesChange = useCallback(
    (changes) => {
      setNodes((prev) => {
        const nextNodes = applyNodeChanges(changes, prev);

        const finishedMoves = changes.filter(
          (c) => c.type === "position" && c.dragging === false
        );
        if (finishedMoves.length === 0) return nextNodes;

        setGroups((prevGroups) => {
          const nextGroups = prevGroups.map((g) => ({
            ...g,
            nodeIds: [...g.nodeIds],
          }));

          for (const move of finishedMoves) {
            const node = nextNodes.find((n) => n.id === move.id);
            if (!node) continue;

            const center = getNodeCenter(node);

            let targetGroupId = null;
            for (const g of nextGroups) {
              const bbox = computeGroupBBox(g.nodeIds, nextNodes);
              if (!bbox) continue;
              if (isPointInsideBBox(center, bbox)) {
                targetGroupId = g.id;
                break;
              }
            }

            // 기존 그룹들에서 제거
            for (const g of nextGroups) {
              g.nodeIds = g.nodeIds.filter((id) => id !== node.id);
            }

            // 새 그룹에 추가
            if (targetGroupId) {
              const tg = nextGroups.find((x) => x.id === targetGroupId);
              if (tg && !tg.nodeIds.includes(node.id)) {
                tg.nodeIds.push(node.id);
              }
            }
          }

          // 정리: 중복 제거 + 2개 미만 자동 제거
          return nextGroups
            .map((g) => ({ ...g, nodeIds: uniqueKeepOrder(g.nodeIds) }))
            .filter((g) => g.nodeIds.length >= 2);
        });

        return nextNodes;
      });
    },
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (event, node) => {
  
      // ✅ 1. 무조건 Inspector 선택 확정
      onSelectNode?.(node.id);
      onSelectEdge?.(null);
  
      // ✅ 2. Shift 안 누르면 "선택만"
      if (!event.shiftKey) {
        setLinkFromNodeId(null);
        return;
      }
  
      // ✅ 3. Shift + 클릭일 때만 링크 로직
      if (!linkFromNodeId) {
        setLinkFromNodeId(node.id);
        return;
      }
  
      if (linkFromNodeId === node.id) {
        setLinkFromNodeId(null);
        return;
      }
  
      setEdges((eds) =>
        addEdge(
          {
            id: `E-${linkFromNodeId}-${node.id}`,
            source: linkFromNodeId,
            target: node.id,
            type: "smoothstep",
          },
          eds
        )
      );
  
      setLinkFromNodeId(null);
    },
    [linkFromNodeId, setEdges, onSelectNode, onSelectEdge]
  );
  
  
  

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }) => {
      // ⚠️ 아무것도 선택 안 됐을 때는 무시
      if (!selNodes?.length && !selEdges?.length) {
        return;
      }
  
      if (selNodes?.length) {
        onSelectNode?.(selNodes[0].id);
        onSelectEdge?.(null);
      } else if (selEdges?.length) {
        onSelectEdge?.(selEdges[0].id);
        onSelectNode?.(null);
      }
    },
    [onSelectNode, onSelectEdge]
  );
  
  
  

  const createGroupFromSelection = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length < 2) return;

    const newId = `grp-${crypto.randomUUID()}`;
    setGroups((prev) => [
      ...prev,
      {
        id: newId,
        nodeIds: selected.map((n) => n.id),
        label: `그룹 ${prev.length + 1}`,
      },
    ]);
  }, [nodes]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      if (!dragItem) return;

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      let label = "";
      if (dragItem.nodeType === "PART") {
        label =
          dragItem.data.partBase ??
          dragItem.data.partId ??
          "PART";
      }
      else if (dragItem.nodeType === "PROCESS") {
        label =
          dragItem.data.label ??
          dragItem.data.processType ??
          "PROCESS";
      }


      setNodes((nds) =>
        nds.concat({
          id: `N-${Date.now()}`,
          type: dragItem.nodeType,
          position,
          data: {
            ...dragItem.data,
            label,
          },
        })
      );
    },
    [dragItem, screenToFlowPosition, setNodes]
  );

  function isTextEditingTarget(target) {
    if (!target) return false;
  
    // contenteditable
    if (target.isContentEditable) return true;
  
    const tag = target.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
  
    // input type 중에서도 text 편집 계열만 허용하고 싶으면 여기서 더 좁힐 수 있음
    // const type = (target.getAttribute?.("type") || "").toLowerCase();
    // return tag === "textarea" || (tag === "input" && ["text","search","email","number","password","tel","url"].includes(type));
  
    return false;
  }
  
  return (
    <div
      style={{ width: "100%", height: "100%", position: "relative" }}
      tabIndex={0}
      onKeyDownCapture={(e) => {

        if (isTextEditingTarget(e.target)) {
          return;
        }

        if (e.key === "Escape") {
          dispatchCancelGroupEdit();
        }
        

        // Backspace로 노드 삭제 사고 방지
        if (e.key === "Backspace") {
          e.stopPropagation();
          e.preventDefault();
          return;
        }

        // Shift + G → 그룹 생성
        if (e.shiftKey && e.key.toLowerCase() === "g") {
          e.preventDefault();
          createGroupFromSelection();
          return;
        }

        onKeyDown?.(e);
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(e, node) => {
          cancelGroupEdit();
          onNodeClick(e, node);
        }}
        onEdgeClick={() => {
          cancelGroupEdit();
        }}
        onPaneClick={() => {
          cancelGroupEdit();
        }}
        onConnect={onConnect}
        fitView
        minZoom={0.1}
        maxZoom={2}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <Background />
        <Controls position="bottom-left" />
        <MiniMap position="bottom-right" zoomable pannable />
      </ReactFlow>

      <GroupLayer
        groups={groups}
        nodes={nodes}
        setNodes={setNodes}
        setGroups={setGroups}
        onEditingChange={(v) => setIsGroupEditing(v)}
      />
    </div>
  );
}
