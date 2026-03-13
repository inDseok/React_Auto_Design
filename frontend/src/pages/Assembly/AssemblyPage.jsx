import React, { useEffect, useState } from "react";
import AssemblySelector from "./AssemblySelector";
import AssemblyTable from "./AssemblyTable";
import { useAssemblyData } from "./useAssemblyData";
import { computeRowspanInfo } from "./groupUtils";
import {
  insertSameGroupRow, insertNewGroupRow, insertNewGroupAt,
  deleteRow,
  deleteGroup,
  updateCell,
  deleteOptionGroup,
} from "./rowActions";
import { useApp } from "../../state/AppContext";
import { useSearchParams } from "react-router-dom";

const API_BASE = "http://localhost:8000/api/assembly";

function formatDecimalCell(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toFixed(2);
}

function normalizeAssemblyRow(row) {
  return {
    ...row,
    "SEC": formatDecimalCell(row["SEC"]),
    "TOTAL": formatDecimalCell(row["TOTAL"]),
  };
}

function AssemblyPage() {
  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedPart, setSelectedPart] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [selectedInsertPosition, setSelectedInsertPosition] = useState("end");
  const [rows, setRows] = useState([]);

  const {
    sheets,
    parts,
    options,
    loadSheets,
    loadParts,
    loadOptions,
    loadTasks,
    saveRowsToDB,
    loadSavedRows,
    runAutoMatch,
  } = useAssemblyData();
  
  const [params] = useSearchParams();
  const bomId = params.get("bomId");
  const spec = params.get("spec");

  const { state, actions } = useApp();

  const restoreSavedRows = async () => {
    if (!bomId || !spec) {
      alert("BOM 또는 사양 정보가 없습니다.");
      return;
    }

    const saved = await loadSavedRows(bomId, spec);
    if (!saved.length) {
      alert("저장된 assembly.json 데이터가 없습니다.");
      return;
    }

    const restored = saved.map((row) => normalizeAssemblyRow({
      ...row,
      __groupKey: row.__groupKey || row["부품 기준"],
      __groupLabel: row.__groupLabel || row.__sequenceGroupLabel || "",
      __sourceSheet: row.__sourceSheet || row.sourceSheet || "",
      __isNew: false,
    }));

    setRows(restored);
  };

  useEffect(() => {
    if (bomId) actions.setBomContext(bomId);
    if (spec) actions.setSpec(spec);
  }, [bomId, spec]);

  // 초기 로딩
  useEffect(() => {
  
    const init = async () => {
      try {
        loadSheets();
  
        const sessionRes = await fetch(`${API_BASE}/session-info`, {
          credentials: "include",
        });
  
        if (sessionRes.ok) {
          const session = await sessionRes.json();
  
          if (session.ok) {
            await restoreSavedRows();
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
  
    init();
  }, [bomId, spec]);
  
  

  // 시트 변경 → part 로딩
  useEffect(() => {
    if (!selectedSheet) {
      setSelectedPart("");
      setSelectedOption("");
      return;
    }

    loadParts(selectedSheet);
    setSelectedPart("");
    setSelectedOption("");
  }, [selectedSheet]);

  // part 변경 → option 로딩
  useEffect(() => {
    if (!selectedSheet || !selectedPart) {
      setSelectedOption("");
      return;
    }

    loadOptions(selectedSheet, selectedPart);
    setSelectedOption("");
  }, [selectedPart]);

  // DB에서 tasks 추가
  const handleAddFromDB = async () => {
    if (!selectedSheet || !selectedPart || !selectedOption) {
      alert("시트, 부품 기준, OPTION을 모두 선택하세요.");
      return;
    }

    const tasks = await loadTasks(
      selectedSheet,
      selectedPart,
      selectedOption
    );

    if (tasks.length === 0) {
      alert("해당 조건에 맞는 작업이 없습니다.");
      return;
    }

    setRows((prev) => {
      const targetGroupKey =
        selectedInsertPosition === "end" ? crypto.randomUUID() : selectedInsertPosition;
      const targetGroupLabel =
        prev.find((row) => row.__groupKey === targetGroupKey)?.__groupLabel || "";
      const newRows = tasks.map((t) => normalizeAssemblyRow({
        id: crypto.randomUUID(),

        // 엑셀 원본 컬럼 그대로
        "부품 기준": t["부품 기준"],
        "요소작업": t["요소작업"],
        "OPTION": t["OPTION"],
        "작업자": t["작업자"],
        "no": t["no"],
        "동작요소": t["동작요소"],
        "반복횟수": t["반복횟수"],
        "SEC": t["SEC"],
        "TOTAL": t["TOTAL"],

        __groupKey: targetGroupKey,
        __groupLabel: targetGroupLabel,
        __sourceSheet: selectedSheet,
        __isNew: false,
      }));

      if (selectedInsertPosition === "end") {
        return [...prev, ...newRows];
      }

      const lastIndexInGroup = prev.reduce(
        (lastIndex, row, index) =>
          row.__groupKey === targetGroupKey ? index : lastIndex,
        -1
      );

      if (lastIndexInGroup === -1) {
        return [...prev, ...newRows];
      }

      const insertIndex = lastIndexInGroup + 1;
      const nextRows = [...prev];
      nextRows.splice(insertIndex, 0, ...newRows);
      return nextRows;
    });
  };

  // 행 조작
  const handleInsertSameGroup = (rowId) => {
    setRows((prev) => insertSameGroupRow(prev, rowId));
  };
  
  const handleInsertNewGroup = (rowId) => {
    setRows((prev) => insertNewGroupRow(prev, rowId));
  };

  const handleInsertGroupAt = (insertIndex) => {
    setRows((prev) => insertNewGroupAt(prev, insertIndex));
  };
  
  const handleDeleteRow = (rowId) => {
    setRows((prev) => deleteRow(prev, rowId));
  };

  const handleDeleteGroup = (groupKey) => {
    setRows((prev) => deleteGroup(prev, groupKey));
  };

  const handleCellChange = (rowId, field, value) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === rowId);
      if (!target) return prev;

      const targetInstanceKey =
        target.__partInstanceKey ||
        `${target.__groupKey || ""}::${target["부품 기준"] || ""}::${target["OPTION"] || ""}`;
  
      // 작업자 컬럼: 값 입력일 때만 그룹 전파
      if (
        field === "작업자" &&
        value !== "" &&               // 비어있지 않고
        value !== target[field]      // 실제로 바뀌었고
      ) {
        return prev.map((r) => {
          const rowInstanceKey =
            r.__partInstanceKey ||
            `${r.__groupKey || ""}::${r["부품 기준"] || ""}::${r["OPTION"] || ""}`;

          if (rowInstanceKey === targetInstanceKey) {
            return { ...r, 작업자: value };
          }
          return r;
        });
      }
  
      // 기본: 개별 셀만 변경
      return updateCell(prev, rowId, field, value);
    });
  };
  
  
  

  // 저장
  const handleSave = async () => {
    if (!rows.length) {
      alert("저장할 조립 총공수 데이터가 없습니다.");
      return;
    }

    const ok = await saveRowsToDB(bomId, spec, rows);
    if (ok) alert("저장 완료");
    else alert("저장 실패");
  };

  const handleAutoMatch = async () => {
    const added = await runAutoMatch(bomId, spec);
  
    if (added.length === 0) {
      alert("자동 추가된 항목이 없습니다.");
      return;
    }
    

      const autoRows = added.map((row) => normalizeAssemblyRow({
        id: crypto.randomUUID(),
        ...row,
        __groupKey: row.__groupKey || row["부품 기준"],
        __groupLabel: row.__groupLabel || row.__sequenceGroupLabel || "",
        __sourceSheet: row.__sourceSheet || row.sourceSheet || "",
        __isNew: false,
      }));
  
    setRows(autoRows);
  };
  
  const handleReset = () => {
    setSelectedSheet("");
    setSelectedPart("");
    setSelectedOption("");
    setSelectedInsertPosition("end");
    setRows([]);
  };
  
  const handleDeleteOptionGroup = (partKey, optionValue) => {
    setRows((prev) => deleteOptionGroup(prev, partKey, optionValue));
  };

  const handleGroupLabelChange = (groupKey, value) => {
    setRows((prev) =>
      prev.map((row) =>
        row.__groupKey === groupKey
          ? { ...row, __groupLabel: value }
          : row
      )
    );
  };

  const insertPositions = (() => {
    if (rows.length === 0) {
      return [{ value: "end", label: "삽입 위치: 맨 뒤" }];
    }

    const processed = computeRowspanInfo(rows);
    const positions = [{ value: "end", label: "삽입 위치: 맨 뒤" }];
    const seen = new Set();

    processed.forEach((row) => {
      const groupKey = row.__groupKey;
      if (!groupKey || seen.has(groupKey)) return;
      seen.add(groupKey);

      const label =
        row.__groupLabel?.trim() ||
        row.__sequenceGroupLabel?.trim() ||
        row["부품 기준"]?.trim() ||
        `그룹 ${seen.size}`;

      positions.push({
        value: groupKey,
        label: `${label}`,
      });
    });

    return positions;
  })();

  useEffect(() => {
    const hasSelectedPosition = insertPositions.some(
      (pos) => pos.value === selectedInsertPosition
    );
    if (!hasSelectedPosition) {
      setSelectedInsertPosition(insertPositions[insertPositions.length - 1]?.value ?? "end");
    }
  }, [insertPositions, selectedInsertPosition]);
  
  return (
    <div style={{ padding: 20 }}>
      <h2>조립 총 공수</h2>

      <AssemblySelector
        sheets={sheets}
        parts={parts}
        options={options}
        insertPositions={insertPositions}
        selectedSheet={selectedSheet}
        selectedPart={selectedPart}
        selectedOption={selectedOption}
        selectedInsertPosition={selectedInsertPosition}
        onChangeSheet={setSelectedSheet}
        onChangePart={setSelectedPart}
        onChangeOption={setSelectedOption}
        onChangeInsertPosition={setSelectedInsertPosition}
        onAdd={handleAddFromDB}
        onLoad={restoreSavedRows}
        onSave={handleSave}
        onAutoMatch={handleAutoMatch}
        onReset={handleReset}
        canSave={rows.length > 0}
      />

      <AssemblyTable
        rows={rows}
        onInsertSameGroup={handleInsertSameGroup}
        onInsertNewGroup={handleInsertNewGroup}
        onInsertGroupAt={handleInsertGroupAt}
        onDeleteRow={handleDeleteRow}
        onDeleteGroup={handleDeleteGroup}
        onCellChange={handleCellChange}
        onRowsChange={(nextRows) => setRows(nextRows)}
        onDeleteOptionGroup={handleDeleteOptionGroup}
        onGroupLabelChange={handleGroupLabelChange}
      />

    </div>
  );
}

export default AssemblyPage;
