import React from "react";
import { getDisplaySpecName } from "../Sequence/sequenceEditorUtils";

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

export function ProcessDesignTable({
  metrics,
  selectedSpec,
  specOptions,
  onChangeSpec,
}) {
  const rows = [
    {
      no: 1,
      item: "택트타임 (TACT TIME)",
      detail: "실가용시간 ÷ 일 생산 요구수량(SPD)",
      unit: "초",
      value: formatValue(metrics?.tactTimeSeconds ?? 0, 1),
    },
    {
      no: 2,
      item: "작업자 총공수 (ΣHT)",
      detail: "수작업시간 합계",
      unit: "초",
      value: formatValue(metrics?.totalManualTime ?? 0, 1),
    },
    {
      no: 3,
      item: "최소(이론) 작업자 수 (n)",
      detail: "ΣHT ÷ TACT TIME",
      unit: "명",
      value: formatValue(metrics?.minimumWorkers ?? 0, 1),
    },
    {
      no: 4,
      item: "운영 작업자 수 (N)",
      detail: "실제 작업 인원",
      unit: "명",
      value: formatInteger(metrics?.workerCount ?? 0),
    },
    {
      no: 5,
      item: "NECK TIME",
      detail: "병목공정의 시간",
      unit: "초",
      value: formatValue(metrics?.neckTime ?? 0, 1),
    },
    {
      no: 6,
      item: "예상 CYCLE TIME",
      detail: "NECK TIME ÷ 효율",
      unit: "초",
      value: formatValue(metrics?.expectedCycleTime ?? 0, 1),
    },
    {
      no: 7,
      item: "효율",
      detail: "CIS 사내표준 효율(생산량별 차등) or 사내운영 효율 적용",
      unit: "%",
      value: formatInteger(metrics?.efficiencyPercent ?? 0, "%"),
    },
    {
      no: 8,
      item: "표준 UPH",
      detail: "1HR(3,600초) ÷ NECK TIME",
      unit: "개(ea)",
      value: formatInteger(metrics?.standardUph ?? 0),
    },
    {
      no: 9,
      item: "예상 UPH",
      detail: "1HR(3,600초) ÷ 예상 CYCLE TIME",
      unit: "개(ea)",
      value: formatValue(metrics?.expectedUph ?? 0, 1),
    },
    {
      no: 10,
      item: "예상 UPMH",
      detail: "예상 UPH ÷ 운영 작업자 수 (N)",
      unit: "개(ea)",
      value: formatValue(metrics?.expectedUpmh ?? 0, 1),
    },
    {
      no: 11,
      item: "LOB",
      detail: "공수 합계 총합 ÷ (최대 공수 합계 x 작업자 수)",
      unit: "%",
      value: formatInteger(metrics?.lobPercent ?? 0, "%"),
    },
    {
      no: 12,
      item: "부하시간",
      detail: "일 생산 요구수량(SPD) ÷ 예상 UPH",
      unit: "시간(hr)",
      value: formatValue(metrics?.loadHours ?? 0, 1),
    },
    {
      no: 13,
      item: "부하율",
      detail: "부하시간 ÷ 일가동시간",
      unit: "%",
      value: formatValue(metrics?.loadRatePercent ?? 0, 1, "%"),
    },
    {
      no: 14,
      item: "라인일생산능력",
      detail: "예상 UPH x 일가동시간",
      unit: "개(ea)",
      value: formatInteger(metrics?.dailyLineCapacity ?? 0),
    },
  ];

  return (
    <section style={cardStyle}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#102a43" }}>공정설계표</div>
        <div style={{ color: "#526071", marginTop: 6 }}>
          같은 BOM 안의 사양을 선택해 하나의 공정설계 지표만 확인합니다.
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <label style={selectorWrapStyle}>
          <span style={selectorLabelStyle}>사양 선택</span>
          <select value={selectedSpec} onChange={(e) => onChangeSpec?.(e.target.value)} style={selectorStyle}>
            {specOptions.length === 0 ? (
              <option value="">선택 가능한 사양 없음</option>
            ) : (
              specOptions.map((spec) => (
                <option key={spec} value={spec}>
                  {getDisplaySpecName(spec)}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", background: "#fff" }}>
          <thead>
            <tr>
              <th style={{ ...headCellStyle, width: 70 }}>NO.</th>
              <th style={{ ...headCellStyle, width: 320 }}>항목</th>
              <th style={{ ...headCellStyle, width: 300 }}>세부 기준</th>
              <th style={{ ...headCellStyle, width: 90 }}>단위</th>
              <th style={{ ...subHeadCellStyle, minWidth: 220 }}>
                {selectedSpec ? getDisplaySpecName(selectedSpec) : "선택된 사양"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.no}>
                <td style={{ ...bodyCellStyle, textAlign: "center", fontWeight: 700 }}>{row.no}</td>
                <td style={{ ...bodyCellStyle, fontWeight: 700, textAlign: "center" }}>{row.item}</td>
                <td style={{ ...bodyCellStyle, textAlign: "center", background: "#f7f3e8" }}>{row.detail}</td>
                <td style={{ ...bodyCellStyle, textAlign: "center", fontWeight: 700 }}>{row.unit}</td>
                <td style={{ ...bodyCellStyle, textAlign: "right", fontWeight: 700, fontSize: 18 }}>{row.value}</td>
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

const selectorWrapStyle = {
  display: "grid",
  gap: 6,
  width: 360,
  maxWidth: "100%",
};

const selectorLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: "#334e68",
};

const selectorStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#102a43",
  fontSize: 14,
};
