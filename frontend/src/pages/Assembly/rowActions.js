import { v4 as uuidv4 } from "uuid";

// -----------------------------
// 특정 행 아래에 빈 행 추가
// -----------------------------

export function insertSameGroupRow(rows, targetRowId) {
  const idx = rows.findIndex((r) => r.id === targetRowId);
  if (idx === -1) return rows;

  const target = rows[idx];

  const newRow = {
    id: uuidv4(),

    "부품 기준": target["부품 기준"],
    "요소작업": target["요소작업"],
    "OPTION": target["OPTION"],

    "작업자": "",
    "no": "",
    "동작요소": "",
    "반복횟수": "",
    "SEC": "",
    "TOTAL": "",

    __groupKey: target.__groupKey,
    __isNew: false,
  };

  const newRows = [...rows];
  newRows.splice(idx + 1, 0, newRow);
  return newRows;
}

export function insertNewGroupRow(rows, targetRowId) {
  const idx = rows.findIndex((r) => r.id === targetRowId);
  if (idx === -1) return rows;

  const newRow = {
    id: uuidv4(),

    "부품 기준": "",
    "요소작업": "",
    "OPTION": "",

    "작업자": "",
    "no": "",
    "동작요소": "",
    "반복횟수": "",
    "SEC": "",
    "TOTAL": "",

    __groupKey: uuidv4(),
    __isNew: true,
  };

  const newRows = [...rows];
  newRows.splice(idx + 1, 0, newRow);
  return newRows;
}


// -----------------------------
// 특정 행 삭제
// -----------------------------
// rowActions.js
import { computeRowspanInfo } from "./groupUtils";

export function deleteRow(rows, targetRowId) {
  const idx = rows.findIndex((r) => r.id === targetRowId);
  if (idx === -1) return rows;

  // 화면에 보이는(상속 포함) 값을 먼저 계산해둠
  const effective = computeRowspanInfo(rows);
  const removedEff = effective.find((r) => r.id === targetRowId);

  const removedRaw = rows[idx];
  const nextRaw = rows[idx + 1];

  // 우선 삭제 대상 제거
  const nextRows = rows.filter((r) => r.id !== targetRowId);

  // 아래 행이 있으면, "상속이 끊기지 않도록" 값을 승격(실데이터로 주입)
  if (
    removedEff &&
    nextRaw &&
    !nextRaw.__isNew &&
    !removedRaw.__isNew &&
    nextRaw.__groupKey === removedRaw.__groupKey
  ) {
    const cols = ["부품 기준", "요소작업", "OPTION"];

    // nextRows에서 nextRaw를 찾아서 갱신
    const nextIdx = nextRows.findIndex((r) => r.id === nextRaw.id);
    if (nextIdx !== -1) {
      const patchedNext = { ...nextRows[nextIdx] };

      for (const col of cols) {
        const nextVal = patchedNext[col];
        const removedVal = removedEff[col];

        // 다음 행이 원래 빈칸(엑셀 병합 빈칸)이면, 삭제된 행의 "보이는 값"을 주입
        if (
          (nextVal === "" || nextVal === null || nextVal === undefined) &&
          removedVal !== "" &&
          removedVal !== null &&
          removedVal !== undefined
        ) {
          patchedNext[col] = removedVal;
        }
      }

      nextRows[nextIdx] = patchedNext;
    }
  }

  return nextRows;
}


// -----------------------------
// 그룹 전체 삭제 (부품 기준 단위)
// -----------------------------
export function deleteGroup(rows, groupKey) {
  return rows.filter((r) => r.__groupKey !== groupKey);
}

export function deleteOptionGroup(rows, partKey, optionValue) {
  return rows.filter(
    (r) => !(r.__groupKey === partKey && r["OPTION"] === optionValue)
  );
}

// -----------------------------
// 셀 값 수정
// -----------------------------
export function updateCell(rows, rowId, field, value) {
  return rows.map((row) => {
    if (row.id !== rowId) return row;

    const updated = { ...row, [field]: value };

    // SEC / 반복횟수 변경 시에만 TOTAL 자동 갱신
    if (field === "SEC" || field === "반복횟수") {
      const sec = Number(updated["SEC"]) || 0;
      const cnt = Number(updated["반복횟수"]) || 0;
      updated["TOTAL"] = sec * cnt;
    }

    // TOTAL 직접 수정 가능
    return updated;
  });
}



