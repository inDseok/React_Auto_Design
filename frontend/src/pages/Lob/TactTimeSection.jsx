import React, { useMemo } from "react";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value, digits = 2) {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function InputCard({ label, unit, value, onChange, hint }) {
  return (
    <label
      style={{
        display: "grid",
        gap: 8,
        padding: 18,
        borderRadius: 18,
        background: "#ffffff",
        border: "1px solid #d9e2ec",
        boxShadow: "0 14px 30px rgba(15, 23, 42, 0.06)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: "#102a43" }}>
        {label} {unit ? <span style={{ color: "#526071", fontWeight: 500 }}>({unit})</span> : null}
      </span>
      <input
        type="number"
        value={value}
        min="0"
        step="0.01"
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid #cbd5e1",
          fontSize: 16,
          color: "#102a43",
        }}
      />
      {hint ? <span style={{ fontSize: 12, color: "#7b8794" }}>{hint}</span> : null}
    </label>
  );
}

function ResultCard({ label, value, unit, accent }) {
  return (
    <div
      style={{
        padding: 20,
        borderRadius: 20,
        background: "#ffffff",
        border: "1px solid #d9e2ec",
        boxShadow: "0 16px 34px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ fontSize: 13, color: "#526071", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || "#102a43" }}>
        {value}
        {unit ? <span style={{ fontSize: 16, marginLeft: 6 }}>{unit}</span> : null}
      </div>
    </div>
  );
}

export function TactTimeSection({ inputs, onChange }) {
  const calculated = useMemo(() => {
    const workDays = toNumber(inputs.workDaysPerYear);
    const dailyAvailable = toNumber(inputs.dailyAvailableMinutes);
    const plannedStop = toNumber(inputs.plannedStopMinutes);
    const realAvailable = toNumber(inputs.realAvailableMinutes);
    const annualVehicles = toNumber(inputs.annualVehicleTarget);
    const qtyPerVehicle = toNumber(inputs.quantityPerVehicle);
    const lineCount = toNumber(inputs.lineCount);

    const computedRealAvailable = Math.max(dailyAvailable - plannedStop, 0);
    const annualRequiredQuantity = annualVehicles * qtyPerVehicle;
    const dailyRequiredQuantity = workDays > 0 ? annualRequiredQuantity / workDays : 0;
    const lineTactMinutes =
      dailyRequiredQuantity > 0 ? (realAvailable / dailyRequiredQuantity) * lineCount : 0;
    const lineTactSeconds = lineTactMinutes * 60;

    return {
      computedRealAvailable,
      annualRequiredQuantity,
      dailyRequiredQuantity,
      lineTactMinutes,
      lineTactSeconds,
    };
  }, [inputs]);

  return (
    <section style={{ display: "grid", gap: 18 }}>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <InputCard
          label="1년 근무 횟수"
          unit="일"
          value={inputs.workDaysPerYear}
          onChange={(value) => onChange("workDaysPerYear", value)}
        />
        <InputCard
          label="1일 총 가용시간"
          unit="분"
          value={inputs.dailyAvailableMinutes}
          onChange={(value) => onChange("dailyAvailableMinutes", value)}
        />
        <InputCard
          label="계획 정지시간"
          unit="분"
          value={inputs.plannedStopMinutes}
          onChange={(value) => onChange("plannedStopMinutes", value)}
        />
        <InputCard
          label="실가용시간"
          unit="분"
          value={inputs.realAvailableMinutes}
          onChange={(value) => onChange("realAvailableMinutes", value)}
        />
        <InputCard
          label="1년 생산 대수"
          unit="대"
          value={inputs.annualVehicleTarget}
          onChange={(value) => onChange("annualVehicleTarget", value)}
        />
        <InputCard
          label="대당 환산 개수"
          unit="개"
          value={inputs.quantityPerVehicle}
          onChange={(value) => onChange("quantityPerVehicle", value)}
          hint="예: 대당 2개면 2 입력"
        />
        <InputCard
          label="총 라인 수"
          unit="라인"
          value={inputs.lineCount}
          onChange={(value) => onChange("lineCount", value)}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <ResultCard
          label="연간 요구 수량"
          value={formatNumber(calculated.annualRequiredQuantity, 0)}
          unit="개"
        />
        <ResultCard
          label="일일 요구 수량"
          value={formatNumber(calculated.dailyRequiredQuantity)}
          unit="개/일"
        />
        <ResultCard
          label="라인당 택트타임"
          value={formatNumber(calculated.lineTactMinutes)}
          unit="분"
          accent="#0f766e"
        />
        <ResultCard
          label="라인당 택트타임"
          value={formatNumber(calculated.lineTactSeconds)}
          unit="초"
          accent="#b45309"
        />
      </div>

    </section>
  );
}
