import React from "react";
import "../css/tree.css";

function TreeNode({ node, selectedNodeId, onSelect }) {
  const isSelected = node.id === selectedNodeId;

  return (
    <div className="tree-node">
      <div className="tree-row">
        <div
          className={`tree-card ${isSelected ? "selected" : ""}`}
          onClick={() => onSelect(node)}
        >
          <div className="tree-title">부품명: {node.id ?? "(이름 없음)"}</div>
          <div className="tree-meta">
            품번: {node.part_no ?? "-"} / 수량: {node.qty}EA / 재질:
            {node.material ? ` ${node.material}` : " -"}
          </div>
        </div>
      </div>

      {Array.isArray(node.children) && node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}          // ✅ 핵심
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TreeView({ tree, selectedNodeId, onSelect }) {
  if (!Array.isArray(tree)) return null;

  return (
    <div>
      {tree.map((root) => (
        <TreeNode
          key={root.id}              // ✅ 핵심
          node={root}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
