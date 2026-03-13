import React from "react";
import { formatNumber } from "./timeUtils";

export default function TimeSummaryCards({ summary }) {
  const items = [
    { label: "공정 수", value: `${summary.processCount}` },
    { label: "작업자 수", value: `${summary.workerCount}` },
    { label: "SEC 합계", value: formatNumber(summary.secSum) },
    { label: "TOTAL 합계", value: formatNumber(summary.totalSum) },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#fff",
            padding: "14px 16px",
            boxShadow: "0 2px 10px rgba(15, 23, 42, 0.04)",
          }}
        >
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>
            {item.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
