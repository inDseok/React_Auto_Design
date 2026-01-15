import React, { useEffect, useState } from "react";
import AssemblySelector from "./AssemblySelector";
import AssemblyTable from "./AssemblyTable";
import { useAssemblyData } from "./useAssemblyData";
import {
  insertRowBelow,
  deleteRow,
  deleteGroup,
  updateCell,
} from "./rowActions";

function AssemblyPage() {
  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedPart, setSelectedPart] = useState("");
  const [selectedOption, setSelectedOption] = useState("");

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
  } = useAssemblyData();

  // 초기 로딩
  useEffect(() => {
    loadSheets();

    (async () => {
      const saved = await loadSavedRows();
      if (saved.length > 0) {
        const restored = saved.map((row) => ({
          ...row,
          __groupKey: row["부품 기준"], // ⭐ 그룹 기준
          __isNew: false,
        }));
        setRows(restored);
      }
    })();
  }, []);

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

    const newRows = tasks.map((t) => ({
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

      __groupKey: t["부품 기준"], // ⭐ 그룹 병합 기준
      __isNew: false,
    }));

    setRows((prev) => [...prev, ...newRows]);
  };

  // 행 조작
  const handleInsertBelow = (rowId) => {
    setRows((prev) => insertRowBelow(prev, rowId));
  };

  const handleDeleteRow = (rowId) => {
    setRows((prev) => deleteRow(prev, rowId));
  };

  const handleDeleteGroup = (groupKey) => {
    setRows((prev) => deleteGroup(prev, groupKey));
  };

  const handleCellChange = (rowId, field, value) => {
    setRows((prev) => updateCell(prev, rowId, field, value));
  };

  // 저장
  const handleSave = async () => {
    const ok = await saveRowsToDB(rows);
    if (ok) alert("저장 완료");
    else alert("저장 실패");
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>조립 총 공수</h2>

      <AssemblySelector
        sheets={sheets}
        parts={parts}
        options={options}
        selectedSheet={selectedSheet}
        selectedPart={selectedPart}
        selectedOption={selectedOption}
        onChangeSheet={setSelectedSheet}
        onChangePart={setSelectedPart}
        onChangeOption={setSelectedOption}
        onAdd={handleAddFromDB}
        onSave={handleSave}
      />

      <AssemblyTable
        rows={rows}
        onInsertBelow={handleInsertBelow}
        onDeleteRow={handleDeleteRow}
        onDeleteGroup={handleDeleteGroup}
        onCellChange={handleCellChange}
      />
    </div>
  );
}

export default AssemblyPage;
