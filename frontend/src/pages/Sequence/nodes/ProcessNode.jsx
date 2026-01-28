import React from "react";
import { Handle, Position } from "@xyflow/react";

export default function ProcessNode({ data, selected }) {
  const {
    label,        // 공정명
    partBase,     // fallback
    sourceSheet,  // 공통 DB / 표준 동작
  } = data;

  const processName = label || partBase || "공정";

  return (
    <div
      style={{
        width: 200,
        minHeight: 80,
        borderRadius: 8,
        border: selected ? "2px solid #f97316" : "1px solid #fed7aa",
        background: "#fff7ed",
        boxShadow: selected
          ? "0 0 0 2px rgba(249,115,22,0.2)"
          : "0 1px 3px rgba(0,0,0,0.1)",
        fontSize: 12,
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 26,
          padding: "0 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #fed7aa",
        }}
      >
        <div style={{ fontWeight: 600 }}>PROCESS</div>
        {sourceSheet && (
          <div
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 6,
              background: "#fb923c",
              color: "#fff",
            }}
          >
            {sourceSheet}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "6px 8px" }}>
        <div
          style={{
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={processName}
        >
          {processName}
        </div>
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
