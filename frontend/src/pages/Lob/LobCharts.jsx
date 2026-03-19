import React from "react";
import { CATEGORY_META, CATEGORY_ORDER, formatRatio, formatTime } from "./lobUtils";

const GRAPH_SEGMENTS = [
  ...CATEGORY_ORDER,
  "이동시간",
];

const MOVEMENT_META = {
  color: "#2563eb",
};

export function VerticalBarChart({ workerStats, movementTimes, maxTime }) {
  if (!workerStats.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        padding: 24,
        borderRadius: 24,
        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
        border: "1px solid #d9e2ec",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#102a43" }}>작업자 LOB 그래프</div>
        <div style={{ color: "#526071", marginTop: 6 }}>
          작업자별 공수 합계를 기준으로 가치, 필비, 낭비, 이동시간을 누적 세로 막대로 표시합니다.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {GRAPH_SEGMENTS.map((category) => (
          <div key={category} style={{ display: "flex", alignItems: "center", gap: 8, color: "#334e68" }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: category === "이동시간" ? MOVEMENT_META.color : CATEGORY_META[category].color,
              }}
            />
            {category}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${workerStats.length}, minmax(88px, 1fr))`,
          gap: 16,
          alignItems: "end",
          minHeight: 360,
        }}
      >
        {workerStats.map((worker) => (
          (() => {
            const movementTime = Number(movementTimes[worker.worker] ?? 0);
            const laborSum = worker.totalTime + (Number.isFinite(movementTime) ? movementTime : 0);
            const ratios = {
              "가치": laborSum > 0 ? (worker.categoryTimes["가치"] / laborSum) * 100 : 0,
              "필비": laborSum > 0 ? (worker.categoryTimes["필비"] / laborSum) * 100 : 0,
              "낭비": laborSum > 0 ? (worker.categoryTimes["낭비"] / laborSum) * 100 : 0,
              "이동시간": laborSum > 0 ? ((Number.isFinite(movementTime) ? movementTime : 0) / laborSum) * 100 : 0,
            };

            return (
              <div
                key={worker.worker}
                style={{
                  display: "grid",
                  gap: 10,
                  alignItems: "end",
                  justifyItems: "center",
                }}
              >
                <span style={{ fontSize: 12, color: "#526071" }}>{formatTime(laborSum)}</span>
                <div
                  style={{
                    width: "100%",
                    maxWidth: 84,
                    height: 260,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    padding: "0 4px",
                    borderRadius: 18,
                    background: "linear-gradient(180deg, #f8fbff 0%, #eef4f8 100%)",
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: maxTime > 0 ? `${(laborSum / maxTime) * 100}%` : 0,
                      minHeight: laborSum > 0 ? 10 : 0,
                      display: "flex",
                      flexDirection: "column-reverse",
                      borderRadius: 999,
                      overflow: "hidden",
                      transition: "height 0.4s ease",
                      boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.05)",
                    }}
                    title={`${worker.worker} 공수 합계: ${formatTime(laborSum)}`}
                  >
                    {GRAPH_SEGMENTS.map((category) => {
                      const segmentValue =
                        category === "이동시간"
                          ? Number.isFinite(movementTime)
                            ? movementTime
                            : 0
                          : worker.categoryTimes[category];
                      const segmentHeight = laborSum > 0 ? (segmentValue / laborSum) * 100 : 0;

                      return (
                        <div
                          key={category}
                          title={`${worker.worker} ${category}: ${formatTime(segmentValue)}`}
                          style={{
                            height: `${segmentHeight}%`,
                            minHeight: segmentValue > 0 ? 6 : 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background:
                              category === "이동시간" ? MOVEMENT_META.color : CATEGORY_META[category].color,
                            color: "#ffffff",
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: 1,
                            textShadow: "0 1px 2px rgba(15, 23, 42, 0.35)",
                            overflow: "hidden",
                          }}
                        >
                          {segmentHeight >= 14 ? formatRatio(ratios[category]) : ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <strong
                  style={{
                    color: "#102a43",
                    fontSize: 13,
                    textAlign: "center",
                    wordBreak: "break-word",
                  }}
                >
                  {worker.worker}
                </strong>
              </div>
            );
          })()
        ))}
      </div>
    </div>
  );
}

export function EquipmentStackedBarChart({ equipmentRows }) {
  if (!equipmentRows.length) return null;

  const maxTotal = equipmentRows.reduce(
    (max, row) => Math.max(max, row.totalTime),
    0
  );

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        padding: 24,
        borderRadius: 24,
        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
        border: "1px solid #d9e2ec",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#102a43" }}>설비 시간 구성 그래프</div>
        <div style={{ color: "#526071", marginTop: 6 }}>
          설비 공정별 장비 시간과 수작업 시간을 누적 세로 막대로 표시합니다.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#334e68" }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, background: "#1d4ed8" }} />
          장비 시간
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#334e68" }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, background: "#f97316" }} />
          수작업 시간
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${equipmentRows.length}, minmax(92px, 1fr))`,
          gap: 16,
          alignItems: "end",
          minHeight: 360,
        }}
      >
        {equipmentRows.map((row) => (
          <div
            key={row.name}
            style={{
              display: "grid",
              gap: 10,
              alignItems: "end",
              justifyItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: "#526071" }}>{formatTime(row.totalTime)}</span>
            <div
              style={{
                width: "100%",
                maxWidth: 84,
                height: 260,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "0 4px",
                borderRadius: 18,
                background: "linear-gradient(180deg, #f8fbff 0%, #eef4f8 100%)",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: maxTotal > 0 ? `${(row.totalTime / maxTotal) * 100}%` : 0,
                  minHeight: row.totalTime > 0 ? 10 : 0,
                  display: "flex",
                  flexDirection: "column-reverse",
                  borderRadius: 999,
                  overflow: "hidden",
                  transition: "height 0.4s ease",
                  boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.05)",
                }}
                title={`${row.name} 합계: ${formatTime(row.totalTime)}`}
              >
                <div
                  style={{
                    height: row.totalTime > 0 ? `${(row.manualTime / row.totalTime) * 100}%` : "0%",
                    minHeight: row.manualTime > 0 ? 6 : 0,
                    background: "#f97316",
                  }}
                  title={`${row.name} 수작업 시간: ${formatTime(row.manualTime)}`}
                />
                <div
                  style={{
                    height: row.totalTime > 0 ? `${(row.equipmentTime / row.totalTime) * 100}%` : "0%",
                    minHeight: row.equipmentTime > 0 ? 6 : 0,
                    background: "#1d4ed8",
                  }}
                  title={`${row.name} 장비 시간: ${formatTime(row.equipmentTime)}`}
                />
              </div>
            </div>
            <strong
              style={{
                color: "#102a43",
                fontSize: 12,
                textAlign: "center",
                wordBreak: "keep-all",
                lineHeight: 1.4,
              }}
            >
              {row.name}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
