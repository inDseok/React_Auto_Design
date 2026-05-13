import React from "react";
import { CATEGORY_META, CATEGORY_ORDER, formatRatio, formatTime } from "./lobUtils";

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const panelStyle = {
  borderRadius: 24,
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,249,252,0.98) 100%)",
  border: "1px solid #d9e2ec",
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.08)",
  overflow: "hidden",
};

const tableHeadStyle = {
  padding: "13px 14px",
  borderBottom: "1px solid #d9e2ec",
  textAlign: "left",
  color: "#486581",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  background: "#f8fbff",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

function tableCellStyle(textAlign, tone = "default") {
  return {
    padding: "13px 14px",
    borderBottom: "1px solid #e5edf5",
    color: tone === "muted" ? "#7b8794" : "#243b53",
    textAlign,
    verticalAlign: "top",
    fontSize: 13.5,
    lineHeight: 1.45,
  };
}

function metricBadgeStyle(accent) {
  return {
    display: "grid",
    gap: 2,
    minWidth: 132,
    padding: "10px 12px",
    borderRadius: 16,
    border: `1px solid ${accent}22`,
    background: `${accent}10`,
  };
}

function RowValue({ primary, fallback = "-", secondary = "" }) {
  const value = primary || fallback;
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span>{value}</span>
      {secondary ? <span style={{ fontSize: 11.5, color: "#7b8794" }}>{secondary}</span> : null}
    </div>
  );
}

export function WorkerDetailSection({ workerStats }) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {workerStats.map((worker) => {
        let currentPart = "";
        let currentWork = "";
        let currentOption = "";

        return (
          <details key={worker.worker} open style={panelStyle}>
            <summary
              style={{
                cursor: "pointer",
                listStyle: "none",
                padding: 22,
                display: "grid",
                gap: 14,
                background:
                  "linear-gradient(135deg, rgba(247,250,252,0.95) 0%, rgba(236,245,255,0.95) 100%)",
                borderBottom: "1px solid #d9e2ec",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: "#102a43" }}>{worker.worker}</span>
                  <span style={{ fontSize: 13, color: "#526071" }}>
                    총 {worker.rowCount}개 동작, 누적 {formatTime(worker.totalTime)}
                  </span>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "#ffffff",
                    border: "1px solid #d9e2ec",
                    color: "#334e68",
                    fontSize: 12.5,
                    fontWeight: 700,
                    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
                  }}
                >
                  펼쳐서 상세 보기
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={metricBadgeStyle("#0f766e")}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#0f766e", letterSpacing: "0.04em" }}>
                    TOTAL
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#102a43" }}>{formatTime(worker.totalTime)}</span>
                </div>
                {CATEGORY_ORDER.map((category) => (
                  <div key={category} style={metricBadgeStyle(CATEGORY_META[category].color)}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: CATEGORY_META[category].color,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {category}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#102a43" }}>
                      {formatTime(worker.categoryTimes[category])}
                    </span>
                    <span style={{ fontSize: 11.5, color: "#526071" }}>{formatRatio(worker.ratios[category])}</span>
                  </div>
                ))}
              </div>
            </summary>

            <div style={{ padding: 20 }}>
              <div
                style={{
                  overflow: "auto",
                  borderRadius: 18,
                  border: "1px solid #d9e2ec",
                  background: "#ffffff",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 1020 }}>
                  <thead>
                    <tr>
                      {["#", "분류", "부품 기준", "요소작업", "OPTION", "동작요소", "반복횟수", "SEC", "TOTAL 반영시간"].map(
                        (label) => (
                          <th key={label} style={tableHeadStyle}>
                            {label}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {worker.rows.filter((item) => toNumber(item.row["반복횟수"]) !== 0).map((item, index) => {
                      if (item.row["부품 기준"]) currentPart = item.row["부품 기준"];
                      if (item.row["요소작업"]) currentWork = item.row["요소작업"];
                      if (item.row["OPTION"]) currentOption = item.row["OPTION"];

                      const isAlt = index % 2 === 1;

                      return (
                        <tr key={item.id} style={{ background: isAlt ? "#fbfdff" : "#ffffff" }}>
                          <td style={tableCellStyle("center", "muted")}>{index + 1}</td>
                          <td style={tableCellStyle("left")}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "5px 10px",
                                borderRadius: 999,
                                background: CATEGORY_META[item.category].bg,
                                color: CATEGORY_META[item.category].color,
                                fontWeight: 800,
                                fontSize: 12,
                              }}
                            >
                              {item.category}
                            </span>
                          </td>
                          <td style={tableCellStyle("left")}>
                            <RowValue primary={currentPart} />
                          </td>
                          <td style={tableCellStyle("left")}>
                            <RowValue primary={currentWork} />
                          </td>
                          <td style={tableCellStyle("left")}>
                            <RowValue primary={currentOption} />
                          </td>
                          <td style={tableCellStyle("left")}>
                            <RowValue primary={item.row["동작요소"]} />
                          </td>
                          <td style={tableCellStyle("right")}>{item.row["반복횟수"] || "-"}</td>
                          <td style={tableCellStyle("right")}>{item.row["SEC"] || "-"}</td>
                          <td style={{ ...tableCellStyle("right"), fontWeight: 800, color: "#102a43" }}>
                            {formatTime(item.time)}
                          </td>
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
