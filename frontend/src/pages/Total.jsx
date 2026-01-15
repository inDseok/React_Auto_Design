import React, { useEffect, useMemo, useRef, useState } from "react";

const FETCH_OPT = { credentials: "include" };
const API_BASE = "http://localhost:8000";

/*
  최종본 기능
  - 시트/부품 기준/OPTION 선택 후 "추가"로 DB(tasks) 조회 → rows에 누적
  - 엑셀 병합 셀(부품 기준/요소작업/OPTION)을 UI에서 rowspan으로 재현
  - 우클릭 컨텍스트 메뉴(3개):
    1) 이 행 아래 추가  -> "같은 그룹" 아래에 빈 행 1줄 삽입 + 즉시 편집 가능
    2) 이 행 삭제       -> 해당 행 삭제
    3) 그룹 전체 삭제   -> 해당 그룹의 모든 행 삭제
  - 셀 더블클릭(또는 클릭) 편집:
    - Enter: 저장
    - ESC: 취소
    - Blur: 저장
  - 숫자 컬럼(반복횟수/SEC/TOTAL)은 숫자 형태로 저장 시도 (실패 시 원문 유지)
*/

function normalize(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isEmpty(v) {
  return normalize(v) === "";
}

/*
  rows를 순서대로 훑으며 forward-fill(병합 셀 대응) 후
  연속 그룹(key 동일) 단위로 묶습니다.
  group.items에는 filledRow가 들어갑니다.
*/
function buildGroupsWithFill(rows) {
  const groups = [];

  let curPart = null;
  let curWork = null;
  let curOpt = null;

  let currentGroup = null;

  rows.forEach((raw, idx) => {
    // ⭐ 신규 빈 행은 병합 대상에서 제외
    if (raw.__isNew) {
      groups.push({
        key: `__new__${raw.__rowKey}`,
        part: "",
        work: "",
        option: "",
        items: [{
          ...raw,
          __groupKey: `__new__${raw.__rowKey}`,
          __sourceIndex: idx,
        }],
        startIndexInRows: idx,
        endIndexInRows: idx,
        __isIsolated: true,
      });
      return;
    }

    if (!isEmpty(raw["부품 기준"])) curPart = raw["부품 기준"];
    if (!isEmpty(raw["요소작업"])) curWork = raw["요소작업"];
    if (!isEmpty(raw["OPTION"])) curOpt = raw["OPTION"];

    const key = `${normalize(curPart)}||${normalize(curWork)}||${normalize(curOpt)}`;

    const filled = {
      ...raw,
      "부품 기준": curPart,
      "요소작업": curWork,
      "OPTION": curOpt,
      __groupKey: key,
      __sourceIndex: idx,
    };

    if (!currentGroup || currentGroup.key !== key) {
      currentGroup = {
        key,
        part: curPart,
        work: curWork,
        option: curOpt,
        items: [filled],
        startIndexInRows: idx,
        endIndexInRows: idx,
      };
      groups.push(currentGroup);
    } else {
      currentGroup.items.push(filled);
      currentGroup.endIndexInRows = idx;
    }
  });

  return groups;
}


/* -----------------------------
   Context Menu
----------------------------- */

function ContextMenu({ open, x, y, onClose, onAction }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  const style = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 9999,
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: 8,
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    padding: 6,
    minWidth: 190,
  };

  const btn = {
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    borderRadius: 6,
  };

  const hover = (e, on) => {
    e.currentTarget.style.background = on ? "#f2f4f7" : "transparent";
  };

  return (
    <div ref={menuRef} style={style}>
      <button
        style={btn}
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
        onClick={() => onAction("add_below")}
      >
        이 행 아래 추가
      </button>
      <button
        style={btn}
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
        onClick={() => onAction("delete_row")}
      >
        이 행 삭제
      </button>
      <button
        style={btn}
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
        onClick={() => onAction("delete_group")}
      >
        그룹 전체 삭제
      </button>
    </div>
  );
}

/* -----------------------------
   Editable Cell
----------------------------- */

