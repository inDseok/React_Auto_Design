import React, { useEffect, useMemo, useState } from "react";
import AssemblySelector from "./AssemblySelector";
import AssemblyTable from "./AssemblyTable";
import { useAssemblyData } from "./useAssemblyData";
import { computeRowspanInfo } from "./groupUtils";
import {
  insertSameGroupRow, insertNewGroupRow, insertNewGroupAt,
  deleteRow,
  deleteGroup,
  updateCell,
  deleteOptionGroup,
} from "./rowActions";
import { useApp } from "../../state/AppContext";
import { useSearchParams } from "react-router-dom";

const API_BASE = "http://localhost:8000/api/assembly";

function formatDecimalCell(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toFixed(2);
}

function normalizeAssemblyRow(row) {
  return {
    ...row,
    "SEC": formatDecimalCell(row["SEC"]),
    "TOTAL": formatDecimalCell(row["TOTAL"]),
  };
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getRowTotalTime(row) {
  const total = toNumber(row["TOTAL"]);
  if (total > 0) return total;

  const sec = toNumber(row["SEC"]);
  const repeat = toNumber(row["반복횟수"]);
  if (sec > 0 && repeat > 0) {
    return sec * repeat;
  }

  return sec;
}

function buildWorkerRecommendation(rows, workerCount) {
  if (!Array.isArray(rows) || rows.length === 0 || workerCount < 1) {
    return {
      bundles: [],
      workers: [],
      assignmentByRowId: {},
      totalTime: 0,
    };
  }

  const processedRows = computeRowspanInfo(rows);
  const bundles = [];
  let currentBundle = null;

  processedRows.forEach((processedRow, index) => {
    const rawRow = rows[index];
    const groupKey = processedRow.__groupKey || "__ungrouped__";
    const partLabel = String(processedRow["부품 기준"] ?? "").trim() || "미지정 부품";
    const groupLabel =
      String(
        processedRow.__groupLabel ??
          processedRow.__sequenceGroupLabel ??
          processedRow["부품 기준"] ??
          ""
      ).trim() || "이름 없음";
    const totalTime = getRowTotalTime(rawRow);
    const bundleKey = `${groupKey}::${partLabel}::${index}`;

    if (
      !currentBundle ||
      currentBundle.groupKey !== groupKey ||
      currentBundle.partLabel !== partLabel
    ) {
      currentBundle = {
        key: bundleKey,
        groupKey,
        groupLabel,
        partLabel,
        rowIds: [],
        totalTime: 0,
        rowCount: 0,
      };
      bundles.push(currentBundle);
    }

    currentBundle.rowIds.push(rawRow.id);
    currentBundle.rowCount += 1;
    currentBundle.totalTime += totalTime;
  });

  const workers = Array.from({ length: workerCount }, (_, idx) => ({
    worker: String(idx + 1),
    totalTime: 0,
    bundles: [],
  }));

  const assignmentByRowId = {};
  const bundleCount = bundles.length;
  const partitionCount = Math.min(workerCount, Math.max(1, bundleCount));

  if (bundleCount > 0) {
    const prefixSums = [0];
    for (const bundle of bundles) {
      prefixSums.push(prefixSums[prefixSums.length - 1] + bundle.totalTime);
    }

    const totalTime = prefixSums[bundleCount];
    const targetTimePerWorker = totalTime / partitionCount;

    const dp = Array.from({ length: partitionCount + 1 }, () =>
      Array.from({ length: bundleCount + 1 }, () => ({
        varianceCost: Number.POSITIVE_INFINITY,
        maxSegmentTime: Number.POSITIVE_INFINITY,
      }))
    );
    const split = Array.from({ length: partitionCount + 1 }, () =>
      Array(bundleCount + 1).fill(0)
    );

    dp[0][0] = {
      varianceCost: 0,
      maxSegmentTime: 0,
    };

    for (let workerIdx = 1; workerIdx <= partitionCount; workerIdx += 1) {
      for (let bundleIdx = 1; bundleIdx <= bundleCount; bundleIdx += 1) {
        for (let cutIdx = workerIdx - 1; cutIdx < bundleIdx; cutIdx += 1) {
          const previous = dp[workerIdx - 1][cutIdx];
          if (!Number.isFinite(previous.varianceCost)) {
            continue;
          }

          const segmentSum = prefixSums[bundleIdx] - prefixSums[cutIdx];
          const segmentVariance = Math.pow(segmentSum - targetTimePerWorker, 2);
          const candidate = {
            varianceCost: previous.varianceCost + segmentVariance,
            maxSegmentTime: Math.max(previous.maxSegmentTime, segmentSum),
          };
          const best = dp[workerIdx][bundleIdx];

          const isBetter =
            candidate.varianceCost < best.varianceCost ||
            (
              candidate.varianceCost === best.varianceCost &&
              candidate.maxSegmentTime < best.maxSegmentTime
            );

          if (isBetter) {
            dp[workerIdx][bundleIdx] = candidate;
            split[workerIdx][bundleIdx] = cutIdx;
          }
        }
      }
    }

    const ranges = [];
    let workerIdx = partitionCount;
    let bundleIdx = bundleCount;

    while (workerIdx > 0) {
      const cutIdx = split[workerIdx][bundleIdx];
      ranges.unshift([cutIdx, bundleIdx]);
      bundleIdx = cutIdx;
      workerIdx -= 1;
    }

    ranges.forEach(([start, end], rangeIndex) => {
      const targetWorker = workers[rangeIndex];
      const assignedBundles = bundles.slice(start, end);
      targetWorker.bundles = assignedBundles;
      targetWorker.totalTime = assignedBundles.reduce(
        (sum, bundle) => sum + bundle.totalTime,
        0
      );

      assignedBundles.forEach((bundle) => {
        bundle.rowIds.forEach((rowId) => {
          assignmentByRowId[rowId] = targetWorker.worker;
        });
      });
    });
  }

  workers.sort((left, right) => Number(left.worker) - Number(right.worker));

  return {
    bundles,
    workers,
    assignmentByRowId,
    totalTime: bundles.reduce((sum, bundle) => sum + bundle.totalTime, 0),
  };
}

function formatWorkerTime(value) {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function AssemblyPage() {
  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedPart, setSelectedPart] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [selectedInsertPosition, setSelectedInsertPosition] = useState("end");
  const [rows, setRows] = useState([]);
  const [isRecommendOpen, setIsRecommendOpen] = useState(false);
  const [recommendWorkerCount, setRecommendWorkerCount] = useState("1");

  const {
    sheets,
    parts,
    options,
    loadSheets,
    loadParts,
    loadOptions,
    loadTasks,
    saveRowsToDB,
    loadSavedRows,
    runAutoMatch,
  } = useAssemblyData();
  
  const [params] = useSearchParams();
  const bomId = params.get("bomId");
  const spec = params.get("spec");

  const { actions } = useApp();

  const recommendWorkerCountNumber = Math.max(
    1,
    Number.parseInt(recommendWorkerCount || "1", 10) || 1
  );
  const workerRecommendation = useMemo(
    () => buildWorkerRecommendation(rows, recommendWorkerCountNumber),
    [recommendWorkerCountNumber, rows]
  );

  const restoreSavedRows = async ({ silent = false } = {}) => {
    if (!bomId || !spec) {
      if (!silent) {
        alert("BOM 또는 사양 정보가 없습니다.");
      }
      return;
    }

    const saved = await loadSavedRows(bomId, spec);
    if (!saved.length) {
      if (!silent) {
        alert("저장된 assembly.json 데이터가 없습니다.");
      }
      return;
    }

    const restored = saved.map((row) => normalizeAssemblyRow({
      ...row,
      __groupKey: row.__groupKey || row["부품 기준"],
      __groupLabel: row.__groupLabel || row.__sequenceGroupLabel || "",
      __sourceSheet: row.__sourceSheet || row.sourceSheet || "",
      __isNew: false,
    }));

    setRows(restored);
  };

  useEffect(() => {
    if (bomId) actions.setBomContext(bomId);
    if (spec) actions.setSpec(spec);
  }, [bomId, spec]);

  // 초기 로딩
  useEffect(() => {
  
    const init = async () => {
      try {
        loadSheets();
  
        const sessionRes = await fetch(`${API_BASE}/session-info`, {
          credentials: "include",
        });
  
        if (sessionRes.ok) {
          const session = await sessionRes.json();
  
          if (session.ok) {
            await restoreSavedRows({ silent: true });
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
  
    init();
  }, [bomId, spec]);
  
  

  // 시트 변경 → part 로딩
  useEffect(() => {
    if (!selectedSheet) {
      setSelectedPart("");
      setSelectedOption("");
      return;
    }

    loadParts(selectedSheet);
    setSelectedPart("");
    setSelectedOption("");
  }, [selectedSheet]);

  // part 변경 → option 로딩
  useEffect(() => {
    if (!selectedSheet || !selectedPart) {
      setSelectedOption("");
      return;
    }

    loadOptions(selectedSheet, selectedPart);
    setSelectedOption("");
  }, [selectedPart]);

  // DB에서 tasks 추가
  const handleAddFromDB = async () => {
    if (!selectedSheet || !selectedPart || !selectedOption) {
      alert("시트, 부품 기준, OPTION을 모두 선택하세요.");
      return;
    }

    const tasks = await loadTasks(
      selectedSheet,
      selectedPart,
      selectedOption
    );

    if (tasks.length === 0) {
      alert("해당 조건에 맞는 작업이 없습니다.");
      return;
    }

    setRows((prev) => {
      const targetGroupKey =
        selectedInsertPosition === "end" ? crypto.randomUUID() : selectedInsertPosition;
      const targetGroupLabel =
        prev.find((row) => row.__groupKey === targetGroupKey)?.__groupLabel || "";
      const newRows = tasks.map((t) => normalizeAssemblyRow({
        id: crypto.randomUUID(),

        // 엑셀 원본 컬럼 그대로
        "부품 기준": t["부품 기준"],
        "요소작업": t["요소작업"],
        "OPTION": t["OPTION"],
        "작업자": t["작업자"],
        "no": t["no"],
        "동작요소": t["동작요소"],
        "반복횟수": t["반복횟수"],
        "SEC": t["SEC"],
        "TOTAL": t["TOTAL"],

        __groupKey: targetGroupKey,
        __groupLabel: targetGroupLabel,
        __sourceSheet: selectedSheet,
        __isNew: false,
      }));

      if (selectedInsertPosition === "end") {
        return [...prev, ...newRows];
      }

      const lastIndexInGroup = prev.reduce(
        (lastIndex, row, index) =>
          row.__groupKey === targetGroupKey ? index : lastIndex,
        -1
      );

      if (lastIndexInGroup === -1) {
        return [...prev, ...newRows];
      }

      const insertIndex = lastIndexInGroup + 1;
      const nextRows = [...prev];
      nextRows.splice(insertIndex, 0, ...newRows);
      return nextRows;
    });
  };

  // 행 조작
  const handleInsertSameGroup = (rowId) => {
    setRows((prev) => insertSameGroupRow(prev, rowId));
  };
  
  const handleInsertNewGroup = (rowId) => {
    setRows((prev) => insertNewGroupRow(prev, rowId));
  };

  const handleInsertGroupAt = (insertIndex) => {
    setRows((prev) => insertNewGroupAt(prev, insertIndex));
  };
  
  const handleDeleteRow = (rowId) => {
    setRows((prev) => deleteRow(prev, rowId));
  };

  const handleDeleteGroup = (groupKey) => {
    setRows((prev) => deleteGroup(prev, groupKey));
  };

  const handleCellChange = (rowId, field, value) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === rowId);
      if (!target) return prev;

      const targetInstanceKey =
        target.__partInstanceKey ||
        `${target.__groupKey || ""}::${target["부품 기준"] || ""}::${target["OPTION"] || ""}`;
  
      // 작업자 컬럼: 값 입력일 때만 그룹 전파
      if (
        field === "작업자" &&
        value !== "" &&               // 비어있지 않고
        value !== target[field]      // 실제로 바뀌었고
      ) {
        return prev.map((r) => {
          const rowInstanceKey =
            r.__partInstanceKey ||
            `${r.__groupKey || ""}::${r["부품 기준"] || ""}::${r["OPTION"] || ""}`;

          if (rowInstanceKey === targetInstanceKey) {
            return { ...r, 작업자: value };
          }
          return r;
        });
      }
  
      // 기본: 개별 셀만 변경
      return updateCell(prev, rowId, field, value);
    });
  };
  
  
  

  // 저장
  const handleSave = async () => {
    if (!rows.length) {
      alert("저장할 조립 총공수 데이터가 없습니다.");
      return;
    }

    const ok = await saveRowsToDB(bomId, spec, rows);
    if (ok) alert("저장 완료");
    else alert("저장 실패");
  };

  const handleAutoMatch = async () => {
    const added = await runAutoMatch(bomId, spec);
  
    if (added.length === 0) {
      alert("자동 추가된 항목이 없습니다.");
      return;
    }
    

      const autoRows = added.map((row) => normalizeAssemblyRow({
        id: crypto.randomUUID(),
        ...row,
        __groupKey: row.__groupKey || row["부품 기준"],
        __groupLabel: row.__groupLabel || row.__sequenceGroupLabel || "",
        __sourceSheet: row.__sourceSheet || row.sourceSheet || "",
        __isNew: false,
      }));
  
    setRows(autoRows);
  };

  const handleOpenRecommend = () => {
    if (!rows.length) {
      alert("작업자 추천을 하려면 조립 총공수 데이터가 있어야 합니다.");
      return;
    }

    const currentWorkers = new Set(
      rows
        .map((row) => String(row["작업자"] ?? "").trim())
        .filter(Boolean)
    );
    setRecommendWorkerCount(String(Math.max(1, currentWorkers.size || 1)));
    setIsRecommendOpen(true);
  };

  const handleApplyRecommendation = () => {
    const assignmentByRowId = workerRecommendation.assignmentByRowId || {};
    setRows((prev) =>
      prev.map((row) =>
        assignmentByRowId[row.id]
          ? { ...row, 작업자: assignmentByRowId[row.id] }
          : row
      )
    );
    setIsRecommendOpen(false);
  };
  
  const handleReset = () => {
    setSelectedSheet("");
    setSelectedPart("");
    setSelectedOption("");
    setSelectedInsertPosition("end");
    setRows([]);
  };
  
  const handleDeleteOptionGroup = (partKey, optionValue) => {
    setRows((prev) => deleteOptionGroup(prev, partKey, optionValue));
  };

  const handleGroupLabelChange = (groupKey, value) => {
    setRows((prev) =>
      prev.map((row) =>
        row.__groupKey === groupKey
          ? { ...row, __groupLabel: value }
          : row
      )
    );
  };

  const insertPositions = (() => {
    if (rows.length === 0) {
      return [{ value: "end", label: "삽입 위치: 맨 뒤" }];
    }

    const processed = computeRowspanInfo(rows);
    const positions = [{ value: "end", label: "삽입 위치: 맨 뒤" }];
    const seen = new Set();

    processed.forEach((row) => {
      const groupKey = row.__groupKey;
      if (!groupKey || seen.has(groupKey)) return;
      seen.add(groupKey);

      const label =
        row.__groupLabel?.trim() ||
        row.__sequenceGroupLabel?.trim() ||
        row["부품 기준"]?.trim() ||
        `그룹 ${seen.size}`;

      positions.push({
        value: groupKey,
        label: `${label}`,
      });
    });

    return positions;
  })();

  useEffect(() => {
    const hasSelectedPosition = insertPositions.some(
      (pos) => pos.value === selectedInsertPosition
    );
    if (!hasSelectedPosition) {
      setSelectedInsertPosition(insertPositions[insertPositions.length - 1]?.value ?? "end");
    }
  }, [insertPositions, selectedInsertPosition]);
  
  return (
    <div style={{ padding: 20 }}>
      <AssemblySelector
        sheets={sheets}
        parts={parts}
        options={options}
        insertPositions={insertPositions}
        selectedSheet={selectedSheet}
        selectedPart={selectedPart}
        selectedOption={selectedOption}
        selectedInsertPosition={selectedInsertPosition}
        onChangeSheet={setSelectedSheet}
        onChangePart={setSelectedPart}
        onChangeOption={setSelectedOption}
        onChangeInsertPosition={setSelectedInsertPosition}
        onAdd={handleAddFromDB}
        onLoad={restoreSavedRows}
        onSave={handleSave}
        onAutoMatch={handleAutoMatch}
        onRecommendWorkers={handleOpenRecommend}
        onReset={handleReset}
        canSave={rows.length > 0}
      />

      <AssemblyTable
        rows={rows}
        onInsertSameGroup={handleInsertSameGroup}
        onInsertNewGroup={handleInsertNewGroup}
        onInsertGroupAt={handleInsertGroupAt}
        onDeleteRow={handleDeleteRow}
        onDeleteGroup={handleDeleteGroup}
        onCellChange={handleCellChange}
        onRowsChange={(nextRows) => setRows(nextRows)}
        onDeleteOptionGroup={handleDeleteOptionGroup}
        onGroupLabelChange={handleGroupLabelChange}
      />

      {isRecommendOpen && (
        <div
          onClick={() => setIsRecommendOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 24px 64px rgba(15, 23, 42, 0.2)",
              display: "grid",
              gap: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#102a43" }}>
                  작업자 추천
                </div>
              </div>
              <button type="button" onClick={() => setIsRecommendOpen(false)}>
                닫기
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                padding: 16,
                borderRadius: 14,
                background: "#f8fafc",
                border: "1px solid #d9e2ec",
              }}
            >
              <label style={{ fontWeight: 600, color: "#243b53" }}>작업자 수</label>
              <input
                type="number"
                min="1"
                step="1"
                value={recommendWorkerCount}
                onChange={(e) => setRecommendWorkerCount(e.target.value)}
                style={{
                  width: 120,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                }}
              />
              <div style={{ color: "#526071" }}>
                추천 묶음 {workerRecommendation.bundles.length}개 / 총 공수{" "}
                {formatWorkerTime(workerRecommendation.totalTime)}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {workerRecommendation.workers.map((worker) => (
                <div
                  key={worker.worker}
                  style={{
                    border: "1px solid #d9e2ec",
                    borderRadius: 16,
                    padding: 16,
                    background: "#ffffff",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ color: "#102a43" }}>작업자 {worker.worker}</strong>
                    <span style={{ color: "#1d4ed8", fontWeight: 700 }}>
                      {formatWorkerTime(worker.totalTime)}
                    </span>
                  </div>
                  <div style={{ color: "#526071", fontSize: 13 }}>
                    배정 묶음 {worker.bundles.length}개
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {worker.bundles.length === 0 && (
                      <div style={{ color: "#829ab1", fontSize: 13 }}>배정 없음</div>
                    )}
                    {worker.bundles.map((bundle) => (
                      <div
                        key={bundle.key}
                        style={{
                          borderRadius: 12,
                          background: "#f8fafc",
                          border: "1px solid #e5edf5",
                          padding: 10,
                          display: "grid",
                          gap: 4,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#243b53" }}>{bundle.partLabel}</div>
                        <div style={{ fontSize: 12, color: "#526071" }}>{bundle.groupLabel}</div>
                        <div style={{ fontSize: 12, color: "#1f2937" }}>
                          {formatWorkerTime(bundle.totalTime)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setIsRecommendOpen(false)}>
                취소
              </button>
              <button type="button" onClick={handleApplyRecommendation}>
                추천 적용
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default AssemblyPage;
