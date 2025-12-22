import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";

const STORAGE_KEY = "process_tool_app_state_v1";

const initialState = {
  bomId: null,
  selectedSpec: null,
  sourceSheet: null,
  selectedNodeId: null,

  // 큰 트리는 여기에 넣지 않는 것을 권장합니다.
  // 필요한 경우에만 최소한으로 캐시하세요(예: 노드 수가 적을 때).
  treeCache: null,

  lastLoadedAt: null,
};

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = safeParse(raw);
  if (!parsed || typeof parsed !== "object") return null;

  // 필드 화이트리스트로만 복원(예상치 못한 키 방지)
  return {
    ...initialState,
    bomId: parsed.bomId ?? null,
    selectedSpec: parsed.selectedSpec ?? null,
    sourceSheet: parsed.sourceSheet ?? null,
    selectedNodeId: parsed.selectedNodeId ?? null,
    treeCache: parsed.treeCache ?? null,
    lastLoadedAt: parsed.lastLoadedAt ?? null,
  };
}

function persistToStorage(state) {
  const payload = {
    bomId: state.bomId,
    selectedSpec: state.selectedSpec,
    sourceSheet: state.sourceSheet,
    selectedNodeId: state.selectedNodeId,

    // 캐시를 쓰지 않을 거면 null 유지
    treeCache: state.treeCache,

    lastLoadedAt: state.lastLoadedAt,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function reducer(state, action) {
  switch (action.type) {
    case "RESET_ALL":
      return { ...initialState };

    case "SET_BOM_CONTEXT":
      // bomId가 바뀌면 spec/node/tree는 무조건 초기화하는 게 안전합니다.
      return {
        ...state,
        bomId: action.payload?.bomId ?? null,
        selectedSpec: null,
        sourceSheet: null,
        selectedNodeId: null,
        treeCache: null,
        lastLoadedAt: null,
      };

    case "SET_SPEC":
      return {
        ...state,
        selectedSpec: action.payload?.selectedSpec ?? null,
        sourceSheet: action.payload?.sourceSheet ?? null,
        selectedNodeId: null,
        treeCache: null,
        lastLoadedAt: null,
      };

    case "SET_SELECTED_NODE":
      return { ...state, selectedNodeId: action.payload?.selectedNodeId ?? null };

    case "SET_TREE_CACHE":
      return {
        ...state,
        treeCache: action.payload?.treeCache ?? null,
        lastLoadedAt: action.payload?.lastLoadedAt ?? Date.now(),
      };

    case "CLEAR_TREE_CACHE":
      return { ...state, treeCache: null, lastLoadedAt: null };

    default:
      return state;
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const boot = useMemo(() => loadFromStorage() ?? initialState, []);
  const [state, dispatch] = useReducer(reducer, boot);

  useEffect(() => {
    persistToStorage(state);
  }, [state]);

  const api = useMemo(() => {
    return {
      state,
      actions: {
        resetAll: () => dispatch({ type: "RESET_ALL" }),

        setBomContext: (bomId) =>
          dispatch({ type: "SET_BOM_CONTEXT", payload: { bomId } }),

        setSpec: (selectedSpec, sourceSheet = null) =>
          dispatch({ type: "SET_SPEC", payload: { selectedSpec, sourceSheet } }),

        setSelectedNode: (selectedNodeId) =>
          dispatch({ type: "SET_SELECTED_NODE", payload: { selectedNodeId } }),

        setTreeCache: (treeCache) =>
          dispatch({
            type: "SET_TREE_CACHE",
            payload: { treeCache, lastLoadedAt: Date.now() },
          }),

        clearTreeCache: () => dispatch({ type: "CLEAR_TREE_CACHE" }),
      },
    };
  }, [state]);

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
