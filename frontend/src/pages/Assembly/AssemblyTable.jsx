import React, { useMemo, useState, useRef } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";

import RowContextMenu from "./RowContextMenu";
import { computeRowspanInfo } from "./groupUtils";

/* =========================
   utils
========================= */

const TABLE_COLUMNS = [
  { key: "부품 기준", label: "부품 기준", width: "14%" },
  { key: "요소작업", label: "요소작업", width: "13.5%" },
  { key: "OPTION", label: "OPTION", width: "12%" },
  { key: "작업자", label: "작업자", width: "5%" },
  { key: "no", label: "no", width: "6%" },
  { key: "동작요소", label: "동작요소", width: "31%" },
  { key: "반복횟수", label: "반복횟수", width: "5%" },
  { key: "SEC", label: "SEC", width: "5%" },
  { key: "TOTAL", label: "TOTAL", width: "5%" },
];

const TABLE_MIN_WIDTH = 1280;
const MIN_COLUMN_WIDTH = 72;

function getInitialColumnWidths() {
  return TABLE_COLUMNS.map((column) => {
    if (typeof column.width === "string" && column.width.endsWith("%")) {
      return (parseFloat(column.width) / 100) * TABLE_MIN_WIDTH;
    }
    return Number(column.width) || MIN_COLUMN_WIDTH;
  });
}

// rows 등장 순서대로 groupKey 리스트 생성
function buildGroupOrder(rows) {
  const order = [];
  const seen = new Set();
  for (const r of rows) {
    const gk = r.__groupKey;
    if (!gk) continue;
    if (seen.has(gk)) continue;
    seen.add(gk);
    order.push(gk);
  }
  return order;
}

// groupKey -> rows[] map
function buildGroupRowsMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const gk = r.__groupKey;
    if (!map.has(gk)) map.set(gk, []);
    map.get(gk).push(r);
  }
  return map;
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isFinite(rounded)
    ? rounded.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00";
}

function getNoCellHighlight(value) {
  const normalized = String(value ?? "").trim();

  if (normalized === "필비") {
    return { background: "#fef3c7", color: "#92400e" };
  }
  if (normalized === "낭비") {
    return { background: "#fee2e2", color: "#991b1b" };
  }
  if (normalized === "가치") {
    return { background: "#dcfce7", color: "#166534" };
  }

  return null;
}

function buildPartBlocks(rows) {
  const blocks = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    const span = Math.max(1, Number(row.__partRowspan) || 1);

    blocks.push({
      id: row.id,
      groupKey: row.__groupKey,
      label: row["부품 기준"] || "",
      rows: rows.slice(i, i + span),
    });

    i += span;
  }

  return blocks;
}

function buildGlobalPartBlocks(groupOrder, groupPartBlocksMap) {
  const blocks = [];
  for (const groupKey of groupOrder) {
    const groupBlocks = groupPartBlocksMap.get(groupKey) || [];
    for (const block of groupBlocks) {
      blocks.push(block);
    }
  }
  return blocks;
}

// rows에서 UI 메타 제거(선택)
// computeRowspanInfo가 다시 계산하므로, 남아 있어도 큰 문제는 없지만 깔끔하게 제거
function stripRowspanMeta(row) {
  const {
    __showPart,
    __partRowspan,
    __showTask,
    __taskRowspan,
    __showOption,
    __optionRowspan,
    ...rest
  } = row;
  return rest;
}

/* =========================
   Main Table
========================= */

