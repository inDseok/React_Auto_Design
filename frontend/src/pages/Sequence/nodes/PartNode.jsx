import React from "react";
import { Handle, Position } from "@xyflow/react";

export default function PartNode({ data, selected }) {
  const { partBase,PartId, inhouse, statusLabel, isAssemblyImported } = data;

  return (
    <div
      style={{
        width: 180,
        height: 80,
        borderRadius: 8,
        border: selected
          ? `2px solid ${isAssemblyImported ? "#0f766e" : "#2563eb"}`
          : `1px solid ${isAssemblyImported ? "#99f6e4" : "#cbd5e1"}`,
        background: isAssemblyImported ? "#ecfeff" : "#f8fafc",
        boxShadow: selected
          ? isAssemblyImported
            ? "0 0 0 2px rgba(15,118,110,0.15)"
            : "0 0 0 2px rgba(37,99,235,0.15)"
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
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div style={{ fontWeight: 600 }}>PART</div>
        <div
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 6,
            background: isAssemblyImported
              ? "#0f766e"
              : inhouse
                ? "#2563eb"
                : "#64748b",
            color: "#fff",
          }}
        >
          {isAssemblyImported ? "ASM" : inhouse ? "IN" : "OUT"}
        </div>
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
          title={data.partBase ?? data.partId}
        >
          {data.partBase ?? data.partId}
        </div>

        {statusLabel && (
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: "#475569",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={statusLabel}
          >
            {statusLabel}
          </div>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{ background: isAssemblyImported ? "#0f766e" : "#2563eb" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ background: isAssemblyImported ? "#0f766e" : "#2563eb" }}
      />
    </div>
  );
}
