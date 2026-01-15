export function computeRowspanInfo(rows) {
    if (!Array.isArray(rows)) return [];
  
    const result = rows.map((r) => ({ ...r }));
  
    const columns = ["부품 기준", "요소작업", "OPTION"];
  
    // 1️⃣ 값 상속 (엑셀 빈칸만)
    for (let col of columns) {
      let lastValue = null;
  
      for (let i = 0; i < result.length; i++) {
        const row = result[i];
  
        if (row.__isNew) {
          lastValue = null;
          continue;
        }
  
        const val = row[col];
  
        if (val === "" || val === null || val === undefined) {
          if (lastValue !== null) {
            row[col] = lastValue;
          }
        } else {
          lastValue = val;
        }
      }
    }
  
    // 2️⃣ rowspan 계산 초기화
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
  
        // 새 행이면 무조건 단독
        if (row.__isNew) {
          row[showKey] = true;
          row[spanKey] = 1;
          i++;
          continue;
        }
  
        let j = i + 1;
  
        while (
          j < result.length &&
          !result[j].__isNew &&
          result[j][col] === row[col]
        ) {
          j++;
        }
  
        const span = j - i;
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
  