import React, { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSequenceDnD } from "./SequenceDnDContext";
import PartNode from "./nodes/PartNode";
import ProcessNode from "./nodes/ProcessNode"; // 없으면 일단 제거하고 PART만 먼저 확인하세요
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";

export default function SequenceCanvas({
  nodes,
  edges,
  setNodes,
  setEdges,
  onSelectNode,
  onSelectEdge,
}) {
  const [dragItem] = useSequenceDnD();
  const { screenToFlowPosition } = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      PART: PartNode,
      PROCESS: ProcessNode,
    }),
    []
  );

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes]
  );
  
  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );


  // 위 onNodesChange/onEdgesChange를 빈 구현으로 두면 이동/삭제 등이 일부 안 맞습니다.
  // 그래서 applyNodeChanges/applyEdgeChanges까지 포함한 “정석 버전”을 아래에 같이 제공합니다.
  // 지금 당장 엣지 연결만 해결하려면 onConnect + nodeTypes + import 통일이 먼저입니다.

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
      const n = selNodes?.[0] || null;
      const e = selEdges?.[0] || null;
      onSelectNode?.(n ? n.id : null);
      onSelectEdge?.(e ? e.id : null);
    },
    [onSelectNode, onSelectEdge]
  );

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
        label = dragItem.data.partId || dragItem.data.partName || "PART";
      } else if (dragItem.nodeType === "PROCESS") {
        label =
          dragItem.data.label ||
          dragItem.data.description ||
          dragItem.data.processType ||
          "PROCESS";
      }

      setNodes((nds) =>
        nds.concat({
          id: `N-${Date.now()}`,
          type: dragItem.nodeType, // "PART" | "PROCESS"
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

  return (
    <div style={{ width: "100%", height: "100%" }} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        fitView
        minZoom={0.1}
        maxZoom={2}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
      >
        <Background />
        <Controls position="bottom-left" />
        <MiniMap position="bottom-right" zoomable pannable />
      </ReactFlow>
    </div>
  );
}
