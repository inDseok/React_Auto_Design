import React from "react";

function AssemblySelector({
  sheets,
  parts,
  options,
  insertPositions,

  selectedSheet,
  selectedPart,
  selectedOption,
  selectedInsertPosition,

  onChangeSheet,
  onChangePart,
  onChangeOption,
  onChangeInsertPosition,

  onAdd,
  onLoad,
  onSave,
  onAutoMatch,
  onRecommendWorkers,
  onReset,
  canSave = true,
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      {/* 시트 선택 */}
      <select
        value={selectedSheet}
        onChange={(e) => onChangeSheet(e.target.value)}
      >
        <option value="">시트 선택</option>
        {sheets.map((sheet) => (
          <option key={sheet} value={sheet}>
            {sheet}
          </option>
        ))}
      </select>

      {/* 부품 기준 선택 */}
      <select
        value={selectedPart}
        onChange={(e) => onChangePart(e.target.value)}
        disabled={!selectedSheet}
      >
        <option value="">부품 기준 선택</option>
        {parts.map((part) => (
          <option key={part} value={part}>
            {part}
          </option>
        ))}
      </select>

      {/* OPTION 선택 */}
      <select
        value={selectedOption}
        onChange={(e) => onChangeOption(e.target.value)}
        disabled={!selectedPart}
      >
        <option value="">OPTION 선택</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      <select
        value={selectedInsertPosition}
        onChange={(e) => onChangeInsertPosition(e.target.value)}
      >
        {(insertPositions || []).map((pos) => (
          <option key={pos.value} value={pos.value}>
            {pos.label}
          </option>
        ))}
      </select>

      <button onClick={onAdd}>추가</button>
      <button onClick={onLoad}>불러오기</button>
      <button onClick={onSave} disabled={!canSave}>저장</button>
      <button onClick={onAutoMatch}>자동 추가</button>
      <button onClick={onRecommendWorkers} disabled={!canSave}>작업자 추천</button>
      <button onClick={onReset}>초기화</button>

    </div>
  );
}

export default AssemblySelector;
