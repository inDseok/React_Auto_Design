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
const AUTO_CONNECT_MAX_EDGE_DISTANCE = 200;
const AUTO_CONNECT_MAX_NEIGHBOR_GAP_X = 600;
const AUTO_CONNECT_MAX_NEIGHBOR_GAP_Y = 250;

function getNodeSize(node) {
  const w = node.measured?.width ?? node.width ?? 180;
  const h = node.measured?.height ?? node.height ?? 70;
  return { w, h };
}

function getNodeCenter(node) {
  const { w, h } = getNodeSize(node);
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

function getDropNodeCenter(position, nodeType) {
  const fallbackNode =
    nodeType === "PROCESS"
      ? { width: 220, height: 72 }
      : { width: 180, height: 72 };

  return {
    x: position.x + fallbackNode.width / 2,
    y: position.y + fallbackNode.height / 2,
  };
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
    )
  );

  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function findEdgeInsertionTarget(
  point,
  nodes = [],
  edges = [],
  maxDistance = AUTO_CONNECT_MAX_EDGE_DISTANCE
) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  let best = null;

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode || edge.source === edge.target) {
      continue;
    }

    const distance = distancePointToSegment(
      point,
      getNodeCenter(sourceNode),
      getNodeCenter(targetNode)
    );

    if (distance > maxDistance) {
      continue;
    }

    if (!best || distance < best.distance) {
      best = { edge, distance };
    }
  }

  return best?.edge ?? null;
}

function findNeighborInsertionTarget(
  point,
  nodes = [],
  maxGapX = AUTO_CONNECT_MAX_NEIGHBOR_GAP_X,
  maxGapY = AUTO_CONNECT_MAX_NEIGHBOR_GAP_Y
) {
  const centers = nodes
    .map((node) => ({
      node,
      center: getNodeCenter(node),
    }))
    .sort((left, right) => compareNodesBySequencePosition(left.node, right.node));

  let leftNeighbor = null;
  let rightNeighbor = null;

  for (const item of centers) {
    const dx = Math.abs(item.center.x - point.x);
    const dy = Math.abs(item.center.y - point.y);
    if (dx > maxGapX || dy > maxGapY) {
      continue;
    }

    if (item.center.x <= point.x) {
      if (!leftNeighbor || item.center.x > leftNeighbor.center.x) {
        leftNeighbor = item;
      }
      continue;
    }

    if (!rightNeighbor || item.center.x < rightNeighbor.center.x) {
      rightNeighbor = item;
    }
  }

  if (!leftNeighbor && !rightNeighbor) {
    return null;
  }

  return {
    source: leftNeighbor?.node?.id ?? null,
    target: rightNeighbor?.node?.id ?? null,
  };
}

function findGroupInsertionContext(point, groups = [], nodes = []) {
  const candidates = groups
    .map((group) => ({
      group,
      bbox: computeGroupBBox(group.nodeIds || [], nodes, 72),
    }))
    .filter((item) => item.bbox && isPointInsideBBox(point, item.bbox))
    .sort(
      (left, right) =>
        left.bbox.width * left.bbox.height - right.bbox.width * right.bbox.height
    );

  if (!candidates.length) {
    return null;
  }

  const { group } = candidates[0];
  const orderedNodeIds = orderNodeIdsByLayout(group.nodeIds || [], nodes);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  let insertionIndex = orderedNodeIds.length;
  for (let index = 0; index < orderedNodeIds.length; index += 1) {
    const node = nodeMap.get(orderedNodeIds[index]);
    if (!node) {
      continue;
    }

    const center = getNodeCenter(node);
    if (point.x < center.x) {
      insertionIndex = index;
      break;
    }
  }

  return {
    group,
    orderedNodeIds,
    insertionIndex,
  };
}

function isEdgeWithinNodeSet(edge, nodeIds = []) {
  const nodeIdSet = new Set(nodeIds);
  return nodeIdSet.has(edge?.source) && nodeIdSet.has(edge?.target);
}