function EditableCell({
  value,
  onStartEdit, // (rowKey, field)
  editing, // boolean
  inputValue,
  setInputValue,
  onCommit, // (rowKey, field, newValue)
  onCancel,
  rowKey,
  field,
  alignRight = false,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const display = value === null || value === undefined ? "" : String(value);

  const tdStyle = {
    verticalAlign: "top",
    whiteSpace: field === "동작요소" ? "pre-wrap" : "nowrap",
    textAlign: alignRight ? "right" : "left",
    cursor: "text",
  };

  if (!editing) {
    return (
      <td
        style={tdStyle}
        onDoubleClick={() => onStartEdit(rowKey, field, display)}
        onClick={() => onStartEdit(rowKey, field, display)}
        title="클릭/더블클릭: 편집"
      >
        {display}
      </td>
    );
  }

  const isTextarea = field === "동작요소";

  const commonInputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #c7cdd6",
    outline: "none",
    fontSize: 14,
  };

  return (
    <td style={tdStyle}>
      {isTextarea ? (
        <textarea
          ref={inputRef}
          style={{ ...commonInputStyle, resize: "vertical", minHeight: 60 }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
            // textarea는 Enter 저장을 강제하지 않음(줄바꿈 필요)
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              onCommit(rowKey, field, inputValue);
            }
          }}
          onBlur={() => onCommit(rowKey, field, inputValue)}
        />
      ) : (
        <input
          ref={inputRef}
          style={commonInputStyle}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(rowKey, field, inputValue);
            }
          }}
          onBlur={() => onCommit(rowKey, field, inputValue)}
        />
      )}
      {field === "동작요소" && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#667085" }}>
          Ctrl+Enter 저장, ESC 취소
        </div>
      )}
    </td>
  );
}

/* -----------------------------
   Main
----------------------------- */

