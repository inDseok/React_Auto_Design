// src/.../groupUtils.js
// 최종본: "부품 기준", "요소작업", "OPTION"은 서로 독립 병합
// - 병합/상속은 같은 __groupKey 안에서만 수행
// - __isNew === true 행은 상속/병합 모두 금지(항상 단독)
// - 상속은 "엑셀 빈칸"만 채움(실제 값이 있으면 유지)
// - 삭제해도 아래 행은 같은 그룹 내에서 계속 상속되어 "이어져 보임" (요구사항 YES)

export function computeRowspanInfo(rows) {
  if (!Array.isArray(rows)) return [];

  const result = rows.map((r) => ({ ...r }));
  const columns = ["부품 기준", "요소작업", "OPTION"];

  const getMergeUnitKey = (row) => row.__partInstanceKey ?? row["부품 기준"] ?? null;

  // 1) 값 상속: 같은 그룹(__groupKey) 안에서만, __isNew 제외
  for (const col of columns) {
    let lastValue = null;
    let lastGroupKey = null;
  
    for (let i = 0; i < result.length; i++) {
      const row = result[i];
  
      if (row.__isNew) {
        continue;
      }
  
      const gk = row.__groupKey ?? null;
  
      if (gk !== lastGroupKey) {
        lastGroupKey = gk;
      }
  
      const val = row[col];
  
      if ((val === "" || val === null || val === undefined) && lastValue !== null) {
        row[col] = lastValue;
      } else {
        lastValue = val;
      }
    }
  }
  

  // 2) rowspan 메타 초기화
  for (const row of result) {
    row.__showPart = false;
    row.__partRowspan = 1;

    row.__showTask = false;
    row.__taskRowspan = 1;

    row.__showOption = false;
    row.__optionRowspan = 1;
  }

  // 3) 컬럼별 병합: 같은 그룹(__groupKey) + 같은 값만 병합
  function processColumn(col, showKey, spanKey) {
    let i = 0;

    while (i < result.length) {
      const row = result[i];

      // 새 행은 항상 단독
      if (row.__isNew) {
        row[showKey] = true;
        row[spanKey] = 1;
        i += 1;
        continue;
      }

      const baseGroupKey = row.__groupKey ?? null;
      const baseMergeUnitKey = getMergeUnitKey(row);

      let j = i + 1;
      while (j < result.length) {
        const next = result[j];

        // 새 행이면 병합 경계
        if (next.__isNew) break;

        // 그룹이 바뀌면 병합 경계
        if ((next.__groupKey ?? null) !== baseGroupKey) break;

        // 같은 시퀀스 그룹 안이라도 노드 인스턴스가 다르면 병합하지 않음
        if (getMergeUnitKey(next) !== baseMergeUnitKey) break;

        // 값이 다르면 병합 경계
        if (next[col] !== row[col]) break;

        // 요소작업/OPTION은 부품 기준이 다르면 병합하지 않음
        if (
          (col === "요소작업" || col === "OPTION") &&
          next["부품 기준"] !== row["부품 기준"]
        ) break;

        j += 1;
      }

      const span = j - i;
      row[showKey] = true;
      row[spanKey] = span;

      for (let k = i + 1; k < j; k++) {
        result[k][showKey] = false;
        result[k][spanKey] = 1;
      }

      i = j;
    }
  }

  processColumn("부품 기준", "__showPart", "__partRowspan");
  processColumn("요소작업", "__showTask", "__taskRowspan");
  processColumn("OPTION", "__showOption", "__optionRowspan");

  return result;
}