function isNodeInGroups(nodeId, groups = []) {
  return (groups || []).some((group) => (group.nodeIds || []).includes(nodeId));
}

function rebuildStandaloneMovedNodeEdges({
  finishedMoves = [],
  nextNodes = [],
  prevEdges = [],
  nextGroups = [],
}) {
  // 이동된 노드 중 그룹에 속하지 않는 것만 대상
  const movedNodeIds = new Set(
    (finishedMoves || [])
      .map((m) => m.id)
      .filter((id) => id && !isNodeInGroups(id, nextGroups))
  );

  if (movedNodeIds.size === 0) return [...(prevEdges || [])];

  // 이동 전 각 노드의 외부 선행자·후행자 기억 (체인 치유에 사용)
  const predecessorsOf = new Map();
  const successorsOf = new Map();
  for (const movedNodeId of movedNodeIds) {
    predecessorsOf.set(
      movedNodeId,
      (prevEdges || [])
        .filter((e) => e.target === movedNodeId && !movedNodeIds.has(e.source))
        .map((e) => e.source)
    );
    successorsOf.set(
      movedNodeId,
      (prevEdges || [])
        .filter((e) => e.source === movedNodeId && !movedNodeIds.has(e.target))
        .map((e) => e.target)
    );
  }

  // 이동된 노드와 외부 노드 사이의 엣지만 제거(내부 엣지는 유지)
  let workingEdges = (prevEdges || []).filter((edge) => {
    const srcMoved = movedNodeIds.has(edge.source);
    const tgtMoved = movedNodeIds.has(edge.target);
    // 양쪽 다 이동: 내부 연결 → 유지
    // 양쪽 다 고정: 외부 연결 → 유지
    // 한쪽만 이동: 이동 노드 연결 → 제거 후 재연결
    return srcMoved === tgtMoved;
  });

  // 체인 치유: 노드가 빠져나간 자리에 선행자→후행자 직결 엣지 복원
  for (const movedNodeId of movedNodeIds) {
    const preds = predecessorsOf.get(movedNodeId) || [];
    const succs = successorsOf.get(movedNodeId) || [];
    for (const predId of preds) {
      for (const succId of succs) {
        if (predId === succId) continue;
        if (workingEdges.some((e) => e.source === predId && e.target === succId)) continue;
        workingEdges.push({
          id: `MANUAL:heal:${predId}:${succId}:${Date.now()}-${workingEdges.length}`,
          source: predId,
          target: succId,
          type: "straight",
          sourceHandle: "out",
          targetHandle: "in",
          data: { manual: true, healedChain: true },
        });
      }
    }
  }

  const externalNodes = nextNodes.filter((n) => !movedNodeIds.has(n.id));

  for (const movedNodeId of movedNodeIds) {
    const movedNode = nextNodes.find((n) => n.id === movedNodeId);
    if (!movedNode) continue;

    const insertionPoint = getNodeCenter(movedNode);

    // 외부 노드끼리의 엣지만 삽입 후보로 사용
    const externalEdges = workingEdges.filter(
      (edge) => !movedNodeIds.has(edge.source) && !movedNodeIds.has(edge.target)
    );

    const insertionEdge = findEdgeInsertionTarget(insertionPoint, nextNodes, externalEdges);
    const neighborTarget = !insertionEdge
      ? findNeighborInsertionTarget(insertionPoint, externalNodes)
      : null;

    let effectiveSourceId = insertionEdge?.source ?? neighborTarget?.source ?? null;
    let effectiveTargetId = insertionEdge?.target ?? neighborTarget?.target ?? null;

    if (!effectiveSourceId && !effectiveTargetId) continue;

    // 삽입 엣지 제거
    workingEdges = workingEdges.filter((e) => e.id !== insertionEdge?.id);

    const movedCenterX = insertionPoint.x;

    // sourceId만 찾혔을 때: source의 우측 방향 기존 엣지를 가로채기
    if (effectiveSourceId && !effectiveTargetId) {
      const candidates = workingEdges
        .filter((e) => {
          if (e.source !== effectiveSourceId || movedNodeIds.has(e.target)) return false;
          const tNode = nextNodes.find((n) => n.id === e.target);
          return tNode && getNodeCenter(tNode).x > movedCenterX;
        })
        .sort((a, b) => {
          const ax = getNodeCenter(nextNodes.find((n) => n.id === a.target))?.x ?? Infinity;
          const bx = getNodeCenter(nextNodes.find((n) => n.id === b.target))?.x ?? Infinity;
          return ax - bx;
        });
      if (candidates.length > 0) {
        workingEdges = workingEdges.filter((e) => e.id !== candidates[0].id);
        effectiveTargetId = candidates[0].target;
      }
    }

    // targetId만 찾혔을 때: target의 좌측 방향 기존 엣지를 가로채기
    if (!effectiveSourceId && effectiveTargetId) {
      const candidates = workingEdges
        .filter((e) => {
          if (e.target !== effectiveTargetId || movedNodeIds.has(e.source)) return false;
          const sNode = nextNodes.find((n) => n.id === e.source);
          return sNode && getNodeCenter(sNode).x < movedCenterX;
        })
        .sort((a, b) => {
          const ax = getNodeCenter(nextNodes.find((n) => n.id === a.source))?.x ?? -Infinity;
          const bx = getNodeCenter(nextNodes.find((n) => n.id === b.source))?.x ?? -Infinity;
          return bx - ax;
        });
      if (candidates.length > 0) {
        workingEdges = workingEdges.filter((e) => e.id !== candidates[0].id);
        effectiveSourceId = candidates[0].source;
      }
    }

    // source→target 직결 엣지 제거
    if (effectiveSourceId && effectiveTargetId) {
      workingEdges = workingEdges.filter(
        (e) => !(e.source === effectiveSourceId && e.target === effectiveTargetId)
      );
    }

    const timestamp = Date.now();
    if (effectiveSourceId) {
      workingEdges.push({
        id: `MANUAL:${effectiveSourceId}:${movedNodeId}:${timestamp}-${workingEdges.length}`,
        source: effectiveSourceId,
        target: movedNodeId,
        type: "straight",
        sourceHandle: insertionEdge?.sourceHandle ?? "out",
        targetHandle: "in",
        data: { manual: true, insertedByMove: true },
      });
    }

    if (effectiveTargetId) {
      workingEdges.push({
        id: `MANUAL:${movedNodeId}:${effectiveTargetId}:${timestamp}-${workingEdges.length + 1}`,
        source: movedNodeId,
        target: effectiveTargetId,
        type: "straight",
        sourceHandle: "out",
        targetHandle: insertionEdge?.targetHandle ?? "in",
        data: { manual: true, insertedByMove: true },
      });
    }
  }

  return workingEdges;
}

