import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Select } from "antd";
import { useApp } from "../../state/AppContext";

import SequencePalette from "./SequencePalette";
import SequenceCanvas from "./SequenceCanvas";
import SequenceInspector from "./SequenceInspector";
import SequenceChatPanel from "./SequenceChatPanel";
import SequenceOptionPicker from "./SequenceOptionPicker";
import SequenceProcessRecommendationPopup from "./SequenceProcessRecommendationPopup";
import SavedPopup from "../../template/SavedPopup";
import { showPopup } from "../../template/popupUtils";
import {
  actionButtonStyle,
  chatFabStyle,
  selectStyle,
} from "./SequenceEditor.styles";
import {
  createSerializableFlowState,
  createSequenceWorkspaceContext,
  getFlowStateSnapshot,
  getSequenceDraftStorageKey,
  isTextEditingTarget,
  loadSequenceDraft,
  parseOptionSelectionAnswer,
  persistSequenceDraft,
} from "./sequenceEditorUtils";

const API_BASE = "http://localhost:8000";
const manualSelectFilterOption = (input, option) =>
  String(option?.label || "")
    .toLowerCase()
    .includes(String(input || "").trim().toLowerCase());

const getVisibleRecommendationReason = (reason) => {
  const normalized = String(reason || "").trim();
  if (!normalized) {
    return "";
  }
  if (/^graph traversal depth=\d+$/i.test(normalized)) {
    return "";
  }
  return normalized;
};

const isManualBarcodeReadingProcess = (process) => {
  const haystack = [
    process?.processKey,
    process?.label,
    process?.displayLabel,
    process?.operationLabel,
    process?.partBase,
    process?.contextPartBase,
    process?.reason,
  ]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
    .join(" ");
  const compact = haystack.replace(/[^A-Z0-9가-힣]+/g, "");
  const hasBarcode =
    haystack.includes("바코드") ||
    haystack.includes("BAR CODE") ||
    haystack.includes("BAR-CODE") ||
    haystack.includes("BARCODE");
  const hasReading =
    haystack.includes("리딩") ||
    haystack.includes("READ") ||
    haystack.includes("READING") ||
    haystack.includes("SCAN") ||
    haystack.includes("스캔");
  return (hasBarcode && hasReading) || haystack.includes("단순 리딩 작업") || compact.includes("단순리딩작업");
};

const filterManualBarcodeReadingProcesses = (processes) =>
  (Array.isArray(processes) ? processes : []).filter(
    (process) => !isManualBarcodeReadingProcess(process)
  );

const normalizeRecommendationKey = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^A-Z0-9가-힣/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildPartLookupCandidates = (partLike) =>
  Array.from(
    new Set(
      [
        String(partLike?.displayLabel || "").trim(),
        String(partLike?.partBase || "").trim(),
        String(partLike?.partName || "").trim(),
        String(partLike?.partId || "").trim(),
        String(partLike?.nodeName || "").trim(),
      ].filter(Boolean)
    )
  );

const filterSelfReferentialProcesses = (processes, part) => {
  const partKeys = new Set(
    [part?.partBase, part?.partName, part?.partId, part?.nodeName]
      .map((value) => normalizeRecommendationKey(value))
      .filter(Boolean)
  );

  return filterManualBarcodeReadingProcesses(processes).filter((process) => {
    const processKeys = [
      process?.label,
      process?.displayLabel,
      process?.operationLabel,
      process?.processKey,
      process?.partBase,
    ]
      .map((value) => normalizeRecommendationKey(value))
      .filter(Boolean);

    return !processKeys.some((key) => partKeys.has(key));
  });
};

const filterRedundantPartRecommendations = (processes, currentPart, selectedParts) => {
  const currentPartKeys = new Set(
    [currentPart?.partBase, currentPart?.partName, currentPart?.partId, currentPart?.nodeName]
      .map((value) => normalizeRecommendationKey(value))
      .filter(Boolean)
  );

  const otherSelectedPartKeys = new Set(
    (Array.isArray(selectedParts) ? selectedParts : []).flatMap((part) => {
      const normalizedKeys = [part?.partBase, part?.partName, part?.partId, part?.nodeName]
        .map((value) => normalizeRecommendationKey(value))
        .filter(Boolean);
      const overlapsCurrentPart = normalizedKeys.some((key) => currentPartKeys.has(key));
      return overlapsCurrentPart ? [] : normalizedKeys;
    })
  );

  if (!otherSelectedPartKeys.size) {
    return Array.isArray(processes) ? processes : [];
  }

  return (Array.isArray(processes) ? processes : []).filter((process) => {
    const processKeys = [
      process?.label,
      process?.displayLabel,
      process?.operationLabel,
      process?.processKey,
      process?.partBase,
    ]
      .map((value) => normalizeRecommendationKey(value))
      .filter(Boolean);

    return !processKeys.some((key) => otherSelectedPartKeys.has(key));
  });
};

const messageRequestsFastener = (message) =>
  /스크류|체결|볼트|나사|t\/?\s*screw|m\/?\s*screw|fastener/i.test(String(message || ""));

const messageRequestsExtraction = (message) =>
  /취출|배출|꺼내|꺼냄|언로딩|unload|take\s*out|extract/i.test(String(message || ""));

const hasFastenerRecommendation = (result) => {
  const readTexts = (item) =>
    [
      item?.processKey,
      item?.label,
      item?.displayLabel,
      item?.operationLabel,
      item?.partBase,
      item?.contextPartBase,
      item?.partLabel,
      item?.part?.partBase,
    ]
      .map((value) => String(value || "").toUpperCase())
      .join(" ");

  const processMatches = [
    ...(Array.isArray(result?.recommendedProcesses) ? result.recommendedProcesses : []),
    ...(Array.isArray(result?.perPartRecommendations)
      ? result.perPartRecommendations.flatMap((item) => item?.recommendedProcesses || [])
      : []),
  ];

  return processMatches.some((item) =>
    /(SCREW|T\/SCREW|M\/SCREW|체결|볼트|나사)/i.test(readTexts(item))
  );
};

const hasExtractionRecommendation = (result) => {
  const readTexts = (item) =>
    [
      item?.processKey,
      item?.label,
      item?.displayLabel,
      item?.operationLabel,
      item?.partBase,
      item?.contextPartBase,
      item?.partLabel,
      item?.part?.partBase,
      item?.option,
    ]
      .map((value) => String(value || "").toUpperCase())
      .join(" ");

  const processMatches = [
    ...(Array.isArray(result?.recommendedProcesses) ? result.recommendedProcesses : []),
    ...(Array.isArray(result?.perPartRecommendations)
      ? result.perPartRecommendations.flatMap((item) => item?.recommendedProcesses || [])
      : []),
  ];

  return processMatches.some((item) =>
    /(취출|배출|언로딩|UNLOAD|EXTRACT|TAKE\s*OUT)/i.test(readTexts(item))
  );
};

const buildExtractionProcessRecommendationFromTemplate = (process) => {
  if (!process) {
    return null;
  }
  const processKey = String(process.processKey || "").trim();
  if (!processKey) {
    return null;
  }
  return {
    processKey,
    processType: process.processType || "STANDARD",
    label: process.label || processKey,
    displayLabel: process.label || processKey,
    operationLabel: process.label || processKey,
    partBase: process.partBase || "",
    contextPartBase: process.partBase || "",
    sourceSheet: process.sourceSheet || "",
    reason: "취출 요청 우선 추천",
    score: 9999,
    options: [],
  };
};

const injectExtractionRecommendationIntoItems = (items, message, processTemplates) => {
  if (!messageRequestsExtraction(message)) {
    return Array.isArray(items) ? items : [];
  }

  const safeItems = Array.isArray(items) ? items.map((item) => ({ ...item, processes: [...(item?.processes || [])] })) : [];
  if (!safeItems.length) {
    return safeItems;
  }

  const extractionTemplate =
    (Array.isArray(processTemplates) ? processTemplates : []).find((process) => {
      const partBase = String(process?.partBase || "").trim();
      return /부품\(단품\)류 취출작업|부품.?단품.?류 취출작업/i.test(partBase);
    }) ||
    (Array.isArray(processTemplates) ? processTemplates : []).find((process) => {
      const haystack = [
        process?.partBase,
        process?.label,
        process?.processKey,
        process?.sourceSheet,
      ]
        .map((value) => String(value || ""))
        .join(" ");
      return /(취출|UNLOAD|EXTRACT|TAKE\s*OUT)/i.test(haystack);
    });

  const extractionProcess = buildExtractionProcessRecommendationFromTemplate(extractionTemplate);
  if (!extractionProcess) {
    return safeItems;
  }

  const targetIndex = safeItems.length - 1;
  const targetItem = safeItems[targetIndex];
  if (!targetItem) {
    return safeItems;
  }

  const alreadyHasExtraction = (targetItem.processes || []).some((process) => {
    const haystack = [
      process?.partBase,
      process?.label,
      process?.displayLabel,
      process?.operationLabel,
      process?.processKey,
    ]
      .map((value) => String(value || ""))
      .join(" ");
    return /(취출|UNLOAD|EXTRACT|TAKE\s*OUT)/i.test(haystack);
  });
  if (alreadyHasExtraction) {
    return safeItems;
  }

  safeItems[targetIndex] = {
    ...targetItem,
    processes: [extractionProcess, ...(targetItem.processes || [])],
  };
  return safeItems;
};

const filterManualBarcodeReadingSequence = (steps) =>
  (Array.isArray(steps) ? steps : []).filter(
    (step) => step?.type !== "PROCESS" || !isManualBarcodeReadingProcess(step)
  );

const normalizeSequenceOrderText = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^A-Z0-9가-힣/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SEQUENCE_ORDER_ALIAS_GROUPS = [
  ["HOUSING", "HSG", "하우징", "메인 하우징", "MAIN HOUSING"],
  ["DUST CAP", "DUST CAP COVER", "DUST CAP(COVER)", "DUST COVER", "더스트 커버", "더스트캡", "더스트 캡"],
  ["LENS", "렌즈", "MAIN LENS", "OTR LENS", "INR LENS"],
  ["BEZEL", "베젤", "MAIN BEZEL"],
  ["LDM", "LED DRIVE MODULE", "주광 LED 모듈", "주광 LED 모듈 ASS'Y", "광모듈", "광 모듈"],
  ["HEAT SINK", "H S", "히트싱크", "히트 싱크"],
  ["AIR BLOWING", "BLOWING", "에어블로잉", "에어 블로잉", "에어블로윙", "에어 블로윙", "블로잉", "블로윙"],
  ["설비 작동", "설비작동", "설비 스위치 ON", "스위치 ON", "작동", "OPERATE"],
  ["취출", "취출 작업", "단품 취출", "단순 취출", "부품 취출", "부품 단품 취출", "부품 단품류 취출 작업", "부품(단품)류 취출작업", "UNLOAD", "EXTRACT", "TAKE OUT"],
];

const buildSequenceOrderAliasCandidates = (...values) => {
  const normalizedValues = values
    .map((value) => normalizeSequenceOrderText(value))
    .filter(Boolean);
  if (!normalizedValues.length) {
    return [];
  }

  const matchedAliases = [];
  SEQUENCE_ORDER_ALIAS_GROUPS.forEach((group) => {
    const normalizedGroup = group
      .map((value) => normalizeSequenceOrderText(value))
      .filter(Boolean);
    if (
      normalizedGroup.some((alias) =>
        normalizedValues.some(
          (value) => value === alias || value.includes(alias) || alias.includes(value)
        )
      )
    ) {
      matchedAliases.push(...normalizedGroup);
    }
  });
  return Array.from(new Set(matchedAliases));
};

const buildSequenceOrderMessageTokens = (message) => {
  const normalizedMessage = normalizeSequenceOrderText(message);
  if (!normalizedMessage) {
    return [];
  }

  const tokens = [];
  let searchStart = 0;
  normalizedMessage.split(" ").forEach((rawToken) => {
    const token = String(rawToken || "").trim();
    if (!token) {
      return;
    }
    const index = normalizedMessage.indexOf(token, searchStart);
    if (index >= 0) {
      searchStart = index + token.length;
      tokens.push({ token, index });
    }
  });
  return tokens;
};

const buildOrderSearchCandidates = (...values) => {
  const candidates = [];
  values.forEach((value) => {
    const normalized = normalizeSequenceOrderText(value);
    if (!normalized) {
      return;
    }
    candidates.push(normalized);
    normalized
      .split(" ")
      .filter((token) => token.length >= 2)
      .forEach((token) => candidates.push(token));
  });
  buildSequenceOrderAliasCandidates(...values).forEach((candidate) => {
    candidates.push(candidate);
    candidate
      .split(" ")
      .filter((token) => token.length >= 2)
      .forEach((token) => candidates.push(token));
  });
  return Array.from(new Set(candidates));
};

const findSequenceOrderIndex = (message, ...values) => {
  const normalizedMessage = normalizeSequenceOrderText(message);
  if (!normalizedMessage) {
    return Number.POSITIVE_INFINITY;
  }
  const messageTokens = buildSequenceOrderMessageTokens(normalizedMessage);

  let bestIndex = Number.POSITIVE_INFINITY;
  buildOrderSearchCandidates(...values).forEach((candidate) => {
    const normalizedCandidate = normalizeSequenceOrderText(candidate);
    if (!normalizedCandidate) {
      return;
    }

    const exactIndex = normalizedMessage.indexOf(normalizedCandidate);
    if (exactIndex >= 0 && exactIndex < bestIndex) {
      bestIndex = exactIndex;
    }

    normalizedCandidate
      .split(" ")
      .filter((token) => token.length >= 2)
      .forEach((candidateToken) => {
        messageTokens.forEach(({ token, index }) => {
          if (
            token === candidateToken ||
            token.includes(candidateToken) ||
            candidateToken.includes(token)
          ) {
            if (index < bestIndex) {
              bestIndex = index;
            }
          }
        });
      });
  });
  return bestIndex;
};

const orderProcessesByMessage = (processes, item, message) =>
  (Array.isArray(processes) ? processes : [])
    .map((process, index) => ({
      ...process,
      __originalIndex: index,
      __orderIndex: findSequenceOrderIndex(
        message,
        process?.operationLabel,
        process?.label,
        process?.processKey,
        process?.partBase,
        item?.partLabel
      ),
    }))
    .sort((left, right) => {
      if (left.__orderIndex !== right.__orderIndex) {
        return left.__orderIndex - right.__orderIndex;
      }
      return left.__originalIndex - right.__originalIndex;
    })
    .map(({ __originalIndex, __orderIndex, ...process }) => process);

const orderRecommendationItemsByMessage = (items, message) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      ...item,
      __originalIndex: index,
      __orderIndex: findSequenceOrderIndex(
        message,
        item?.partLabel,
        item?.partNodeName,
        item?.partData?.partBase,
        item?.partData?.partName,
        item?.partData?.nodeName
      ),
      processes: orderProcessesByMessage(item?.processes, item, message),
    }))
    .sort((left, right) => {
      if (left.__orderIndex !== right.__orderIndex) {
        return left.__orderIndex - right.__orderIndex;
      }
      return left.__originalIndex - right.__originalIndex;
    })
    .map(({ __originalIndex, __orderIndex, ...item }) => item);

