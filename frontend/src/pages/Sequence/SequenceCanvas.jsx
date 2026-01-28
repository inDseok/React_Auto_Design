import React, { useCallback, useMemo, useState } from "react";
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
  onKeyDown,
}) {
  const [dragItem] = useSequenceDnD();
  const { screenToFlowPosition } = useReactFlow();

  const [linkFromNodeId, setLinkFromNodeId] = useState(null);

  const [contextMenu, setContextMenu] = useState(null);

  const onNodeClick = useCallback((event, node) => {
    event.stopPropagation(); // 선택 충돌 방지
  
    if (!linkFromNodeId) {
      setLinkFromNodeId(node.id);
      return;
    }
  
    if (linkFromNodeId === node.id) {
      // 자기 자신 클릭 → 취소
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
  }, [linkFromNodeId, setEdges]);
  
  
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
  const getAbsolutePosition = (node, nodes) => {
    let x = node.position.x;
    let y = node.position.y;
  
    if (node.parentNode) {
      const parent = nodes.find((n) => n.id === node.parentNode);
      if (parent) {
        x += parent.position.x;
        y += parent.position.y;
      }
    }
  
    return { x, y };
  };
  
  const onNodeDragStop = useCallback((event, node) => {
    if (node.type === "GROUP") return;
  
    setNodes((nds) => {
      const dragged = nds.find((n) => n.id === node.id);
      if (!dragged) return nds;
  
      const { x: nodeX, y: nodeY } = (() => {
        let x = node.position.x;
        let y = node.position.y;
        if (node.parentNode) {
          const p = nds.find((n) => n.id === node.parentNode);
          if (p) {
            x += p.position.x;
            y += p.position.y;
          }
        }
        return { x, y };
      })();
  
      const groups = nds.filter((n) => n.type === "GROUP");
  
      let targetGroup = null;
      for (const g of groups) {
        const gw = g.style?.width;
        const gh = g.style?.height;
        if (!gw || !gh) continue;
  
        if (
          nodeX > g.position.x &&
          nodeX < g.position.x + gw &&
          nodeY > g.position.y &&
          nodeY < g.position.y + gh
        ) {
          targetGroup = g;
          break;
        }
      }
  
      return nds.map((n) => {
        if (n.id !== node.id) return n;
  
        if (targetGroup) {
          return {
            ...n,
            parentNode: targetGroup.id,
            extent: "parent",
            position: {
              x: nodeX - targetGroup.position.x,
              y: nodeY - targetGroup.position.y,
            },
          };
        }
  
        return {
          ...n,
          parentNode: undefined,
          extent: undefined,
          position: { x: nodeX, y: nodeY },
        };
      });
    });
  }, []);
  
  
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
        });
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <button
          onClick={() => {
            setNodes((nds) =>
              nds.concat({
                id: "GROUP-1",
                type: "GROUP",
                position: { x: 200, y: 200 },
                draggable: true,        // 그룹 이동은 허용
                selectable: false,      // ❌ 선택 안 됨
                connectable: false,     // ❌ 엣지 연결 대상 아님
                deletable: true,        // 삭제는 허용
                style: {
                  width: 500,
                  height: 300,
                  zIndex: -1,           // ⭐ 핵심
                },
                data: {
                  label: "공정 그룹",
                },
              }
              )
            );
          }}
        >
          + 그룹 생성
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
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
