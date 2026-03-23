import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "../../state/AppContext";
import { useAssemblyData } from "../Assembly/useAssemblyData";
import { EquipmentStackedBarChart, VerticalBarChart } from "./LobCharts";
import { ProcessDesignTable } from "./ProcessDesignTable";
import { SummaryCard } from "./LobSummaryCards";
import { TactTimeSection } from "./TactTimeSection";
import { WorkerDetailSection } from "./WorkerDetailSection";
import { WorkerTable } from "./WorkerTable";
import {
  buildSummary,
  buildWorkerStats,
  CATEGORY_META,
  CATEGORY_ORDER,
  formatRatio,
  formatTime,
} from "./lobUtils";

const TACT_STORAGE_KEY = "lob_tact_inputs_v1";

const VIEW_OPTIONS = [
  { key: "tact", label: "Tact time 분석" },
  { key: "worker", label: "작업자 LOB" },
  { key: "equipment", label: "설비 LOB" },
  { key: "process-design", label: "공정설계표" },
];

const ZERO_TACT_INPUTS = {
  workDaysPerYear: 0,
  dailyAvailableMinutes: 0,
  plannedStopMinutes: 0,
  realAvailableMinutes: 0,
  annualVehicleTarget: 0,
  quantityPerVehicle: 0,
  lineCount: 0,
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createEquipmentRow() {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `equipment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    investmentCost: "",
    equipmentTimeInput: "",
    manualTimeInput: "",
    reviewChecked: false,
    improvementNote: "",
  };
}

function normalizeMovementTime(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed * 10) / 10);
}

function formatCardNumber(value, digits = 2, suffix = "") {
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

function getExpectedCtDivisor(annualVehicleTarget) {
  if (annualVehicleTarget >= 1 && annualVehicleTarget <= 2000) return 0.7;
  if (annualVehicleTarget <= 5000) return 0.75;
  if (annualVehicleTarget <= 10000) return 0.83;
  if (annualVehicleTarget <= 50000) return 0.85;
  if (annualVehicleTarget <= 100000) return 0.86;
  if (annualVehicleTarget <= 150000) return 0.89;
  if (annualVehicleTarget >= 150001) return 0.9;
  return 0;
}

function loadSavedTactState(currentBomId) {
  const defaultState = {
    tactInputs: { ...ZERO_TACT_INPUTS },
    isRealAvailableManual: false,
  };

  try {
    const raw = localStorage.getItem(TACT_STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }

    const parsed = JSON.parse(raw);
    if (currentBomId && parsed?.bomId !== currentBomId) {
      return defaultState;
    }

    return {
      tactInputs: {
        workDaysPerYear: parsed?.tactInputs?.workDaysPerYear ?? 0,
        dailyAvailableMinutes: parsed?.tactInputs?.dailyAvailableMinutes ?? 0,
        plannedStopMinutes: parsed?.tactInputs?.plannedStopMinutes ?? 0,
        realAvailableMinutes: parsed?.tactInputs?.realAvailableMinutes ?? 0,
        annualVehicleTarget: parsed?.tactInputs?.annualVehicleTarget ?? 0,
        quantityPerVehicle: parsed?.tactInputs?.quantityPerVehicle ?? 0,
        lineCount: parsed?.tactInputs?.lineCount ?? 0,
      },
      isRealAvailableManual: Boolean(parsed?.isRealAvailableManual),
    };
  } catch {
    return defaultState;
  }
}

export default function LobPage() {
  const [params] = useSearchParams();
  const { state, actions } = useApp();
  const assemblyData = useAssemblyData();
  const paramBomId = params.get("bomId");
  const paramSpec = params.get("spec");
  const bomId = paramBomId || state.bomId;
  const spec = paramSpec || state.selectedSpec;
  const initialTactState = useMemo(() => loadSavedTactState(bomId), [bomId]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState("tact");
  const [movementTimes, setMovementTimes] = useState({});
  const [movementTimeInputs, setMovementTimeInputs] = useState({});
  const [tactInputs, setTactInputs] = useState(initialTactState.tactInputs);
  const [isRealAvailableManual, setIsRealAvailableManual] = useState(initialTactState.isRealAvailableManual);
  const [equipmentRows, setEquipmentRows] = useState([createEquipmentRow()]);
  const prevBomIdRef = useRef(bomId);

  useEffect(() => {
    if (paramBomId && paramBomId !== state.bomId) {
      actions.setBomContext(paramBomId);
    }
  }, [actions, paramBomId, state.bomId]);

  useEffect(() => {
    if (paramSpec && paramSpec !== state.selectedSpec) {
      actions.setSpec(paramSpec);
    }
  }, [actions, paramSpec, state.selectedSpec]);

  useEffect(() => {
    if (!bomId) {
      prevBomIdRef.current = bomId;
      return;
    }

    if (prevBomIdRef.current && prevBomIdRef.current !== bomId) {
      setTactInputs(ZERO_TACT_INPUTS);
      setIsRealAvailableManual(false);
      setMovementTimes({});
      setMovementTimeInputs({});
      setEquipmentRows([createEquipmentRow()]);
    }

    prevBomIdRef.current = bomId;
  }, [bomId]);

  useEffect(() => {
    const load = async () => {
      if (!bomId || !spec) {
        setRows([]);
        return;
      }

      setLoading(true);
      try {
        const saved = await assemblyData.loadSavedRows(bomId, spec);
        setRows(saved);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bomId, spec]);

  const workerStats = useMemo(() => buildWorkerStats(rows), [rows]);
  const summary = useMemo(() => buildSummary(workerStats), [workerStats]);
  const maxTime = useMemo(
    () =>
      workerStats.reduce((max, worker) => {
        const movementTime = toNumber(movementTimes[worker.worker]);
        return Math.max(max, worker.totalTime + movementTime);
      }, 0),
    [movementTimes, workerStats]
  );
  const tactMetrics = useMemo(() => {
    const workDays = toNumber(tactInputs.workDaysPerYear);
    const realAvailable = toNumber(tactInputs.realAvailableMinutes);
    const annualVehicles = toNumber(tactInputs.annualVehicleTarget);
    const qtyPerVehicle = toNumber(tactInputs.quantityPerVehicle);
    const lineCount = toNumber(tactInputs.lineCount);

    const annualRequiredQuantity = annualVehicles * qtyPerVehicle;
    const dailyRequiredQuantity = workDays > 0 ? annualRequiredQuantity / workDays : 0;
    const lineTactMinutes =
      dailyRequiredQuantity > 0 ? (realAvailable / dailyRequiredQuantity) * lineCount : 0;
    const lineTactSeconds = lineTactMinutes * 60;

    return {
      annualVehicles,
      realAvailable,
      workDays,
      annualRequiredQuantity,
      dailyRequiredQuantity,
      lineTactMinutes,
      lineTactSeconds,
    };
  }, [tactInputs]);
  const workerTopMetrics = useMemo(() => {
    const neckTime = workerStats.reduce((max, worker) => {
      const movementTime = toNumber(movementTimes[worker.worker]);
      return Math.max(max, worker.totalTime + movementTime);
    }, 0);
    const divisor = getExpectedCtDivisor(tactMetrics.annualVehicles);
    const expectedCt = divisor > 0 ? neckTime / divisor : 0;

    return {
      neckTime,
      expectedCt,
    };
  }, [movementTimes, tactMetrics.annualVehicles, workerStats]);
  const equipmentTargetCt = useMemo(
    () => workerTopMetrics.expectedCt * 0.9,
    [workerTopMetrics.expectedCt]
  );
  const normalizedEquipmentRows = useMemo(
    () =>
      equipmentRows.map((row) => {
        const equipmentTime = toNumber(row.equipmentTimeInput);
        const manualTime = toNumber(row.manualTimeInput);

        return {
          ...row,
          equipmentTime,
          manualTime,
          totalTime: equipmentTime + manualTime,
        };
      }),
    [equipmentRows]
  );
  const processDesignMetrics = useMemo(() => {
    const workerCount = summary.workers;
    const totalManualTime = summary.totalTime;
    const tactTimeSeconds = tactMetrics.lineTactSeconds;
    const neckTime = workerTopMetrics.neckTime;
    const expectedCycleTime = workerTopMetrics.expectedCt;
    const efficiencyRatio =
      neckTime > 0 && expectedCycleTime > 0 ? neckTime / expectedCycleTime : 0;
    const efficiencyPercent = efficiencyRatio * 100;
    const standardUph = neckTime > 0 ? 3600 / neckTime : 0;
    const expectedUph = expectedCycleTime > 0 ? 3600 / expectedCycleTime : 0;
    const expectedUpmh = workerCount > 0 ? expectedUph / workerCount : 0;
    const minimumWorkers = tactTimeSeconds > 0 ? totalManualTime / tactTimeSeconds : 0;
    const workerLaborSums = workerStats.map((worker) =>
      worker.totalTime + toNumber(movementTimes[worker.worker])
    );
    const totalWorkerLaborSum = workerLaborSums.reduce(
      (sum, laborSum) => sum + laborSum,
      0
    );
    const maxWorkerLaborSum = workerLaborSums.reduce(
      (max, laborSum) => Math.max(max, laborSum),
      0
    );
    const lobPercent =
      maxWorkerLaborSum > 0 && workerCount > 0
        ? (totalWorkerLaborSum / (maxWorkerLaborSum * workerCount)) * 100
        : 0;
    const loadHours = expectedUph > 0 ? tactMetrics.dailyRequiredQuantity / expectedUph : 0;
    const dailyOperatingHours = tactMetrics.realAvailable / 60;
    const loadRatePercent =
      dailyOperatingHours > 0 ? (loadHours / dailyOperatingHours) * 100 : 0;
    const dailyLineCapacity = expectedUph * dailyOperatingHours;

    return {
      tactTimeSeconds,
      totalManualTime,
      minimumWorkers,
      workerCount,
      neckTime,
      expectedCycleTime,
      efficiencyPercent,
      standardUph,
      expectedUph,
      expectedUpmh,
      lobPercent,
      loadHours,
      loadRatePercent,
      dailyLineCapacity,
    };
  }, [movementTimes, summary, tactMetrics, workerStats, workerTopMetrics]);

  useEffect(() => {
    setMovementTimes((prev) => {
      const next = {};
      workerStats.forEach((worker) => {
        next[worker.worker] = prev[worker.worker] ?? 0;
      });
      return next;
    });
  }, [workerStats]);

  useEffect(() => {
    setMovementTimeInputs((prev) => {
      const next = {};
      workerStats.forEach((worker) => {
        if (prev[worker.worker] !== undefined) {
          next[worker.worker] = prev[worker.worker];
        } else {
          next[worker.worker] = String(movementTimes[worker.worker] ?? 0);
        }
      });
      return next;
    });
  }, [movementTimes, workerStats]);

  useEffect(() => {
    localStorage.setItem(
      TACT_STORAGE_KEY,
      JSON.stringify({
        bomId,
        tactInputs,
        isRealAvailableManual,
      })
    );
  }, [bomId, isRealAvailableManual, tactInputs]);

  const handleMovementTimeChange = (worker, value) => {
    setMovementTimeInputs((prev) => ({
      ...prev,
      [worker]: value,
    }));
  };

  const commitMovementTimeChange = (worker, value) => {
    const normalized = normalizeMovementTime(value);
    setMovementTimes((prev) => ({
      ...prev,
      [worker]: normalized,
    }));
    setMovementTimeInputs((prev) => ({
      ...prev,
      [worker]: String(normalized),
    }));
  };

  const handleTactInputChange = (field, value) => {
    setTactInputs((prev) => {
      const next = {
        ...prev,
        [field]: value,
      };

      if (
        !isRealAvailableManual &&
        (field === "dailyAvailableMinutes" || field === "plannedStopMinutes")
      ) {
        const dailyAvailable = Number(
          field === "dailyAvailableMinutes" ? value : next.dailyAvailableMinutes
        );
        const plannedStop = Number(
          field === "plannedStopMinutes" ? value : next.plannedStopMinutes
        );
        const computedRealAvailable = Math.max(
          (Number.isFinite(dailyAvailable) ? dailyAvailable : 0) -
            (Number.isFinite(plannedStop) ? plannedStop : 0),
          0
        );

        next.realAvailableMinutes =
          next.dailyAvailableMinutes === "" && next.plannedStopMinutes === ""
            ? ""
            : computedRealAvailable;
      }

      return next;
    });

    if (field === "realAvailableMinutes") {
      setIsRealAvailableManual(true);
    }
  };

  const updateEquipmentRow = (id, patch) => {
    setEquipmentRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const handleAddEquipmentRow = () => {
    setEquipmentRows((prev) => [...prev, createEquipmentRow()]);
  };

  const handleRemoveEquipmentRow = (id) => {
    setEquipmentRows((prev) => {
      if (prev.length <= 1) {
        return [createEquipmentRow()];
      }

      return prev.filter((row) => row.id !== id);
    });
  };

  if (!bomId || !spec) {
    return (
      <div style={{ padding: 24 }}>
        BOM 또는 사양 정보가 없습니다. 조립 총공수 페이지에서 대상 BOM/사양을 먼저 선택하세요.
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100%",
        padding: 24,
        background:
          "radial-gradient(circle at top left, rgba(186, 230, 253, 0.28), transparent 24%), linear-gradient(180deg, #f4f8fb 0%, #eaf4fb 100%)",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 20,
          maxWidth: 1440,
        }}
      >
        <section
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          {VIEW_OPTIONS.map((view) => {
            const active = activeView === view.key;
            return (
              <button
                key={view.key}
                type="button"
                onClick={() => setActiveView(view.key)}
                style={{
                  padding: "16px 22px",
                  borderRadius: 22,
                  border: active ? "1px solid #0f766e" : "1px solid #d9e2ec",
                  background: active ? "linear-gradient(135deg, #ecfeff 0%, #ccfbf1 100%)" : "#ffffff",
                  color: active ? "#0f766e" : "#334e68",
                  boxShadow: active
                    ? "0 18px 38px rgba(15, 118, 110, 0.14)"
                    : "0 12px 28px rgba(15, 23, 42, 0.06)",
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {view.label}
              </button>
            );
          })}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginLeft: "auto",
            }}
          >
            <span style={infoBadgeStyle}>작업자 수 {summary.workers}명</span>
            <span style={infoBadgeStyle}>사양 {spec}</span>
          </div>
        </section>

        {loading ? (
          <section style={emptyStateStyle}>
            저장된 조립 총공수 데이터를 불러오는 중입니다.
          </section>
        ) : activeView === "tact" ? (
          <TactTimeSection inputs={tactInputs} onChange={handleTactInputChange} />
        ) : workerStats.length === 0 ? (
          <section style={emptyStateStyle}>
            분석할 작업자 LOB 데이터가 없습니다. 조립 총공수 페이지에서 저장된 데이터의 `작업자`, `no`, `TOTAL` 값을 먼저 확인하세요.
          </section>
        ) : activeView === "equipment" ? (
          <>
            <section style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <SummaryCard
                title="Tact Time"
                value={formatCardNumber(tactMetrics.lineTactSeconds, 2, " sec")}
                accent="#0f766e"
              />
              <SummaryCard
                title="예상 C/T"
                value={formatCardNumber(workerTopMetrics.expectedCt, 2, " sec")}
                accent="#b91c1c"
              />
              <SummaryCard
                title="설비 목표 C/T"
                value={formatCardNumber(equipmentTargetCt, 2, " sec")}
                accent="#1d4ed8"
              />
            </section>

            <section style={equipmentCardStyle}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#102a43" }}>설비 공정 표</div>
                <div style={{ color: "#526071", marginTop: 6 }}>
                  설비 추가를 눌러 공정명부터 장비 시간, 수작업 시간, 투자 금액까지 직접 입력합니다.
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleAddEquipmentRow}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid #bfdbfe",
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  설비 추가
                </button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 980,
                    borderCollapse: "collapse",
                    background: "#ffffff",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #d9e2ec" }}>
                      {[
                        "공정명",
                        "투자 금액(천원/대)",
                        "장비 시간(sec)",
                        "수작업 시간(sec)",
                        "합 계",
                        "검토사항 체크",
                        "개선 사항",
                        "관리",
                      ].map((label) => (
                        <th
                          key={label}
                          style={{
                            padding: "12px 14px",
                            fontSize: 13,
                            color: "#334e68",
                            textAlign: "left",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {normalizedEquipmentRows.map((row) => (
                      <tr
                        key={row.id}
                        style={{
                          borderBottom: "1px solid #e5e7eb",
                          background: row.reviewChecked ? "#fef2f2" : "#ffffff",
                        }}
                      >
                        <td style={equipmentCellStyle}>
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) =>
                              updateEquipmentRow(row.id, {
                                name: e.target.value,
                              })
                            }
                            placeholder="공정명 입력"
                            lang="ko"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            style={equipmentInputStyle}
                          />
                        </td>
                        <td style={equipmentCellStyle}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="text"
                              value={row.investmentCost}
                              onChange={(e) =>
                                updateEquipmentRow(row.id, {
                                  investmentCost: e.target.value,
                                })
                              }
                              lang="ko"
                              autoCapitalize="off"
                              autoCorrect="off"
                              spellCheck={false}
                              style={equipmentInputStyle}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateEquipmentRow(row.id, {
                                  investmentCost: "기존 활용",
                                })
                              }
                              style={equipmentQuickButtonStyle}
                            >
                              기존 활용
                            </button>
                          </div>
                        </td>
                        <td style={equipmentCellStyle}>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.equipmentTimeInput}
                            onChange={(e) =>
                              updateEquipmentRow(row.id, {
                                equipmentTimeInput: e.target.value,
                              })
                            }
                            style={equipmentInputStyle}
                          />
                        </td>
                        <td style={equipmentCellStyle}>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.manualTimeInput}
                            onChange={(e) =>
                              updateEquipmentRow(row.id, {
                                manualTimeInput: e.target.value,
                              })
                            }
                            style={equipmentInputStyle}
                          />
                        </td>
                        <td style={equipmentCellStyle}>{formatCardNumber(row.totalTime, 2)}</td>
                        <td style={equipmentCellStyle}>
                          <input
                            type="checkbox"
                            checked={row.reviewChecked}
                            onChange={(e) =>
                              updateEquipmentRow(row.id, {
                                reviewChecked: e.target.checked,
                              })
                            }
                          />
                        </td>
                        <td style={equipmentCellStyle}>
                          <input
                            type="text"
                            value={row.improvementNote}
                            onChange={(e) =>
                              updateEquipmentRow(row.id, {
                                improvementNote: e.target.value,
                              })
                            }
                            lang="ko"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            style={equipmentInputStyle}
                          />
                        </td>
                        <td style={equipmentCellStyle}>
                          <button
                            type="button"
                            onClick={() => handleRemoveEquipmentRow(row.id)}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #fecaca",
                              background: "#fff1f2",
                              color: "#b91c1c",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <EquipmentStackedBarChart
              equipmentRows={normalizedEquipmentRows.filter(
                (row) => row.name.trim() || row.totalTime > 0 || row.investmentCost || row.improvementNote
              )}
            />
          </>
        ) : activeView === "process-design" ? (
          <ProcessDesignTable metrics={processDesignMetrics} />
        ) : (
          <>
            <section style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <SummaryCard
                title="Tact Time"
                value={formatCardNumber(tactMetrics.lineTactSeconds, 2, " sec")}
                accent="#0f766e"
              />
              <SummaryCard
                title="Neck Time"
                value={formatCardNumber(workerTopMetrics.neckTime, 2, " sec")}
                accent="#b45309"
              />
              <SummaryCard
                title="예상 C/T"
                value={formatCardNumber(workerTopMetrics.expectedCt, 2, " sec")}
                accent="#b91c1c"
              />
              <SummaryCard title="총 작업 시간" value={formatTime(summary.totalTime)} />
              {CATEGORY_ORDER.map((category) => (
                <SummaryCard
                  key={category}
                  title={`${category} 총 시간`}
                  value={`${formatTime(summary.categoryTimes[category])} / ${
                    summary.totalTime > 0
                      ? formatRatio((summary.categoryTimes[category] / summary.totalTime) * 100)
                      : "0.0%"
                  }`}
                  accent={CATEGORY_META[category].color}
                />
              ))}
            </section>

            <VerticalBarChart workerStats={workerStats} movementTimes={movementTimes} maxTime={maxTime} />

            <section style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#102a43" }}>작업자 요약 표</div>
                <div style={{ color: "#526071", marginTop: 6 }}>
                  열은 작업자, 행은 가치·필비·낭비·이동시간·공수 합계·실동율로 구성됩니다.
                </div>
              </div>
              <WorkerTable
                workerStats={workerStats}
                movementTimes={movementTimes}
                movementTimeInputs={movementTimeInputs}
                onChangeMovementTime={handleMovementTimeChange}
                onCommitMovementTime={commitMovementTimeChange}
              />
            </section>

            <section style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#102a43" }}>작업자 상세 표</div>
                <div style={{ color: "#526071", marginTop: 6 }}>
                  작업자별 원본 행을 열어보면서 어떤 동작요소가 각 분류로 집계됐는지 확인할 수 있습니다.
                </div>
              </div>
              <WorkerDetailSection workerStats={workerStats} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const infoBadgeStyle = {
  display: "inline-flex",
  padding: "10px 14px",
  borderRadius: 999,
  background: "#ffffff",
  border: "1px solid #d9e2ec",
  color: "#334e68",
  fontSize: 13,
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.06)",
};

const emptyStateStyle = {
  padding: 28,
  borderRadius: 24,
  background: "#ffffff",
  border: "1px solid #d9e2ec",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  color: "#334e68",
};

const equipmentCardStyle = {
  display: "grid",
  gap: 16,
  padding: 24,
  borderRadius: 24,
  background: "#ffffff",
  border: "1px solid #d9e2ec",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
};

const equipmentCellStyle = {
  padding: "12px 14px",
  fontSize: 13,
  color: "#102a43",
  verticalAlign: "middle",
};

const equipmentInputStyle = {
  width: "100%",
  minWidth: 120,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  boxSizing: "border-box",
};

const equipmentQuickButtonStyle = {
  flexShrink: 0,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