function computeGroupBBox(nodeIds, nodes, pad = 16) {
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

function compareNodesBySequencePosition(a, b) {
  const ay = Number.isFinite(a?.position?.y) ? a.position.y : 0;
  const by = Number.isFinite(b?.position?.y) ? b.position.y : 0;
  const ax = Number.isFinite(a?.position?.x) ? a.position.x : 0;
  const bx = Number.isFinite(b?.position?.x) ? b.position.x : 0;

  if (Math.abs(ax - bx) > 120) {
    return ax - bx;
  }
  if (Math.abs(ay - by) > 24) {
    return ay - by;
  }
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function orderNodeIdsByLayout(nodeIds = [], nodes = []) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return uniqueKeepOrder(nodeIds)
    .filter((nodeId) => nodeMap.has(nodeId))
    .sort((leftId, rightId) =>
      compareNodesBySequencePosition(nodeMap.get(leftId), nodeMap.get(rightId))
    );
}

function normalizeGroupsWithNodes(groups = [], nodes = [], minSize = 2) {
  return groups
    .map((group) => ({
      ...group,
      nodeIds: orderNodeIdsByLayout(group.nodeIds || [], nodes),
      skippedAutoEdgeIds: Array.isArray(group.skippedAutoEdgeIds)
        ? uniqueKeepOrder(group.skippedAutoEdgeIds)
        : [],
    }))
    .filter((group) => (group.nodeIds || []).length >= minSize);
}

function buildManualSequentialEdgesForNodeIds(nodeIds = [], groupId = "") {
  const edges = [];

  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const source = nodeIds[index];
    const target = nodeIds[index + 1];
    if (!source || !target || source === target) {
      continue;
    }

    edges.push({
      id: `MANUAL:${groupId}:${source}:${target}`,
      source,
      target,
      type: "straight",
      sourceHandle: "out",
      targetHandle: "in",
      data: {
        manual: true,
        connectedByGroup: true,
        groupId,
      },
    });
  }

  return edges;
}

