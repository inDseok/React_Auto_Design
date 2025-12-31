import React from "react";
import "../css/tree.css";

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

  return (
    <div className="tree-node">
      <div className="tree-row">
        <div
          className={`
            tree-card 
            ${isSelected ? "selected" : ""} 
            ${isSub ? "sub-node" : ""}
          `}
          onClick={() => onSelect(node)}
          draggable={isSelected}
          onDragStart={() => {
            if (isSelected && typeof onDragStartNode === "function") {
              onDragStartNode(node.id);
            }
          }}
        >
          <div className="tree-title">
            부품명: {node.id ?? "(이름 없음)"}
            {isSub && <span className="sub-badge">  외주</span>}
          </div>
          <div className="tree-meta">
            품번: {node.part_no ?? "-"} / 수량: {node.qty}EA / 재질:
            {node.material ? ` ${node.material}` : " -"}
          </div>
        </div>
      </div>

      {Array.isArray(node.children) && node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child, idx) => (
            <React.Fragment key={child.id}>
              <DropZone parentId={node.id} index={idx} onDropNode={onDropNode} />

              <TreeNode
                node={child}
                selectedNodeId={selectedNodeId}
                onSelect={onSelect}
                onDragStartNode={onDragStartNode}
                onDropNode={onDropNode}
              />
            </React.Fragment>
          ))}

          <DropZone
            parentId={node.id}
            index={node.children.length}
            onDropNode={onDropNode}
          />
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
