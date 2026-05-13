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
import SavedPopup from "../../template/SavedPopup";
import ConfirmPopup from "../../template/ConfirmPopup";
import { showPopup } from "../../template/popupUtils";
import { useSearchParams } from "react-router-dom";
import {
  createSequenceWorkspaceContext,
  removeSequenceDraft,
} from "../Sequence/sequenceEditorUtils";

const API_BASE = "http://localhost:8000/api/assembly";
const ASSEMBLY_DRAFT_STORAGE_PREFIX = "assembly_page_draft_v1";

function getAssemblyDraftStorageKey(bomId, spec) {
  if (!bomId || !spec) return null;
  return `${ASSEMBLY_DRAFT_STORAGE_PREFIX}:${bomId}:${spec}`;
}

function formatDecimalCell(value) {
  if (value === "" || value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toFixed(2);
}

function normalizeAssemblyRow(row) {
  return {
    ...row,
    id: row.id || crypto.randomUUID(),
    "SEC": formatDecimalCell(row["SEC"]),
    "TOTAL": formatDecimalCell(row["TOTAL"]),
  };
}

// 그룹 자체를 작업자 번호 순으로 정렬하고, 그룹 내 행도 작업자 번호 순으로 정렬
function sortRowsByWorkerWithinGroups(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const groupOrder = [];
  const seen = new Set();
  const rowsByGroup = {};

  for (const row of rows) {
    const key = row.__groupKey ?? "__ungrouped__";
    if (!seen.has(key)) {
      seen.add(key);
      groupOrder.push(key);
      rowsByGroup[key] = [];
    }
    rowsByGroup[key].push(row);
  }

  const workerSortKey = (w) => {
    const n = Number(String(w ?? ""));
    return Number.isFinite(n) ? n : Infinity;
  };

  // 그룹 내 행 정렬
  for (const key of groupOrder) {
    rowsByGroup[key].sort((a, b) => {
      const ka = workerSortKey(a["작업자"]);
      const kb = workerSortKey(b["작업자"]);
      if (ka !== kb) return ka - kb;
      return String(a["작업자"] ?? "").localeCompare(String(b["작업자"] ?? ""), "ko");
    });
  }

  // 그룹 자체를 각 그룹의 최소 작업자 번호 기준으로 정렬
  groupOrder.sort((keyA, keyB) => {
    const minA = Math.min(...rowsByGroup[keyA].map((r) => workerSortKey(r["작업자"])));
    const minB = Math.min(...rowsByGroup[keyB].map((r) => workerSortKey(r["작업자"])));
    return minA - minB;
  });

  return groupOrder.flatMap((key) => rowsByGroup[key]);
}

function createSerializableRows(rows = []) {
  return Array.isArray(rows)
    ? rows.map((row) => ({
        ...row,
        "SEC": formatDecimalCell(row["SEC"]),
        "TOTAL": formatDecimalCell(row["TOTAL"]),
      }))
    : [];
}

function getRowsSnapshot(rows = []) {
  return JSON.stringify(createSerializableRows(rows));
}

function removeAssemblyDraft(bomId, spec) {
  const storageKey = getAssemblyDraftStorageKey(bomId, spec);
  if (!storageKey) return;
  localStorage.removeItem(storageKey);
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
  if (sec > 0) {
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
      assignmentByRowIndex: {},
      totalTime: 0,
    };
  }

  const processedRows = computeRowspanInfo(rows);
  const bundles = [];
  let currentBundle = null;

  processedRows.forEach((processedRow, index) => {
    const groupKey = processedRow.__groupKey || "__ungrouped__";
    const partLabel = String(processedRow["부품 기준"] ?? "").trim() || "미지정 부품";
    const groupLabel =
      String(
        processedRow.__groupLabel ??
          processedRow.__sequenceGroupLabel ??
          processedRow["부품 기준"] ??
          ""
      ).trim() || "이름 없음";
    const totalTime = getRowTotalTime(processedRow);
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
        rowIndexes: [],
        totalTime: 0,
        rowCount: 0,
      };
      bundles.push(currentBundle);
    }

    if (rows[index].id) {
      currentBundle.rowIds.push(rows[index].id);
    }
    currentBundle.rowIndexes.push(index);
    currentBundle.rowCount += 1;
    currentBundle.totalTime += totalTime;
  });

  const workers = Array.from({ length: workerCount }, (_, idx) => ({
    worker: String(idx + 1),
    totalTime: 0,
    bundles: [],
  }));

  const assignmentByRowId = {};
  const assignmentByRowIndex = {};
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
        bundle.rowIndexes.forEach((rowIndex) => {
          assignmentByRowIndex[rowIndex] = targetWorker.worker;
        });
      });
    });
  }

  workers.sort((left, right) => Number(left.worker) - Number(right.worker));

  return {
    bundles,
    workers,
    assignmentByRowId,
    assignmentByRowIndex,
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
  const [showSavedPopup, setShowSavedPopup] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
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
  
  const [params, setParams] = useSearchParams();
  const bomId = params.get("bomId");
  const spec = params.get("spec");

  const { actions } = useApp();
  const lastSavedRowsSnapshotRef = React.useRef(getRowsSnapshot([]));

  const recommendWorkerCountNumber = Math.max(
    1,
    Number.parseInt(recommendWorkerCount || "1", 10) || 1
  );
  const workerRecommendation = useMemo(
    () => buildWorkerRecommendation(rows, recommendWorkerCountNumber),
    [recommendWorkerCountNumber, rows]
  );

  useEffect(() => {
    if (bomId && spec) {
      return;
    }

    const workspaceContext = createSequenceWorkspaceContext();
    const nextBomId = bomId || workspaceContext.bomId;
    const nextParams = new URLSearchParams(params);
    nextParams.set("bomId", nextBomId);
    nextParams.set("spec", spec || `manual-sequence-${nextBomId}`);
    setParams(nextParams, { replace: true });
  }, [bomId, params, setParams, spec]);

  const restoreSavedRows = async ({ silent = false } = {}) => {
    if (!bomId || !spec) {
      if (!silent) {
        showPopup("BOM 또는 사양 정보가 없습니다.", "warning");
      }
      return false;
    }

    const saved = await loadSavedRows(bomId, spec);
    if (!saved.length) {
      if (!silent) {
        showPopup("저장된 assembly.json 데이터가 없습니다.", "warning");
      }
      return false;
    }

    const restored = saved.map((row) => normalizeAssemblyRow({
      ...row,
      __groupKey: row.__groupKey || row["부품 기준"],
      __groupLabel: row.__groupLabel || row.__sequenceGroupLabel || "",
      __sourceSheet: row.__sourceSheet || row.sourceSheet || "",
      __isNew: false,
    }));

    const sortedRestored = sortRowsByWorkerWithinGroups(restored);
    setRows(sortedRestored);
    const restoredSnapshot = getRowsSnapshot(sortedRestored);
    lastSavedRowsSnapshotRef.current = restoredSnapshot;
    if (!silent) showPopup("불러오기 완료", "success");
    return true;
  };

  const loadRowsFromSequence = async ({ showEmptyAlert = false } = {}) => {
    if (!bomId || !spec) {
      return false;
    }

    const added = await runAutoMatch(bomId, spec);
    if (!added.length) {
      setRows([]);
      removeAssemblyDraft(bomId, spec);

      if (showEmptyAlert) {
        showPopup("시퀀스 JSON에서 자동 추가할 항목이 없습니다.", "warning");
      }
      return false;
    }

    const autoRows = added.map((row) =>
      normalizeAssemblyRow({
        id: crypto.randomUUID(),
        ...row,
        __groupKey: row.__groupKey || row["부품 기준"],
        __groupLabel: row.__groupLabel || row.__sequenceGroupLabel || "",
        __sourceSheet: row.__sourceSheet || row.sourceSheet || "",
        __isNew: false,
      })
    );

    setRows(sortRowsByWorkerWithinGroups(autoRows));
    setSelectedSheet("");
    setSelectedPart("");
    setSelectedOption("");
    setSelectedInsertPosition("end");
    removeAssemblyDraft(bomId, spec);
    return true;
  };

  useEffect(() => {
    if (bomId) actions.setBomContext(bomId);
    if (spec) actions.setSpec(spec);
  }, [bomId, spec]);

  // 초기 로딩: assembly / sequence 버전 비교 후 최신 데이터 복원
  useEffect(() => {
    const init = async () => {
      try {
        loadSheets();

        let useSequence = false;
        if (bomId && spec) {
          try {
            const res = await fetch(
              `${API_BASE}/bom/${encodeURIComponent(bomId)}/spec/${encodeURIComponent(spec)}/version-info`,
              { credentials: "include" }
            );
            if (res.ok) {
              const { assemblyVersion, sequenceVersion, hasAssembly, hasSequence } = await res.json();
              // 시퀀스가 assembly보다 나중에 저장됐으면 시퀀스 기준으로 재구성
              if (hasSequence && (!hasAssembly || sequenceVersion > assemblyVersion)) {
                useSequence = true;
              }
            }
          } catch {
            // 버전 정보 조회 실패 시 assembly 우선
          }
        }

        if (useSequence) {
          await loadRowsFromSequence({ showEmptyAlert: false });
        } else {
          const hasRestored = await restoreSavedRows({ silent: true });
          if (!hasRestored) {
            await loadRowsFromSequence({ showEmptyAlert: false });
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
      showPopup("시트, 부품 기준, OPTION을 모두 선택하세요.", "warning");
      return;
    }

    const tasks = await loadTasks(
      selectedSheet,
      selectedPart,
      selectedOption
    );

    if (tasks.length === 0) {
      showPopup("해당 조건에 맞는 작업이 없습니다.", "warning");
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

      const normalizedValue =
        field === "OPTION" || field === "요소작업" || field === "부품 기준"
          ? String(value ?? "").replace(/\r?\n/g, " ").trim()
          : value;
      const targetInstanceKey =
        target.__partInstanceKey ||
        `${target.__groupKey || ""}::${target["부품 기준"] || ""}::${target["OPTION"] || ""}`;
  
      // 작업자 컬럼: 값 입력일 때만 그룹 전파
      if (
        field === "작업자" &&
        normalizedValue !== "" &&               // 비어있지 않고
        normalizedValue !== target[field]      // 실제로 바뀌었고
      ) {
        return prev.map((r) => {
          const rowInstanceKey =
            r.__partInstanceKey ||
            `${r.__groupKey || ""}::${r["부품 기준"] || ""}::${r["OPTION"] || ""}`;

          if (rowInstanceKey === targetInstanceKey) {
            return { ...r, 작업자: normalizedValue };
          }
          return r;
        });
      }

      // OPTION 컬럼: 병합된 묶음 전체에 같은 값 반영
      if (field === "OPTION" && normalizedValue !== target[field]) {
        const targetPartBase = String(target["부품 기준"] ?? "").trim();
        const targetOption = String(target["OPTION"] ?? "").trim();

        return prev.map((r) => {
          const rowInstanceKey =
            r.__partInstanceKey ||
            `${r.__groupKey || ""}::${r["부품 기준"] || ""}::${r["OPTION"] || ""}`;

          const sameMergedOptionBlock =
            rowInstanceKey === targetInstanceKey &&
            String(r["부품 기준"] ?? "").trim() === targetPartBase &&
            String(r["OPTION"] ?? "").trim() === targetOption;

          if (!sameMergedOptionBlock) {
            return r;
          }

          return { ...r, OPTION: normalizedValue };
        });
      }

      // 요소작업 컬럼: 병합된 묶음 전체에 같은 값 반영
      if (field === "요소작업" && normalizedValue !== target[field]) {
        const targetPartBase = String(target["부품 기준"] ?? "").trim();
        const targetTask = String(target["요소작업"] ?? "").trim();

        return prev.map((r) => {
          const rowInstanceKey =
            r.__partInstanceKey ||
            `${r.__groupKey || ""}::${r["부품 기준"] || ""}::${r["OPTION"] || ""}`;

          const sameMergedTaskBlock =
            rowInstanceKey === targetInstanceKey &&
            String(r["부품 기준"] ?? "").trim() === targetPartBase &&
            String(r["요소작업"] ?? "").trim() === targetTask;

          if (!sameMergedTaskBlock) {
            return r;
          }

          return { ...r, "요소작업": normalizedValue };
        });
      }

      // 부품 기준 컬럼: 병합된 묶음 전체에 같은 값 반영
      if (field === "부품 기준" && normalizedValue !== target[field]) {
        const targetPartBase = String(target["부품 기준"] ?? "").trim();

        return prev.map((r) => {
          const rowInstanceKey =
            r.__partInstanceKey ||
            `${r.__groupKey || ""}::${r["부품 기준"] || ""}::${r["OPTION"] || ""}`;

          const sameMergedPartBlock =
            rowInstanceKey === targetInstanceKey &&
            String(r["부품 기준"] ?? "").trim() === targetPartBase;

          if (!sameMergedPartBlock) {
            return r;
          }

          return { ...r, "부품 기준": normalizedValue };
        });
      }
  
      // 기본: 개별 셀만 변경
      return updateCell(prev, rowId, field, normalizedValue);
    });
  };
  
  
  

  // 저장
  const handleSave = async () => {
    if (!rows.length) {
      showPopup("저장할 조립 총공수 데이터가 없습니다.", "warning");
      return false;
    }

    const ok = await saveRowsToDB(bomId, spec, rows);
    if (ok) {
      removeSequenceDraft(bomId, spec);
      removeAssemblyDraft(bomId, spec);
      const savedSnapshot = getRowsSnapshot(rows);
      lastSavedRowsSnapshotRef.current = savedSnapshot;
      setShowSavedPopup(true);
    } else showPopup("저장 실패", "error");
    return ok;
  };

  useEffect(() => {
    const handleSaveRequest = async (event) => {
      const ok = rows.length ? await saveRowsToDB(bomId, spec, rows) : true;

      if (ok) {
        removeSequenceDraft(bomId, spec);
        removeAssemblyDraft(bomId, spec);
        const savedSnapshot = getRowsSnapshot(rows);
        lastSavedRowsSnapshotRef.current = savedSnapshot;
      }

      event.detail?.respond?.(ok);
    };

    window.addEventListener("app:assembly-save-request", handleSaveRequest);
    return () => {
      window.removeEventListener("app:assembly-save-request", handleSaveRequest);
    };
  }, [bomId, rows, saveRowsToDB, spec]);

  useEffect(() => {
    const handleDirtyCheckRequest = (event) => {
      const currentSnapshot = getRowsSnapshot(rows);
      event.detail?.respond?.(currentSnapshot !== lastSavedRowsSnapshotRef.current);
    };

    window.addEventListener("app:assembly-dirty-check-request", handleDirtyCheckRequest);
    return () => {
      window.removeEventListener("app:assembly-dirty-check-request", handleDirtyCheckRequest);
    };
  }, [rows]);

  const handleOpenRecommend = () => {
    if (!rows.length) {
      showPopup("작업자 추천을 하려면 조립 총공수 데이터가 있어야 합니다.", "warning");
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

  const handleApplyRecommendation = async () => {
    const assignmentByRowId = workerRecommendation.assignmentByRowId || {};
    const assignmentByRowIndex = workerRecommendation.assignmentByRowIndex || {};
    const nextRows = rows.map((row, index) => {
      const assignedWorker =
        (row.id ? assignmentByRowId[row.id] : null) || assignmentByRowIndex[index];
      return assignedWorker
          ? { ...row, 작업자: assignedWorker }
          : row
    });

    setRows(nextRows);
    setIsRecommendOpen(false);

    if (!bomId || !spec) {
      showPopup("작업자 추천은 적용됐지만 BOM 또는 사양 정보가 없어 저장하지 못했습니다.", "error");
      return;
    }

    const ok = await saveRowsToDB(bomId, spec, nextRows);
    if (ok) {
      removeSequenceDraft(bomId, spec);
      removeAssemblyDraft(bomId, spec);
      const savedSnapshot = getRowsSnapshot(nextRows);
      lastSavedRowsSnapshotRef.current = savedSnapshot;
      return;
    }

    showPopup("작업자 추천은 화면에 적용됐지만 저장에 실패했습니다.", "error");
  };
  
  const handleReset = () => setShowConfirmReset(true);

  const doReset = () => {
    setSelectedSheet("");
    setSelectedPart("");
    setSelectedOption("");
    setSelectedInsertPosition("end");
    setRows([]);
    setShowConfirmReset(false);
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

      {showSavedPopup && <SavedPopup onClose={() => setShowSavedPopup(false)} />}

      {showConfirmReset && (
        <ConfirmPopup
          message="초기화하시겠습니까? 현재 작업 내용이 모두 삭제됩니다."
          confirmLabel="초기화"
          danger
          onConfirm={doReset}
          onCancel={() => setShowConfirmReset(false)}
        />
      )}

    </div>
  );
}

export default AssemblyPage;