function isSameConnection(left, right) {
  return (
    left?.source === right?.source &&
    left?.target === right?.target &&
    (left?.sourceHandle ?? "out") === (right?.sourceHandle ?? "out") &&
    (left?.targetHandle ?? "in") === (right?.targetHandle ?? "in")
  );
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

function hasSameGroupMembers(groups = [], targetNodeIds = [], nodes = []) {
  const normalizedTarget = orderNodeIdsByLayout(targetNodeIds, nodes);
  if (normalizedTarget.length < 2) {
    return false;
  }

  return (groups || []).some((group) => {
    const normalizedGroup = orderNodeIdsByLayout(group.nodeIds || [], nodes);
    if (normalizedGroup.length !== normalizedTarget.length) {
      return false;
    }
    return normalizedGroup.every((nodeId, index) => nodeId === normalizedTarget[index]);
  });
}

const GROUP_STAY_PAD = 400;   // 이미 속한 그룹에서 벗어나는 판정 허용 범위
const GROUP_JOIN_PAD = 72;    // 새로 그룹에 들어가는 판정 허용 범위

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
      const candidateNodeIds = (group.nodeIds || []).filter((nodeId) => nodeId !== node.id);
      if (candidateNodeIds.length === 0) continue;

      // 이미 이 그룹 멤버였으면 탈출 허용 범위를 크게 적용
      const isAlreadyMember = (group.nodeIds || []).includes(node.id);
      const hitPad = isAlreadyMember ? GROUP_STAY_PAD : GROUP_JOIN_PAD;

      const bbox = computeGroupBBox(candidateNodeIds, nextNodes, hitPad);
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

  return normalizeGroupsWithNodes(nextGroups, nextNodes, minSize);
}

