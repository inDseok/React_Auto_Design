import React, { useRef, useState } from "react";
import TimeSummaryCards from "./TimeSummaryCards";
import TimeGroupSection from "./TimeGroupSection";
import {
  TIME_COLUMNS,
  TIME_MIN_COLUMN_WIDTH,
  TIME_TABLE_MIN_WIDTH,
  getInitialTimeColumnWidths,
} from "./timeColumns";

export default function TimeAnalysisView({
  bomId,
  spec,
  loading,
  processedRows,
  groupOrder,
  groupRowsMap,
  summary,
}) {
  const [columnWidths, setColumnWidths] = useState(getInitialTimeColumnWidths);
  const resizingRef = useRef(null);

  const stopResize = () => {
    resizingRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", stopResize);
  };

  const handleResizeMove = (e) => {
    const resizeState = resizingRef.current;
    if (!resizeState) return;

    const deltaX = e.clientX - resizeState.startX;
    const nextWidth = Math.max(
      TIME_MIN_COLUMN_WIDTH,
      resizeState.startWidth + deltaX
    );

    setColumnWidths((prev) =>
      prev.map((width, index) =>
        index === resizeState.index ? nextWidth : width
      )
    );
  };

  const startResize = (index, e) => {
    e.preventDefault();
    e.stopPropagation();

    resizingRef.current = {
      index,
      startX: e.clientX,
      startWidth: columnWidths[index],
    };

    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", stopResize);
  };

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>작업시간 분석표</h2>
          <div style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
            BOM `{bomId}` / 사양 `{spec}` 기준 조립 총공수 보기
          </div>
        </div>
      </div>

      <TimeSummaryCards summary={summary} />

      <div
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 12,
          overflowX: "auto",
          overflowY: "hidden",
          background: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,.05)",
        }}
      >
        <table
          style={{
            width: "100%",
            minWidth: Math.max(
              TIME_TABLE_MIN_WIDTH,
              columnWidths.reduce((sum, width) => sum + width, 0)
            ),
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {TIME_COLUMNS.map((column, index) => (
              <col key={column.key} style={{ width: columnWidths[index] }} />
            ))}
          </colgroup>
          <thead>
            <tr
              style={{
                background: "#f8fafc",
                borderBottom: "1px solid #e5e7eb",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {TIME_COLUMNS.map((column, index) => (
                <th
                  key={column.key}
                  style={{
                    position: "relative",
                    padding: "12px 14px",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {column.label}
                  <div
                    onMouseDown={(e) => startResize(index, e)}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: -3,
                      width: 6,
                      height: "100%",
                      cursor: "col-resize",
                      userSelect: "none",
                      zIndex: 2,
                    }}
                    title="열 너비 조절"
                  />
                </th>
              ))}
            </tr>
          </thead>
        </table>

        {loading ? (
          <div style={{ padding: 24 }}>불러오는 중...</div>
        ) : processedRows.length === 0 ? (
          <div style={{ padding: 24 }}>저장된 조립 총공수 데이터가 없습니다.</div>
        ) : (
          <div style={{ display: "grid", gap: 14, padding: 14, background: "#f8fafc" }}>
            {groupOrder.map((groupKey, index) => {
              const groupRows = groupRowsMap.get(groupKey) || [];
              if (groupRows.length === 0) return null;

              return (
                <TimeGroupSection
                  key={groupKey}
                  groupKey={groupKey}
                  groupRows={groupRows}
                  index={index}
                  columnWidths={columnWidths}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
