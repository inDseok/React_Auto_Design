export const TIME_COLUMNS = [
  { key: "부품 기준", label: "부품 기준", width: "14%" },
  { key: "요소작업", label: "요소작업", width: "11%" },
  { key: "OPTION", label: "OPTION", width: "9%" },
  { key: "작업자", label: "작업자", width: "7%" },
  { key: "no", label: "no", width: "6%" },
  { key: "동작요소", label: "동작요소", width: "28%" },
  { key: "repeatWeight", label: "반복횟수 가중치", width: "10%" },
  { key: "SEC", label: "SEC", width: "7.5%" },
  { key: "TOTAL", label: "TOTAL", width: "7.5%" },
];

export const TIME_TABLE_MIN_WIDTH = 1240;
export const TIME_MIN_COLUMN_WIDTH = 72;

export function getInitialTimeColumnWidths() {
  return TIME_COLUMNS.map((column) => {
    if (typeof column.width === "string" && column.width.endsWith("%")) {
      return (parseFloat(column.width) / 100) * TIME_TABLE_MIN_WIDTH;
    }
    return Number(column.width) || TIME_MIN_COLUMN_WIDTH;
  });
}
