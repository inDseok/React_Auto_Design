export function computeRowspanInfo(rows) {
  if (!Array.isArray(rows)) return [];

  const result = rows.map((r) => ({ ...r }));
  const columns = ["부품 기준", "요소작업", "OPTION"];

  // 1) 값 상속 (같은 그룹 내에서만, __isNew 제외)
  for (let col of columns) {
    let lastValue = null;
    let lastGroupKey = null;

    for (let i = 0; i < result.length; i++) {
      const row = result[i];

      if (row.__isNew) {
        lastValue = null;
        lastGroupKey = null;
        continue;
      }

      const val = row[col];

      if (
        (val === "" || val === null || val === undefined) &&
        lastValue !== null &&
        row.__groupKey === lastGroupKey
      ) {
        row[col] = lastValue;
      } else {
        lastValue = val;
        lastGroupKey = row.__groupKey;
      }
    }
  }

  // 2) rowspan 초기화
  for (let row of result) {
    row.__showPart = false;
    row.__partRowspan = 1;

    row.__showTask = false;
    row.__taskRowspan = 1;

    row.__showOption = false;
    row.__optionRowspan = 1;
  }

  function processColumn(col, showKey, spanKey) {
    let i = 0;

    while (i < result.length) {
      const row = result[i];

      // 새 그룹은 무조건 단독
      if (row.__isNew) {
        row[showKey] = true;
        row[spanKey] = 1;
        i++;
        continue;
      }

      let j = i + 1;
      let span = 1;

      while (j < result.length) {
        const next = result[j];

        // 새 그룹이면 병합 끊기
        if (next.__isNew) break;

        // 다른 그룹이면 병합 끊기
        if (next.__groupKey !== row.__groupKey) break;

        if (next[col] === row[col]) {
          span++;
          j++;
        } else {
          break;
        }
      }

      row[showKey] = true;
      row[spanKey] = span;

      for (let k = i + 1; k < j; k++) {
        result[k][showKey] = false;
      }

      i = j;
    }
  }

  processColumn("부품 기준", "__showPart", "__partRowspan");
  processColumn("요소작업", "__showTask", "__taskRowspan");
  processColumn("OPTION", "__showOption", "__optionRowspan");

  return result;
}