export default function Total() {
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState("");

  const [partBases, setPartBases] = useState([]);
  const [partBase, setPartBase] = useState("");

  const [options, setOptions] = useState([]);
  const [option, setOption] = useState("");

  const [rows, setRows] = useState([]);

  // 우클릭 메뉴
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [menuCtx, setMenuCtx] = useState(null); // { rowKey, groupKey, groupEndIndexInRows, part, work, option }

  // 편집 상태
  const [editing, setEditing] = useState(null); // { rowKey, field }
  const [inputValue, setInputValue] = useState("");

  // 시트 목록
  useEffect(() => {
    fetch(`${API_BASE}/api/assembly/sheets`, FETCH_OPT)
      .then((res) => res.json())
      .then(setSheets)
      .catch((err) => console.error("시트 로드 실패", err));
  
    // 🔥 조립 총공수 JSON 로드
    fetch(`${API_BASE}/api/assembly/load`, FETCH_OPT)
      .then((res) => res.json())
      .then((data) => {
        if (!data || !data.rows) return;
        const stamped = stampRows(data.rows);
        setRows(stamped);
      })
      .catch(() => {
        // 저장된 게 없는 경우 무시
      });
  }, []);
  
  const stripUiMeta = (rows) =>
    rows.map(({ __rowKey, __isNew, ...rest }) => rest);
  
  const handleSave = async () => {
    try {
      const pureRows = stripUiMeta(rows);
  
      const res = await fetch(`${API_BASE}/api/assembly/save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pureRows),
      });
  
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
  
      alert("저장 완료");
    } catch (err) {
      console.error(err);
      alert("저장 실패");
    }
  };
  

  // 시트 변경
  useEffect(() => {
    if (!sheet) return;

    setPartBase("");
    setOption("");
    setOptions([]);
    setEditing(null);

    fetch(`${API_BASE}/api/assembly/part-bases?sheet=${encodeURIComponent(sheet)}`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then(setPartBases)
      .catch((err) => console.error("부품 기준 로드 실패", err));    
  }, [sheet]);

  // 부품 기준 → 옵션
  useEffect(() => {
    if (!sheet || !partBase) return;

    setOption("");

    fetch(
      `${API_BASE}/api/assembly/options?sheet=${encodeURIComponent(sheet)}&part_base=${encodeURIComponent(partBase)}`,
      {
        credentials: "include",
      }
    )
      .then((res) => res.json())
      .then(setOptions)
      .catch((err) => console.error("OPTION 로드 실패", err));
  }, [sheet, partBase]);

  const grouped = useMemo(() => buildGroupsWithFill(rows), [rows]);

  const closeMenu = () => {
    setMenuOpen(false);
    setMenuCtx(null);
  };

  const stampRows = (data) => {
    const base = `${Date.now()}-${Math.random()}`;
    return data.map((r, i) => ({
      ...r,
      __rowKey: `${base}-${i}`,
    }));
  };

  const makeEmptyRow = () => ({
    "부품 기준": "",
    "요소작업": "",
    "OPTION": "",
    "작업자": "",
    "no": "",
    "동작요소": "",
    "반복횟수": "",
    "SEC": "",
    "TOTAL": "",
    __rowKey: `${Date.now()}-${Math.random()}`,
    __isNew: true,
  });

  const fetchTasks = async (sheetArg, partBaseArg, optionArg) => {
    const url =
      `${API_BASE}/api/assembly/tasks?sheet=${encodeURIComponent(sheetArg)}` +
      `&part_base=${encodeURIComponent(partBaseArg)}` +
      `&option=${encodeURIComponent(optionArg)}`;

    const res = await fetch(url, {
      credentials: "include",
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `tasks failed: ${res.status}`);
    }
    return await res.json();
  };

  const handleAddTop = async () => {
    if (!sheet || !partBase || !option) {
      alert("시트, 부품 기준, OPTION을 모두 선택하세요.");
      return;
    }

    try {
      const data = await fetchTasks(sheet, partBase, option);
      const stamped = stampRows(data);
      setRows((prev) => [...prev, ...stamped]);
    } catch (err) {
      console.error(err);
      alert("작업 로드 실패. 콘솔 로그를 확인하세요.");
    }
  };

  const startEdit = (rowKey, field, currentDisplay) => {
    setEditing({ rowKey, field });
    setInputValue(currentDisplay ?? "");
  };

  const cancelEdit = () => {
    setEditing(null);
    setInputValue("");
  };

  const toNumberIfPossible = (field, v) => {
    // 숫자 필드만 숫자 변환 시도
    const numFields = new Set(["반복횟수", "SEC", "TOTAL"]);
    if (!numFields.has(field)) return v;

    const s = normalize(v);
    if (s === "") return "";

    // 콤마 제거 후 숫자 변환
    const cleaned = s.replaceAll(",", "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;

    return v;
  };

  const commitEdit = (rowKey, field, newValue) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.__rowKey !== rowKey) return r;
        return {
          ...r,
          [field]: toNumberIfPossible(field, newValue),
          __isNew: false,
        };
      })
    );
    setEditing(null);
    setInputValue("");
  };

  const deleteRowByKey = (rowKey) => {
    // 편집 중 행을 삭제하면 편집 종료
    if (editing && editing.rowKey === rowKey) cancelEdit();
    setRows((prev) => prev.filter((r) => r.__rowKey !== rowKey));
  };

  const deleteGroupByKey = (groupKey) => {
    // rows를 forward-fill 해가며 groupKey와 일치하는 행 제거
    let curPart = null;
    let curWork = null;
    let curOpt = null;

    setRows((prev) => {
      const next = [];
      prev.forEach((raw) => {
        if (!isEmpty(raw["부품 기준"])) curPart = raw["부품 기준"];
        if (!isEmpty(raw["요소작업"])) curWork = raw["요소작업"];
        if (!isEmpty(raw["OPTION"])) curOpt = raw["OPTION"];

        const k = `${normalize(curPart)}||${normalize(curWork)}||${normalize(curOpt)}`;
        if (k !== groupKey) next.push(raw);
      });
      return next;
    });
  };

  const insertEmptyRowBelowGroup = (ctx) => {
    // 그룹 끝 아래에 빈 행 삽입 후 즉시 편집 시작(동작요소)
    setRows((prev) => {
      const groupsNow = buildGroupsWithFill(prev);
      const g = groupsNow.find((gg) => gg.key === ctx.groupKey);
      const endIndex = g ? g.endIndexInRows : prev.length - 1;

      const empty = makeEmptyRow();

      const before = prev.slice(0, endIndex + 1);
      const after = prev.slice(endIndex + 1);

      // 빈 행의 rowKey를 기억해서 편집 시작
      setTimeout(() => {
        startEdit(empty.__rowKey, "동작요소", "");
      }, 0);

      return [...before, empty, ...after];
    });
  };

  const handleRowContextMenu = (e, filledRow, groupInfo) => {
    e.preventDefault();

    // 편집 중이면 우클릭 메뉴 열기 전에 커밋/취소는 사용자 선택이 자연스럽지만,
    // 여기서는 메뉴만 띄우고 편집은 유지합니다.
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 150);

    setMenuPos({ x, y });
    setMenuCtx({
      rowKey: filledRow.__rowKey,
      groupKey: filledRow.__groupKey,
      part: groupInfo.part,
      work: groupInfo.work,
      option: groupInfo.option,
    });
    setMenuOpen(true);
  };

  const handleMenuAction = (action) => {
    if (!menuCtx) return;

    if (action === "add_below") {
      insertEmptyRowBelowGroup(menuCtx);
      closeMenu();
      return;
    }

    if (action === "delete_row") {
      if (window.confirm("이 행을 삭제하시겠습니까?")) {
        deleteRowByKey(menuCtx.rowKey);
      }
      closeMenu();
      return;
    }

    if (action === "delete_group") {
      if (window.confirm("이 그룹을 전체 삭제하시겠습니까?")) {
        deleteGroupByKey(menuCtx.groupKey);
      }
      closeMenu();
      return;
    }

    closeMenu();
  };

  const thStyle = {
    background: "#f5f5f5",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  const isEditingCell = (rowKey, field) =>
    editing && editing.rowKey === rowKey && editing.field === field;

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>조립 총공수</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
          <option value="">시트 선택</option>
          {sheets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={partBase}
          onChange={(e) => setPartBase(e.target.value)}
          disabled={!sheet}
        >
          <option value="">부품 기준</option>
          {partBases.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={option}
          onChange={(e) => setOption(e.target.value)}
          disabled={!sheet || !partBase}
        >
          <option value="">OPTION</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        <button onClick={handleAddTop} disabled={!sheet || !partBase || !option}>
          추가
        </button>
      </div>
        <button onClick={handleSave} disabled={rows.length === 0}>
          저장
        </button>
      <div style={{ overflowX: "auto", maxHeight: "70vh", overflowY: "auto" }}>
        <table
          border="1"
          cellPadding="6"
          style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}
        >
          <thead>
            <tr>
              <th style={thStyle}>부품 기준</th>
              <th style={thStyle}>요소작업</th>
              <th style={thStyle}>OPTION</th>
              <th style={thStyle}>작업자</th>
              <th style={thStyle}>no</th>
              <th style={thStyle}>동작요소</th>
              <th style={thStyle}>반복횟수</th>
              <th style={thStyle}>SEC</th>
              <th style={thStyle}>TOTAL</th>
            </tr>
          </thead>

          <tbody>
            {grouped.length === 0 && (
              <tr>
                <td colSpan="9" align="center">
                  추가된 작업이 없습니다.
                </td>
              </tr>
            )}

            {grouped.map((group, gIdx) =>
              group.items.map((filledRow, idx) => {
                const rowKey = filledRow.__rowKey || `${gIdx}-${idx}`;

                return (
                  <tr
                    key={`${gIdx}-${rowKey}`}
                    onContextMenu={(e) => handleRowContextMenu(e, filledRow, group)}
                    title="우클릭: 행 아래 추가 / 행 삭제 / 그룹 삭제"
                    style={{
                      cursor: "context-menu",
                      background: filledRow.__isNew ? "#fffbeb" : "transparent",
                    }}
                  >
                    {!group.__isIsolated && idx === 0 && (
                      <>
                        <td rowSpan={group.items.length}>{group.part}</td>
                        <td rowSpan={group.items.length}>{group.work}</td>
                        <td rowSpan={group.items.length}>{group.option}</td>
                      </>
                    )}

                    <EditableCell
                      value={filledRow["작업자"]}
                      rowKey={rowKey}
                      field="작업자"
                      editing={isEditingCell(rowKey, "작업자")}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      onStartEdit={startEdit}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                    />

                    <EditableCell
                      value={filledRow["no"]}
                      rowKey={rowKey}
                      field="no"
                      editing={isEditingCell(rowKey, "no")}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      onStartEdit={startEdit}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                    />

                    <EditableCell
                      value={filledRow["동작요소"]}
                      rowKey={rowKey}
                      field="동작요소"
                      editing={isEditingCell(rowKey, "동작요소")}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      onStartEdit={startEdit}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                    />

                    <EditableCell
                      value={filledRow["반복횟수"]}
                      rowKey={rowKey}
                      field="반복횟수"
                      editing={isEditingCell(rowKey, "반복횟수")}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      onStartEdit={startEdit}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                      alignRight
                    />

                    <EditableCell
                      value={filledRow["SEC"]}
                      rowKey={rowKey}
                      field="SEC"
                      editing={isEditingCell(rowKey, "SEC")}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      onStartEdit={startEdit}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                      alignRight
                    />

                    <EditableCell
                      value={filledRow["TOTAL"]}
                      rowKey={rowKey}
                      field="TOTAL"
                      editing={isEditingCell(rowKey, "TOTAL")}
                      inputValue={inputValue}
                      setInputValue={setInputValue}
                      onStartEdit={startEdit}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                      alignRight
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ContextMenu
        open={menuOpen}
        x={menuPos.x}
        y={menuPos.y}
        onClose={closeMenu}
        onAction={handleMenuAction}
      />
    </div>
  );
}
