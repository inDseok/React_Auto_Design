import React, { useEffect, useMemo, useState } from "react";
import { Tag, Typography } from "antd";
import "../../css/tree.css";

const { Text } = Typography;

function collectNodeKeys(nodes, bucket = new Set()) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    const key = String(node.name || node.id || "");
    if (key) {
      bucket.add(key);
    }
    collectNodeKeys(node.children || [], bucket);
  });
  return bucket;
}

function DropZone({ parentId, index, onDropNode, draggingNodeId, activeDropId, setActiveDropId }) {
  const zoneId = `${parentId ?? "root"}::${index}`;
  return (
    <div
      className={`subtree-dropzone ${activeDropId === zoneId ? "active" : ""} ${draggingNodeId ? "enabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (draggingNodeId) {
          setActiveDropId?.(zoneId);
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (draggingNodeId) {
          setActiveDropId?.(zoneId);
        }
      }}
      onDragLeave={(e) => {
        if (activeDropId === zoneId) {
          setActiveDropId?.(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setActiveDropId?.(null);
        onDropNode?.(parentId, index);
      }}
    />
  );
}

function TreeNodeCard({ node, isSelected, hasChildren, isDragging, onSelect }) {
  const isSub = node.type === "SUB";
  const nodeTypeLabel = hasChildren ? "ASSEMBLY" : "PART";

  return (
    <div
      className={`subtree-card ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${hasChildren ? "assembly" : "part"}`}
      onClick={() => onSelect?.(node)}
    >
      <div className="subtree-card-head">
        <div className="subtree-card-title-wrap">
          <div className="subtree-card-kicker-row">
            <span className={`subtree-type-dot ${hasChildren ? "assembly" : "part"}`} />
            <div className="subtree-card-kicker">{nodeTypeLabel}</div>
          </div>
          <Text strong className="subtree-card-title">
            {node.id || "(이름 없음)"}
          </Text>
        </div>

        <div className="subtree-card-tags">
          <span className="subtree-drag-handle" title="드래그해서 이동">⋮⋮</span>
          {isSub ? (
            <Tag color="red" style={{ marginInlineEnd: 0, fontWeight: 700 }}>
              외주
            </Tag>
          ) : null}
          {node.inhouse === true ? (
            <Tag color="blue" style={{ marginInlineEnd: 0, fontWeight: 700 }}>
              사내 조립
            </Tag>
          ) : null}
        </div>
      </div>

      <div className="subtree-card-meta">
        <span className="subtree-pill">
          <span className="subtree-pill-label">품번</span>
          <span className="subtree-pill-value">{node.part_no || "-"}</span>
        </span>
        <span className="subtree-pill">
          <span className="subtree-pill-label">수량</span>
          <span className="subtree-pill-value">{node.qty ?? "-"} EA</span>
        </span>
        <span className="subtree-pill subtree-pill-wide">
          <span className="subtree-pill-label">재질</span>
          <span className="subtree-pill-value">{node.material || "-"}</span>
        </span>
      </div>
    </div>
  );
}

function TreeBranch({
  nodes,
  depth,
  expandedKeys,
  onToggleExpanded,
  selectedNodeId,
  onSelect,
  onDragStartNode,
  onDropNode,
  draggingNodeId,
  activeDropId,
  setActiveDropId,
  onDragStateChange,
  parentId = null,
}) {
  return (
    <ul className={`subtree-list ${depth === 0 ? "root" : "nested"}`}>
      {nodes.map((node, index) => {
        const key = String(node.name || node.id || `node-${depth}-${index}`);
        const children = Array.isArray(node.children) ? node.children : [];
        const hasChildren = children.length > 0;
        const isExpanded = expandedKeys.has(key);
        const isSelected = key === selectedNodeId;
        const isDragging = String(node.id || "") === String(draggingNodeId || "");
        const isLast = index === nodes.length - 1;

        return (
          <li
            key={key}
            className={`subtree-item ${isLast ? "last" : ""} ${hasChildren ? "has-children" : "leaf"} ${hasChildren && isExpanded ? "expanded" : ""} ${node.type === "SUB" ? "is-sub" : ""} ${node.inhouse === true ? "is-inhouse" : ""}`}
          >
            <DropZone
              parentId={parentId}
              index={index}
              onDropNode={onDropNode}
              draggingNodeId={draggingNodeId}
              activeDropId={activeDropId}
              setActiveDropId={setActiveDropId}
            />

            <div className="subtree-entry">
              {hasChildren ? (
                <button
                  type="button"
                  className="subtree-toggle"
                  onClick={() => onToggleExpanded(key)}
                  aria-label={isExpanded ? "하위 트리 접기" : "하위 트리 펼치기"}
                  onDragEnter={() => {
                    if (!isExpanded && draggingNodeId) {
                      onToggleExpanded(key);
                    }
                  }}
                >
                  {isExpanded ? "−" : "+"}
                </button>
              ) : null}

              <div
                className={`subtree-card-wrap ${hasChildren ? "with-toggle" : "leaf-card"}`}
                draggable
                onDragStart={(e) => {
                  onSelect?.(node);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(node.id || ""));
                  onDragStartNode?.(node.id);
                  onDragStateChange?.({
                    draggingNodeId: node.id,
                    activeDropId: null,
                  });
                }}
                onDragEnd={() => {
                  onDragStateChange?.({
                    draggingNodeId: null,
                    activeDropId: null,
                  });
                }}
              >
                <TreeNodeCard
                  node={node}
                  isSelected={isSelected}
                  hasChildren={hasChildren}
                  isDragging={isDragging}
                  onSelect={onSelect}
                />
              </div>
            </div>

            {hasChildren && isExpanded ? (
              <div className="subtree-children-wrap">
                <TreeBranch
                  nodes={children}
                  depth={depth + 1}
                  expandedKeys={expandedKeys}
                  onToggleExpanded={onToggleExpanded}
                  selectedNodeId={selectedNodeId}
                  onSelect={onSelect}
                  onDragStartNode={onDragStartNode}
                  onDropNode={onDropNode}
                  draggingNodeId={draggingNodeId}
                  activeDropId={activeDropId}
                  setActiveDropId={setActiveDropId}
                  onDragStateChange={onDragStateChange}
                  parentId={node.id}
                />
              </div>
            ) : null}

            {isLast ? (
              <DropZone
                parentId={parentId}
                index={nodes.length}
                onDropNode={onDropNode}
                draggingNodeId={draggingNodeId}
                activeDropId={activeDropId}
                setActiveDropId={setActiveDropId}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function TreeView({
  tree,
  selectedNodeId,
  onSelect,
  onDragStartNode,
  onDropNode,
}) {
  const allKeys = useMemo(() => Array.from(collectNodeKeys(tree)), [tree]);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set(allKeys));
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [activeDropId, setActiveDropId] = useState(null);

  useEffect(() => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      allKeys.forEach((key) => next.add(key));
      return next;
    });
  }, [allKeys]);

  const normalizedSelectedNodeId = String(selectedNodeId || "");

  return (
    <div className="subtree-shell">
      <TreeBranch
        nodes={Array.isArray(tree) ? tree : []}
        depth={0}
        expandedKeys={expandedKeys}
        onToggleExpanded={(key) =>
          setExpandedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
              next.delete(key);
            } else {
              next.add(key);
            }
            return next;
          })
        }
        selectedNodeId={normalizedSelectedNodeId}
        onSelect={onSelect}
        onDragStartNode={onDragStartNode}
        onDropNode={onDropNode}
        draggingNodeId={draggingNodeId}
        activeDropId={activeDropId}
        setActiveDropId={setActiveDropId}
        onDragStateChange={({ draggingNodeId: nextDraggingNodeId, activeDropId: nextActiveDropId }) => {
          setDraggingNodeId(nextDraggingNodeId);
          setActiveDropId(nextActiveDropId);
        }}
      />
    </div>
  );
}