const orderSelectedEntriesByMessage = (entries, message) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      ...entry,
      __originalIndex: index,
      __orderIndex: findSequenceOrderIndex(
        message,
        entry?.item?.partLabel,
        entry?.item?.partNodeName,
        entry?.item?.partData?.partBase,
        entry?.item?.partData?.partName,
        entry?.item?.partData?.nodeName
      ),
      processes: orderProcessesByMessage(entry?.processes, entry?.item, message),
    }))
    .sort((left, right) => {
      if (left.__orderIndex !== right.__orderIndex) {
        return left.__orderIndex - right.__orderIndex;
      }
      return left.__originalIndex - right.__originalIndex;
    })
    .map(({ __originalIndex, __orderIndex, ...entry }) => entry);

export default function SequenceEditor() {
  const location = useLocation();
  const navigate = useNavigate();
  const { actions } = useApp();
  const params = new URLSearchParams(location.search);
  const bomId = params.get("bomId");
  const spec = params.get("spec");

  // ===============================
  // Data state
  // ===============================
  const [inhouseParts, setInhouseParts] = useState([]);
  const [chatCandidateParts, setChatCandidateParts] = useState([]);
  const [processTemplates, setProcessTemplates] = useState([]);

  // ===============================
  // React Flow state
  // ===============================
  const [flowState, setFlowState] = useState({
    nodes: [],
    edges: [],
    groups: [],
    workerGroups: [],
  });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [showSavedPopup, setShowSavedPopup] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingOptionSelection, setPendingOptionSelection] = useState(null);
  const [recommendedProcessKeys, setRecommendedProcessKeys] = useState([]);
  const [processRecommendationPopup, setProcessRecommendationPopup] = useState({
    open: false,
    title: "",
    items: [],
    message: "",
  });
  const [useAiForAutoBuild, setUseAiForAutoBuild] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      id: "assistant-welcome",
      role: "assistant",
      text:
        "자연어로 원하는 시퀀스를 적어주세요. 예: 메인 베젤과 렌즈 중심으로 플라스틱 체결 위주 공정을 추천해줘",
    },
  ]);

  const historyRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const flowStateRef = useRef(flowState);
  const lastSavedSnapshotRef = useRef(getFlowStateSnapshot(flowState));
  const restoredDraftKeyRef = useRef(null);
  const runtimeIdRef = useRef(0);
  const sequenceClipboardRef = useRef(null);
  const pasteSequenceCountRef = useRef(0);
  const HISTORY_LIMIT = 80;

  const nodes = flowState.nodes;
  const edges = flowState.edges;
  const groups = flowState.groups;
  const workerGroups = flowState.workerGroups;
  const usedPartNodeNames = useMemo(
    () =>
      nodes
        .filter((node) => node.type === "PART")
        .map((node) => String(node.data?.nodeName || "").trim())
        .filter(Boolean),
    [nodes]
  );

  const cloneFlowState = useCallback((value) => JSON.parse(JSON.stringify(value)), []);

  const nextRuntimeId = useCallback((prefix = "ID") => {
    runtimeIdRef.current += 1;
    return `${prefix}-${Date.now()}-${runtimeIdRef.current}`;
  }, []);

  const isPartLikeSequenceRecommendation = useCallback((item) => {
    const haystack = [
      item?.processKey,
      item?.displayLabel,
      item?.operationLabel,
      item?.label,
      item?.partBase,
    ]
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
      .join(" ");

    return haystack.includes("T/SCREW");
  }, []);

  useEffect(() => {
    if (bomId && spec) {
      return;
    }

    const workspaceContext = createSequenceWorkspaceContext();
    const nextParams = new URLSearchParams(location.search);
    nextParams.set("bomId", workspaceContext.bomId);
    nextParams.set("spec", workspaceContext.spec);
    navigate(
      {
        pathname: location.pathname,
        search: `?${nextParams.toString()}`,
      },
      { replace: true }
    );
  }, [bomId, location.pathname, location.search, navigate, spec]);

  useEffect(() => {
    if (!bomId || !spec) {
      return;
    }

    actions.setBomContext(bomId);
    actions.setSpec(spec);
  }, [actions.setBomContext, actions.setSpec, bomId, spec]);

  useEffect(() => {
    flowStateRef.current = flowState;
  }, [flowState]);

  useEffect(() => {
    const storageKey = getSequenceDraftStorageKey(bomId, spec);

    if (!storageKey) {
      restoredDraftKeyRef.current = null;
      return;
    }

    if (restoredDraftKeyRef.current === storageKey) {
      return;
    }

    const draft = loadSequenceDraft(bomId, spec);
    if (draft) {
      setFlowState(draft.flowState);
      flowStateRef.current = draft.flowState;
      setSelectedNodeId(draft.selectedNodeId);
      setSelectedEdgeId(draft.selectedEdgeId);
      lastSavedSnapshotRef.current =
        draft.lastSavedSnapshot ?? getFlowStateSnapshot(draft.flowState);
    } else {
      let cancelled = false;
      const loadSavedSequence = async () => {
        try {
          const res = await fetch(
            `${API_BASE}/api/sequence/load?bomId=${encodeURIComponent(bomId)}&spec=${encodeURIComponent(spec)}`,
            { credentials: "include" }
          );

          if (!res.ok) {
            throw new Error("시퀀스 저장본 로드 실패");
          }

          const data = await res.json();
          if (cancelled) {
            return;
          }

          const savedFlowState = createSerializableFlowState({
            nodes: data.nodes || [],
            edges: data.edges || [],
            groups: data.groups || [],
            workerGroups: data.workerGroups || [],
          });

          setFlowState(savedFlowState);
          flowStateRef.current = savedFlowState;
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          lastSavedSnapshotRef.current = getFlowStateSnapshot(savedFlowState);
          persistSequenceDraft({
            bomId,
            spec,
            flowState: savedFlowState,
            selectedNodeId: null,
            selectedEdgeId: null,
            lastSavedSnapshot: lastSavedSnapshotRef.current,
          });
        } catch (error) {
          if (cancelled) {
            return;
          }

          const emptyFlowState = {
            nodes: [],
            edges: [],
            groups: [],
            workerGroups: [],
          };
          setFlowState(emptyFlowState);
          flowStateRef.current = emptyFlowState;
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          lastSavedSnapshotRef.current = getFlowStateSnapshot(emptyFlowState);
        }
      };

      loadSavedSequence();

      return () => {
        cancelled = true;
      };
    }

    historyRef.current = [];
    redoHistoryRef.current = [];
    restoredDraftKeyRef.current = storageKey;
  }, [bomId, spec]);

  useEffect(() => {
    const storageKey = getSequenceDraftStorageKey(bomId, spec);
    if (!storageKey) {
      return;
    }

    if (restoredDraftKeyRef.current !== storageKey) {
      return;
    }

    persistSequenceDraft({
      bomId,
      spec,
      flowState,
      selectedNodeId,
      selectedEdgeId,
      lastSavedSnapshot: lastSavedSnapshotRef.current,
    });
  }, [bomId, flowState, selectedEdgeId, selectedNodeId, spec]);

  const applyFlowChange = useCallback(
    (updater, options = {}) => {
      const { recordHistory = true } = options;
      setFlowState((prev) => {
        const next =
          typeof updater === "function"
            ? updater(prev)
            : {
                ...prev,
                ...updater,
              };

        if (recordHistory) {
          historyRef.current.push(cloneFlowState(prev));
          if (historyRef.current.length > HISTORY_LIMIT) {
            historyRef.current.shift();
          }
          redoHistoryRef.current = [];
        }

        return next;
      });
    },
    [cloneFlowState]
  );

  const replaceFlowState = useCallback(
    (nextState, options = {}) => {
      applyFlowChange(
        () => ({
          nodes: Array.isArray(nextState.nodes) ? nextState.nodes : [],
          edges: Array.isArray(nextState.edges) ? nextState.edges : [],
          groups: Array.isArray(nextState.groups) ? nextState.groups : [],
          workerGroups: Array.isArray(nextState.workerGroups)
            ? nextState.workerGroups
            : [],
        }),
        options
      );
    },
    [applyFlowChange]
  );

  const setNodes = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        nodes: typeof updater === "function" ? updater(prev.nodes) : updater,
      }));
    },
    [applyFlowChange]
  );

  const setEdges = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        edges: typeof updater === "function" ? updater(prev.edges) : updater,
      }));
    },
    [applyFlowChange]
  );

  const setGroups = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        groups: typeof updater === "function" ? updater(prev.groups) : updater,
      }));
    },
    [applyFlowChange]
  );

  const setWorkerGroups = useCallback(
    (updater) => {
      applyFlowChange((prev) => ({
        ...prev,
        workerGroups:
          typeof updater === "function" ? updater(prev.workerGroups) : updater,
      }));
    },
    [applyFlowChange]
  );

  const undoFlowChange = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoHistoryRef.current.push(cloneFlowState(flowStateRef.current));
    setFlowState(previous);
  }, [cloneFlowState]);

  const redoFlowChange = useCallback(() => {
    const next = redoHistoryRef.current.pop();
    if (!next) return;
    historyRef.current.push(cloneFlowState(flowStateRef.current));
    setFlowState(next);
  }, [cloneFlowState]);

  // ===============================
  // UI state
  // ===============================
  const [loadingParts, setLoadingParts] = useState(false);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [autoBuildLoading, setAutoBuildLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manualOpen, setManualOpen] = useState(true);
  const [manualSheets, setManualSheets] = useState([]);
  const [manualPartBases, setManualPartBases] = useState([]);
  const [manualSheet, setManualSheet] = useState("");
  const [manualPartBase, setManualPartBase] = useState("");
  const [manualAllParts, setManualAllParts] = useState([]);
  const [manualSearchKey, setManualSearchKey] = useState("");
  const [selectedPalettePartNodeNames, setSelectedPalettePartNodeNames] = useState([]);
  const selectedPaletteParts = useMemo(
    () =>
      inhouseParts.filter((part) =>
        selectedPalettePartNodeNames.includes(part.nodeName)
      ),
    [inhouseParts, selectedPalettePartNodeNames]
  );
  const processTemplateLabelSet = useMemo(
    () =>
      new Set(
        (processTemplates || [])
          .map((process) => String(process.label || "").trim())
          .filter(Boolean)
      ),
    [processTemplates]
  );
  const recommendationProcessTemplates = useMemo(
    () => filterManualBarcodeReadingProcesses(processTemplates),
    [processTemplates]
  );
  const canvasPartCandidates = useMemo(
    () =>
      (nodes || [])
        .filter((node) => node.type === "PART")
        .map((node) => ({
          nodeName:
            String(node.data?.nodeName || "").trim() ||
            String(node.data?.partId || "").trim() ||
            node.id,
          partId:
            String(node.data?.partId || "").trim() ||
            String(node.data?.label || "").trim() ||
            String(node.data?.nodeName || "").trim() ||
            node.id,
          partName:
            String(node.data?.partName || "").trim() ||
            String(node.data?.partId || "").trim() ||
            String(node.data?.label || "").trim() ||
            node.id,
          partBase: String(node.data?.partBase || "").trim() || null,
          sourceSheet: String(node.data?.sourceSheet || "").trim() || null,
          treePath: Array.isArray(node.data?.treePath) ? node.data.treePath : [],
          parentName: node.data?.parentName || null,
          inhouse: Boolean(node.data?.inhouse),
        })),
    [nodes]
  );
  const effectiveChatCandidateParts = useMemo(() => {
    const merged = new Map();
    [...chatCandidateParts, ...inhouseParts, ...canvasPartCandidates].forEach((part, index) => {
      if (!part) {
        return;
      }
      const key = [
        String(part.nodeName || "").trim(),
        String(part.partId || "").trim(),
        String(part.partBase || "").trim(),
        String(part.partName || "").trim(),
        String(index),
      ]
        .filter(Boolean)
        .slice(0, 4)
        .join("::");
      const dedupeKey =
        [
          String(part.nodeName || "").trim(),
          String(part.partId || "").trim(),
          String(part.partBase || "").trim(),
          String(part.partName || "").trim(),
        ]
          .filter(Boolean)
          .join("::") || key;
      if (!merged.has(dedupeKey)) {
        merged.set(dedupeKey, part);
      }
    });
    return Array.from(merged.values());
  }, [canvasPartCandidates, chatCandidateParts, inhouseParts]);
  const currentPendingOptionItem = useMemo(() => {
    if (!pendingOptionSelection?.items?.length) {
      return null;
    }
    return pendingOptionSelection.items[pendingOptionSelection.currentIndex] || null;
  }, [pendingOptionSelection]);

  const saveSequence = useCallback(
    async ({ showAlert = true } = {}) => {
      if (!bomId || !spec) {
        if (showAlert) {
          showPopup("bomId / spec 없음", "warning");
        }
        return false;
      }

      const latestFlowState = flowStateRef.current || {
        nodes: [],
        edges: [],
        groups: [],
        workerGroups: [],
      };
      const serializedFlowState = createSerializableFlowState(latestFlowState);

      try {
        const res = await fetch(`${API_BASE}/api/sequence/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            bomId,
            spec,
            nodes: serializedFlowState.nodes,
            edges: serializedFlowState.edges,
            groups: serializedFlowState.groups,
            workerGroups: serializedFlowState.workerGroups,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "시퀀스 저장 실패");
        }

        if (showAlert) {
          setShowSavedPopup(true);
        }
        lastSavedSnapshotRef.current = JSON.stringify(serializedFlowState);
        persistSequenceDraft({
          bomId,
          spec,
          flowState: latestFlowState,
          selectedNodeId,
          selectedEdgeId,
          lastSavedSnapshot: lastSavedSnapshotRef.current,
        });
        return true;
      } catch (error) {
        console.error(error);
        if (showAlert) {
          showPopup(`저장 실패: ${error.message || "알 수 없는 오류"}`, "error");
        }
        return false;
      }
    },
    [bomId, spec]
  );

  // ===============================
  // Helpers
  // ===============================
  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  const getRecommendedNodeAnchor = useCallback((existingNodes = [], existingGroups = []) => {
    const safeNodes = Array.isArray(existingNodes) ? existingNodes : [];
    const getNodeSize = (node) => {
      const fallbackWidth = node?.type === "PROCESS" ? 220 : 180;
      const fallbackHeight = node?.type === "PROCESS" ? 80 : 84;
      return {
        width:
          Number(node?.measured?.width) ||
          Number(node?.width) ||
          fallbackWidth,
        height:
          Number(node?.measured?.height) ||
          Number(node?.height) ||
          fallbackHeight,
      };
    };

    const maxNodeBottom = safeNodes.reduce((currentMax, node) => {
      const nodeY = Number(node?.position?.y ?? 0);
      return Math.max(currentMax, nodeY + getNodeSize(node).height);
    }, 0);
    const nodeById = new Map(safeNodes.map((node) => [node.id, node]));
    const maxGroupBottom = (Array.isArray(existingGroups) ? existingGroups : []).reduce(
      (currentMax, group) => {
        const groupNodes = (group?.nodeIds || [])
          .map((nodeId) => nodeById.get(nodeId))
          .filter(Boolean);
        if (!groupNodes.length) {
          return currentMax;
        }
        const groupBottom = Math.max(
          ...groupNodes.map((node) => {
            const nodeY = Number(node?.position?.y ?? 0);
            return nodeY + getNodeSize(node).height;
          })
        );
        return Math.max(currentMax, groupBottom + 48);
      },
      0
    );
    const maxBottom = Math.max(maxNodeBottom, maxGroupBottom);

    return {
      startX: 120,
      startY: maxBottom > 0 ? maxBottom + 180 : 120,
      rowGap: 144,
      colGap: 220,
    };
  }, []);

  const addManualPartNode = useCallback(() => {
    if (!manualSheet || !manualPartBase) {
      showPopup("시트, 부품 기준을 모두 선택하세요.", "warning");
      return;
    }

    applyFlowChange((prev) => {
      const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);
      return {
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id: nextRuntimeId("N"),
            type: "PROCESS",
            position: {
              x: anchor.startX,
              y: anchor.startY,
            },
            data: {
              partBase: manualPartBase,
              contextPartBase: manualPartBase,
              partId: manualPartBase,
              partName: manualPartBase,
              sourceSheet: manualSheet,
              option: "",
              label: manualPartBase,
              inhouse: true,
              statusLabel: "",
              manualAdded: true,
            },
          },
        ],
      };
    });
  }, [applyFlowChange, getRecommendedNodeAnchor, manualSheet, manualPartBase, nextRuntimeId]);

  const addSearchPartNode = useCallback(() => {
    if (!manualSearchKey) return;
    const sep = manualSearchKey.indexOf("::");
    if (sep === -1) return;
    const partBase = manualSearchKey.slice(0, sep);
    const sheet = manualSearchKey.slice(sep + 2);

    applyFlowChange((prev) => {
      const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);
      return {
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id: nextRuntimeId("N"),
            type: "PROCESS",
            position: {
              x: anchor.startX,
              y: anchor.startY,
            },
            data: {
              partBase,
              contextPartBase: partBase,
              partId: partBase,
              partName: partBase,
              sourceSheet: sheet,
              option: "",
              label: partBase,
              inhouse: true,
              statusLabel: "",
              manualAdded: true,
            },
          },
        ],
      };
    });
    setManualSearchKey("");
  }, [applyFlowChange, getRecommendedNodeAnchor, manualSearchKey, nextRuntimeId]);

  const ensurePartsVisibleOnCanvas = useCallback(
    (partsToEnsure) => {
      const safeParts = Array.isArray(partsToEnsure) ? partsToEnsure.filter(Boolean) : [];
      if (!safeParts.length) {
        return;
      }

      applyFlowChange((prev) => {
        const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);
        const existingPartKeys = new Set(
          (prev.nodes || [])
            .filter((node) => node.type === "PART")
            .flatMap((node) => [
              String(node.data?.nodeName || "").trim(),
              String(node.data?.partBase || "").trim(),
              String(node.data?.partId || "").trim(),
            ])
            .filter(Boolean)
        );

        const nodesToAdd = [];
        let appendIndex = 0;

        for (const part of safeParts) {
          const candidateKeys = [
            String(part.nodeName || "").trim(),
            String(part.partBase || "").trim(),
            String(part.partId || "").trim(),
          ].filter(Boolean);
          if (!candidateKeys.length) {
            continue;
          }
          if (candidateKeys.some((key) => existingPartKeys.has(key))) {
            continue;
          }

          candidateKeys.forEach((key) => existingPartKeys.add(key));
          nodesToAdd.push({
            id: nextRuntimeId(`N-PART-${appendIndex}`),
            type: "PART",
            position: {
              x: anchor.startX,
              y: anchor.startY + appendIndex * anchor.rowGap,
            },
            data: {
              partId: part.partId || part.partBase || part.nodeName || "",
              partName: part.partName || part.partBase || part.nodeName || "",
              nodeName: part.nodeName || part.partBase || part.partId || "",
              inhouse: part.inhouse ?? true,
              partBase: part.partBase || "",
              sourceSheet: part.sourceSheet || "",
              option: "",
              statusLabel: "선택된 기준 부품",
              label: part.partBase || part.partName || part.partId || part.nodeName || "",
            },
          });
          appendIndex += 1;
        }

        if (!nodesToAdd.length) {
          return prev;
        }

        return {
          ...prev,
          nodes: [...(prev.nodes || []), ...nodesToAdd],
        };
      });
    },
    [applyFlowChange, getRecommendedNodeAnchor, nextRuntimeId]
  );

  const ensureRecommendedPartNode = useCallback(
    (recommendationItem) => {
      const partNodeName = String(recommendationItem?.partNodeName || "").trim();
      const sourcePart =
        inhouseParts.find((part) => String(part.nodeName || "").trim() === partNodeName) || null;
      let resolvedPartNodeId = null;

      applyFlowChange((prev) => {
        const existingPartNode = (prev.nodes || []).find((node) => {
          if (node.type !== "PART") {
            return false;
          }
          const nodeName = String(node.data?.nodeName || "").trim();
          const partBase = String(node.data?.partBase || "").trim();
          return (
            (partNodeName && nodeName === partNodeName) ||
            (recommendationItem?.partLabel &&
              partBase &&
              partBase === String(recommendationItem.partLabel || "").trim())
          );
        });

        if (existingPartNode) {
          resolvedPartNodeId = existingPartNode.id;
          return prev;
        }

        const generatedPartNodeId = nextRuntimeId("N-PART");
        resolvedPartNodeId = generatedPartNodeId;
        const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);

        return {
          ...prev,
          nodes: [
            ...(prev.nodes || []),
            {
              id: generatedPartNodeId,
              type: "PART",
              position: { x: anchor.startX, y: anchor.startY },
              data: {
                partId:
                  sourcePart?.partId ||
                  recommendationItem?.partLabel ||
                  recommendationItem?.partNodeName ||
                  "",
                partName:
                  sourcePart?.partName ||
                  recommendationItem?.partLabel ||
                  recommendationItem?.partNodeName ||
                  "",
                nodeName:
                  sourcePart?.nodeName ||
                  recommendationItem?.partNodeName ||
                  recommendationItem?.partLabel ||
                  "",
                inhouse: sourcePart?.inhouse ?? true,
                partBase: sourcePart?.partBase || recommendationItem?.partLabel || "",
                sourceSheet: sourcePart?.sourceSheet || "",
                option: "",
                statusLabel: "추천 기준 부품",
                label:
                  sourcePart?.partBase ||
                  recommendationItem?.partLabel ||
                  recommendationItem?.partNodeName ||
                  "",
              },
            },
          ],
        };
      });

      return resolvedPartNodeId;
    },
    [applyFlowChange, getRecommendedNodeAnchor, inhouseParts, nextRuntimeId]
  );

  const addRecommendedProcessNode = useCallback(
    (processRecommendation, recommendationItem, options = {}) => {
      const { deferOptionSelection = false } = options;
      if (!processRecommendation?.processKey) {
        return { processNodeId: null, partNodeId: null };
      }

      const shouldCreatePartNode = isPartLikeSequenceRecommendation(processRecommendation);
      const processNodeId = nextRuntimeId(shouldCreatePartNode ? "N-PART" : "N-PROC");
      const partNodeName = String(recommendationItem?.partNodeName || "").trim();
      const sourcePart =
        inhouseParts.find((part) => String(part.nodeName || "").trim() === partNodeName) || null;
      let createdProcessNodeId = processNodeId;
      let createdPartNodeId = null;

      applyFlowChange((prev) => {
        const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);
        const existingPartNode = (prev.nodes || []).find((node) => {
          if (node.type !== "PART") {
            return false;
          }
          const nodeName = String(node.data?.nodeName || "").trim();
          const partBase = String(node.data?.partBase || "").trim();
          return (
            (partNodeName && nodeName === partNodeName) ||
            (recommendationItem?.partLabel &&
              partBase &&
              partBase === String(recommendationItem.partLabel || "").trim())
          );
        });

        const baseX = anchor.startX;
        const baseY = anchor.startY;
        const nextNodes = (prev.nodes || []).map((node) => ({
          ...node,
          selected: false,
        }));

        let ensuredPartNodeId = existingPartNode?.id || null;
        if (!existingPartNode && (sourcePart || recommendationItem?.partLabel)) {
          const generatedPartNodeId = nextRuntimeId("N-PART");
          ensuredPartNodeId = generatedPartNodeId;
          createdPartNodeId = generatedPartNodeId;
          nextNodes.push({
            id: generatedPartNodeId,
            type: "PART",
            position: {
              x: baseX,
              y: baseY,
            },
            data: {
              partId:
                sourcePart?.partId ||
                recommendationItem?.partLabel ||
                recommendationItem?.partNodeName ||
                "",
              partName:
                sourcePart?.partName ||
                recommendationItem?.partLabel ||
                recommendationItem?.partNodeName ||
                "",
              nodeName:
                sourcePart?.nodeName ||
                recommendationItem?.partNodeName ||
                recommendationItem?.partLabel ||
                "",
              inhouse: sourcePart?.inhouse ?? true,
              partBase:
                sourcePart?.partBase ||
                recommendationItem?.partLabel ||
                "",
              sourceSheet: sourcePart?.sourceSheet || "",
              option: "",
              statusLabel: "추천 기준 부품",
              label:
                sourcePart?.partBase ||
                recommendationItem?.partLabel ||
                recommendationItem?.partNodeName ||
                "",
            },
            selected: false,
          });
        } else {
          createdPartNodeId = ensuredPartNodeId;
        }

        const nextNode = {
          id: processNodeId,
          type: shouldCreatePartNode ? "PART" : "PROCESS",
          position: {
            x: ensuredPartNodeId ? baseX + 220 : baseX,
            y: baseY,
          },
          data: {
            processKey: processRecommendation.processKey,
            processType: processRecommendation.processType || "STANDARD",
            label:
              processRecommendation.displayLabel ||
              processRecommendation.label ||
              processRecommendation.processKey,
            operationLabel:
              processRecommendation.operationLabel ||
              processRecommendation.label ||
              processRecommendation.processKey,
            partBase:
              sourcePart?.partBase ||
              recommendationItem?.partData?.partBase ||
              recommendationItem?.partLabel ||
              processRecommendation.partBase ||
              "",
            sourceSheet: processRecommendation.sourceSheet || "",
            option:
              Array.isArray(processRecommendation.options) &&
              processRecommendation.options.length === 1
                ? processRecommendation.options[0]
                : "",
            statusLabel: getVisibleRecommendationReason(processRecommendation.reason),
            partId: shouldCreatePartNode
              ? (
                  sourcePart?.partBase ||
                  recommendationItem?.partData?.partBase ||
                  recommendationItem?.partLabel ||
                  processRecommendation.partBase ||
                  processRecommendation.displayLabel ||
                  processRecommendation.label ||
                  processRecommendation.processKey
                )
              : (
                  processRecommendation.displayLabel ||
                  processRecommendation.label ||
                  processRecommendation.partBase ||
                  processRecommendation.processKey
                ),
            partName: shouldCreatePartNode
              ? (
                  sourcePart?.partBase ||
                  recommendationItem?.partData?.partBase ||
                  recommendationItem?.partLabel ||
                  processRecommendation.partBase ||
                  processRecommendation.displayLabel ||
                  processRecommendation.label ||
                  processRecommendation.processKey
                )
              : (
                  processRecommendation.displayLabel ||
                  processRecommendation.label ||
                  processRecommendation.partBase ||
                  processRecommendation.processKey
                ),
            nodeName: shouldCreatePartNode
              ? (
                  sourcePart?.nodeName ||
                  recommendationItem?.partNodeName ||
                  sourcePart?.partBase ||
                  recommendationItem?.partData?.partBase ||
                  recommendationItem?.partLabel ||
                  processRecommendation.partBase ||
                  processRecommendation.displayLabel ||
                  processRecommendation.label ||
                  processRecommendation.processKey
                )
              : (
                  processRecommendation.displayLabel ||
                  processRecommendation.label ||
                  processRecommendation.partBase ||
                  processRecommendation.processKey
                ),
            inhouse: true,
          },
          selected: true,
        };

        createdProcessNodeId = nextNode.id;

        return {
          ...prev,
          nodes: [...nextNodes, nextNode],
        };
      });

      setSelectedNodeId(createdProcessNodeId);
      setSelectedEdgeId(null);

      if (
        !deferOptionSelection &&
        Array.isArray(processRecommendation.options) &&
        processRecommendation.options.length > 1
      ) {
        setPendingOptionSelection({
          items: [
            {
              nodeIds: [createdProcessNodeId],
              nodeLabel: processRecommendation.label || processRecommendation.processKey,
              options: processRecommendation.options,
            },
          ],
          currentIndex: 0,
        });
      }

      return {
        processNodeId: createdProcessNodeId,
        partNodeId: createdPartNodeId,
      };
    },
    [applyFlowChange, getRecommendedNodeAnchor, inhouseParts, isPartLikeSequenceRecommendation, nextRuntimeId]
  );

  const togglePalettePartSelection = useCallback((part) => {
    const nodeName = String(part?.nodeName || "").trim();
    if (!nodeName) {
      return;
    }

    setSelectedPalettePartNodeNames((prev) =>
      prev.includes(nodeName)
        ? prev.filter((item) => item !== nodeName)
        : [...prev, nodeName]
    );
  }, []);

  const clearPalettePartSelection = useCallback(() => {
    setSelectedPalettePartNodeNames([]);
  }, []);

  const applyOptionToNodeIds = useCallback(
    (nodeIds, optionValue) => {
      const targetIds = new Set((nodeIds || []).filter(Boolean));
      if (!targetIds.size) {
        return;
      }

      applyFlowChange((prev) => ({
        ...prev,
        nodes: (prev.nodes || []).map((node) =>
          targetIds.has(node.id)
            ? {
                ...node,
                data: {
                  ...(node.data || {}),
                  option: optionValue,
                },
              }
            : node
        ),
      }));
    },
    [applyFlowChange]
  );

  const buildOptionPromptText = useCallback((pending) => {
    if (!pending?.items?.length) {
      return "";
    }

    const current = pending.items[pending.currentIndex];
    if (!current) {
      return "";
    }

    const optionLines = (current.options || [])
      .map((option, index) => `${index + 1}. ${option}`)
      .join("\n");

    return [
      `${current.nodeLabel} 옵션을 선택해주세요.`,
      optionLines,
      `${(current.options || []).length + 1}. 넘어가기`,
      "번호만 입력해도 됩니다.",
    ]
      .filter(Boolean)
      .join("\n");
  }, []);

  const confirmRecommendedProcesses = useCallback(
    async (selectedEntries, options = {}) => {
      const entries = orderSelectedEntriesByMessage(
        Array.isArray(selectedEntries) ? selectedEntries : [],
        processRecommendationPopup.message
      );
      if (!entries.length) {
        return;
      }
      const includePartNodes = options.includePartNodes !== false;
      const forceProcessNodes = options.forceProcessNodes === true;
      const mergeIntoSingleFlow = options.mergeIntoSingleFlow === true;
      const sequenceGroupLabel = String(options.groupLabel || "").trim();

      const pendingOptionCandidates = [];
      let lastSelectedNodeId = null;

      applyFlowChange((prev) => {
        const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);
        const nextNodes = [...(prev.nodes || [])];
        const nextEdges = [...(prev.edges || [])];
        const appendSequentialEdge = (source, target, groupId = "") => {
          if (!source || !target || source === target) {
            return;
          }

          nextEdges.push({
            id: `MANUAL:${groupId || "sequence"}:${source}:${target}`,
            source,
            target,
            type: "straight",
            sourceHandle: "out",
            targetHandle: "in",
            data: {
              manual: true,
              connectedByGroup: Boolean(groupId),
              groupId: groupId || undefined,
            },
          });
        };
        const createdPartNodeByEntryKey = new Map();
        const createdPartNodeByIdentity = new Map();
        const nextGroups = [...(prev.groups || [])];
        const findExistingPartNode = (sourcePart, item) => {
          const candidateKeys = [
            String(sourcePart?.nodeName || item?.partNodeName || "").trim(),
            String(sourcePart?.partBase || item?.partData?.partBase || item?.partLabel || "").trim(),
            String(sourcePart?.partId || item?.partData?.partId || "").trim(),
          ].filter(Boolean);

          if (!candidateKeys.length) {
            return null;
          }

          return (
            (nextNodes || []).find((node) => {
              if (node.type !== "PART") {
                return false;
              }
              const nodeKeys = [
                String(node.data?.nodeName || "").trim(),
                String(node.data?.partBase || "").trim(),
                String(node.data?.partId || "").trim(),
              ].filter(Boolean);
              return candidateKeys.some((key) => nodeKeys.includes(key));
            }) || null
          );
        };

        if (mergeIntoSingleFlow) {
          const mergedGroupNodeIds = [];
          const partNodeByIdentity = new Map();
          const mergedProcesses = [];
          const seenProcessSignatures = new Set();
          let createdReferencePartCount = 0;

          entries.forEach(({ item, processes }) => {
            const sourcePart =
              inhouseParts.find(
                (part) =>
                  String(part.nodeName || "").trim() === String(item?.partNodeName || "").trim()
              ) ||
              item?.partData ||
              null;

            if (sourcePart || item?.partLabel) {
              const partIdentity = [
                String(sourcePart?.nodeName || item?.partNodeName || "").trim(),
                String(sourcePart?.partBase || item?.partData?.partBase || item?.partLabel || "").trim(),
                String(sourcePart?.partId || item?.partData?.partId || "").trim(),
              ]
                .filter(Boolean)
                .join("::");

              if (!partNodeByIdentity.has(partIdentity)) {
                const existingPartNode = findExistingPartNode(sourcePart, item);
                const partNodeId = existingPartNode?.id || nextRuntimeId("N-PART");
                partNodeByIdentity.set(partIdentity, partNodeId);

                if (!existingPartNode) {
                  const referencePartIndex = createdReferencePartCount;
                  createdReferencePartCount += 1;
                  nextNodes.push({
                    id: partNodeId,
                    type: "PART",
                    position: {
                      x: anchor.startX + referencePartIndex * anchor.colGap,
                      y: anchor.startY,
                    },
                    data: {
                      partId:
                        sourcePart?.partId ||
                        sourcePart?.partBase ||
                        item?.partLabel ||
                        item?.partNodeName ||
                        "",
                      partName:
                        sourcePart?.partName ||
                        sourcePart?.partBase ||
                        item?.partLabel ||
                        item?.partNodeName ||
                        "",
                      nodeName:
                        sourcePart?.nodeName ||
                        item?.partNodeName ||
                        item?.partLabel ||
                        "",
                      inhouse: sourcePart?.inhouse ?? true,
                      partBase:
                        sourcePart?.partBase || item?.partData?.partBase || item?.partLabel || "",
                      sourceSheet: sourcePart?.sourceSheet || item?.partData?.sourceSheet || "",
                      option: "",
                      statusLabel: "선택 기준 부품",
                      label:
                        sourcePart?.partBase || item?.partData?.partBase || item?.partLabel || "",
                    },
                    selected: false,
                  });
                }

                lastSelectedNodeId = partNodeId;
              }
            }

            filterManualBarcodeReadingProcesses(processes).forEach((process) => {
              const sourcePartBase =
                sourcePart?.partBase || item?.partData?.partBase || item?.partLabel || "";
              const operationLabel = String(
                process.operationLabel || process.label || process.processKey || ""
              ).trim();
              const processKey = String(process.processKey || operationLabel).trim();
              const signature = processKey;
              if (!processKey || seenProcessSignatures.has(signature)) {
                return;
              }
              seenProcessSignatures.add(signature);
              mergedProcesses.push({
                process,
                operationLabel,
                processKey,
                processPartBase:
                  process.partBase || process.contextPartBase || sourcePartBase || "",
                sourceSheet: process.sourceSheet || sourcePart?.sourceSheet || "",
              });
            });
          });

          mergedProcesses.forEach((item, processIndex) => {
            const processNodeId = nextRuntimeId("N-PROC");
            nextNodes.push({
              id: processNodeId,
              type: "PROCESS",
              position: {
                x:
                  anchor.startX +
                  processIndex * anchor.colGap,
                y: anchor.startY + (createdReferencePartCount > 0 ? anchor.rowGap : 0),
              },
              data: {
                processKey: item.processKey,
                processType: item.process.processType || "STANDARD",
                label:
                  item.process.displayLabel ||
                  item.process.label ||
                  item.process.processKey,
                operationLabel: item.operationLabel,
                partBase: item.processPartBase,
                contextPartBase: item.process.contextPartBase || item.processPartBase,
                sourceSheet: item.sourceSheet,
                option: "",
                statusLabel: getVisibleRecommendationReason(item.process.reason),
                partId:
                  item.process.displayLabel ||
                  item.process.label ||
                  item.process.partBase ||
                  item.process.processKey,
                partName:
                  item.process.displayLabel ||
                  item.process.label ||
                  item.process.partBase ||
                  item.process.processKey,
                nodeName:
                  item.process.displayLabel ||
                  item.process.label ||
                  item.process.partBase ||
                  item.process.processKey,
                inhouse: true,
              },
              selected: true,
            });
            mergedGroupNodeIds.push(processNodeId);
            pendingOptionCandidates.push({
              type: "PROCESS",
              nodeIds: [processNodeId],
              nodeLabel:
                item.process.displayLabel ||
                item.process.operationLabel ||
                item.process.label ||
                item.process.processKey,
              options: Array.isArray(item.process.options) ? item.process.options : [],
              partBase: item.processPartBase,
              processLabel: item.operationLabel,
              sourceSheet: item.sourceSheet,
            });
            lastSelectedNodeId = processNodeId;
          });

          if (mergedGroupNodeIds.length >= 2) {
            const nextGroupId = nextRuntimeId("grp");
            nextGroups.push({
              id: nextGroupId,
              label: sequenceGroupLabel || "자동 시퀀스",
              nodeIds: mergedGroupNodeIds,
              skippedAutoEdgeIds: [],
            });

            for (let index = 0; index < mergedGroupNodeIds.length - 1; index += 1) {
              appendSequentialEdge(
                mergedGroupNodeIds[index],
                mergedGroupNodeIds[index + 1],
                nextGroupId
              );
            }
          }

          return {
            ...prev,
            nodes: nextNodes.map((node) => ({
              ...node,
              selected: node.id === lastSelectedNodeId,
            })),
            edges: nextEdges,
            groups: nextGroups,
          };
        }

        let previousEntryLastNodeId = null;
        let sequenceColumnIndex = 0;
        const sequenceRowY = anchor.startY;
        entries.forEach(({ item, processes }, entryIndex) => {
          const sourcePart =
            inhouseParts.find(
              (part) => String(part.nodeName || "").trim() === String(item?.partNodeName || "").trim()
            ) ||
            item?.partData ||
            null;
          const recommendedPartData = item?.partData || null;
          const effectivePartData = recommendedPartData || sourcePart || null;
          const orderedProcesses = orderProcessesByMessage(
            processes,
            item,
            processRecommendationPopup.message
          );

          const partIdentity = [
            String(item?.itemKey || "").trim(),
            String(sourcePart?.nodeName || effectivePartData?.nodeName || item?.partNodeName || "").trim(),
            String(effectivePartData?.partBase || item?.partLabel || "").trim(),
            String(effectivePartData?.partId || "").trim(),
          ]
            .filter(Boolean)
            .join("::");

          let partNode = null;
          if (includePartNodes) {
            partNode =
              createdPartNodeByEntryKey.get(String(item?.itemKey || "")) ||
              createdPartNodeByIdentity.get(partIdentity) ||
              null;
          }

          if (includePartNodes && !partNode && (sourcePart || item?.partLabel)) {
            const partNodeId = nextRuntimeId("N-PART");
            partNode = {
              id: partNodeId,
              type: "PART",
              position: {
                x: anchor.startX + sequenceColumnIndex * anchor.colGap,
                y: sequenceRowY,
              },
              data: {
                displayLabel:
                  effectivePartData?.displayLabel ||
                  item?.partLabel ||
                  effectivePartData?.partBase ||
                  effectivePartData?.partName ||
                  effectivePartData?.partId ||
                  item?.partNodeName ||
                  "",
                partId:
                  effectivePartData?.partId ||
                  effectivePartData?.partBase ||
                  item?.partLabel ||
                  item?.partNodeName ||
                  "",
                partName:
                  effectivePartData?.partName ||
                  effectivePartData?.partBase ||
                  item?.partLabel ||
                  item?.partNodeName ||
                  "",
                nodeName:
                  sourcePart?.nodeName ||
                  effectivePartData?.nodeName ||
                  item?.partNodeName ||
                  item?.partLabel ||
                  "",
                inhouse: sourcePart?.inhouse ?? effectivePartData?.inhouse ?? true,
                partBase: effectivePartData?.partBase || item?.partLabel || "",
                sourceSheet: effectivePartData?.sourceSheet || sourcePart?.sourceSheet || "",
                option:
                  "",
                statusLabel: "추천 기준 부품",
                label:
                  effectivePartData?.displayLabel ||
                  effectivePartData?.partBase ||
                  item?.partLabel ||
                  item?.partNodeName ||
                  "",
              },
              selected: false,
            };
            nextNodes.push(partNode);
            if (item?.itemKey) {
              createdPartNodeByEntryKey.set(String(item.itemKey), partNode);
            }
            if (partIdentity) {
              createdPartNodeByIdentity.set(partIdentity, partNode);
            }
            sequenceColumnIndex += 1;
          }

          if (includePartNodes && partNode?.id) {
            lastSelectedNodeId = partNode.id;
            pendingOptionCandidates.push({
              type: "PART",
              nodeIds: [partNode.id],
              nodeLabel: item.partLabel,
              options: Array.isArray(item?.partOptions) ? item.partOptions : [],
              displayLabel: effectivePartData?.displayLabel || item.partLabel || "",
              partBase:
                effectivePartData?.partBase ||
                item?.partData?.partBase ||
                item?.partLabel ||
                "",
              partName: effectivePartData?.partName || "",
              partId: effectivePartData?.partId || "",
              nodeName: effectivePartData?.nodeName || sourcePart?.nodeName || item?.partNodeName || "",
              sourceSheet: effectivePartData?.sourceSheet || sourcePart?.sourceSheet || "",
            });
          }

          const entryNodeIds = [];
          if (includePartNodes && partNode?.id) {
            entryNodeIds.push(partNode.id);
          }

          filterManualBarcodeReadingProcesses(orderedProcesses).forEach((process, processIndex) => {
            const shouldCreatePartNode =
              forceProcessNodes ? false : isPartLikeSequenceRecommendation(process);
            const processPartBase =
              process.partBase ||
              process.contextPartBase ||
              effectivePartData?.partBase ||
              sourcePart?.partBase ||
              item?.partData?.partBase ||
              item?.partLabel ||
              "";
            const operationLabel = String(
              process.operationLabel || process.label || process.processKey || ""
            ).trim();
            const processKey = String(process.processKey || operationLabel).trim();
            let processNode = null;
            if (processKey) {
              processNode = {
                id: nextRuntimeId(shouldCreatePartNode ? "N-PART" : "N-PROC"),
                type: shouldCreatePartNode ? "PART" : "PROCESS",
                position: {
                  x: anchor.startX + sequenceColumnIndex * anchor.colGap,
                  y: sequenceRowY,
                },
                data: {
                  processKey,
                  processType: process.processType || "STANDARD",
                  label:
                    process.displayLabel ||
                    process.label ||
                    process.processKey,
                  operationLabel,
                  partBase: processPartBase,
                  contextPartBase:
                    process.contextPartBase ||
                    effectivePartData?.partBase ||
                    sourcePart?.partBase ||
                    item?.partData?.partBase ||
                    item?.partLabel ||
                    "",
                  sourceSheet:
                    process.sourceSheet ||
                    effectivePartData?.sourceSheet ||
                    sourcePart?.sourceSheet ||
                    "",
                  option:
                    "",
                  statusLabel: getVisibleRecommendationReason(process.reason),
                  partId: shouldCreatePartNode
                    ? (
                        processPartBase ||
                        process.displayLabel ||
                        process.label ||
                        process.processKey
                      )
                    : (
                        process.displayLabel ||
                        process.label ||
                        process.partBase ||
                        process.processKey
                      ),
                  partName: shouldCreatePartNode
                    ? (
                        processPartBase ||
                        process.displayLabel ||
                        process.label ||
                        process.processKey
                      )
                    : (
                        process.displayLabel ||
                        process.label ||
                        process.partBase ||
                        process.processKey
                      ),
                  nodeName: shouldCreatePartNode
                    ? (
                        sourcePart?.nodeName ||
                        effectivePartData?.nodeName ||
                        item?.partNodeName ||
                        processPartBase ||
                        process.displayLabel ||
                        process.label ||
                        process.processKey
                      )
                    : (
                        process.displayLabel ||
                        process.label ||
                        process.partBase ||
                        process.processKey
                      ),
                  inhouse: true,
                },
                selected: true,
              };
              nextNodes.push(processNode);
              sequenceColumnIndex += 1;
            }

            if (processNode?.id) {
              entryNodeIds.push(processNode.id);
              lastSelectedNodeId = processNode.id;
              pendingOptionCandidates.push({
                type: shouldCreatePartNode ? "PART" : "PROCESS",
                nodeIds: [processNode.id],
                nodeLabel:
                  process.displayLabel ||
                  process.operationLabel ||
                  process.label ||
                  process.processKey,
                options: Array.isArray(process.options) ? process.options : [],
                displayLabel:
                  shouldCreatePartNode
                    ? (
                        process.displayLabel ||
                        effectivePartData?.displayLabel ||
                        item.partLabel ||
                        processPartBase
                      )
                    : "",
                partBase: processPartBase,
                partName:
                  shouldCreatePartNode
                    ? (
                        effectivePartData?.partName ||
                        process.displayLabel ||
                        process.label ||
                        processPartBase
                      )
                    : "",
                partId:
                  shouldCreatePartNode
                    ? (
                        effectivePartData?.partId ||
                        processPartBase
                      )
                    : "",
                nodeName:
                  shouldCreatePartNode
                    ? (
                        effectivePartData?.nodeName ||
                        sourcePart?.nodeName ||
                        item?.partNodeName ||
                        processPartBase
                      )
                    : "",
                processLabel: operationLabel,
                sourceSheet:
                  process.sourceSheet ||
                  effectivePartData?.sourceSheet ||
                  sourcePart?.sourceSheet ||
                  "",
              });
            }
          });

          for (let index = 0; index < entryNodeIds.length - 1; index += 1) {
            appendSequentialEdge(entryNodeIds[index], entryNodeIds[index + 1]);
          }
          if (previousEntryLastNodeId && entryNodeIds.length) {
            appendSequentialEdge(previousEntryLastNodeId, entryNodeIds[0]);
          }
          previousEntryLastNodeId =
            entryNodeIds[entryNodeIds.length - 1] || previousEntryLastNodeId;
        });

        const nextState = {
          ...prev,
          nodes: nextNodes.map((node) => ({
            ...node,
            selected: node.id === lastSelectedNodeId,
          })),
          edges: nextEdges,
          groups: nextGroups,
        };
        return nextState;
      });

      if (lastSelectedNodeId) {
        setSelectedNodeId(lastSelectedNodeId);
        setSelectedEdgeId(null);
      }

      setProcessRecommendationPopup((prev) => ({
        ...prev,
        open: false,
      }));

      const fetchOptionsForCandidate = async (candidate) => {
        const sourceSheet = String(candidate?.sourceSheet || "").trim();
        if (candidate?.type !== "PROCESS") {
          const partLookupCandidates = buildPartLookupCandidates(candidate);
          const fetchedPartOptions = await requestPartOptions(partLookupCandidates, sourceSheet);
          if (fetchedPartOptions.length) {
            return fetchedPartOptions;
          }
          return Array.isArray(candidate?.options) ? candidate.options : [];
        }

        const partBase = String(candidate?.partBase || "").trim();
        if (!partBase) {
          return Array.isArray(candidate?.options) ? candidate.options : [];
        }

        const endpoint = `/api/sequence/process/options?partBase=${encodeURIComponent(partBase)}&processLabel=${encodeURIComponent(
          String(candidate?.processLabel || "").trim()
        )}${sourceSheet ? `&sourceSheet=${encodeURIComponent(sourceSheet)}` : ""}`;

        try {
          const response = await fetch(`${API_BASE}${endpoint}`, {
            credentials: "include",
          });
          if (!response.ok) {
            return Array.isArray(candidate?.options) ? candidate.options : [];
          }
          const data = await response.json();
          const fetchedOptions = Array.isArray(data?.options) ? data.options : [];
          if (fetchedOptions.length) {
            return fetchedOptions;
          }
          return Array.isArray(candidate?.options) ? candidate.options : [];
        } catch (error) {
          return Array.isArray(candidate?.options) ? candidate.options : [];
        }
      };

      const resolvedPendingItems = (
        await Promise.all(
          pendingOptionCandidates.map(async (candidate) => {
            const options = await fetchOptionsForCandidate(candidate);
            if (!options.length) {
              return null;
            }
            return {
              nodeIds: candidate.nodeIds,
              nodeLabel: candidate.nodeLabel,
              options,
            };
          })
        )
      ).filter(Boolean);

      if (resolvedPendingItems.length) {
        setPendingOptionSelection({
          items: resolvedPendingItems,
          currentIndex: 0,
        });
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-option-start-${Date.now()}`,
            role: "assistant",
            text: buildOptionPromptText({
              items: resolvedPendingItems,
              currentIndex: 0,
            }),
          },
        ]);
      }
    },
    [
      applyFlowChange,
      API_BASE,
      buildOptionPromptText,
      getRecommendedNodeAnchor,
      inhouseParts,
      isPartLikeSequenceRecommendation,
      nextRuntimeId,
      processRecommendationPopup.message,
    ]
  );

  const resolvePendingOptionAnswer = useCallback(
    (answerText, { appendUserMessage = false } = {}) => {
      if (!pendingOptionSelection?.items?.length) {
        return;
      }

      const currentItem = pendingOptionSelection.items[pendingOptionSelection.currentIndex];
      const normalizedAnswer = String(answerText || "").trim();

      if (appendUserMessage && normalizedAnswer) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `user-option-${Date.now()}`,
            role: "user",
            text: normalizedAnswer,
          },
        ]);
      }

      const parsedAnswer = parseOptionSelectionAnswer(
        normalizedAnswer,
        (currentItem?.options || []).length,
        true
      );

      if (parsedAnswer.type === "invalid") {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-option-invalid-${Date.now()}`,
            role: "assistant",
            text: `응답을 이해하지 못했습니다.\n\n${buildOptionPromptText(
              pendingOptionSelection
            )}`,
          },
        ]);
        return;
      }

      const resolvedOption =
        parsedAnswer.type === "select"
          ? currentItem.options[parsedAnswer.index]
          : "";
      applyOptionToNodeIds(currentItem.nodeIds, resolvedOption);

      const nextIndex = pendingOptionSelection.currentIndex + 1;
      if (nextIndex < pendingOptionSelection.items.length) {
        const nextPending = {
          ...pendingOptionSelection,
          currentIndex: nextIndex,
        };
        setPendingOptionSelection(nextPending);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-option-next-${Date.now()}`,
            role: "assistant",
            text: [
              resolvedOption
                ? `${currentItem.nodeLabel} 옵션을 ${resolvedOption}로 반영했습니다.`
                : `${currentItem.nodeLabel} 옵션은 비워두었습니다.`,
              buildOptionPromptText(nextPending),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ]);
        return;
      }

      setPendingOptionSelection(null);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-option-done-${Date.now()}`,
          role: "assistant",
          text: resolvedOption
            ? `${currentItem.nodeLabel} 옵션을 ${resolvedOption}로 반영했습니다.\n\n남은 옵션 선택은 없습니다.`
            : `${currentItem.nodeLabel} 옵션은 비워두었습니다.\n\n남은 옵션 선택은 없습니다.`,
        },
      ]);
    },
    [applyOptionToNodeIds, buildOptionPromptText, pendingOptionSelection]
  );

  const requestChatRecommendations = useCallback(
    async (
      message,
      selectedPartsForRequest = null,
      limit = 5,
      { expandSelectedParts = true } = {}
    ) => {
      const effectiveSelectedParts =
        Array.isArray(selectedPartsForRequest) && selectedPartsForRequest.length
          ? selectedPartsForRequest
          : selectedPaletteParts;
      const requestBody = {
        bomId,
        spec,
        message,
        candidateParts: effectiveChatCandidateParts.map((part) => ({
          nodeName: part.nodeName,
          partId: part.partId,
          partName: part.partName,
          partBase: part.partBase,
          sourceSheet: part.sourceSheet,
          treePath: part.treePath || [],
          parentName: part.parentName || null,
        })),
        selectedParts: (effectiveSelectedParts || []).map((part) => ({
          nodeName: part.nodeName,
          partId: part.partId,
          partName: part.partName,
          partBase: part.partBase,
          sourceSheet: part.sourceSheet,
          treePath: part.treePath || [],
          parentName: part.parentName || null,
        })),
        processTemplates: recommendationProcessTemplates.map((process) => ({
          processKey: process.processKey,
          processType: process.processType,
          label: process.label,
          partBase: process.partBase,
          sourceSheet: process.sourceSheet,
        })),
        limit,
        expandSelectedParts,
        includePerPartRecommendations: true,
      };

      const needsFastener = messageRequestsFastener(message);
      const needsExtraction = messageRequestsExtraction(message);
      const maxAttempts = needsFastener || needsExtraction ? 2 : 1;
      let lastResult = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const retryHints = [];
        if (attempt > 0) {
          if (needsFastener) {
            retryHints.push("스크류(T/SCREW) 또는 체결 부품을 반드시 포함해서 추천해줘");
          }
          if (needsExtraction) {
            retryHints.push("취출 공정 또는 부품(단품)류 취출작업을 반드시 포함해서 추천해줘");
          }
        }
        const response = await fetch(`${API_BASE}/api/sequence/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            ...requestBody,
            message: attempt === 0 || !retryHints.length ? message : `${message}\n${retryHints.join("\n")}`,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "공정 추천 요청 실패");
        }

        lastResult = await response.json();
        const fastenerSatisfied = !needsFastener || hasFastenerRecommendation(lastResult);
        const extractionSatisfied = !needsExtraction || hasExtractionRecommendation(lastResult);
        if (fastenerSatisfied && extractionSatisfied) {
          return lastResult;
        }
      }

      return lastResult;
    },
    [bomId, effectiveChatCandidateParts, recommendationProcessTemplates, selectedPaletteParts, spec]
  );

  const requestNextProcessRecommendations = useCallback(
    async (selectedPartsForRequest = selectedPaletteParts, limit = 5) => {
      const response = await fetch(`${API_BASE}/api/sequence/recommend-next-processes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          bomId,
          spec,
          selectedParts: (selectedPartsForRequest || []).map((part) => ({
            nodeName: part.nodeName,
            partId: part.partId,
            partName: part.partName,
            partBase: part.partBase,
            sourceSheet: part.sourceSheet,
            treePath: part.treePath || [],
            parentName: part.parentName || null,
          })),
          processTemplates: recommendationProcessTemplates.map((process) => ({
            processKey: process.processKey,
            processType: process.processType,
            label: process.label,
            partBase: process.partBase,
            sourceSheet: process.sourceSheet,
          })),
          limit,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "다음 공정 추천 요청 실패");
      }

      return response.json();
    },
    [bomId, recommendationProcessTemplates, selectedPaletteParts, spec]
  );

  const requestChatPerPartRecommendations = useCallback(
    async (message, selectedPartsForRequest = [], limit = 5) => {
      const response = await fetch(`${API_BASE}/api/sequence/chat/per-part`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          bomId,
          spec,
          message,
          selectedParts: (selectedPartsForRequest || []).map((part) => ({
            nodeName: part.nodeName,
            partId: part.partId,
            partName: part.partName,
            partBase: part.partBase,
            sourceSheet: part.sourceSheet,
            treePath: part.treePath || [],
            parentName: part.parentName || null,
          })),
          processTemplates: recommendationProcessTemplates.map((process) => ({
            processKey: process.processKey,
            processType: process.processType,
            label: process.label,
            partBase: process.partBase,
            sourceSheet: process.sourceSheet,
          })),
          limit,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "부품별 공정 추천 요청 실패");
      }

      return response.json();
    },
    [bomId, recommendationProcessTemplates, spec]
  );

  const requestSequenceAiDraft = useCallback(
    async (
      selectedPartsForRequest,
      maxProcesses = 5,
      processTemplatesForRequest = recommendationProcessTemplates,
      { timeoutMs = 0 } = {}
    ) => {
      const templatePayload = Array.isArray(processTemplatesForRequest)
        ? processTemplatesForRequest
        : recommendationProcessTemplates;
      const abortController =
        timeoutMs > 0 && typeof AbortController !== "undefined"
          ? new AbortController()
          : null;
      const timeoutId = abortController
        ? window.setTimeout(() => abortController.abort(), timeoutMs)
        : null;
      const response = await fetch(`${API_BASE}/api/sequence/ai-draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        signal: abortController?.signal,
        body: JSON.stringify({
          bomId,
          spec,
          selectedParts: (selectedPartsForRequest || []).map((part) => ({
            nodeName: part.nodeName,
            partId: part.partId,
            partName: part.partName,
            partBase: part.partBase,
            sourceSheet: part.sourceSheet,
            treePath: part.treePath || [],
            parentName: part.parentName || null,
          })),
          processTemplates: templatePayload.map((process) => ({
            processKey: process.processKey,
            processType: process.processType,
            label: process.label,
            partBase: process.partBase,
            sourceSheet: process.sourceSheet,
          })),
          options: {
            maxProcesses,
            layoutDirection: "LR",
            autoConnect: true,
          },
        }),
      }).finally(() => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "AI 초안 생성 실패");
      }

      return response.json();
    },
    [bomId, recommendationProcessTemplates, spec]
  );

  const requestPartOptions = useCallback(async (partLike, sourceSheet = "") => {
    const lookupCandidates = Array.isArray(partLike)
      ? Array.from(new Set(partLike.map((value) => String(value || "").trim()).filter(Boolean)))
      : typeof partLike === "object" && partLike !== null
        ? buildPartLookupCandidates(partLike)
        : [String(partLike || "").trim()].filter(Boolean);
    if (!lookupCandidates.length) {
      return [];
    }

    const fetchOptions = async (candidatePartBase, sheet = "") => {
      const response = await fetch(
        `${API_BASE}/api/sequence/part/options?partBase=${encodeURIComponent(candidatePartBase)}${
          sheet ? `&sourceSheet=${encodeURIComponent(String(sheet).trim())}` : ""
        }`,
        { credentials: "include" }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return Array.isArray(data?.options) ? data.options : [];
    };

    for (const candidatePartBase of lookupCandidates) {
      const primaryOptions = await fetchOptions(candidatePartBase, sourceSheet);
      if (primaryOptions.length || !sourceSheet) {
        if (primaryOptions.length) {
          return primaryOptions;
        }
        continue;
      }

      const fallbackOptions = await fetchOptions(candidatePartBase, "");
      if (fallbackOptions.length) {
        return fallbackOptions;
      }
    }

    return [];
  }, []);

  const requestProcessOptions = useCallback(async ({ partBase, processLabel, sourceSheet = "" }) => {
    const normalizedPartBase = String(partBase || "").trim();
    const normalizedProcessLabel = String(processLabel || "").trim();
    if (!normalizedPartBase || !normalizedProcessLabel) {
      return [];
    }

    const fetchOptions = async (sheet = "") => {
      const response = await fetch(
        `${API_BASE}/api/sequence/process/options?partBase=${encodeURIComponent(
          normalizedPartBase
        )}&processLabel=${encodeURIComponent(normalizedProcessLabel)}${
          sheet ? `&sourceSheet=${encodeURIComponent(String(sheet).trim())}` : ""
        }`,
        { credentials: "include" }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return Array.isArray(data?.options) ? data.options : [];
    };

    const primaryOptions = await fetchOptions(sourceSheet);
    if (primaryOptions.length || !sourceSheet) {
      return primaryOptions;
    }

    return fetchOptions("");
  }, []);

  const writeSequenceDebugLog = useCallback(
    (stage, payload = {}) => {
      try {
        fetch(`${API_BASE}/api/sequence/debug-print`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({
            stage,
            payload,
          }),
        }).catch(() => {});
      } catch (_error) {
        // 파일 로그 저장 실패는 자동 구성 흐름을 막지 않음
      }
      return Promise.resolve();
    },
    [API_BASE]
  );

  const openPerPartRecommendationPopup = useCallback(
    async ({
      selectedPartsForRequest,
      title,
      fetchRecommendation,
      includeOptions = false,
      message = "",
      perPartRecommendations = [],
    }) => {
      const parts = Array.isArray(selectedPartsForRequest)
        ? selectedPartsForRequest.filter((part) => {
            if (!part) {
              return false;
            }
            const candidates = [
              String(part.partBase || "").trim(),
              String(part.partName || "").trim(),
              String(part.partId || "").trim(),
              String(part.nodeName || "").trim(),
            ].filter(Boolean);
            return !candidates.some((value) => processTemplateLabelSet.has(value));
          })
        : [];
      const dedupedParts = Array.from(
        new Map(
          parts.map((part) => {
            const dedupeKey = [
              String(part.partBase || "").trim(),
              String(part.partId || "").trim(),
              String(part.partName || "").trim(),
              String(part.nodeName || "").trim(),
            ]
              .filter(Boolean)
              .slice(0, 3)
              .join("::");
            return [dedupeKey, part];
          })
        ).values()
      );
      if (!dedupedParts.length) {
        throw new Error("추천할 부품을 먼저 선택하세요.");
      }

      const perPartRecommendationMap = new Map(
        (Array.isArray(perPartRecommendations) ? perPartRecommendations : []).map((item) => {
          const part = item?.part || {};
          const dedupeKey = [
            String(part.partBase || "").trim(),
            String(part.partId || "").trim(),
            String(part.partName || "").trim(),
            String(part.nodeName || "").trim(),
          ]
            .filter(Boolean)
            .slice(0, 3)
            .join("::");
          return [dedupeKey, item];
        })
      );

      if (!perPartRecommendationMap.size) {
        const batchResult = await requestChatPerPartRecommendations(message, dedupedParts, 5);
        (Array.isArray(batchResult?.perPartRecommendations) ? batchResult.perPartRecommendations : []).forEach(
          (item) => {
            const part = item?.part || {};
            const dedupeKey = [
              String(part.partBase || "").trim(),
              String(part.partId || "").trim(),
              String(part.partName || "").trim(),
              String(part.nodeName || "").trim(),
            ]
              .filter(Boolean)
              .slice(0, 3)
              .join("::");
            if (dedupeKey) {
              perPartRecommendationMap.set(dedupeKey, item);
            }
          }
        );
      }

      const results = await Promise.all(
        dedupedParts.map(async (part, index) => {
          const partKey = [
            String(part.partBase || "").trim(),
            String(part.partId || "").trim(),
            String(part.partName || "").trim(),
            String(part.nodeName || "").trim(),
          ]
            .filter(Boolean)
            .slice(0, 3)
            .join("::");
          const cachedRecommendation = perPartRecommendationMap.get(partKey);
          const result =
            cachedRecommendation ||
            (typeof fetchRecommendation === "function"
              ? await fetchRecommendation(part, message)
              : { recommendedProcesses: [], recommendedOptions: [], reply: "" });
          const optionsByTargetKey = new Map(
            includeOptions
              ? (result.recommendedOptions || []).flatMap((item) => {
                  const targetType = String(item.targetType || "").trim().toUpperCase();
                  const targetKey = String(item.targetKey || "").trim();
                  if (!targetKey) {
                    return [];
                  }
                  return [
                    [`${targetType}::${targetKey}`, item.options || []],
                    [targetKey, item.options || []],
                  ];
                })
              : []
          );
          const readRecommendedOptions = (targetType, targetKey) => {
            const normalizedType = String(targetType || "").trim().toUpperCase();
            const normalizedKey = String(targetKey || "").trim();
            if (!normalizedKey) {
              return [];
            }
            return (
              optionsByTargetKey.get(`${normalizedType}::${normalizedKey}`) ||
              optionsByTargetKey.get(normalizedKey) ||
              []
            );
          };
          const partOptionKey = String(
            part.partBase || part.partName || part.partId || part.nodeName || ""
          ).trim();
          const recommendedPartOptions = includeOptions
            ? readRecommendedOptions("PART", partOptionKey)
            : [];

          const partOptions = includeOptions
            ? recommendedPartOptions.length
              ? recommendedPartOptions
              : await requestPartOptions(part, part.sourceSheet)
            : [];

          const filteredProcesses = filterRedundantPartRecommendations(
            filterSelfReferentialProcesses(result.recommendedProcesses, part),
            part,
            dedupedParts
          );

          const processes = await Promise.all(
            filteredProcesses.map(async (process) => {
              const processOptionKey = String(
                process.operationLabel || process.label || process.processKey || ""
              ).trim();
              const recommendedProcessOptions = includeOptions
                ? readRecommendedOptions("PROCESS", processOptionKey)
                : [];
              const recommendedProcessKeyOptions = includeOptions
                ? readRecommendedOptions("PROCESS", String(process.processKey || "").trim())
                : [];
              const processOptions = includeOptions
                ? recommendedProcessOptions.length
                  ? recommendedProcessOptions
                  : recommendedProcessKeyOptions.length
                    ? recommendedProcessKeyOptions
                    : await requestProcessOptions({
                        partBase: process.partBase || part.partBase,
                        processLabel: process.operationLabel || process.label,
                        sourceSheet: process.sourceSheet || part.sourceSheet,
                      })
                : [];

              return {
                ...process,
                options: processOptions,
              };
            })
          );

          return {
            itemKey: [
              String(part.nodeName || "").trim(),
              String(part.partBase || "").trim(),
              String(part.partId || "").trim(),
              String(part.partName || "").trim(),
              String(index),
            ]
              .filter(Boolean)
              .join("::"),
            partNodeName: String(part.nodeName || "").trim(),
            partLabel:
              part.displayLabel || part.partBase || part.partName || part.partId || part.nodeName || "이름 없음",
            partData: part,
            reply: result.reply || "",
            partOptions,
            processes,
          };
        })
      );

      const orderedResults = injectExtractionRecommendationIntoItems(
        orderRecommendationItemsByMessage(results, message),
        message,
        recommendationProcessTemplates
      );
      const recommendedKeys = orderedResults.flatMap((item) =>
        (item.processes || [])
          .map((process) => String(process.processKey || "").trim())
          .filter(Boolean)
      );
      setRecommendedProcessKeys(Array.from(new Set(recommendedKeys)));
      setProcessRecommendationPopup({
        open: true,
        title,
        items: orderedResults,
        message,
      });
    },
    [
      processTemplateLabelSet,
      recommendationProcessTemplates,
      requestChatPerPartRecommendations,
      requestPartOptions,
      requestProcessOptions,
    ]
  );

  const buildAiSequenceDraft = useCallback(async () => {
    if (!bomId || !spec) {
      showPopup("bomId / spec 없음", "warning");
      return;
    }

      const inhousePartByNodeName = new Map(
        inhouseParts.map((part) => [String(part.nodeName || "").trim(), part])
      );
      const selectedParts = selectedPalettePartNodeNames
        .map((nodeName) => inhousePartByNodeName.get(String(nodeName || "").trim()))
        .filter(Boolean);
      const filteredSelectedParts = selectedParts.filter((part) => {
        const candidates = [
          String(part.partBase || "").trim(),
          String(part.partId || "").trim(),
          String(part.nodeName || "").trim(),
          String(part.partName || "").trim(),
        ].filter(Boolean);
        return !candidates.some((value) => processTemplateLabelSet.has(value));
      });

    if (filteredSelectedParts.length === 0) {
      showPopup("자동 구성할 사내 부품을 선택하세요.", "warning");
      return;
    }

    if (recommendationProcessTemplates.length === 0) {
      showPopup("사용 가능한 공정 템플릿이 없습니다.", "warning");
      return;
    }

    setAutoBuildLoading(true);
    await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_START", {
      bomId,
      spec,
      useAiForAutoBuild,
      selectedPartCount: filteredSelectedParts.length,
      selectedPartNodeNames: filteredSelectedParts.map((part) => part.nodeName),
    });

    try {
      const selectedPartKeySet = new Set(
        filteredSelectedParts
          .flatMap((part) => [
            String(part.partBase || "").trim(),
            String(part.nodeName || "").trim(),
            String(part.partId || "").trim(),
          ])
          .filter(Boolean)
      );
      const buildSequenceFromAiDraft = (aiDraft) => {
        const steps = Array.isArray(aiDraft?.sequence) ? aiDraft.sequence : [];
        const usedPartKeys = new Set();
        const usedProcessKeys = new Set();
        const sequence = [];

        for (const step of steps) {
          if (step?.type === "PART") {
            const sourcePart = filteredSelectedParts.find(
              (part) => String(part.nodeName || "").trim() === String(step.nodeName || "").trim()
            );
            if (!sourcePart) {
              continue;
            }
            const partKey =
              String(sourcePart.partBase || "").trim() ||
              String(sourcePart.nodeName || "").trim() ||
              String(sourcePart.partId || "").trim();
            if (!partKey || usedPartKeys.has(partKey)) {
              continue;
            }
            usedPartKeys.add(partKey);
            sequence.push({
              type: "PART",
              nodeName: sourcePart.nodeName,
              partId: sourcePart.partId,
              partName: sourcePart.partName,
              partBase: sourcePart.partBase,
              sourceSheet: sourcePart.sourceSheet,
              label: sourcePart.partBase || sourcePart.partName || sourcePart.partId || sourcePart.nodeName,
              reason: step.reason || "Gemma RAG 선택 부품",
            });
            continue;
          }

          if (step?.type !== "PROCESS") {
            continue;
          }

          const processKey = String(step.processKey || "").trim();
          if (!processKey || usedProcessKeys.has(processKey) || isManualBarcodeReadingProcess(step)) {
            continue;
          }
          const process = recommendationProcessTemplates.find(
            (item) => String(item.processKey || "").trim() === processKey
          );
          if (!process) {
            continue;
          }
          const processPartBase = String(process.partBase || "").trim();
          if (processPartBase && selectedPartKeySet.has(processPartBase)) {
            continue;
          }

          usedProcessKeys.add(processKey);
          sequence.push({
            type: "PROCESS",
            processKey,
            processType: process.processType || "STANDARD",
            label: process.label,
            displayLabel: process.label,
            operationLabel: process.label,
            partBase: process.partBase,
            contextPartBase: filteredSelectedParts
              .map((part) => String(part.partBase || part.partId || part.nodeName || "").trim())
              .filter(Boolean)
              .join(", "),
            sourceSheet: process.sourceSheet,
            reason: step.reason || "Gemma RAG 추천 공정",
            score: Number(aiDraft?.confidence || 0),
          });
        }

        return sequence;
      };
      const findProcessTemplateByKey = (processKey) => {
        const normalizedProcessKey = String(processKey || "").trim();
        if (!normalizedProcessKey) {
          return null;
        }
        return (
          recommendationProcessTemplates.find(
            (item) => String(item.processKey || "").trim() === normalizedProcessKey
          ) || null
        );
      };
      const normalizeProcessStepForAiReview = (step) => {
        if (!step || step.type !== "PROCESS") {
          return null;
        }
        const processKey = String(step.processKey || step.label || "").trim();
        if (!processKey) {
          return null;
        }
        const template = findProcessTemplateByKey(processKey);
        return {
          processKey,
          processType: step.processType || template?.processType || "STANDARD",
          label: step.label || step.displayLabel || template?.label || processKey,
          partBase: step.partBase || template?.partBase || "",
          sourceSheet: step.sourceSheet || template?.sourceSheet || "",
        };
      };
      const extractGraphProcessTemplates = (result) => {
        const candidates = [
          ...(Array.isArray(result?.recommendedSequence)
            ? result.recommendedSequence
            : []),
          ...(Array.isArray(result?.recommendedProcesses)
            ? result.recommendedProcesses
            : []),
        ];
        const deduped = new Map();
        candidates.forEach((step) => {
          const processTemplate = normalizeProcessStepForAiReview(step);
          if (!processTemplate) {
            return;
          }
          deduped.set(processTemplate.processKey, processTemplate);
        });
        return Array.from(deduped.values());
      };

      let graphResult = await requestNextProcessRecommendations(filteredSelectedParts, 8);
      graphResult.recommendationSource = "graph-fast";

      const hasGraphRecommendation =
        (Array.isArray(graphResult?.recommendedSequence) &&
          graphResult.recommendedSequence.some((step) => step?.type === "PROCESS")) ||
        (Array.isArray(graphResult?.recommendedProcesses) &&
          graphResult.recommendedProcesses.length > 0);

      if (useAiForAutoBuild && hasGraphRecommendation) {
        const graphProcessTemplates = extractGraphProcessTemplates(graphResult);
        if (graphProcessTemplates.length) {
          try {
            const aiDraft = await requestSequenceAiDraft(
              filteredSelectedParts,
              8,
              graphProcessTemplates
            );
            const aiReviewedSequence = buildSequenceFromAiDraft(aiDraft);
            const aiPartCount = aiReviewedSequence.filter((step) => step?.type === "PART").length;
            const aiProcessCount = aiReviewedSequence.filter((step) => step?.type === "PROCESS").length;
            const aiConfidence = Number(aiDraft?.confidence || 0);
            await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_AI_REVIEW_RECEIVED", {
              provider: aiDraft?.provider,
              model: aiDraft?.model,
              confidence: aiConfidence,
              graphProcessCandidateCount: graphProcessTemplates.length,
              stepCount: aiReviewedSequence.length,
              partCount: aiPartCount,
              processCount: aiProcessCount,
              warnings: aiDraft?.warnings || [],
            });

            if (
              aiPartCount >= Math.min(2, filteredSelectedParts.length) &&
              aiProcessCount > 0 &&
              aiConfidence >= 0.15
            ) {
              graphResult = {
                ...graphResult,
                recommendedProcesses: [],
                recommendedSequence: aiReviewedSequence,
                recommendationSource: "graph-ai-reviewed",
              };
            }
          } catch (aiReviewError) {
            await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_AI_REVIEW_FAILED", {
              message: aiReviewError?.message || "알 수 없는 오류",
              graphProcessCandidateCount: graphProcessTemplates.length,
            });
          }
        }
      } else if (useAiForAutoBuild && !hasGraphRecommendation) {
        try {
          const aiDraft = await requestSequenceAiDraft(filteredSelectedParts, 8);
          const aiRecommendedSequence = buildSequenceFromAiDraft(aiDraft);
          const aiPartCount = aiRecommendedSequence.filter((step) => step?.type === "PART").length;
          const aiProcessCount = aiRecommendedSequence.filter((step) => step?.type === "PROCESS").length;
          const aiConfidence = Number(aiDraft?.confidence || 0);
          await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_GEMMA_RECEIVED", {
            provider: aiDraft?.provider,
            model: aiDraft?.model,
            confidence: aiConfidence,
            stepCount: aiRecommendedSequence.length,
            partCount: aiPartCount,
            processCount: aiProcessCount,
            warnings: aiDraft?.warnings || [],
          });

          if (
            aiPartCount >= Math.min(2, filteredSelectedParts.length) &&
            aiProcessCount > 0 &&
            aiConfidence >= 0.15
          ) {
            graphResult = {
              recommendedProcesses: [],
              recommendedSequence: aiRecommendedSequence,
              recommendationSource: "gemma-rag-fallback",
            };
          } else {
            await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_GEMMA_FALLBACK", {
              reason: "Graph와 Gemma 모두 적용 가능한 공정을 만들지 못함",
              confidence: aiConfidence,
              partCount: aiPartCount,
              processCount: aiProcessCount,
            });
          }
        } catch (aiError) {
          await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_GEMMA_FAILED", {
            message: aiError?.message || "알 수 없는 오류",
          });
        }
      }
      const recommendedSequence = filterManualBarcodeReadingSequence(
        graphResult?.recommendedSequence
      );
      if (recommendedSequence.length) {
        const processSteps = recommendedSequence.filter((step) => step?.type === "PROCESS");
        if (!processSteps.length) {
          graphResult = {
            ...graphResult,
            recommendedSequence: [],
          };
        } else {
        const processKeys = processSteps
          .map((process) => String(process?.processKey || "").trim())
          .filter(Boolean);

        await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_COMBINATION_SEQUENCE_RECEIVED", {
          source: graphResult?.recommendationSource || "graph",
          stepCount: recommendedSequence.length,
          partCount: recommendedSequence.filter((step) => step?.type === "PART").length,
          processCount: processSteps.length,
          processKeys,
        });

        setRecommendedProcessKeys(Array.from(new Set(processKeys)));

        let selectedCombinationNodeId = null;
        applyFlowChange((prev) => {
          const anchor = getRecommendedNodeAnchor(prev.nodes || [], prev.groups || []);
          const nextNodes = [...(prev.nodes || [])];
          const nextEdges = [...(prev.edges || [])];
          const nextGroups = [...(prev.groups || [])];
          const sequenceNodeIds = [];
          const usedPartKeys = new Set();

          const existingGroupedNodeIds = new Set(
            (prev.groups || []).flatMap((group) => group?.nodeIds || [])
          );
          const findExistingPartNode = (step) => {
            const candidateKeys = [
              String(step?.nodeName || "").trim(),
              String(step?.partBase || "").trim(),
              String(step?.partId || "").trim(),
            ].filter(Boolean);
            if (!candidateKeys.length) {
              return null;
            }

            return (
              nextNodes.find((node) => {
                if (node.type !== "PART") {
                  return false;
                }
                if (existingGroupedNodeIds.has(node.id)) {
                  return false;
                }
                const nodeKeys = [
                  String(node.data?.nodeName || "").trim(),
                  String(node.data?.partBase || "").trim(),
                  String(node.data?.partId || "").trim(),
                ].filter(Boolean);
                return candidateKeys.some((key) => nodeKeys.includes(key));
              }) || null
            );
          };

          recommendedSequence.forEach((step, index) => {
            if (step?.type === "PART") {
              const partKey =
                String(step.partBase || "").trim() ||
                String(step.nodeName || "").trim() ||
                String(step.partId || "").trim();
              if (!partKey || usedPartKeys.has(partKey)) {
                return;
              }
              usedPartKeys.add(partKey);

              const existingPartNode = findExistingPartNode(step);
              const partNodeId = existingPartNode?.id || nextRuntimeId("N-PART");
              const nextPosition = {
                x: anchor.startX + sequenceNodeIds.length * anchor.colGap,
                y: anchor.startY,
              };
              const nextData = {
                partId: step.partId || step.partBase || step.nodeName || "",
                partName: step.partName || step.partBase || step.nodeName || "",
                nodeName: step.nodeName || step.partBase || step.partId || "",
                inhouse: true,
                partBase: step.partBase || "",
                sourceSheet: step.sourceSheet || "",
                option: "",
                statusLabel: "선택 조합 부품",
                label: step.partBase || step.partName || step.partId || step.nodeName || "",
              };

              if (existingPartNode) {
                const nodeIndex = nextNodes.findIndex((node) => node.id === existingPartNode.id);
                if (nodeIndex >= 0) {
                  nextNodes[nodeIndex] = {
                    ...nextNodes[nodeIndex],
                    position: nextPosition,
                    data: {
                      ...(nextNodes[nodeIndex].data || {}),
                      ...nextData,
                    },
                    selected: false,
                  };
                }
              } else {
                nextNodes.push({
                  id: partNodeId,
                  type: "PART",
                  position: nextPosition,
                  data: nextData,
                  selected: false,
                });
              }

              sequenceNodeIds.push(partNodeId);
              selectedCombinationNodeId = partNodeId;
              return;
            }

            if (step?.type !== "PROCESS") {
              return;
            }

            const processKey = String(step.processKey || step.label || "").trim();
            if (!processKey) {
              return;
            }

            const processNodeId = nextRuntimeId("N-PROC");
            nextNodes.push({
              id: processNodeId,
              type: "PROCESS",
              position: {
                x: anchor.startX + sequenceNodeIds.length * anchor.colGap,
                y: anchor.startY,
              },
              data: {
                processKey,
                processType: step.processType || "STANDARD",
                label: step.displayLabel || step.label || processKey,
                operationLabel: step.operationLabel || step.label || processKey,
                partBase: step.partBase || "",
                contextPartBase: step.contextPartBase || "",
                sourceSheet: step.sourceSheet || "",
                option: "",
                statusLabel: getVisibleRecommendationReason(step.reason),
                partId: step.displayLabel || step.label || step.partBase || processKey,
                partName: step.displayLabel || step.label || step.partBase || processKey,
                nodeName: step.displayLabel || step.label || step.partBase || processKey,
                inhouse: true,
              },
              selected: true,
            });
            sequenceNodeIds.push(processNodeId);
            selectedCombinationNodeId = processNodeId;
          });

          if (sequenceNodeIds.length >= 2) {
            const nextGroupId = nextRuntimeId("grp");
            nextGroups.push({
              id: nextGroupId,
              label: "선택 부품 조합",
              nodeIds: sequenceNodeIds,
              skippedAutoEdgeIds: [],
            });

            for (let index = 0; index < sequenceNodeIds.length - 1; index += 1) {
              const source = sequenceNodeIds[index];
              const target = sequenceNodeIds[index + 1];
              if (!source || !target || source === target) {
                continue;
              }
              nextEdges.push({
                id: `MANUAL:${nextGroupId}:${source}:${target}`,
                source,
                target,
                type: "straight",
                sourceHandle: "out",
                targetHandle: "in",
                data: {
                  manual: true,
                  connectedByGroup: true,
                  groupId: nextGroupId,
                },
              });
            }
          }

          return {
            ...prev,
            nodes: nextNodes.map((node) => ({
              ...node,
              selected: node.id === selectedCombinationNodeId,
            })),
            edges: nextEdges,
            groups: nextGroups,
          };
        });

        if (selectedCombinationNodeId) {
          setSelectedNodeId(selectedCombinationNodeId);
          setSelectedEdgeId(null);
        }

        await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_COMBINATION_SEQUENCE_APPLIED", {
          stepCount: recommendedSequence.length,
        });
        clearPalettePartSelection();
        return;
        }
      }

      const commonProcesses = filterManualBarcodeReadingProcesses(
        graphResult?.recommendedProcesses
      );
      if (!commonProcesses.length) {
        throw new Error("바코드 리딩기 스캔 작업을 제외한 추천 공정을 찾지 못했습니다.");
      }
      await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_COMMON_PATH_RECEIVED", {
        processCount: commonProcesses.length,
        processKeys: commonProcesses.map((process) => String(process?.processKey || "").trim()),
      });

      const enrichedProcesses = await Promise.all(
        commonProcesses.map(async (process) => {
          const processOptions = await requestProcessOptions({
            partBase: process.partBase,
            processLabel: process.operationLabel || process.label,
            sourceSheet: process.sourceSheet,
          });
          await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_PROCESS_PREPARED", {
            processKey: process.processKey,
            processLabel: process.label,
            optionCount: processOptions.length,
          });
          return {
            ...process,
            displayLabel: process.displayLabel || process.label,
            operationLabel: process.operationLabel || process.label,
            reason: process.reason || "선택 부품 조합의 graph DB 공통 경로",
            options: processOptions,
          };
        })
      );

      const popupItems = await Promise.all(
        filteredSelectedParts.map(async (part) => {
          await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_PART_PREPARED", {
            partNodeName: part.nodeName,
            partBase: part.partBase,
            optionCount: 0,
          });
          return {
            itemKey: [
              String(part.nodeName || "").trim(),
              String(part.partBase || "").trim(),
              String(part.partId || "").trim(),
            ]
              .filter(Boolean)
              .join("::"),
            partNodeName: String(part.nodeName || "").trim(),
            partLabel:
              part.displayLabel || part.partBase || part.partName || part.partId || part.nodeName || "이름 없음",
            partData: part,
            partOptions: [],
            reply: "선택 부품 조합의 graph DB 공통 경로를 기준으로 정렬한 공정입니다.",
            processes: enrichedProcesses,
          };
        })
      );

      if (!popupItems.length) {
        throw new Error("선택한 부품으로 생성할 시퀀스 기준 노드를 만들지 못했습니다.");
      }

      await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_CANVAS_APPLY_START", {
        itemCount: popupItems.length,
        totalProcessCount: popupItems.reduce(
          (sum, item) => sum + (Array.isArray(item.processes) ? item.processes.length : 0),
          0
        ),
      });
      setRecommendedProcessKeys(
        Array.from(
          new Set(
            popupItems.flatMap((item) =>
              (item.processes || [])
                .map((process) => String(process.processKey || "").trim())
                .filter(Boolean)
            )
          )
        )
      );
      await confirmRecommendedProcesses(
        popupItems.map((item) => ({
          item,
          processes: Array.isArray(item.processes) ? item.processes : [],
        })),
        {
          includePartNodes: false,
          forceProcessNodes: true,
          mergeIntoSingleFlow: true,
          groupLabel: "자동 시퀀스",
        }
      );
      await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_CANVAS_APPLY_DONE", {
        itemCount: popupItems.length,
      });
      clearPalettePartSelection();
    } catch (fetchError) {
      await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_FAILED", {
        message: fetchError?.message || "알 수 없는 오류",
      });
      showPopup(`자동 시퀀스 구성 실패: ${fetchError.message || "알 수 없는 오류"}`, "error");
    } finally {
      setAutoBuildLoading(false);
      await writeSequenceDebugLog("SEQUENCE_AUTO_BUILD_FINISHED", {
        bomId,
        spec,
      });
    }
  }, [
    bomId,
    applyFlowChange,
    confirmRecommendedProcesses,
    clearPalettePartSelection,
    getRecommendedNodeAnchor,
    inhouseParts,
    nextRuntimeId,
    processTemplateLabelSet,
    recommendationProcessTemplates,
    requestNextProcessRecommendations,
    requestSequenceAiDraft,
    requestProcessOptions,
    selectedPalettePartNodeNames,
    spec,
    useAiForAutoBuild,
    writeSequenceDebugLog,
  ]);

  const submitChatMessage = useCallback(async () => {
    const trimmed = String(chatInput || "").trim();
    if (!trimmed) {
      return;
    }

    setChatMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: trimmed,
      },
    ]);
    setChatInput("");
    setChatLoading(true);

    try {
      if (pendingOptionSelection?.items?.length) {
        resolvePendingOptionAnswer(trimmed);
        return;
      }

      const partRecommendationResult = await requestChatRecommendations(trimmed, [], 5);
      const recommendedParts = Array.isArray(partRecommendationResult?.recommendedParts)
        ? partRecommendationResult.recommendedParts
        : [];

      if (!recommendedParts.length) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now() + 1}`,
            role: "assistant",
            text:
              partRecommendationResult?.reply ||
              "자연어와 맞는 추천 부품을 찾지 못했습니다. 부품명이나 공정 관련 표현을 더 구체적으로 입력해 주세요.",
          },
        ]);
        return;
      }

      await openPerPartRecommendationPopup({
        selectedPartsForRequest: recommendedParts,
        title: "부품별 추천 공정",
        includeOptions: false,
        message: trimmed,
        perPartRecommendations: partRecommendationResult?.perPartRecommendations || [],
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 1}`,
          role: "assistant",
          text: "자연어 기준 추천 부품과 공정 팝업을 열었습니다. 필요한 부품과 공정을 고른 뒤 확인을 눌러 주세요.",
        },
      ]);
    } catch (error) {
      console.error(error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now() + 1}`,
          role: "assistant",
          text: `채팅 추천 요청 실패: ${error.message || "알 수 없는 오류"}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [
    bomId,
    chatInput,
    openPerPartRecommendationPopup,
    pendingOptionSelection,
    requestChatRecommendations,
    resolvePendingOptionAnswer,
  ]);

  // ===============================
  // PROCESS templates 로드
  // ===============================
  useEffect(() => {
    if (!bomId || !spec) return;

    let cancelled = false;
    setLoadingProcesses(true);

    fetch(`${API_BASE}/api/sequence/process-templates`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("process 템플릿 로드 실패");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setProcessTemplates(Array.isArray(data.processes) ? data.processes : []);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setProcessTemplates([]);
        setError((prev) => prev || err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingProcesses(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bomId, spec]);

  useEffect(() => {
    let cancelled = false;

    fetch("http://localhost:8000/api/assembly/sheets", {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("시트 로딩 실패");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setManualSheets(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setManualSheets([]);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!manualSheet) {
      setManualPartBases([]);
      setManualPartBase("");
      return;
    }

    let cancelled = false;

    fetch(
      `http://localhost:8000/api/assembly/part-bases?sheet=${encodeURIComponent(manualSheet)}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("부품 기준 로딩 실패");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setManualPartBases(Array.isArray(data) ? data : []);
          setManualPartBase("");
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) { setManualPartBases([]); setManualPartBase(""); }
      });

    return () => { cancelled = true; };
  }, [manualSheet]);

  useEffect(() => {
    let cancelled = false;

    fetch("http://localhost:8000/api/assembly/all-part-bases", {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("부품 목록 로딩 실패");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setManualAllParts(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setManualAllParts([]);
      });

    return () => { cancelled = true; };
  }, []);

  // ===============================
  // inhouse PART 로드
  // ===============================
  useEffect(() => {
    if (!bomId || !spec) return;

    let cancelled = false;

    setLoadingParts(true);
    setError(null);

    fetch(
      `${API_BASE}/api/sequence/inhouse-parts?bomId=${encodeURIComponent(
        bomId
      )}&spec=${encodeURIComponent(spec)}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("inhouse 부품 로드 실패");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        const parts = Array.isArray(data.parts) ? data.parts : [];

        // ✅ 핵심: 서버가 내려주는 partBase/sourceSheet 보존
        // (Palette에서 이 값을 payload에 포함시키면 PART OPTION이 동작함)
        setInhouseParts(parts);
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setInhouseParts([]);
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingParts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bomId, spec]);

  useEffect(() => {
    if (!bomId || !spec) return;

    let cancelled = false;

    fetch(
      `${API_BASE}/api/sequence/parts?bomId=${encodeURIComponent(
        bomId
      )}&spec=${encodeURIComponent(spec)}`,
      { credentials: "include" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("채팅 후보 부품 로드 실패");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setChatCandidateParts(Array.isArray(data.parts) ? data.parts : []);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setChatCandidateParts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bomId, spec]);

  // ===============================
  // Delete / Backspace 삭제
  // ===============================
  const onKeyDown = useCallback(
    (e) => {
      const isCopyShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c";
      const isPasteShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v";
      const selectedText = typeof window !== "undefined" ? String(window.getSelection?.() || "") : "";

      if (isCopyShortcut) {
        if (selectedText.trim()) {
          return;
        }
        const currentFlowState = flowStateRef.current || { nodes: [], edges: [], groups: [], workerGroups: [] };
        const selectedNodeIds = new Set(
          (currentFlowState.nodes || [])
            .filter((node) => node.selected)
            .map((node) => node.id)
        );

        if (!selectedNodeIds.size && selectedNodeId) {
          selectedNodeIds.add(selectedNodeId);
        }

        if (!selectedNodeIds.size) {
          return;
        }

        const copiedNodes = (currentFlowState.nodes || [])
          .filter((node) => selectedNodeIds.has(node.id))
          .map((node) => JSON.parse(JSON.stringify(node)));
        const copiedEdges = (currentFlowState.edges || [])
          .filter(
            (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
          )
          .map((edge) => JSON.parse(JSON.stringify(edge)));
        const copiedGroups = (currentFlowState.groups || [])
          .map((group) => ({
            ...JSON.parse(JSON.stringify(group)),
            nodeIds: (group.nodeIds || []).filter((id) => selectedNodeIds.has(id)),
          }))
          .filter((group) => (group.nodeIds || []).length >= 2);
        const copiedWorkerGroups = (currentFlowState.workerGroups || [])
          .map((group) => ({
            ...JSON.parse(JSON.stringify(group)),
            nodeIds: (group.nodeIds || []).filter((id) => selectedNodeIds.has(id)),
          }))
          .filter((group) => (group.nodeIds || []).length >= 1);

        sequenceClipboardRef.current = {
          nodes: copiedNodes,
          edges: copiedEdges,
          groups: copiedGroups,
          workerGroups: copiedWorkerGroups,
        };
        pasteSequenceCountRef.current = 0;
        e.preventDefault();
        return;
      }

      if (isPasteShortcut) {
        const clipboard = sequenceClipboardRef.current;
        if (!clipboard?.nodes?.length) {
          return;
        }

        e.preventDefault();
        pasteSequenceCountRef.current += 1;
        const offset = 48 * pasteSequenceCountRef.current;

        let firstPastedNodeId = null;
        applyFlowChange((prev) => {
          const idMap = new Map();
          const nextNodes = (prev.nodes || []).map((node) => ({
            ...node,
            selected: false,
          }));

          const pastedNodes = (clipboard.nodes || []).map((node) => {
            const nextId = nextRuntimeId(node.type === "PROCESS" ? "N-PROC" : "N-PART");
            idMap.set(node.id, nextId);
            if (!firstPastedNodeId) {
              firstPastedNodeId = nextId;
            }
            return {
              ...JSON.parse(JSON.stringify(node)),
              id: nextId,
              position: {
                x: Number(node.position?.x || 0) + offset,
                y: Number(node.position?.y || 0) + offset,
              },
              selected: true,
            };
          });

          const pastedEdges = (clipboard.edges || []).map((edge) => ({
            ...JSON.parse(JSON.stringify(edge)),
            id: nextRuntimeId("E"),
            source: idMap.get(edge.source) || edge.source,
            target: idMap.get(edge.target) || edge.target,
            selected: false,
          }));

          const pastedGroups = (clipboard.groups || []).map((group, index) => ({
            ...JSON.parse(JSON.stringify(group)),
            id: nextRuntimeId("grp"),
            label: group.label ? `${group.label} 복사본` : `그룹 복사본 ${index + 1}`,
            nodeIds: (group.nodeIds || []).map((id) => idMap.get(id)).filter(Boolean),
            skippedAutoEdgeIds: [],
          }));

          const pastedWorkerGroups = (clipboard.workerGroups || []).map((group) => ({
            ...JSON.parse(JSON.stringify(group)),
            id: nextRuntimeId("wrk"),
            nodeIds: (group.nodeIds || []).map((id) => idMap.get(id)).filter(Boolean),
          }));

          return {
            ...prev,
            nodes: [...nextNodes, ...pastedNodes],
            edges: [...(prev.edges || []), ...pastedEdges],
            groups: [...(prev.groups || []), ...pastedGroups.filter((group) => (group.nodeIds || []).length >= 2)],
            workerGroups: [
              ...(prev.workerGroups || []),
              ...pastedWorkerGroups.filter((group) => (group.nodeIds || []).length >= 1),
            ],
          };
        });

        if (firstPastedNodeId) {
          setSelectedNodeId(firstPastedNodeId);
          setSelectedEdgeId(null);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redoFlowChange();
          return;
        }
        undoFlowChange();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoFlowChange();
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      if (selectedEdgeId) {
        applyFlowChange((prev) => {
          const edgeToDelete = prev.edges.find((edge) => edge.id === selectedEdgeId);
          const nextGroups = (prev.groups || []).map((group) => {
            if (!edgeToDelete?.data?.autoGenerated || edgeToDelete.data.groupId !== group.id) {
              return group;
            }

            const skippedAutoEdgeIds = Array.isArray(group.skippedAutoEdgeIds)
              ? group.skippedAutoEdgeIds
              : [];

            if (skippedAutoEdgeIds.includes(selectedEdgeId)) {
              return group;
            }

            return {
              ...group,
              skippedAutoEdgeIds: [...skippedAutoEdgeIds, selectedEdgeId],
            };
          });

          return {
            ...prev,
            edges: prev.edges.filter((edge) => edge.id !== selectedEdgeId),
            groups: nextGroups,
          };
        });
        setSelectedEdgeId(null);
        return;
      }

      if (selectedNodeId) {
        applyFlowChange((prev) => {
          const selectedNodeIds = new Set(
            (prev.nodes || [])
              .filter((node) => node.selected)
              .map((node) => node.id)
          );

          if (!selectedNodeIds.size) {
            selectedNodeIds.add(selectedNodeId);
          }

          return {
            ...prev,
            nodes: prev.nodes.filter((node) => !selectedNodeIds.has(node.id)),
            edges: prev.edges.filter(
              (edge) =>
                !selectedNodeIds.has(edge.source) &&
                !selectedNodeIds.has(edge.target)
            ),
            groups: prev.groups
              .map((group) => ({
                ...group,
                nodeIds: (group.nodeIds || []).filter((id) => !selectedNodeIds.has(id)),
                skippedAutoEdgeIds: (group.skippedAutoEdgeIds || []).filter((edgeId) => {
                  const edge = prev.edges.find((item) => item.id === edgeId);
                  return (
                    edge &&
                    !selectedNodeIds.has(edge.source) &&
                    !selectedNodeIds.has(edge.target)
                  );
                }),
              }))
              .filter((group) => (group.nodeIds || []).length >= 2),
            workerGroups: prev.workerGroups
              .map((group) => ({
                ...group,
                nodeIds: (group.nodeIds || []).filter((id) => !selectedNodeIds.has(id)),
              }))
              .filter((group) => (group.nodeIds || []).length >= 1),
          };
        });
        setSelectedNodeId(null);
      }
    },
    [applyFlowChange, nextRuntimeId, redoFlowChange, selectedNodeId, selectedEdgeId, undoFlowChange]
  );

  const flowControls = useMemo(
    () => ({
      applyFlowChange,
      replaceFlowState,
      getFlowState: () => flowStateRef.current,
      undoFlowChange,
      redoFlowChange,
    }),
    [applyFlowChange, replaceFlowState, undoFlowChange, redoFlowChange]
  );

  useEffect(() => {
    const handleWindowKeyDown = (e) => {
      if (e.defaultPrevented) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      onKeyDown(e);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    const handleSaveRequest = async (event) => {
      const result = await saveSequence({ showAlert: false });
      event.detail?.respond?.(result);
    };

    window.addEventListener("app:sequence-save-request", handleSaveRequest);
    return () => {
      window.removeEventListener("app:sequence-save-request", handleSaveRequest);
    };
  }, [saveSequence]);

  useEffect(() => {
    const handleDirtyCheckRequest = (event) => {
      const currentSnapshot = getFlowStateSnapshot(flowStateRef.current);
      event.detail?.respond?.(currentSnapshot !== lastSavedSnapshotRef.current);
    };

    window.addEventListener("app:sequence-dirty-check-request", handleDirtyCheckRequest);
    return () => {
      window.removeEventListener("app:sequence-dirty-check-request", handleDirtyCheckRequest);
    };
  }, []);

  useEffect(() => {
    const handleOptionCheckRequest = (event) => {
      const nodes = flowStateRef.current?.nodes || [];
      const missingCount = nodes.filter(
        (node) => !String(node.data?.option || "").trim()
      ).length;
      event.detail?.respond?.(missingCount);
    };

    window.addEventListener("app:sequence-option-check-request", handleOptionCheckRequest);
    return () => {
      window.removeEventListener("app:sequence-option-check-request", handleOptionCheckRequest);
    };
  }, []);

  useEffect(() => {
    const handleMarkSaved = (event) => {
      lastSavedSnapshotRef.current = getFlowStateSnapshot(event.detail?.flowState || {});
      persistSequenceDraft({
        bomId,
        spec,
        flowState: flowStateRef.current,
        selectedNodeId,
        selectedEdgeId,
        lastSavedSnapshot: lastSavedSnapshotRef.current,
      });
    };

    window.addEventListener("app:sequence-mark-saved", handleMarkSaved);
    return () => {
      window.removeEventListener("app:sequence-mark-saved", handleMarkSaved);
    };
  }, [bomId, selectedEdgeId, selectedNodeId, spec]);

  if (!bomId || !spec) {
    return <div style={{ padding: 16 }}>시퀀스 작업 세트를 준비하는 중입니다...</div>;
  }

  const loading = loadingParts || loadingProcesses;
  // ===============================
  // UI
  // ===============================
  return (
    <div
      style={{
        height: "calc(100vh - 80px)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        boxSizing: "border-box",
      }}
      onClick={() => {
        // 바깥 클릭 시 선택 해제 원하면 사용 (필요 없으면 제거 가능)
        // clearSelection();
      }}
    >
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          background: "#fff",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setManualOpen((prev) => !prev)}
          style={{
            width: "100%",
            border: 0,
            background: "#f8fafc",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          수동 부품 추가 {manualOpen ? "▾" : "▸"}
        </button>

        {manualOpen && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 12,
              borderTop: "1px solid #e5e7eb",
            }}
          >
            <Select
              showSearch
              allowClear
              placeholder="시트 선택"
              value={manualSheet || undefined}
              onChange={(value) => setManualSheet(value || "")}
              options={manualSheets.map((sheet) => ({
                value: sheet,
                label: sheet,
              }))}
              filterOption={manualSelectFilterOption}
              style={{ minWidth: 200 }}
            />

            <Select
              showSearch
              allowClear
              placeholder="부품 기준 선택"
              value={manualPartBase || undefined}
              onChange={(value) => setManualPartBase(value || "")}
              disabled={!manualSheet}
              options={manualPartBases.map((part) => ({
                value: part,
                label: part,
              }))}
              filterOption={manualSelectFilterOption}
              style={{ minWidth: 200 }}
            />

            <button
              type="button"
              onClick={addManualPartNode}
              disabled={!manualSheet || !manualPartBase}
              style={actionButtonStyle}
            >
              노드 추가
            </button>

            <div style={{ width: 1, height: 28, background: "#e5e7eb", margin: "0 4px" }} />

            <Select
              showSearch
              allowClear
              placeholder="부품명 검색으로 추가"
              value={manualSearchKey || undefined}
              onChange={(value) => setManualSearchKey(value || "")}
              options={manualAllParts.map(({ partBase, sheet }) => ({
                value: `${partBase}::${sheet}`,
                label: `${partBase} (${sheet})`,
              }))}
              filterOption={manualSelectFilterOption}
              style={{ minWidth: 260 }}
            />

            <button
              type="button"
              onClick={addSearchPartNode}
              disabled={!manualSearchKey}
              style={actionButtonStyle}
            >
              노드 추가
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: 12,
        }}
      >
        {/* ===============================
            Left : Palette
           =============================== */}
        <div
          style={{
            width: 320,
            minWidth: 320,
            height: "100%",
            overflow: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            background: "#fff",
          }}
        >
          <SequencePalette
            parts={inhouseParts}
            processes={processTemplates}
            loading={loading}
            error={error}
            usedPartNodeNames={usedPartNodeNames}
            selectedPartNodeNames={selectedPalettePartNodeNames}
            onTogglePartSelection={togglePalettePartSelection}
            onClearPartSelection={clearPalettePartSelection}
            onAutoBuildSequence={buildAiSequenceDraft}
            autoBuildLoading={autoBuildLoading}
            useAiForAutoBuild={useAiForAutoBuild}
            onToggleUseAiForAutoBuild={() =>
              setUseAiForAutoBuild((prev) => !prev)
            }
          />
        </div>

        {/* ===============================
            Center : Canvas
           =============================== */}
        <div
          style={{
            flex: 1,
            height: "100%",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            overflow: "hidden",
            background: "#fff",
            minWidth: 0,
          }}
        >
          <SequenceCanvas
            nodes={nodes}
            edges={edges}
            groups={groups}
            workerGroups={workerGroups}
            setNodes={setNodes}
            setEdges={setEdges}
            setGroups={setGroups}
            setWorkerGroups={setWorkerGroups}
            flowControls={flowControls}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
            onKeyDown={onKeyDown}
          />
        </div>

        {/* ===============================
            Right : Inspector
           =============================== */}
        <SequenceInspector
          nodes={nodes}
          edges={edges}
          groups={groups}
          workerGroups={workerGroups}
          setGroups={setGroups}
          setWorkerGroups={setWorkerGroups}
          flowControls={flowControls}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          setNodes={setNodes}
          setEdges={setEdges}
          bomId={bomId}
          spec={spec}
          onSaveSequence={saveSequence}
        />
      </div>

      <SequenceChatPanel
        open={chatOpen}
        messages={chatMessages}
        input={chatInput}
        loading={chatLoading}
        onClose={() => setChatOpen(false)}
        onChangeInput={setChatInput}
        onReset={() => {
          setChatMessages((prev) => prev.slice(0, 1));
          setRecommendedProcessKeys([]);
        }}
        onSubmit={submitChatMessage}
      />

      <SequenceOptionPicker
        item={currentPendingOptionItem}
        loading={chatLoading}
        onSelectOption={(index) =>
          resolvePendingOptionAnswer(String(index + 1), { appendUserMessage: true })
        }
        onSkip={() => resolvePendingOptionAnswer("넘어가기", { appendUserMessage: true })}
      />

      <SequenceProcessRecommendationPopup
        open={processRecommendationPopup.open}
        title={processRecommendationPopup.title}
        items={processRecommendationPopup.items}
        onConfirmSelections={confirmRecommendedProcesses}
        onClose={() =>
          setProcessRecommendationPopup((prev) => ({
            ...prev,
            open: false,
          }))
        }
      />

      {showSavedPopup && <SavedPopup onClose={() => setShowSavedPopup(false)} />}

      <button
        type="button"
        onClick={() => setChatOpen((prev) => !prev)}
        style={chatFabStyle}
        aria-label={chatOpen ? "채팅창 닫기" : "채팅창 열기"}
        title={chatOpen ? "채팅창 닫기" : "자연어 시퀀스 도우미"}
      >
        {chatOpen ? "×" : "AI"}
      </button>
    </div>
  );
}
