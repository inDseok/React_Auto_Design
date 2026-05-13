const SEQUENCE_DRAFT_STORAGE_PREFIX = "sequence_editor_draft_v1";
const SEQUENCE_MANUAL_SPEC_PREFIX = "manual-sequence";

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `seq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSequenceWorkspaceContext() {
  const workspaceId = createUuid();
  return {
    bomId: workspaceId,
    spec: `${SEQUENCE_MANUAL_SPEC_PREFIX}-${workspaceId}`,
  };
}

export function isManualSequenceSpec(spec) {
  return String(spec || "").startsWith(`${SEQUENCE_MANUAL_SPEC_PREFIX}-`);
}

export function getDisplaySpecName(spec) {
  return isManualSequenceSpec(spec) ? "" : String(spec || "");
}

export function getSequenceDraftStorageKey(bomId, spec) {
  if (!bomId || !spec) return null;
  return `${SEQUENCE_DRAFT_STORAGE_PREFIX}:${bomId}:${spec}`;
}

export function createSerializableFlowState(flowState = {}) {
  return {
    nodes: Array.isArray(flowState.nodes)
      ? flowState.nodes.map((node, idx) => ({
          id: node.id,
          type: node.type,
          position:
            node.position &&
            typeof node.position.x === "number" &&
            typeof node.position.y === "number"
              ? node.position
              : {
                  x: 100 + (idx % 5) * 220,
                  y: 100 + Math.floor(idx / 5) * 120,
                },
          data: node.data || {},
        }))
      : [],
    edges: Array.isArray(flowState.edges)
      ? flowState.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "straight",
          sourceHandle: edge.sourceHandle ?? "out",
          targetHandle: edge.targetHandle ?? "in",
          data: edge.data || {},
        }))
      : [],
    groups: Array.isArray(flowState.groups)
      ? flowState.groups.map((group) => ({
          id: group.id,
          label: group.label || "",
          nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds : [],
          skippedAutoEdgeIds: Array.isArray(group.skippedAutoEdgeIds)
            ? group.skippedAutoEdgeIds
            : [],
        }))
      : [],
    workerGroups: Array.isArray(flowState.workerGroups)
      ? flowState.workerGroups.map((group) => ({
          id: group.id,
          label: group.label || "",
          nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds : [],
        }))
      : [],
  };
}

export function getFlowStateSnapshot(flowState = {}) {
  return JSON.stringify(createSerializableFlowState(flowState));
}

export function loadSequenceDraft(bomId, spec) {
  const storageKey = getSequenceDraftStorageKey(bomId, spec);
  if (!storageKey) return null;

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      flowState: createSerializableFlowState(parsed.flowState || {}),
      selectedNodeId: parsed.selectedNodeId ?? null,
      selectedEdgeId: parsed.selectedEdgeId ?? null,
      lastSavedSnapshot:
        typeof parsed.lastSavedSnapshot === "string"
          ? parsed.lastSavedSnapshot
          : null,
    };
  } catch (error) {
    console.error("Failed to load sequence draft", error);
    return null;
  }
}

export function persistSequenceDraft({
  bomId,
  spec,
  flowState,
  selectedNodeId,
  selectedEdgeId,
  lastSavedSnapshot,
}) {
  const storageKey = getSequenceDraftStorageKey(bomId, spec);
  if (!storageKey) return;

  localStorage.setItem(
    storageKey,
    JSON.stringify({
      flowState: createSerializableFlowState(flowState),
      selectedNodeId,
      selectedEdgeId,
      lastSavedSnapshot: lastSavedSnapshot ?? null,
      savedAt: Date.now(),
    })
  );
}

export function removeSequenceDraft(bomId, spec) {
  const storageKey = getSequenceDraftStorageKey(bomId, spec);
  if (!storageKey) return;
  localStorage.removeItem(storageKey);
}

export function isTextEditingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function createAiSequenceLayoutStart(nodes = []) {
  if (!nodes.length) {
    return { x: 120, y: 140 };
  }

  const maxY = Math.max(...nodes.map((node) => Number(node.position?.y) || 0));

  return {
    x: 120,
    y: maxY + 120,
  };
}

export function normalizeAiProcessFamily(processKey = "") {
  return String(processKey || "")
    .trim()
    .toUpperCase()
    .replaceAll("엑셀 변환:", " ")
    .replaceAll("EXCEL IMPORT:", " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/#\s*\d+\b/g, " ")
    .replace(/\b\d+MM(?:이상)?\b/g, " ")
    .replace(/[^A-Z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeConsecutiveAiSteps(steps = []) {
  return steps.reduce((acc, step) => {
    const previous = acc[acc.length - 1];
    if (!previous || previous.type !== "PROCESS" || step?.type !== "PROCESS") {
      acc.push(step);
      return acc;
    }

    const previousKey = String(previous.processKey || "").trim();
    const currentKey = String(step.processKey || "").trim();

    if (previousKey && previousKey === currentKey) {
      return acc;
    }

    const previousFamily = normalizeAiProcessFamily(previousKey);
    const currentFamily = normalizeAiProcessFamily(currentKey);

    if (previousFamily && previousFamily === currentFamily) {
      return acc;
    }

    acc.push(step);
    return acc;
  }, []);
}

export function toSequenceAIPartPayload(part) {
  return {
    nodeName: part.nodeName,
    partId: part.partId,
    partName: part.partName,
    partBase: part.partBase,
    sourceSheet: part.sourceSheet,
    treePath: part.treePath || [],
    parentName: part.parentName || null,
  };
}

export function toSequenceAIProcessPayload(process) {
  return {
    processKey: process.processKey,
    processType: process.processType,
    label: process.label,
    partBase: process.partBase,
    sourceSheet: process.sourceSheet,
  };
}

export function normalizeOptionMatchValue(value) {
  return String(value || "").trim().toUpperCase();
}

export function parseOptionSelectionAnswer(text, optionCount, allowSkipChoice = false) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return { type: "invalid" };
  }

  if (/모르|몰라|모름|skip|건너|넘어가|선택 안 함|선택안함|없음/i.test(normalized)) {
    return { type: "skip" };
  }

  const numberMatch = normalized.match(/(\d+)/);
  if (!numberMatch) {
    return { type: "invalid" };
  }

  const selectedIndex = Number.parseInt(numberMatch[1], 10) - 1;
  if (allowSkipChoice && selectedIndex === optionCount) {
    return { type: "skip" };
  }

  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= optionCount) {
    return { type: "invalid" };
  }

  return { type: "select", index: selectedIndex };
}
