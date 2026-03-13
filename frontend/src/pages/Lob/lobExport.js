import { CATEGORY_META, CATEGORY_ORDER, formatRatio, formatTimeCell } from "./lobUtils";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildWorkerChartSvg(workerStats, maxTime) {
  const chartHeight = 320;
  const chartWidth = Math.max(760, workerStats.length * 96);
  const barAreaHeight = 220;
  const barWidth = 28;
  const baseY = 250;
  const leftPad = 56;
  const gap = 68;

  const bars = workerStats.map((worker, index) => {
    const x = leftPad + index * gap;
    const totalHeight = maxTime > 0 ? (worker.totalTime / maxTime) * barAreaHeight : 0;
    let accumulated = 0;

    const segments = CATEGORY_ORDER.map((category) => {
      const segmentHeight =
        worker.totalTime > 0 ? (worker.categoryTimes[category] / worker.totalTime) * totalHeight : 0;
      const y = baseY - accumulated - segmentHeight;
      accumulated += segmentHeight;

      return `
        <rect
          x="${x}"
          y="${y}"
          width="${barWidth}"
          height="${Math.max(segmentHeight, worker.categoryTimes[category] > 0 ? 4 : 0)}"
          rx="8"
          ry="8"
          fill="${CATEGORY_META[category].color}"
        />
      `;
    }).join("");

    const ratios = CATEGORY_ORDER.map((category, ratioIndex) => `
      <text x="${x + barWidth / 2}" y="${286 + ratioIndex * 14}" text-anchor="middle" font-size="11" fill="#526071">
        ${escapeHtml(category)} ${escapeHtml(formatRatio(worker.ratios[category]))}
      </text>
    `).join("");

    return `
      <text x="${x + barWidth / 2}" y="20" text-anchor="middle" font-size="11" fill="#526071">
        ${escapeHtml(formatTimeCell(worker.totalTime))} sec
      </text>
      <rect x="${x}" y="${baseY - totalHeight}" width="${barWidth}" height="${Math.max(totalHeight, 8)}" rx="10" ry="10" fill="#e9eff5" />
      ${segments}
      <text x="${x + barWidth / 2}" y="268" text-anchor="middle" font-size="12" font-weight="700" fill="#102a43">
        ${escapeHtml(worker.worker)}
      </text>
      ${ratios}
    `;
  }).join("");

  const legend = CATEGORY_ORDER.map((category, index) => `
    <rect x="${leftPad + index * 92}" y="34" width="12" height="12" rx="6" ry="6" fill="${CATEGORY_META[category].color}" />
    <text x="${leftPad + 18 + index * 92}" y="44" font-size="12" fill="#334e68">${escapeHtml(category)}</text>
  `).join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}">
      <rect width="100%" height="100%" fill="#ffffff" />
      <text x="${leftPad}" y="20" font-size="18" font-weight="700" fill="#102a43">작업자 LOB 그래프</text>
      <text x="${leftPad}" y="62" font-size="12" fill="#526071">작업자별 총 시간을 기준으로 가치, 필비, 낭비 시간을 누적 세로 막대로 표시합니다.</text>
      ${legend}
      <line x1="${leftPad - 16}" y1="${baseY}" x2="${chartWidth - 24}" y2="${baseY}" stroke="#cbd5e1" stroke-width="1" />
      ${bars}
    </svg>
  `;
}

function buildSummaryTable(workerStats, movementTimes) {
  const rows = [
    { key: "가치", label: "가치 작업시간" },
    { key: "필비", label: "필비 작업시간" },
    { key: "낭비", label: "낭비 작업시간" },
    { key: "이동시간", label: "이동시간", input: true },
    { key: "공수 합계", label: "공수 합계", total: true },
    { key: "실동율", label: "실동율", ratio: true },
  ];

  const grandTotals = workerStats.reduce(
    (acc, worker) => {
      const movementTime = movementTimes[worker.worker] ?? 0;
      const laborSum = worker.totalTime + movementTime;
      acc["가치"] += worker.categoryTimes["가치"];
      acc["필비"] += worker.categoryTimes["필비"];
      acc["낭비"] += worker.categoryTimes["낭비"];
      acc["이동시간"] += movementTime;
      acc["공수 합계"] += laborSum;
      return acc;
    },
    { "가치": 0, "필비": 0, "낭비": 0, "이동시간": 0, "공수 합계": 0 }
  );

  const totalEfficiency =
    grandTotals["공수 합계"] > 0 ? (grandTotals["가치"] / grandTotals["공수 합계"]) * 100 : 0;

  return `
    <table>
      <tr>
        <th>항목</th>
        ${workerStats.map((worker) => `<th>${escapeHtml(worker.worker)}</th>`).join("")}
        <th>전체</th>
      </tr>
      ${rows.map((rowDef) => `
        <tr>
          <td>${escapeHtml(rowDef.label)}</td>
          ${workerStats.map((worker) => {
            const movementTime = movementTimes[worker.worker] ?? 0;
            const laborSum = worker.totalTime + movementTime;
            const efficiency = laborSum > 0 ? (worker.categoryTimes["가치"] / laborSum) * 100 : 0;
            const value = rowDef.input
              ? formatTimeCell(movementTime)
              : rowDef.total
                ? formatTimeCell(laborSum)
                : rowDef.ratio
                  ? formatRatio(efficiency)
                  : formatTimeCell(worker.categoryTimes[rowDef.key] ?? 0);

            return `<td class="num">${escapeHtml(value)}</td>`;
          }).join("")}
          <td class="num">${escapeHtml(
            rowDef.input
              ? formatTimeCell(grandTotals["이동시간"])
              : rowDef.total
                ? formatTimeCell(grandTotals["공수 합계"])
                : rowDef.ratio
                  ? formatRatio(totalEfficiency)
                  : formatTimeCell(grandTotals[rowDef.key] ?? 0)
          )}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function buildDetailTables(workerStats) {
  return workerStats.map((worker) => {
    let currentPart = "";
    let currentWork = "";
    let currentOption = "";

    const rows = worker.rows.map((item) => {
      if (item.row["부품 기준"]) currentPart = item.row["부품 기준"];
      if (item.row["요소작업"]) currentWork = item.row["요소작업"];
      if (item.row["OPTION"]) currentOption = item.row["OPTION"];

      return `
        <tr>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(currentPart || "-")}</td>
          <td>${escapeHtml(currentWork || "-")}</td>
          <td>${escapeHtml(currentOption || "-")}</td>
          <td>${escapeHtml(item.row["동작요소"] || "-")}</td>
          <td class="num">${escapeHtml(item.row["반복횟수"] || "-")}</td>
          <td class="num">${escapeHtml(item.row["SEC"] || "-")}</td>
          <td class="num">${escapeHtml(formatTimeCell(item.time))} sec</td>
        </tr>
      `;
    }).join("");

    return `
      <h3>${escapeHtml(worker.worker)}</h3>
      <table>
        <tr>
          <th>분류</th>
          <th>부품 기준</th>
          <th>요소작업</th>
          <th>OPTION</th>
          <th>동작요소</th>
          <th>반복횟수</th>
          <th>SEC</th>
          <th>TOTAL 반영시간</th>
        </tr>
        ${rows}
      </table>
    `;
  }).join("<div style='height:24px'></div>");
}

export function downloadWorkerLobExcel({ spec, workerStats, movementTimes }) {
  const maxTime = workerStats.reduce((max, worker) => Math.max(max, worker.totalTime), 0);
  const chartSvg = buildWorkerChartSvg(workerStats, maxTime);
  const summaryTable = buildSummaryTable(workerStats, movementTimes);
  const detailTables = buildDetailTables(workerStats);

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Worker LOB</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #243b53; }
          h1, h2, h3 { margin: 0 0 12px; }
          .section { margin-bottom: 28px; }
          table { border-collapse: collapse; width: 100%; min-width: 960px; }
          th, td { border: 1px solid #d9e2ec; padding: 8px 10px; }
          th { background: #f0f4f8; text-align: left; }
          td.num, th.num { text-align: right; }
        </style>
      </head>
      <body>
        <div class="section">
          <h1>작업자 LOB 분석표</h1>
          <div>사양: ${escapeHtml(spec)}</div>
        </div>
        <div class="section">
          ${chartSvg}
        </div>
        <div class="section">
          <h2>작업자 요약 표</h2>
          ${summaryTable}
        </div>
        <div class="section">
          <h2>작업자 상세 표</h2>
          ${detailTables}
        </div>
      </body>
    </html>
  `;

  const blob = new Blob([`\ufeff${html}`], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `worker_lob_${spec || "export"}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
