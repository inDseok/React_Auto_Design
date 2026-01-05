import React from "react";
import { Card, Tag, Typography } from "antd";
import "../css/tree.css";

const { Text } = Typography;

function DropZone({ parentId, index, onDropNode }) {
  return (
    <div
      className="drop-zone"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => e.currentTarget.classList.add("active")}
      onDragLeave={(e) => e.currentTarget.classList.remove("active")}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("active");
        if (typeof onDropNode === "function") {
          onDropNode(parentId, index);
        }
      }}
    />
  );
}

function TreeNode({
  node,
  selectedNodeId,
  onSelect,
  onDragStartNode,
  onDropNode,
}) {
  const isSelected = node.id === selectedNodeId;
  const isSub = node.type === "SUB";
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  return (
    <div className="tree-node">
      <div className="tree-row">
        <Card
          size="small"
          hoverable
          bordered
          className={`tree-card-antd ${isSelected ? "selected" : ""}`}
          style={{
            borderColor: isSelected ? "#1677ff" : "#e5e7eb",
            background: isSub ? "#fff1f0" : "#ffffff",
          }}
          onClick={() => onSelect(node)}
          draggable={isSelected}
          onDragStart={() => {
            if (isSelected && typeof onDragStartNode === "function") {
              onDragStartNode(node.id);
            }
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Text strong>
              부품명: {node.id ?? node.id ?? "(이름 없음)"}
            </Text>

            {isSub && (
              <Tag
                color="red"
                style={{
                  fontWeight: 700,
                  border: "1px solid #ff4d4f",
                  background: "#fff1f0",
                }}
              >
                외주
              </Tag>
            )}
          </div>

          <div>
            <Text type="secondary">
              품번: {node.part_no ?? "-"} / 수량: {node.qty ?? "-"}EA / 재질:
              {node.material ? ` ${node.material}` : " -"}
            </Text>
          </div>
        </Card>
      </div>

      {hasChildren && (
        <div className="tree-children">
          {node.children.map((child, idx) => {
            const isLast = idx === node.children.length - 1;
            return (
              <div className="tree-child" key={child.id}>
                <DropZone
                  parentId={node.id}
                  index={idx}
                  onDropNode={onDropNode}
                />

                <TreeNode
                  node={child}
                  selectedNodeId={selectedNodeId}
                  onSelect={onSelect}
                  onDragStartNode={onDragStartNode}
                  onDropNode={onDropNode}
                />

                {isLast && (
                  <DropZone
                    parentId={node.id}
                    index={node.children.length}
                    onDropNode={onDropNode}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


export default function TreeView({
  tree,
  selectedNodeId,
  onSelect,
  onDragStartNode,
  onDropNode,
}) {
  if (!Array.isArray(tree)) return null;

  return (
    <div className="tree-panel">
      {tree.map((root) => (
        <TreeNode
          key={root.id}
          node={root}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
          onDragStartNode={onDragStartNode}
          onDropNode={onDropNode}
        />
      ))}
    </div>
  );
}
