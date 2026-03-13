import React from "react";

export function SummaryCard({ title, value, accent }) {
  return (
    <div
      style={{
        minWidth: 180,
        flex: "1 1 180px",
        padding: 20,
        borderRadius: 20,
        background: "#ffffff",
        border: "1px solid #d9e2ec",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ fontSize: 13, color: "#526071", marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || "#102a43" }}>{value}</div>
    </div>
  );
}