function pruneInvalidGroupConnectedEdges(edges = [], groups = []) {
  const validPairs = new Set();

  for (const group of groups || []) {
    const nodeIds = uniqueKeepOrder(group.nodeIds || []);
    for (let index = 0; index < nodeIds.length - 1; index += 1) {
      const source = nodeIds[index];
      const target = nodeIds[index + 1];
      if (!source || !target || source === target) {
        continue;
      }
      validPairs.add(`${group.id}::${source}::${target}`);
    }
  }

  return (edges || []).filter((edge) => {
    if (!edge?.data?.connectedByGroup || !edge?.data?.groupId) {
      return true;
    }
    const pairKey = `${edge.data.groupId}::${edge.source}::${edge.target}`;
    return validPairs.has(pairKey);
  });
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
  onRequestConnectGroup,
  style,
  deleteLabel,
  emptyLabel,
  showConnectAction = false,
  labelPosition = "top-left",
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
                ...(labelPosition === "top-right"
                  ? { left: bbox.x + bbox.width - 8, top: bbox.y + 8, transform: "translateX(-100%)" }
                  : { left: bbox.x + 8, top: bbox.y + 8 }),
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
                  {showConnectAction ? (
                    <div
                      style={{
                        padding: "6px 12px",
                        cursor: "pointer",
                        borderTop: "1px solid #eef2f7",
                        color: "#1d4ed8",
                        fontWeight: 600,
                      }}
                      onClick={() => {
                        onRequestConnectGroup?.(group.id);
                        setContextMenuGroupId(null);
                      }}
                    >
                      노드 연결
                    </div>
                  ) : null}
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

            // 이동이 끝난 노드가 속한 그룹의 순서 기반 엣지 자동 재구성
            const movedNodeIds = new Set(finishedMoves.map((m) => m.id));
            let prunedEdges = pruneInvalidGroupConnectedEdges(prev.edges || [], nextGroups);
            for (const group of nextGroups) {
              const hasMovedMember = (group.nodeIds || []).some((id) => movedNodeIds.has(id));
              if (!hasMovedMember) continue;
              const orderedNodeIds = orderNodeIdsByLayout(group.nodeIds || [], nextNodes);
              // 이 그룹의 auto-generated 엣지만 교체 (수동 엣지는 유지)
              prunedEdges = [
                ...prunedEdges.filter(
                  (e) => !(e.data?.connectedByGroup && e.data?.groupId === group.id)
                ),
                ...buildManualSequentialEdgesForNodeIds(orderedNodeIds, group.id),
              ];
            }

            const rebuiltStandaloneEdges = rebuildStandaloneMovedNodeEdges({
              finishedMoves,
              nextNodes,
              prevEdges: prunedEdges,
              nextGroups,
            });

            return {
              ...prev,
              nodes: applyWorkerLabelsToNodes(nextNodes, nextWorkerGroups),
              groups: nextGroups,
              workerGroups: nextWorkerGroups,
              edges: rebuiltStandaloneEdges,
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
      const nextEdge = {
        id: params.id || `MANUAL:${params.source}:${params.target}:${Date.now()}`,
        source: params.source,
        target: params.target,
        type: "straight",
        sourceHandle: params.sourceHandle ?? "out",
        targetHandle: params.targetHandle ?? "in",
        data: {
          manual: true,
        },
      };

      if (flowControls?.applyFlowChange) {
        flowControls.applyFlowChange((prev) => {
          const existingEdges = prev.edges || [];
          if (existingEdges.some((edge) => isSameConnection(edge, nextEdge))) {
            return prev;
          }

          return {
            ...prev,
            edges: [...existingEdges, nextEdge],
          };
        });
        return;
      }

      setEdges((prev) => {
        if (prev.some((edge) => isSameConnection(edge, nextEdge))) {
          return prev;
        }
        return [...prev, nextEdge];
      });
    },
    [flowControls, setEdges]
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
    const orderedSelectedIds = orderNodeIdsByLayout(selectedIds, nodes);
    if (hasSameGroupMembers(groups, orderedSelectedIds, nodes)) {
      return;
    }
    const newId = `grp-${crypto.randomUUID()}`;
    const nextGroup = {
      id: newId,
      nodeIds: orderedSelectedIds,
      label: `그룹 ${groups.length + 1}`,
      skippedAutoEdgeIds: [],
    };

    if (flowControls?.applyFlowChange) {
      flowControls.applyFlowChange((prev) => ({
        ...prev,
        groups: [...(prev.groups || []), nextGroup],
      }));
      return;
    }

    setGroups((prev) => [...prev, nextGroup]);
  }, [flowControls, groups.length, nodes, selectedNodeIds, setGroups]);

  const connectGroupNodes = useCallback(
    (groupId) => {
      if (!groupId) return;

      const applyConnection = (prev) => {
        const targetGroup = (prev.groups || []).find((group) => group.id === groupId);
        if (!targetGroup) {
          return prev;
        }

        const orderedNodeIds = orderNodeIdsByLayout(targetGroup.nodeIds || [], prev.nodes || []);
        if (orderedNodeIds.length < 2) {
          return prev;
        }

        return {
          ...prev,
          groups: (prev.groups || []).map((group) =>
            group.id === groupId ? { ...group, nodeIds: orderedNodeIds } : group
          ),
          edges: [
            ...(prev.edges || []).filter((edge) => !isEdgeWithinNodeSet(edge, orderedNodeIds)),
            ...buildManualSequentialEdgesForNodeIds(orderedNodeIds, groupId),
          ],
        };
      };

      if (flowControls?.applyFlowChange) {
        flowControls.applyFlowChange(applyConnection);
      } else {
        const targetGroup = (groups || []).find((group) => group.id === groupId);
        const orderedNodeIds = orderNodeIdsByLayout(targetGroup?.nodeIds || [], nodes || []);
        setGroups((prev) =>
          prev.map((group) =>
            group.id === groupId ? { ...group, nodeIds: orderedNodeIds } : group
          )
        );
        setEdges((prev) => [
          ...prev.filter((edge) => !isEdgeWithinNodeSet(edge, orderedNodeIds)),
          ...buildManualSequentialEdgesForNodeIds(orderedNodeIds, groupId),
        ]);
      }

    },
    [flowControls, groups, nodes, setEdges, setGroups]
  );

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

      const nextNode = {
        id: `N-${Date.now()}`,
        type: dragItem.nodeType,
        position,
        data: {
          ...dragItem.data,
          label,
        },
      };
      const insertionPoint = getDropNodeCenter(position, dragItem.nodeType);

      if (flowControls?.applyFlowChange) {
        flowControls.applyFlowChange((prev) => {
          const groupInsertion = findGroupInsertionContext(
            insertionPoint,
            prev.groups || [],
            prev.nodes || []
          );
          const insertionEdge = findEdgeInsertionTarget(
            insertionPoint,
            prev.nodes || [],
            prev.edges || []
          );
          const neighborTarget = !insertionEdge && !groupInsertion?.group
            ? findNeighborInsertionTarget(insertionPoint, prev.nodes || [])
            : null;

          if (groupInsertion?.group) {
            const newNodeIds = [
              ...groupInsertion.orderedNodeIds.slice(0, groupInsertion.insertionIndex),
              nextNode.id,
              ...groupInsertion.orderedNodeIds.slice(groupInsertion.insertionIndex),
            ];
            const updatedGroup = { ...groupInsertion.group, nodeIds: newNodeIds };
            const nextGroups = (prev.groups || []).map((group) =>
              group.id === updatedGroup.id ? updatedGroup : group
            );
            const nextNodes = [...(prev.nodes || []), nextNode];
            const orderedNodeIds = orderNodeIdsByLayout(newNodeIds, nextNodes);
            const groupEdges = buildManualSequentialEdgesForNodeIds(orderedNodeIds, updatedGroup.id);
            const prevEdgesWithoutGroup = (prev.edges || []).filter(
              (e) => !(e.data?.connectedByGroup && e.data?.groupId === updatedGroup.id)
            );

            return {
              ...prev,
              nodes: nextNodes,
              groups: nextGroups,
              edges: [...prevEdgesWithoutGroup, ...groupEdges],
            };
          }

          if (!insertionEdge && !neighborTarget?.source && !neighborTarget?.target) {
            return {
              ...prev,
              nodes: [...(prev.nodes || []), nextNode],
            };
          }

          const sourceId = insertionEdge?.source ?? neighborTarget?.source ?? null;
          const targetId = insertionEdge?.target ?? neighborTarget?.target ?? null;
          const replacementEdges = [
            sourceId
              ? {
                  id: `MANUAL:${sourceId}:${nextNode.id}:${Date.now()}`,
                  source: sourceId,
                  target: nextNode.id,
                  type: "straight",
                  sourceHandle: insertionEdge?.sourceHandle ?? "out",
                  targetHandle: "in",
                  data: {
                    manual: true,
                    insertedByDrop: true,
                  },
                }
              : null,
            targetId
              ? {
                  id: `MANUAL:${nextNode.id}:${targetId}:${Date.now() + 1}`,
                  source: nextNode.id,
                  target: targetId,
                  type: "straight",
                  sourceHandle: "out",
                  targetHandle: insertionEdge?.targetHandle ?? "in",
                  data: {
                    manual: true,
                    insertedByDrop: true,
                  },
                }
              : null,
          ].filter(Boolean);

          return {
            ...prev,
            nodes: [...(prev.nodes || []), nextNode],
            edges: [
              ...(prev.edges || []).filter((edge) => {
                if (insertionEdge) return edge.id !== insertionEdge.id;
                if (sourceId && targetId) return !(edge.source === sourceId && edge.target === targetId);
                return true;
              }),
              ...replacementEdges,
            ],
          };
        });
        return;
      }

      const groupInsertion = findGroupInsertionContext(insertionPoint, groups || [], nodes || []);
      const insertionEdge = findEdgeInsertionTarget(insertionPoint, nodes || [], edges || []);
      const neighborTarget = !insertionEdge && !groupInsertion?.group
        ? findNeighborInsertionTarget(insertionPoint, nodes || [])
        : null;
      setNodes((nds) => nds.concat(nextNode));
      if (groupInsertion?.group) {
        const updatedGroup = {
          ...groupInsertion.group,
          nodeIds: [
            ...groupInsertion.orderedNodeIds.slice(0, groupInsertion.insertionIndex),
            nextNode.id,
            ...groupInsertion.orderedNodeIds.slice(groupInsertion.insertionIndex),
          ],
        };
        setGroups((prevGroups) =>
          prevGroups.map((group) => (group.id === updatedGroup.id ? updatedGroup : group))
        );
        return;
      }
      if (insertionEdge || neighborTarget?.source || neighborTarget?.target) {
        const sourceId = insertionEdge?.source ?? neighborTarget?.source ?? null;
        const targetId = insertionEdge?.target ?? neighborTarget?.target ?? null;
        setEdges((prevEdges) => [
          ...prevEdges.filter((edge) => {
            if (insertionEdge) return edge.id !== insertionEdge.id;
            if (sourceId && targetId) return !(edge.source === sourceId && edge.target === targetId);
            return true;
          }),
          ...(sourceId
            ? [
                {
                  id: `MANUAL:${sourceId}:${nextNode.id}:${Date.now()}`,
                  source: sourceId,
                  target: nextNode.id,
                  type: "straight",
                  sourceHandle: insertionEdge?.sourceHandle ?? "out",
                  targetHandle: "in",
                  data: {
                    manual: true,
                    insertedByDrop: true,
                  },
                },
              ]
            : []),
          ...(targetId
            ? [
                {
                  id: `MANUAL:${nextNode.id}:${targetId}:${Date.now() + 1}`,
                  source: nextNode.id,
                  target: targetId,
                  type: "straight",
                  sourceHandle: "out",
                  targetHandle: insertionEdge?.targetHandle ?? "in",
                  data: {
                    manual: true,
                    insertedByDrop: true,
                  },
                },
              ]
            : []),
        ]);
      }
    },
    [dragItem, edges, flowControls, groups, nodes, screenToFlowPosition, setEdges, setGroups, setNodes]
  );

  function isTextEditingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;

    const tag = target.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
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

      if (e.shiftKey && e.key.toLowerCase() === "c") {
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

        if (e.shiftKey && e.key.toLowerCase() === "c") {
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
        onEdgeClick={(_e, edge) => {
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
        onRequestConnectGroup={(groupId) => {
          connectGroupNodes(groupId);
        }}
        deleteLabel="그룹 삭제"
        emptyLabel="이름 없음"
        showConnectAction
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
        onRequestConnectGroup={null}
        deleteLabel="작업자 그룹 삭제"
        emptyLabel="작업자 미지정"
        labelPosition="top-right"
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
