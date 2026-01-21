import React, { useEffect, useState } from "react";
import AssemblySelector from "./AssemblySelector";
import AssemblyTable from "./AssemblyTable";
import { useAssemblyData } from "./useAssemblyData";
import {
  insertSameGroupRow, insertNewGroupRow,
  deleteRow,
  deleteGroup,
  updateCell,
  deleteOptionGroup,
} from "./rowActions";
import { useApp } from "../../state/AppContext";
import { useSearchParams } from "react-router-dom";

const API_BASE = "http://localhost:8000/api/assembly";

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
    runAutoMatch,
  } = useAssemblyData();
  
  const [params] = useSearchParams();
  const bomId = params.get("bomId");
  const spec = params.get("spec");

  const { state, actions } = useApp();

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
            const saved = await loadSavedRows(bomId, spec);
            if (saved.length > 0) {
              const restored = saved.map((row) => ({
                ...row,
                __groupKey: row["부품 기준"],
                __isNew: false,
              }));
              setRows(restored);
            }
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
  const handleInsertSameGroup = (rowId) => {
    setRows((prev) => insertSameGroupRow(prev, rowId));
  };
  
  const handleInsertNewGroup = (rowId) => {
    setRows((prev) => insertNewGroupRow(prev, rowId));
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
  
      // 작업자 컬럼: 값 입력일 때만 그룹 전파
      if (
        field === "작업자" &&
        value !== "" &&               // 비어있지 않고
        value !== target[field]      // 실제로 바뀌었고
      ) {
        return prev.map((r) => {
          if (
            r["부품 기준"] === target["부품 기준"] &&
            r["OPTION"] === target["OPTION"]
          ) {
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
    

      const autoRows = added.map((row) => ({
        id: crypto.randomUUID(),
        ...row,
        __groupKey: row["부품 기준"],
        __isNew: false,
    }));
  
    setRows((prev) => [...prev, ...autoRows]);
  };
  
  const handleReset = () => {
    setSelectedSheet("");
    setSelectedPart("");
    setSelectedOption("");
    setRows([]);
  };
  
  const handleDeleteOptionGroup = (partKey, optionValue) => {
    setRows((prev) => deleteOptionGroup(prev, partKey, optionValue));
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
        onAutoMatch={handleAutoMatch}
        onReset={handleReset}
      />

      <AssemblyTable
        rows={rows}
        onInsertSameGroup={handleInsertSameGroup}
        onInsertNewGroup={handleInsertNewGroup}
        onDeleteRow={handleDeleteRow}
        onDeleteGroup={handleDeleteGroup}
        onCellChange={handleCellChange}
        onRowsChange={(nextRows) => setRows(nextRows)}
        onDeleteOptionGroup={handleDeleteOptionGroup}
      />

    </div>
  );
}

export default AssemblyPage;
