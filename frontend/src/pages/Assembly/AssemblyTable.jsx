import React, { useState } from "react";
import RowContextMenu from "./RowContextMenu";
import { computeRowspanInfo } from "./groupUtils";

export default function AssemblyTable({
  rows,
  onInsertBelow,
  onDeleteRow,
  onDeleteGroup,
  onCellChange,
}) {
  const columns = [
    "부품 기준",
    "요소작업",
    "OPTION",
    "작업자",
    "no",
    "동작요소",
    "반복횟수",
    "SEC",
    "TOTAL",
  ];

  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    row: null,
  });

  const openMenu = (e, row) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      row,
    });
  };

  const hideMenu = () =>
    setContextMenu((p) => ({
      ...p,
      visible: false,
      row: null,
    }));

  const processedRows = computeRowspanInfo(rows);

  const renderTextarea = (row, col) => (
    <textarea
      value={row[col] ?? ""}
      onChange={(e) => onCellChange(row.id, col, e.target.value)}
      rows={1}
      style={{
        width: "100%",
        resize: "none",
        overflow: "hidden",
        border: "1px solid transparent",
        outline: "none",
        background: "transparent",
        padding: "6px 6px",
        fontSize: 13.5,
        lineHeight: "20px",
        wordBreak: "break-word",
        minHeight: 28,
      }}
      ref={(el) => {
        if (el) {
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }
      }}
      onInput={(e) => {
        e.target.style.height = "auto";
        e.target.style.height = e.target.scrollHeight + "px";
      }}
    />
  );

  return (
    <div style={{ paddingTop: 8 }} onClick={hideMenu}>
      <div
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 8,
          overflowX: "auto",
          boxShadow: "0 2px 8px rgba(0,0,0,.05)",
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 13.5,
            width: "100%",
            minWidth: 1200,
          }}
        >
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #d9d9d9",
                    borderRight: "1px solid #d9d9d9",
                    background: "#fafafa",
                    fontWeight: 600,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {processedRows.map((row) => (
              <tr
                key={row.id}
                onContextMenu={(e) => openMenu(e, row)}
              >
                {row.__showPart && (
                  <td
                    rowSpan={row.__partRowspan}
                    style={cellStyle(true)}
                  >
                    {renderTextarea(row, "부품 기준")}
                  </td>
                )}

                {row.__showTask && (
                  <td
                    rowSpan={row.__taskRowspan}
                    style={cellStyle()}
                  >
                    {renderTextarea(row, "요소작업")}
                  </td>
                )}

                {row.__showOption && (
                  <td
                    rowSpan={row.__optionRowspan}
                    style={cellStyle()}
                  >
                    {renderTextarea(row, "OPTION")}
                  </td>
                )}

                {["작업자", "no", "동작요소", "반복횟수", "SEC", "TOTAL"].map(
                  (col) => (
                    <td
                      key={col}
                      style={cellStyle()}
                    >
                      {renderTextarea(row, col)}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu.visible && contextMenu.row && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={hideMenu}
          onInsertBelow={() => {
            onInsertBelow(contextMenu.row.id);
            hideMenu();
          }}
          onDeleteRow={() => {
            onDeleteRow(contextMenu.row.id);
            hideMenu();
          }}
          onDeleteGroup={() => {
            onDeleteGroup(contextMenu.row.__groupKey);
            hideMenu();
          }}
        />
      )}
    </div>
  );
}

function cellStyle(isBold = false) {
  return {
    borderBottom: "1px solid #d9d9d9",
    borderRight: "1px solid #d9d9d9",
    padding: "6px 12px",
    verticalAlign: "top",
    background: isBold ? "#fcfcfc" : "#fff",
    fontWeight: isBold ? 600 : 400,
  };
}
