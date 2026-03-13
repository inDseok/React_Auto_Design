import React from "react";
import { CATEGORY_META, CATEGORY_ORDER, formatRatio, formatTime } from "./lobUtils";

const detailHeadStyle = {
  padding: "12px 14px",
  borderBottom: "1px solid #d9e2ec",
  textAlign: "left",
  color: "#334e68",
  whiteSpace: "nowrap",
};

function detailCellStyle(textAlign) {
  return {
    padding: "12px 14px",
    borderBottom: "1px solid #e5edf5",
    color: "#243b53",
    textAlign,
    verticalAlign: "top",
  };
}

export function WorkerDetailSection({ workerStats }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {workerStats.map((worker) => {
        let currentPart = "";
        let currentWork = "";
        let currentOption = "";

        return (
          <details
            key={worker.worker}
            style={{
              borderRadius: 20,
              background: "#ffffff",
              border: "1px solid #d9e2ec",
              boxShadow: "0 16px 34px rgba(15, 23, 42, 0.06)",
              overflow: "hidden",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                listStyle: "none",
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                color: "#102a43",
                fontWeight: 700,
              }}
            >
              <span>{worker.worker}</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: "#526071" }}>
                {formatTime(worker.totalTime)} / {worker.rowCount}건
              </span>
            </summary>
            <div style={{ padding: "0 20px 20px" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                {CATEGORY_ORDER.map((category) => (
                  <span
                    key={category}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: CATEGORY_META[category].bg,
                      color: CATEGORY_META[category].color,
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {category} {formatTime(worker.categoryTimes[category])} / {formatRatio(worker.ratios[category])}
                  </span>
                ))}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["분류", "부품 기준", "요소작업", "OPTION", "동작요소", "반복횟수", "SEC", "TOTAL 반영시간"].map((label) => (
                        <th key={label} style={detailHeadStyle}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {worker.rows.map((item) => {
                      if (item.row["부품 기준"]) currentPart = item.row["부품 기준"];
                      if (item.row["요소작업"]) currentWork = item.row["요소작업"];
                      if (item.row["OPTION"]) currentOption = item.row["OPTION"];

                      return (
                        <tr key={item.id}>
                          <td style={detailCellStyle("left")}>
                            <span
                              style={{
                                display: "inline-flex",
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: CATEGORY_META[item.category].bg,
                                color: CATEGORY_META[item.category].color,
                                fontWeight: 700,
                                fontSize: 12,
                              }}
                            >
                              {item.category}
                            </span>
                          </td>
                          <td style={detailCellStyle("left")}>{currentPart || "-"}</td>
                          <td style={detailCellStyle("left")}>{currentWork || "-"}</td>
                          <td style={detailCellStyle("left")}>{currentOption || "-"}</td>
                          <td style={detailCellStyle("left")}>{item.row["동작요소"] || "-"}</td>
                          <td style={detailCellStyle("right")}>{item.row["반복횟수"] || "-"}</td>
                          <td style={detailCellStyle("right")}>{item.row["SEC"] || "-"}</td>
                          <td style={detailCellStyle("right")}>{formatTime(item.time)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
