import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSequenceDnD } from "./SequenceDnDContext";
import PartNode from "./nodes/PartNode";
import ProcessNode from "./nodes/ProcessNode";

const CANVAS_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M4 3.5v16l4.6-4.5 3.1 5.2 2.1-1.2-3-5.2h6.7L4 3.5z' fill='%23000' stroke='%23fff' stroke-width='1.4' stroke-linejoin='round'/%3E%3C/svg%3E") 3 3, default`;

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

function isMultiSelectEvent(event) {
  return Boolean(event?.ctrlKey || event?.metaKey);
}

function getNextWorkerGroupLabel(groups = []) {
  const usedNumbers = new Set(
    groups
      .map((group) => Number.parseInt(String(group.label || "").trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  let next = 1;
  while (usedNumbers.has(next)) {
    next += 1;
  }
  return String(next);
}

function normalizeGroups(groups = [], minSize = 2) {
  return groups
    .map((g) => ({ ...g, nodeIds: uniqueKeepOrder(g.nodeIds || []) }))
    .filter((g) => (g.nodeIds || []).length >= minSize);
}

function syncMembership(groups, nextNodes, finishedMoves, minSize = 2) {
  const nextGroups = (groups || []).map((g) => ({
    ...g,
    nodeIds: [...(g.nodeIds || [])],
  }));

  for (const move of finishedMoves) {
    const node = nextNodes.find((n) => n.id === move.id);
    if (!node) continue;

    const center = getNodeCenter(node);
    let targetGroupId = null;

    for (const group of nextGroups) {
      const bbox = computeGroupBBox(group.nodeIds, nextNodes);
      if (!bbox) continue;
      if (isPointInsideBBox(center, bbox)) {
        targetGroupId = group.id;
        break;
      }
    }

    for (const group of nextGroups) {
      group.nodeIds = group.nodeIds.filter((id) => id !== node.id);
    }

    if (targetGroupId) {
      const target = nextGroups.find((group) => group.id === targetGroupId);
      if (target && !target.nodeIds.includes(node.id)) {
        target.nodeIds.push(node.id);
      }
    }
  }

  return normalizeGroups(nextGroups, minSize);
}

function applyWorkerLabelsToNodes(nodes, workerGroups = []) {
  const workerByNodeId = new Map();
  for (const group of workerGroups) {
    const label = String(group.label || "").trim();
    for (const nodeId of group.nodeIds || []) {
      workerByNodeId.set(nodeId, label);
    }
  }

  return nodes.map((node) => {
    const nextWorker = workerByNodeId.get(node.id) ?? "";
    const prevWorker = String(node.data?.worker || "").trim();
    if (nextWorker === prevWorker) {
      return node;
    }

    return {
      ...node,
      data: {
        ...(node.data || {}),
        worker: nextWorker,
      },
    };
  });
}

function GroupLayer({
  groups = [],
  nodes = [],
  setNodes,
  setGroups,
  onEditingChange,
  style,
  deleteLabel,
  emptyLabel,
}) {
  const transform = useStore((s) => s.transform);
  const [tx, ty, zoom] = transform;
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [tempLabel, setTempLabel] = useState("");
  const dragRef = React.useRef(null);
  const [contextMenuGroupId, setContextMenuGroupId] = useState(null);

  const updateGroups = useCallback(
    (updater) => {
      setGroups((prev) => {
        return typeof updater === "function" ? updater(prev) : updater;
      });
    },
    [setGroups]
  );

  useEffect(() => {
    const cancelEdit = () => {
      setEditingGroupId(null);
      onEditingChange?.(false);
    };
    window.addEventListener("group-edit-cancel", cancelEdit);
    return () => window.removeEventListener("group-edit-cancel", cancelEdit);
  }, [onEditingChange]);

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
    updateGroups((prev) =>
      prev.map((group) =>
        group.id === editingGroupId ? { ...group, label: tempLabel } : group
      )
    );
    setEditingGroupId(null);
    onEditingChange?.(false);
  };

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
      prev.map((node) => {
        const group = groups.find((item) => item.id === groupId);
        if (!group || !group.nodeIds.includes(node.id)) return node;

        return {
          ...node,
          position: {
            x: node.position.x + dx,
            y: node.position.y + dy,
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
        zIndex: style.zIndex,
      }}
    >
      {groups.map((group) => {
        const bbox = computeGroupBBox(group.nodeIds || [], nodes);
        if (!bbox) return null;

        const isEditing = editingGroupId === group.id;

        return (
          <React.Fragment key={group.id}>
            <div
              style={{
                position: "absolute",
                left: bbox.x,
                top: bbox.y,
                width: bbox.width,
                height: bbox.height,
                border: style.border,
                background: style.background,
                borderRadius: 10,
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                position: "absolute",
                left: bbox.x + 8,
                top: bbox.y + 8,
                pointerEvents: "auto",
                cursor: "move",
              }}
              onMouseDown={(e) => onGroupMouseDown(e, group)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit(group);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenuGroupId(group.id);
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
                    if (e.key === "Escape") {
                      setEditingGroupId(null);
                      onEditingChange?.(false);
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 12,
                    padding: "2px 6px",
                    borderRadius: 6,
                    border: `1px solid ${style.accentColor}`,
                    outline: "none",
                    width: Math.max(60, tempLabel.length * 8),
                  }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    background: style.labelBackground,
                    color: style.labelColor,
                    padding: "2px 8px",
                    borderRadius: 999,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                    border: `1px solid ${style.labelBorder}`,
                  }}
                >
                  {group.label || emptyLabel}
                </div>
              )}

              {contextMenuGroupId === group.id && (
                <div
                  style={{
                    position: "absolute",
                    left: "100%",
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
                      updateGroups((prev) => prev.filter((item) => item.id !== group.id));
                      setContextMenuGroupId(null);
                    }}
                  >
                    {deleteLabel}
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

export default function SequenceCanvas({
  nodes,
  edges,
  setNodes,
  setEdges,
  groups = [],
  workerGroups = [],
  setGroups,
  setWorkerGroups,
  flowControls,
  onSelectNode,
  onSelectEdge,
  onKeyDown,
}) {
  const [dragItem] = useSequenceDnD();
  const { screenToFlowPosition } = useReactFlow();
  const [isGroupEditing, setIsGroupEditing] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);

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

  const setWorkerGroupsAndSync = useCallback(
    (updater) => {
      if (flowControls?.applyFlowChange) {
        flowControls.applyFlowChange((prev) => {
          const nextWorkerGroups =
            typeof updater === "function"
              ? updater(prev.workerGroups || [])
              : updater;

          return {
            ...prev,
            workerGroups: nextWorkerGroups,
            nodes: applyWorkerLabelsToNodes(prev.nodes || [], nextWorkerGroups),
          };
        });
        return;
      }

      setWorkerGroups((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setNodes((prevNodes) => applyWorkerLabelsToNodes(prevNodes, next));
        return next;
      });
    },
    [flowControls, setNodes, setWorkerGroups]
  );

  const onNodesChange = useCallback(
    (changes) => {
      const shouldRecordHistory = changes.some(
        (change) => change.type !== "position" && change.type !== "select"
      );

      if (flowControls?.applyFlowChange) {
        flowControls.applyFlowChange(
          (prev) => {
            const nextNodes = applyNodeChanges(changes, prev.nodes || []);
            const finishedMoves = changes.filter(
              (change) => change.type === "position" && change.dragging === false
            );

            if (finishedMoves.length === 0) {
              return {
                ...prev,
                nodes: nextNodes,
              };
            }

            const nextGroups = syncMembership(
              prev.groups || [],
              nextNodes,
              finishedMoves,
              2
            );
            const nextWorkerGroups = syncMembership(
              prev.workerGroups || [],
              nextNodes,
              finishedMoves,
              1
            );

            return {
              ...prev,
              nodes: applyWorkerLabelsToNodes(nextNodes, nextWorkerGroups),
              groups: nextGroups,
              workerGroups: nextWorkerGroups,
            };
          },
          { recordHistory: shouldRecordHistory }
        );
        return;
      }

      setNodes((prev) => applyNodeChanges(changes, prev));
    },
    [flowControls, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (event, node) => {
      if (isMultiSelectEvent(event)) {
        const nextSelectedNodeIds = uniqueKeepOrder([
          ...nodes.filter((item) => item.selected).map((item) => item.id),
          node.id,
        ]);

        setNodes((prev) =>
          prev.map((item) => ({
            ...item,
            selected: nextSelectedNodeIds.includes(item.id),
          }))
        );
        setSelectedNodeIds(nextSelectedNodeIds);
        onSelectNode?.(node.id);
        onSelectEdge?.(null);
        return;
      }

      setNodes((prev) =>
        prev.map((item) => ({
          ...item,
          selected: item.id === node.id,
        }))
      );
      setSelectedNodeIds([node.id]);
      onSelectNode?.(node.id);
      onSelectEdge?.(null);
    },
    [nodes, onSelectNode, onSelectEdge, setNodes]
  );

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) =>
        eds.concat({
          ...params,
          id: params.id || `E-${params.source}-${params.target}-${Date.now()}`,
          type: "smoothstep",
          sourceHandle: params.sourceHandle ?? "out",
          targetHandle: params.targetHandle ?? "in",
        })
      );
    },
    [setEdges]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      if (selectedNodes?.length) {
        setSelectedNodeIds(selectedNodes.map((node) => node.id));
        onSelectNode?.(selectedNodes[0].id);
        onSelectEdge?.(null);
        return;
      }

      if (selectedEdges?.length) {
        setSelectedNodeIds([]);
        onSelectEdge?.(selectedEdges[0].id);
        onSelectNode?.(null);
        return;
      }

      setSelectedNodeIds([]);
    },
    [onSelectEdge, onSelectNode]
  );

  const createProcessGroupFromSelection = useCallback(() => {
    const selectedIds = selectedNodeIds.length
      ? selectedNodeIds
      : nodes.filter((node) => node.selected).map((node) => node.id);
    if (selectedIds.length < 2) return;

    const newId = `grp-${crypto.randomUUID()}`;
    setGroups((prev) => [
      ...prev,
      {
        id: newId,
        nodeIds: selectedIds,
        label: `그룹 ${prev.length + 1}`,
      },
    ]);
  }, [nodes, selectedNodeIds, setGroups]);

  const createWorkerGroupFromSelection = useCallback(() => {
    const selectedIds = selectedNodeIds.length
      ? selectedNodeIds
      : nodes.filter((node) => node.selected).map((node) => node.id);
    if (selectedIds.length < 1) return;

    const newId = `wrk-${crypto.randomUUID()}`;
    setWorkerGroupsAndSync((prev) =>
      normalizeGroups(
        [
          ...prev.map((group) => ({
            ...group,
            nodeIds: (group.nodeIds || []).filter((nodeId) => !selectedIds.includes(nodeId)),
          })),
          {
            id: newId,
            nodeIds: selectedIds,
            label: getNextWorkerGroupLabel(prev),
          },
        ],
        1
      )
    );
  }, [nodes, selectedNodeIds, setWorkerGroupsAndSync]);

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
        label = dragItem.data.partBase ?? dragItem.data.partId ?? "PART";
      } else if (dragItem.nodeType === "PROCESS") {
        label = dragItem.data.label ?? dragItem.data.processType ?? "PROCESS";
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
    if (target.isContentEditable) return true;

    const tag = target.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea";
  }

  useEffect(() => {
    const handleWindowKeyDown = (e) => {
      if (e.defaultPrevented || isTextEditingTarget(e.target)) {
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        createProcessGroupFromSelection();
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        createWorkerGroupFromSelection();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [createProcessGroupFromSelection, createWorkerGroupFromSelection]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        cursor: CANVAS_CURSOR,
      }}
      tabIndex={0}
      onKeyDownCapture={(e) => {
        if (isTextEditingTarget(e.target)) {
          return;
        }

        if (e.key === "Escape") {
          dispatchCancelGroupEdit();
        }

        if (e.key === "Backspace") {
          e.stopPropagation();
          e.preventDefault();
          return;
        }

        if (e.shiftKey && e.key.toLowerCase() === "g") {
          e.preventDefault();
          createProcessGroupFromSelection();
          return;
        }

        if (e.shiftKey && e.key.toLowerCase() === "w") {
          e.preventDefault();
          createWorkerGroupFromSelection();
          return;
        }

        e.stopPropagation();
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
        onEdgeClick={(e, edge) => {
          cancelGroupEdit();
          setNodes((prev) =>
            prev.map((item) => ({
              ...item,
              selected: false,
            }))
          );
          setSelectedNodeIds([]);
          onSelectEdge?.(edge.id);
          onSelectNode?.(null);
        }}
        onPaneClick={() => {
          cancelGroupEdit();
          setNodes((prev) =>
            prev.map((item) => ({
              ...item,
              selected: false,
            }))
          );
          setSelectedNodeIds([]);
          onSelectNode?.(null);
          onSelectEdge?.(null);
        }}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        elementsSelectable
        nodesConnectable
        selectionOnDrag
        selectionKeyCode={["Meta", "Ctrl"]}
        multiSelectionKeyCode={["Meta", "Ctrl"]}
        fitView
        minZoom={0.1}
        maxZoom={2}
        panOnDrag={[1]}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        style={{ cursor: CANVAS_CURSOR }}
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
        onEditingChange={setIsGroupEditing}
        deleteLabel="그룹 삭제"
        emptyLabel="이름 없음"
        style={{
          zIndex: 10,
          border: "2px dashed #2563eb",
          background: "rgba(37,99,235,0.08)",
          accentColor: "#2563eb",
          labelBackground: "rgba(255,255,255,0.95)",
          labelColor: "#1d4ed8",
          labelBorder: "rgba(37,99,235,0.25)",
        }}
      />

      <GroupLayer
        groups={workerGroups}
        nodes={nodes}
        setNodes={setNodes}
        setGroups={setWorkerGroupsAndSync}
        onEditingChange={setIsGroupEditing}
        deleteLabel="작업자 그룹 삭제"
        emptyLabel="작업자 미지정"
        style={{
          zIndex: 11,
          border: "2px dotted #d97706",
          background: "rgba(245,158,11,0.12)",
          accentColor: "#d97706",
          labelBackground: "rgba(255,248,235,0.98)",
          labelColor: "#9a3412",
          labelBorder: "rgba(217,119,6,0.28)",
        }}
      />
    </div>
  );
}
