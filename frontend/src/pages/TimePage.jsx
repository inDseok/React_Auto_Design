import React, { useState, useRef } from "react";

export default function TimePage() {
  const columns = [
    "서브공정",
    "단위작업",
    "부품 기준",
    "요소 작업",
    "OPTION",
    "작업자",
    "작업 구분",
    "동작요소",
    "반복횟수(가중치)설정",
    "SEC",
    "TOTAL",
    "기본사양",
    "추가(옵션)사양",
    "비고",
  ];

  const [rows, setRows] = useState([
    Array(columns.length).fill(""),
    Array(columns.length).fill(""),
  ]);

  const [columnWidths, setColumnWidths] = useState(
    Array(columns.length).fill(140)
  );

  const resizingCol = useRef(null);

  const startResizing = (index, e) => {
    resizingCol.current = {
      index,
      startX: e.clientX,
      startWidth: columnWidths[index],
    };

    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stopResizing);
  };

  const resize = (e) => {
    if (!resizingCol.current) return;
    const { index, startX, startWidth } = resizingCol.current;

    const diff = e.clientX - startX;
    const newWidth = Math.max(60, startWidth + diff);

    setColumnWidths((prev) =>
      prev.map((w, i) => (i === index ? newWidth : w))
    );
  };

  const stopResizing = () => {
    resizingCol.current = null;
    document.removeEventListener("mousemove", resize);
    document.removeEventListener("mouseup", stopResizing);
  };

  const updateCell = (r, c, value) => {
    setRows((prev) =>
      prev.map((row, i) =>
        i === r ? row.map((cell, j) => (j === c ? value : cell)) : row
      )
    );
  };

  // ====== Context Menu ======
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    rowIndex: null,
  });

  const addRowAt = (index) => {
    setRows((prev) => {
      const list = [...prev];
      list.splice(index, 0, Array(columns.length).fill(""));
      return list;
    });
    hideMenu();
  };

  const deleteRow = (index) => {
    if (rows.length === 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    hideMenu();
  };

  const openMenu = (e, r) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: r });
  };

  const hideMenu = () => setContextMenu((p) => ({ ...p, visible: false }));

  const totalMinWidth = columnWidths.reduce((a, b) => a + b, 0);

  return (
    <div style={{ padding: 20 }} onClick={hideMenu}>
      <div
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 8,
          overflowX: "auto",
          overflowY: "hidden",
          minWidth: 0,
          boxShadow: "0 2px 8px rgba(0,0,0,.05)",
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            border: "1px solid #d9d9d9",
            fontSize: 13.5,
            width: "100%",
            minWidth: totalMinWidth,
          }}
        >
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={{
                    position: "relative",
                    minWidth: 60,
                    padding: "10px 12px",
                    borderBottom: "1px solid #d9d9d9",
                    borderRight: "1px solid #d9d9d9",
                    background: "#fafafa",
                    color: "#262626",
                    fontWeight: 600,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}

                  <div
                    onMouseDown={(e) => startResizing(i, e)}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      width: 6,
                      height: "100%",
                      cursor: "col-resize",
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, r) => (
              <tr
                key={r}
                onContextMenu={(e) => openMenu(e, r)}
                style={{
                  background: "#fff",
                }}
              >
                {row.map((cell, c) => (
                  <td
                    key={c}
                    style={{
                      borderBottom: "1px solid #d9d9d9",
                      borderRight: "1px solid #d9d9d9",
                      padding: "6px 12px",
                    }}
                  >
                    <textarea
                      value={cell}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                      rows={1}
                      style={{
                        width: "100%",
                        resize: "none",
                        overflow: "hidden",
                        border: "1px solid transparent",
                        outline: "none",
                        background: "transparent",
                        padding: "4px 6px",
                      }}
                      onInput={(e) => {
                        e.target.style.height = "auto";
                        e.target.style.height = e.target.scrollHeight + "px";
                      }}
                    />

                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu.visible && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "#fff",
            border: "1px solid #d9d9d9",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            fontSize: 13,
            minWidth: 160,
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: 10,
              cursor: "pointer",
            }}
            onClick={() => addRowAt(contextMenu.rowIndex)}
          >
            위에 행 추가
          </div>

          <div
            style={{
              padding: 10,
              cursor: "pointer",
            }}
            onClick={() => addRowAt(contextMenu.rowIndex + 1)}
          >
            아래에 행 추가
          </div>

          <div
            style={{
              padding: 10,
              cursor: "pointer",
              color: "#cf1322",
            }}
            onClick={() => deleteRow(contextMenu.rowIndex)}
          >
            이 행 삭제
          </div>
        </div>
      )}
    </div>
  );
}
