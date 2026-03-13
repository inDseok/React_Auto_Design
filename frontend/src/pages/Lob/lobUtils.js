export const CATEGORY_META = {
  "가치": { color: "#0f766e", bg: "#ccfbf1" },
  "필비": { color: "#b45309", bg: "#fef3c7" },
  "낭비": { color: "#b91c1c", bg: "#fee2e2" },
};

export const CATEGORY_ORDER = ["가치", "필비", "낭비"];

export function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function getTimeValue(row) {
  const total = toNumber(row["TOTAL"]);
  if (total > 0) return total;

  const sec = toNumber(row["SEC"]);
  const repeat = toNumber(row["반복횟수"]);
  if (sec > 0 && repeat > 0) return sec * repeat;

  return sec;
}

export function getCategory(noValue) {
  const normalized = String(noValue ?? "").trim();
  if (CATEGORY_ORDER.includes(normalized)) return normalized;
  return null;
}

export function formatTime(value) {
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} sec`;
}

export function formatRatio(value) {
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function formatTimeCell(value) {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getWorkerSortValue(worker) {
  const normalized = String(worker ?? "").trim();
  const matched = normalized.match(/\d+/);
  if (matched) {
    return { number: Number(matched[0]), text: normalized };
  }

  return { number: Number.POSITIVE_INFINITY, text: normalized };
}

export function buildWorkerStats(rows) {
  const workerMap = new Map();

  rows.forEach((row) => {
    const worker = String(row["작업자"] ?? "").trim() || "미지정";
    const category = getCategory(row["no"]);
    if (!category) return;

    const time = getTimeValue(row);
    if (!workerMap.has(worker)) {
      workerMap.set(worker, {
        worker,
        totalTime: 0,
        rowCount: 0,
        categoryTimes: {
          "가치": 0,
          "필비": 0,
          "낭비": 0,
        },
        rows: [],
      });
    }

    const entry = workerMap.get(worker);
    entry.totalTime += time;
    entry.rowCount += 1;
    entry.categoryTimes[category] += time;
    entry.rows.push({
      id: row.id || `${worker}-${entry.rowCount}`,
      category,
      time,
      row,
    });
  });

  return Array.from(workerMap.values())
    .map((entry) => ({
      ...entry,
      ratios: {
        "가치": entry.totalTime > 0 ? (entry.categoryTimes["가치"] / entry.totalTime) * 100 : 0,
        "필비": entry.totalTime > 0 ? (entry.categoryTimes["필비"] / entry.totalTime) * 100 : 0,
        "낭비": entry.totalTime > 0 ? (entry.categoryTimes["낭비"] / entry.totalTime) * 100 : 0,
      },
    }))
    .sort((a, b) => {
      const left = getWorkerSortValue(a.worker);
      const right = getWorkerSortValue(b.worker);

      if (left.number !== right.number) {
        return left.number - right.number;
      }

      return left.text.localeCompare(right.text, "ko");
    });
}

export function buildSummary(workerStats) {
  const totals = {
    workers: workerStats.length,
    totalTime: 0,
    totalRows: 0,
    categoryTimes: {
      "가치": 0,
      "필비": 0,
      "낭비": 0,
    },
  };

  workerStats.forEach((worker) => {
    totals.totalTime += worker.totalTime;
    totals.totalRows += worker.rowCount;
    CATEGORY_ORDER.forEach((category) => {
      totals.categoryTimes[category] += worker.categoryTimes[category];
    });
  });

  return totals;
}
