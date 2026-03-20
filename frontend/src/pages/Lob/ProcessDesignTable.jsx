import React from "react";

function formatValue(value, digits = 1, suffix = "") {
  if (!Number.isFinite(value)) return "";
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

function formatInteger(value, suffix = "") {
  if (!Number.isFinite(value)) return "";
  return `${Math.round(value).toLocaleString("ko-KR")}${suffix}`;
}

export function ProcessDesignTable({ metrics }) {
  const rows = [
    {
      no: 1,
      item: "택트타임 (TACT TIME)",
      detail: "실가용시간 ÷ 일 생산 요구수량(SPD)",
      unit: "초",
      std: formatValue(metrics.tactTimeSeconds, 1),
    },
    {
      no: 2,
      item: "작업자 총공수 (ΣHT)",
      detail: "수작업시간 합계",
      unit: "초",
      std: formatValue(metrics.totalManualTime, 1),
    },
    {
      no: 3,
      item: "최소(이론) 작업자 수 (n)",
      detail: "ΣHT ÷ TACT TIME",
      unit: "명",
      std: formatValue(metrics.minimumWorkers, 1),
    },
    {
      no: 4,
      item: "운영 작업자 수 (N)",
      detail: "실제 작업 인원",
      unit: "명",
      std: formatInteger(metrics.workerCount),
    },
    {
      no: 5,
      item: "NECK TIME",
      detail: "병목공정의 시간",
      unit: "초",
      std: formatValue(metrics.neckTime, 1),
    },
    {
      no: 6,
      item: "예상 CYCLE TIME",
      detail: "NECK TIME ÷ 효율",
      unit: "초",
      std: formatValue(metrics.expectedCycleTime, 1),
    },
    {
      no: 7,
      item: "효율",
      detail: "CIS 사내표준 효율(생산량별 차등) or 사내운영 효율 적용",
      unit: "%",
      std: formatInteger(metrics.efficiencyPercent, "%"),
    },
    {
      no: 8,
      item: "표준 UPH",
      detail: "1HR(3,600초) ÷ NECK TIME",
      unit: "개(ea)",
      std: formatInteger(metrics.standardUph),
    },
    {
      no: 9,
      item: "예상 UPH",
      detail: "1HR(3,600초) ÷ 예상 CYCLE TIME",
      unit: "개(ea)",
      std: formatValue(metrics.expectedUph, 1),
    },
    {
      no: 10,
      item: "예상 UPMH",
      detail: "예상 UPH ÷ 운영 작업자 수 (N)",
      unit: "개(ea)",
      std: formatValue(metrics.expectedUpmh, 1),
    },
    {
      no: 11,
      item: "LOB",
      detail: "ΣHT ÷ (NECK TIME x N)",
      unit: "%",
      std: formatInteger(metrics.lobPercent, "%"),
    },
    {
      no: 12,
      item: "부하시간",
      detail: "일 생산 요구수량(SPD) ÷ 예상 UPH",
      unit: "시간(hr)",
      std: formatValue(metrics.loadHours, 1),
    },
    {
      no: 13,
      item: "부하율",
      detail: "부하시간 ÷ 일가동시간",
      unit: "%",
      std: formatValue(metrics.loadRatePercent, 1, "%"),
    },
    {
      no: 14,
      item: "라인일생산능력",
      detail: "예상 UPH x 일가동시간",
      unit: "개(ea)",
      std: formatInteger(metrics.dailyLineCapacity),
    },
  ];

  return (
    <section style={cardStyle}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#102a43" }}>공정설계표</div>
        <div style={{ color: "#526071", marginTop: 6 }}>
          현재 LOB 분석에서 계산된 값을 기준으로 공정설계 지표를 바로 표시합니다.
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse", background: "#fff" }}>
          <thead>
            <tr>
              <th style={{ ...headCellStyle, width: 70 }} rowSpan={2}>NO.</th>
              <th style={{ ...headCellStyle, width: 320 }} rowSpan={2}>항목</th>
              <th style={{ ...headCellStyle, width: 300 }} rowSpan={2}>세부 기준</th>
              <th style={{ ...headCellStyle, width: 90 }} rowSpan={2}>단위</th>
              <th style={headCellStyle} colSpan={2}>사양 구분</th>
            </tr>
            <tr>
              <th style={subHeadCellStyle}>기본사양(STD)</th>
              <th style={subHeadCellStyle}>추가사양(옵션)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.no}>
                <td style={{ ...bodyCellStyle, textAlign: "center", fontWeight: 700 }}>{row.no}</td>
                <td style={{ ...bodyCellStyle, fontWeight: 700, textAlign: "center" }}>{row.item}</td>
                <td style={{ ...bodyCellStyle, textAlign: "center", background: "#f7f3e8" }}>{row.detail}</td>
                <td style={{ ...bodyCellStyle, textAlign: "center", fontWeight: 700 }}>{row.unit}</td>
                <td style={{ ...bodyCellStyle, textAlign: "right", fontWeight: 700, fontSize: 18 }}>{row.std}</td>
                <td style={{ ...bodyCellStyle, textAlign: "right", color: "#94a3b8" }}></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cardStyle = {
  display: "grid",
  gap: 16,
  padding: 24,
  borderRadius: 24,
  background: "#ffffff",
  border: "1px solid #d9e2ec",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
};

const headCellStyle = {
  padding: "12px 14px",
  background: "#b7d9e6",
  color: "#111827",
  border: "1px solid #64748b",
  fontSize: 14,
  fontWeight: 700,
  textAlign: "center",
};

const subHeadCellStyle = {
  padding: "10px 12px",
  background: "#dbe7b7",
  color: "#111827",
  border: "1px solid #64748b",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "center",
};

const bodyCellStyle = {
  padding: "12px 14px",
  color: "#111827",
  border: "1px solid #64748b",
  fontSize: 14,
  background: "#ffffff",
};