export default function AssemblyTable({
  rows,
  onInsertSameGroup,
  onInsertNewGroup,
  onDeleteRow,
  onDeleteGroup,
  onCellChange,
  onRowsChange,
  onDeleteOptionGroup,
  onGroupLabelChange,
}) {

  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    row: null,
  });
  const [columnWidths, setColumnWidths] = useState(getInitialColumnWidths);
  const resizingRef = useRef(null);

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

  const stopResize = () => {
    resizingRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", stopResize);
  };

  const handleResizeMove = (e) => {
    const resizeState = resizingRef.current;
    if (!resizeState) return;

    const deltaX = e.clientX - resizeState.startX;
    const nextWidth = Math.max(MIN_COLUMN_WIDTH, resizeState.startWidth + deltaX);

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

  // DnD 상태
  const [activePartId, setActivePartId] = useState(null);
  const [activeLabel, setActiveLabel] = useState("");
  
  const groupRectsRef = useRef(new Map());

  
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // rowspan 계산된 rows
  const processedRows = useMemo(() => computeRowspanInfo(rows), [rows]);

  // 그룹 순서 / 그룹별 row 매핑
  const groupOrder = useMemo(() => buildGroupOrder(processedRows), [processedRows]);
  const groupRowsMap = useMemo(() => buildGroupRowsMap(processedRows), [processedRows]);
  const groupPartBlocksMap = useMemo(() => {
    const map = new Map();
    for (const gk of groupOrder) {
      map.set(gk, buildPartBlocks(groupRowsMap.get(gk) || []));
    }
    return map;
  }, [groupOrder, groupRowsMap]);
  const globalPartBlocks = useMemo(
    () => buildGlobalPartBlocks(groupOrder, groupPartBlocksMap),
    [groupOrder, groupPartBlocksMap]
  );

  const groupSums = useMemo(() => {
    const sums = new Map();
    for (const gk of groupOrder) {
      const list = groupRowsMap.get(gk) || [];
      let secSum = 0;
      let totalSum = 0;
      for (const row of list) {
        secSum += toNumber(row["SEC"]);
        totalSum += toNumber(row["TOTAL"]);
      }
      sums.set(gk, { secSum, totalSum });
    }
    return sums;
  }, [groupOrder, groupRowsMap]);

  const grandSums = useMemo(() => {
    let secSum = 0;
    let totalSum = 0;
    for (const row of processedRows) {
      secSum += toNumber(row["SEC"]);
      totalSum += toNumber(row["TOTAL"]);
    }
    return { secSum, totalSum };
  }, [processedRows]);

  // 그룹 rect 등록용 ref 콜백 생성
  const registerPartRect = (partId) => (el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    groupRectsRef.current.set(partId, rect);
  };
  

  const renderTextarea = (row, col, readOnly = false) => (
    <textarea
      value={row[col] ?? ""}
      readOnly={readOnly}
      onChange={(e) => {
        if (readOnly) return;
        onCellChange(row.id, col, e.target.value);
      }}
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

  const renderGroupLabelInput = (groupKey, value) => (
    <textarea
      value={value || ""}
      onChange={(e) => onGroupLabelChange?.(groupKey, e.target.value)}
      placeholder="그룹 이름"
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
        textAlign: "center",
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

  const renderNumberInput = (row, col, { step = "0.01", min } = {}) => (
    <input
      type="number"
      value={row[col] ?? ""}
      step={step}
      min={min}
      onChange={(e) => onCellChange(row.id, col, e.target.value)}
      style={{
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid transparent",
        outline: "none",
        background: "transparent",
        padding: "6px 6px",
        fontSize: 13.5,
        lineHeight: "20px",
        minHeight: 28,
      }}
    />
  );

  const renderDecimalInput = (row, col) => (
    <input
      type="text"
      inputMode="decimal"
      value={row[col] ?? ""}
      onChange={(e) => onCellChange(row.id, col, e.target.value)}
      style={{
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid transparent",
        outline: "none",
        background: "transparent",
        padding: "6px 6px",
        fontSize: 13.5,
        lineHeight: "20px",
        minHeight: 28,
      }}
    />
  );

  function onDragStart(event) {
    const { active } = event;
    const partId = active?.id;
    if (!partId) return;

    setActivePartId(partId);

    for (const blocks of groupPartBlocksMap.values()) {
      const block = blocks.find((item) => item.id === partId);
      if (block) {
        setActiveLabel(block.label);
        return;
      }
    }
    setActiveLabel("");
  }

  function onDragOver(event) {
    // 드래그 중에는 테이블을 움직이지 않음(핸들만 overlay로 움직임)
    // 필요하면 여기서 hover 표시 등을 넣을 수 있음
  }

  function onDragEnd(event) {
    const { active, over } = event;
  
    const activeId = active?.id;
    const overId = over?.id;
  
    setActivePartId(null);
  
    if (!activeId || !overId) return;
    if (activeId === overId) return;
    if (typeof onRowsChange !== "function") return;

    const activeIndex = globalPartBlocks.findIndex((block) => block.id === activeId);
    const overIndex = globalPartBlocks.findIndex((block) => block.id === overId);
    if (activeIndex === -1 || overIndex === -1) return;

    const overBlock = globalPartBlocks[overIndex];
    if (!overBlock) return;

    const reorderedBlocks = [...globalPartBlocks];
    const [moved] = reorderedBlocks.splice(activeIndex, 1);
    reorderedBlocks.splice(overIndex, 0, moved);

    const sourceGroupKey = moved.groupKey;
    const targetGroupKey = overBlock.groupKey;
    const targetGroupRows = groupRowsMap.get(targetGroupKey) || [];
    const targetGroupLabel =
      targetGroupRows[0]?.__groupLabel ||
      targetGroupRows[0]?.__sequenceGroupLabel ||
      "";

    const normalizedBlocks = reorderedBlocks.map((block) => {
      if (block.id !== moved.id) return block;

      const movedRows = block.rows.map((row) => {
        const nextRow = {
          ...row,
          __groupKey: targetGroupKey,
        };

        if (sourceGroupKey !== targetGroupKey) {
          nextRow.__groupLabel = targetGroupLabel;
        }

        return nextRow;
      });

      return {
        ...block,
        groupKey: targetGroupKey,
        rows: movedRows,
      };
    });

    const regroupedRowsMap = new Map();
    for (const block of normalizedBlocks) {
      if (!regroupedRowsMap.has(block.groupKey)) {
        regroupedRowsMap.set(block.groupKey, []);
      }
      regroupedRowsMap.get(block.groupKey).push(...block.rows);
    }

    const orderedGroupKeys = [];
    const seenGroupKeys = new Set();
    for (const block of normalizedBlocks) {
      if (seenGroupKeys.has(block.groupKey)) continue;
      seenGroupKeys.add(block.groupKey);
      orderedGroupKeys.push(block.groupKey);
    }

    const nextRows = [];
    for (const groupKey of orderedGroupKeys) {
      const rowsInGroup = regroupedRowsMap.get(groupKey) || [];
      for (const row of rowsInGroup) {
        nextRows.push(stripRowspanMeta(row));
      }
    }

    onRowsChange(nextRows);
  }
  

  // DragOverlay에서 보여줄 “핸들만”
  const HandleGhost = () => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        border: "1px solid #ddd",
        borderRadius: 8,
        background: "#fff",
        boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
        fontWeight: 600,
        fontSize: 13.5,
        lineHeight: "20px",
      }}
    >
      <span
        style={{
          display: "inline-block",
          cursor: "grabbing",
          padding: "2px 8px",
          border: "1px solid #ddd",
          borderRadius: 6,
          userSelect: "none",
          background: "#fff",
          lineHeight: "20px",
        }}
      >
        ⠿
      </span>
      <span style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {activeLabel || ""}
      </span>
    </div>
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
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <table
            style={{
              borderCollapse: "collapse",
              fontSize: 13.5,
              width: "100%",
              minWidth: Math.max(
                TABLE_MIN_WIDTH,
                columnWidths.reduce((sum, width) => sum + width, 0)
              ),
              tableLayout: "fixed",
            }}
          >
            <colgroup>
              {TABLE_COLUMNS.map((column, index) => (
                <col key={column.key} style={{ width: columnWidths[index] }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {TABLE_COLUMNS.map((column, index) => (
                  <th
                    key={column.key}
                    style={{
                      position: "relative",
                      padding: "10px 12px",
                      borderBottom: "1px solid #d9d9d9",
                      borderRight: "1px solid #d9d9d9",
                      background: "#fafafa",
                      fontWeight: 600,
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

            {groupOrder.map((gk) => {
              const partBlocks = groupPartBlocksMap.get(gk) || [];
              if (partBlocks.length === 0) return null;
              const sum = groupSums.get(gk) || { secSum: 0, totalSum: 0 };
              const groupLabel = partBlocks[0]?.rows[0]?.__groupLabel || partBlocks[0]?.rows[0]?.__sequenceGroupLabel || "";
              return (
                <React.Fragment key={gk}>
                  {partBlocks.map((block) => (
                    <DroppablePartTbody
                      key={block.id}
                      id={block.id}
                      registerRect={registerPartRect(block.id)}
                    >
                      {block.rows.map((row) => (
                        <tr key={row.id} onContextMenu={(e) => openMenu(e, row)}>
                          {row.__showPart && (
                            <td rowSpan={row.__partRowspan} style={cellStyle(true)}>
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                <DraggableHandle id={block.id} />

                                <div style={{ flex: 1, minWidth: 0 }}>
                                  {renderTextarea(row, "부품 기준")}
                                </div>
                              </div>
                            </td>
                          )}

                          {row.__showTask && (
                            <td rowSpan={row.__taskRowspan} style={cellStyle()}>
                              {renderTextarea(row, "요소작업")}
                            </td>
                          )}

                          {row.__showOption && (
                            <td rowSpan={row.__optionRowspan} style={cellStyle()}>
                              {renderTextarea(row, "OPTION")}
                            </td>
                          )}

                          <td style={cellStyle()}>
                            {renderTextarea(row, "작업자")}
                          </td>
                          <td
                            style={{
                              ...cellStyle(),
                              ...(getNoCellHighlight(row["no"]) || {}),
                            }}
                          >
                            {renderTextarea(row, "no")}
                          </td>
                          <td style={cellStyle()}>
                            {renderTextarea(row, "동작요소")}
                          </td>
                          <td style={cellStyle()}>
                            {renderNumberInput(row, "반복횟수")}
                          </td>
                          <td style={cellStyle()}>
                            {renderDecimalInput(row, "SEC")}
                          </td>
                          <td style={cellStyle()}>
                            {renderDecimalInput(row, "TOTAL")}
                          </td>
                        </tr>
                      ))}
                    </DroppablePartTbody>
                  ))}
                  <tbody>
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          ...cellStyle(true),
                          background: "#f8fafc",
                          minWidth: 180,
                          textAlign: "center",
                          verticalAlign: "middle",
                        }}
                      >
                        {renderGroupLabelInput(gk, groupLabel)}
                      </td>
                      <td
                        colSpan={3}
                        style={{
                          ...cellStyle(true),
                          textAlign: "right",
                          background: "#f8fafc",
                        }}
                      >
                        합계
                      </td>
                      <td
                        style={{
                          ...cellStyle(true),
                          background: "#f8fafc",
                        }}
                      >
                        {formatNumber(sum.secSum)}
                      </td>
                      <td
                        style={{
                          ...cellStyle(true),
                          background: "#f8fafc",
                        }}
                      >
                        {formatNumber(sum.totalSum)}
                      </td>
                    </tr>
                  </tbody>
                </React.Fragment>
              );
            })}
            <tfoot>
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...cellStyle(true),
                    textAlign: "right",
                    background: "#eef2ff",
                  }}
                >
                  전체 합계
                </td>
                <td
                  style={{
                    ...cellStyle(true),
                    background: "#eef2ff",
                  }}
                >
                  {formatNumber(grandSums.secSum)}
                </td>
                <td
                  style={{
                    ...cellStyle(true),
                    background: "#eef2ff",
                  }}
                >
                  {formatNumber(grandSums.totalSum)}
                </td>
              </tr>
            </tfoot>
          </table>

          <DragOverlay>
            {activePartId ? <HandleGhost /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {contextMenu.visible && contextMenu.row && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={hideMenu}

          onInsertSameGroup={() => {
            onInsertSameGroup(contextMenu.row.id);
            hideMenu();
          }}

          onInsertNewGroup={() => {
            onInsertNewGroup(contextMenu.row.id);
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

          onDeleteOptionGroup={() => {
            onDeleteOptionGroup(contextMenu.row.__groupKey, contextMenu.row["OPTION"]);
            hideMenu();
          }}
        />
      )}
    </div>
  );
}

/* =========================
   Draggable Handle
   - ⠿만 draggable 느낌
   - 실제 이동은 부품 기준 블록(id)로 수행
========================= */


function DraggableHandle({ id }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });

  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        display: "inline-block",
        cursor: isDragging ? "grabbing" : "grab",
        padding: "2px 8px",
        border: "1px solid #ddd",
        borderRadius: 6,
        userSelect: "none",
        background: "#fff",
        lineHeight: "20px",
        marginTop: 6,
      }}
      title="부품 기준 이동"
    >
      ⠿
    </span>
  );
}

function DroppablePartTbody({ id, children, registerRect }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  // droppable ref + rect 측정 ref를 합쳐서 연결
  const composedRef = (el) => {
    setNodeRef(el);
    if (typeof registerRect === "function") registerRect(el);
  };

  return (
    <tbody
      ref={composedRef}
      data-groupkey={id}
      style={{
        outline: isOver ? "2px dashed #999" : "none",
        outlineOffset: -2,
      }}
    >
      {children}
    </tbody>
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
