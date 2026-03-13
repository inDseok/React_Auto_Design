import React from "react";
import { formatNumber, getGroupLabel, toNumber } from "./timeUtils";
import { TIME_COLUMNS } from "./timeColumns";

function getNoCellStyle(value) {
  const normalized = String(value ?? "").trim();

  if (normalized === "가치") {
    return {
      background: "#dcfce7",
      color: "#166534",
      fontWeight: 700,
    };
  }

  if (normalized === "필비") {
    return {
      background: "#fef3c7",
      color: "#92400e",
      fontWeight: 700,
    };
  }

  if (normalized === "낭비") {
    return {
      background: "#fee2e2",
      color: "#991b1b",
      fontWeight: 700,
    };
  }

  return null;
}

function cellStyle(emphasis = false) {
  return {
    borderBottom: "1px solid #e5e7eb",
    padding: "10px 12px",
    verticalAlign: "top",
    background: emphasis ? "#f8fafc" : "#fff",
    fontWeight: emphasis ? 600 : 400,
  };
}

export default function TimeGroupSection({
  groupKey,
  groupRows,
  index,
  columnWidths,
}) {
  const groupLabel = getGroupLabel(groupRows, index);
  const groupSec = groupRows.reduce((sum, row) => sum + toNumber(row["SEC"]), 0);
  const groupTotal = groupRows.reduce((sum, row) => sum + toNumber(row["TOTAL"]), 0);

  return (
    <section
      key={groupKey}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          padding: "14px 16px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fcfcfd",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 700 }}>{groupLabel}</div>
        <div style={{ fontSize: 13, color: "#4b5563" }}>
          SEC {formatNumber(groupSec)} / TOTAL {formatNumber(groupTotal)}
        </div>
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontSize: 13.5,
        }}
      >
        <colgroup>
          {TIME_COLUMNS.map((column, columnIndex) => (
            <col key={column.key} style={{ width: columnWidths[columnIndex] }} />
          ))}
        </colgroup>
        <tbody>
          {groupRows.map((row) => (
            <tr key={row.id}>
              {row.__showPart && (
                <td rowSpan={row.__partRowspan} style={cellStyle(true)}>
                  {row["부품 기준"] || "-"}
                </td>
              )}
              {row.__showTask && (
                <td rowSpan={row.__taskRowspan} style={cellStyle()}>
                  {row["요소작업"] || "-"}
                </td>
              )}
              {row.__showOption && (
                <td rowSpan={row.__optionRowspan} style={cellStyle()}>
                  {row["OPTION"] || "-"}
                </td>
              )}
              <td style={cellStyle()}>{row["작업자"] || "-"}</td>
              <td style={{ ...cellStyle(), ...(getNoCellStyle(row["no"]) || {}) }}>
                {row["no"] || "-"}
              </td>
              <td style={cellStyle()}>{row["동작요소"] || "-"}</td>
              <td style={cellStyle()}>
                {row["반복횟수"] ?? row.repeatWeight ?? row["repeatWeight"] ?? 1}
              </td>
              <td style={cellStyle()}>{row["SEC"] || "-"}</td>
              <td style={cellStyle()}>{row["TOTAL"] || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
