import React, { useMemo, useState, useRef } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";

import RowContextMenu from "./RowContextMenu";
import { computeRowspanInfo } from "./groupUtils";

import { v4 as uuidv4 } from "uuid";

/* =========================
   utils
========================= */

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

function arrayMoveImmutable(array, fromIndex, toIndex) {
  const copy = [...array];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

function computeDropIndexFromPointer(groupOrder, groupRects, activeId, overId, pointerY) {
  // overId 기준으로 위/아래 절반 판단해서 drop index 계산
  const overIndex = groupOrder.indexOf(overId);
  if (overIndex === -1) return -1;

  const rect = groupRects.get(overId);
  if (!rect) return overIndex;

  const midY = rect.top + rect.height / 2;
  const insertAfter = pointerY > midY;

  // active가 위에서 아래로 내려올 때, 제거 후 삽입 인덱스 보정
  const activeIndex = groupOrder.indexOf(activeId);
  let target = overIndex + (insertAfter ? 1 : 0);

  if (activeIndex !== -1 && activeIndex < target) target -= 1;
  return target;
}

// movedGroupKey를 새 key로 재발급(질문2: B)
function rekeyGroup(rows, oldKey, newKey) {
  return rows.map((r) => {
    if (r.__groupKey !== oldKey) return r;
    return { ...r, __groupKey: newKey };
  });
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

  // DnD 상태
  const [activeGroupKey, setActiveGroupKey] = useState(null);
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

  // 그룹 rect 등록용 ref 콜백 생성
  const registerGroupRect = (groupKey) => (el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    groupRectsRef.current.set(groupKey, rect);
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

  function onDragStart(event) {
    const { active } = event;
    const gk = active?.id;
    if (!gk) return;

    setActiveGroupKey(gk);

    // 라벨(부품기준 텍스트) 추출: 해당 그룹 첫 row의 "부품 기준"
    const firstRow = (groupRowsMap.get(gk) || [])[0];
    setActiveLabel(firstRow?.["부품 기준"] || "");
  }

  function onDragOver(event) {
    // 드래그 중에는 테이블을 움직이지 않음(핸들만 overlay로 움직임)
    // 필요하면 여기서 hover 표시 등을 넣을 수 있음
  }

  function onDragEnd(event) {
    const { active, over } = event;
  
    const activeId = active?.id;
    const overId = over?.id;
  
    setActiveGroupKey(null);
  
    if (!activeId || !overId) return;
    if (activeId === overId) return;
    if (typeof onRowsChange !== "function") return;
  
    const oldIndex = groupOrder.indexOf(activeId);
    const newIndex = groupOrder.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;
  
    // 1) 그룹 순서 재정렬(일단 over 위치로 이동)
    const nextGroupOrder = arrayMoveImmutable(groupOrder, oldIndex, newIndex);
  
    // 2) 이동된 그룹 __groupKey 재발급(B)
    const newKey = uuidv4();
    const rekeyed = rekeyGroup(processedRows, activeId, newKey);
  
    // 3) 새 groupOrder에서도 activeId를 newKey로 치환
    const normalizedOrder = nextGroupOrder.map((k) => (k === activeId ? newKey : k));
  
    // 4) flatten
    const nextMap = buildGroupRowsMap(rekeyed);
    const flattened = [];
    for (const gk of normalizedOrder) {
      const list = nextMap.get(gk) || [];
      for (const r of list) flattened.push(stripRowspanMeta(r));
    }
  
    onRowsChange(flattened);
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

            {groupOrder.map((gk) => {
              const rowsInGroup = groupRowsMap.get(gk) || [];
              if (rowsInGroup.length === 0) return null;

              return (
                <DroppableGroupTbody
                  key={gk}
                  id={gk}
                  registerRect={registerGroupRect(gk)}
                >
                  {rowsInGroup.map((row) => (
                    <tr key={row.id} onContextMenu={(e) => openMenu(e, row)}>
                      {row.__showPart && (
                        <td rowSpan={row.__partRowspan} style={cellStyle(true)}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            {/* ⠿ 핸들만 드래그 */}
                            <DraggableHandle id={gk} />

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

                      {["작업자", "no", "동작요소", "반복횟수", "SEC", "TOTAL"].map((col) => (
                        <td key={col} style={cellStyle()}>
                          {renderTextarea(row, col)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </DroppableGroupTbody>
              );
            })}
          </table>

          <DragOverlay>
            {activeGroupKey ? <HandleGhost /> : null}
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
   - 실제 이동은 groupKey(id)로 수행
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
      title="그룹 이동"
    >
      ⠿
    </span>
  );
}

function DroppableGroupTbody({ id, children, registerRect }) {
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
