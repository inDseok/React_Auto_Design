import React from "react";
import { formatRatio, formatTimeCell } from "./lobUtils";

function cellStyle(textAlign) {
  return {
    padding: "14px 16px",
    borderBottom: "1px solid #e5edf5",
    color: "#243b53",
    textAlign,
    whiteSpace: "nowrap",
  };
}

export function WorkerTable({
  workerStats,
  movementTimes,
  movementTimeInputs,
  onChangeMovementTime,
  onCommitMovementTime,
}) {
  const grandTotals = workerStats.reduce(
    (acc, worker) => {
      const movementTime = movementTimes[worker.worker] ?? 0;
      const laborSum = worker.totalTime + movementTime;

      acc["가치"] += worker.categoryTimes["가치"];
      acc["필비"] += worker.categoryTimes["필비"];
      acc["낭비"] += worker.categoryTimes["낭비"];
      acc["이동시간"] += movementTime;
      acc["공수 합계"] += laborSum;

      return acc;
    },
    { "가치": 0, "필비": 0, "낭비": 0, "이동시간": 0, "공수 합계": 0 }
  );

  const totalEfficiency =
    grandTotals["공수 합계"] > 0 ? (grandTotals["가치"] / grandTotals["공수 합계"]) * 100 : 0;

  return (
    <div
      style={{
        overflowX: "auto",
        borderRadius: 24,
        background: "#ffffff",
        border: "1px solid #d9e2ec",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
        <thead>
          <tr style={{ background: "#f0f4f8" }}>
            <th
              style={{
                padding: "14px 16px",
                textAlign: "left",
                color: "#243b53",
                borderBottom: "1px solid #d9e2ec",
                whiteSpace: "nowrap",
                position: "sticky",
                left: 0,
                background: "#f0f4f8",
                zIndex: 1,
              }}
            >
              항목
            </th>
            {workerStats.map((worker) => (
              <th
                key={worker.worker}
                style={{
                  padding: "14px 16px",
                  textAlign: "right",
                  color: "#243b53",
                  borderBottom: "1px solid #d9e2ec",
                  whiteSpace: "nowrap",
                }}
              >
                {worker.worker}
              </th>
            ))}
            <th
              style={{
                padding: "14px 16px",
                textAlign: "right",
                color: "#243b53",
                borderBottom: "1px solid #d9e2ec",
                whiteSpace: "nowrap",
                background: "#f0f4f8",
              }}
            >
              전체
            </th>
          </tr>
        </thead>
        <tbody>
          {[
            { key: "가치", label: "가치 작업시간" },
            { key: "필비", label: "필비 작업시간" },
            { key: "낭비", label: "낭비 작업시간" },
            { key: "이동시간", label: "이동시간", input: true },
            { key: "공수 합계", label: "공수 합계", total: true },
            { key: "실동율", label: "실동율", ratio: true },
          ].map((rowDef) => (
            <tr key={rowDef.key}>
              <td
                style={{
                  ...cellStyle("left"),
                  position: "sticky",
                  left: 0,
                  background: "#ffffff",
                  fontWeight: 700,
                }}
              >
                {rowDef.label}
              </td>
              {workerStats.map((worker) => {
                const movementTime = movementTimes[worker.worker] ?? 0;
                const laborSum = worker.totalTime + movementTime;
                const efficiency = laborSum > 0 ? (worker.categoryTimes["가치"] / laborSum) * 100 : 0;

                let content = formatTimeCell(worker.categoryTimes[rowDef.key] ?? 0);

                if (rowDef.input) {
                  content = (
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={movementTimeInputs?.[worker.worker] ?? String(movementTime)}
                      onChange={(e) => onChangeMovementTime(worker.worker, e.target.value)}
                      onBlur={(e) => onCommitMovementTime?.(worker.worker, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onCommitMovementTime?.(worker.worker, e.currentTarget.value);
                          e.currentTarget.blur();
                        }
                      }}
                      style={{
                        width: 96,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        textAlign: "right",
                        fontSize: 14,
                      }}
                    />
                  );
                } else if (rowDef.total) {
                  content = formatTimeCell(laborSum);
                } else if (rowDef.ratio) {
                  content = formatRatio(efficiency);
                }

                return (
                  <td key={`${rowDef.key}-${worker.worker}`} style={cellStyle("right")}>
                    {content}
                  </td>
                );
              })}
              <td style={{ ...cellStyle("right"), background: "#f8fafc", fontWeight: 700 }}>
                {rowDef.input
                  ? formatTimeCell(grandTotals["이동시간"])
                  : rowDef.total
                    ? formatTimeCell(grandTotals["공수 합계"])
                    : rowDef.ratio
                      ? formatRatio(totalEfficiency)
                      : formatTimeCell(grandTotals[rowDef.key] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
