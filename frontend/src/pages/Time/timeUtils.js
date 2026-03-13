export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatNumber(value) {
  return (Math.round(value * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildGroupOrder(rows) {
  const seen = new Set();
  const order = [];

  for (const row of rows) {
    const groupKey = row.__groupKey;
    if (!groupKey || seen.has(groupKey)) continue;
    seen.add(groupKey);
    order.push(groupKey);
  }

  return order;
}

export function buildGroupRowsMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const groupKey = row.__groupKey;
    if (!map.has(groupKey)) map.set(groupKey, []);
    map.get(groupKey).push(row);
  }
  return map;
}

export function getSummary(processedRows, groupOrder) {
  let secSum = 0;
  let totalSum = 0;
  const workers = new Set();

  for (const row of processedRows) {
    secSum += toNumber(row["SEC"]);
    totalSum += toNumber(row["TOTAL"]);

    const worker = String(row["작업자"] ?? "").trim();
    if (worker) {
      workers.add(worker);
    }
  }

  return {
    processCount: groupOrder.length,
    workerCount: workers.size,
    secSum,
    totalSum,
  };
}

export function getGroupLabel(groupRows, fallbackIndex) {
  return (
    groupRows[0]?.__groupLabel ||
    groupRows[0]?.__sequenceGroupLabel ||
    `그룹 ${fallbackIndex + 1}`
  );
}
