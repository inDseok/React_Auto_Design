import React from "react";
import { Handle, Position } from "@xyflow/react";

export default function ProcessNode({ data, selected }) {
  const {
    label,        // 공정명
    partBase,     // fallback
    sourceSheet,  // 공통 DB / 표준 동작
    isAssemblyImported,
  } = data;

  const processName = label || partBase || "공정";
  const isOptionMissing = !String(data.option || "").trim();
  const handleColor = isAssemblyImported ? "#8b5cf6" : "#fb923c";

  return (
    <div
      style={{
        width: 200,
        minHeight: 80,
        borderRadius: 8,
        border: selected
          ? `2px solid ${isAssemblyImported ? "#7c3aed" : "#f97316"}`
          : isOptionMissing
            ? "2px solid #dc2626"
            : `1px solid ${isAssemblyImported ? "#ddd6fe" : "#fed7aa"}`,
        background: isOptionMissing
          ? "#fff7f7"
          : isAssemblyImported
            ? "#f5f3ff"
            : "#fff7ed",
        boxShadow: selected
          ? isAssemblyImported
            ? "0 0 0 2px rgba(124,58,237,0.2)"
            : "0 0 0 2px rgba(249,115,22,0.2)"
          : isOptionMissing
            ? "0 0 0 2px rgba(220,38,38,0.12)"
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
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {isOptionMissing && (
            <div
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 6,
                background: "#fee2e2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                fontWeight: 700,
              }}
            >
              OPTION
            </div>
          )}
          {sourceSheet && (
            <div
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 6,
                background: isAssemblyImported ? "#8b5cf6" : "#fb923c",
                color: "#fff",
              }}
            >
              {isAssemblyImported ? "ASM" : sourceSheet}
            </div>
          )}
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
          title={processName}
        >
          {processName}
        </div>

        {isOptionMissing && (
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: "#b91c1c",
              fontWeight: 600,
            }}
          >
            OPTION 미선택
          </div>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        isConnectable
        style={{ background: handleColor }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable
        style={{ background: handleColor }}
      />
    </div>
  );
}
