import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../../../state/AppContext";

const API_BASE = "http://localhost:8000";
const TOOLTIP_WIDTH = 360;
const VIEWPORT_GAP = 12;
const NODE_GAP = 12;

function normalizeValue(value) {
  return String(value || "").trim();
}

function getEffectiveProcessLabel(type, data, partBase) {
  if (type !== "PROCESS") {
    return "";
  }

  const candidate = normalizeValue(data?.operationLabel || data?.label);
  if (!candidate) {
    return "";
  }

  if (candidate === normalizeValue(partBase)) {
    return "";
  }

  return candidate;
}

export default function NodeActionTooltip({
  visible,
  type,
  data,
  accentColor,
  anchorRef,
}) {
  const { state: appState } = useApp();
  const bomId = appState.bomId;
  const spec = appState.selectedSpec;

  const [state, setState] = useState({
    loading: false,
    error: "",
    rows: [],
    resolvedOption: "",
  });
  const [position, setPosition] = useState(null);
  const cacheRef = useRef({});

  const partBase = normalizeValue(
    type === "PART"
      ? data?.partBase || data?.displayLabel || data?.contextPartBase || data?.partId
      : data?.partBase || data?.contextPartBase || data?.partId
  );
  const optionValue = normalizeValue(data?.option);
  const processLabel = getEffectiveProcessLabel(type, data, partBase);
  const sourceSheet = normalizeValue(data?.sourceSheet);
  const instanceKey = normalizeValue(data?.instanceKey || data?.syncKey);
  const requestKey = useMemo(
    () => [bomId, spec, type, partBase, processLabel, optionValue, sourceSheet, instanceKey].join("::"),
    [bomId, spec, type, partBase, processLabel, optionValue, sourceSheet, instanceKey]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (!partBase) {
      setState({ loading: false, error: "부품 기준 정보가 없습니다.", rows: [], resolvedOption: "" });
      return;
    }

    if (!optionValue) {
      setState({ loading: false, error: "옵션을 선택하면 동작요소를 볼 수 있습니다.", rows: [], resolvedOption: "" });
      return;
    }

    if (cacheRef.current[requestKey]?.rows?.length > 0) {
      setState({
        loading: false,
        error: "",
        rows: cacheRef.current[requestKey].rows,
        resolvedOption: cacheRef.current[requestKey].resolvedOption,
      });
      return;
    }

    let cancelled = false;
    setState({ loading: true, error: "", rows: [], resolvedOption: "" });

    const fetchRows = async () => {
      // 조립 총공수 저장 데이터를 우선 조회
      if (bomId && spec) {
        const asmParams = new URLSearchParams({ part_base: partBase, option: optionValue });
        if (type === "PROCESS" && processLabel) {
          asmParams.set("process_label", processLabel);
        }
        if (instanceKey) {
          asmParams.set("instance_key", instanceKey);
        }
        try {
          const asmRes = await fetch(
            `${API_BASE}/api/assembly/bom/${encodeURIComponent(bomId)}/spec/${encodeURIComponent(spec)}/action-elements?${asmParams.toString()}`,
            { credentials: "include" }
          );
          if (asmRes.ok) {
            const asmPayload = await asmRes.json();
            const asmRows = Array.isArray(asmPayload?.rows) ? asmPayload.rows : [];
            // partFound=true 이면 조립 JSON에 해당 파트 존재 → 엑셀 DB 폴백 금지
            if (asmRows.length > 0 || asmPayload?.partFound) {
              const resolvedOption = normalizeValue(optionValue);
              cacheRef.current[requestKey] = { rows: asmRows, resolvedOption };
              if (!cancelled) setState({ loading: false, error: "", rows: asmRows, resolvedOption });
              return;
            }
          }
        } catch {
          // 실패 시 Excel DB로 폴백
        }
      }

      // Excel DB 폴백
      const params = new URLSearchParams({ type, partBase, option: optionValue });
      if (type === "PROCESS" && processLabel) params.set("processLabel", processLabel);
      if (sourceSheet) params.set("sourceSheet", sourceSheet);

      const res = await fetch(
        `${API_BASE}/api/sequence/node/action-elements?${params.toString()}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("동작요소 조회 실패");
      const payload = await res.json();
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      const resolvedOption = normalizeValue(payload?.resolvedOption || optionValue);
      cacheRef.current[requestKey] = { rows, resolvedOption };
      if (!cancelled) setState({ loading: false, error: "", rows, resolvedOption });
    };

    fetchRows().catch((error) => {
      if (!cancelled) {
        setState({
          loading: false,
          error: error?.message || "동작요소 조회 실패",
          rows: [],
          resolvedOption: "",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bomId, optionValue, partBase, processLabel, requestKey, sourceSheet, spec, type, visible]);

  useEffect(() => {
    if (!visible || !anchorRef?.current) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect?.();
      if (!rect) {
        return;
      }

      let left = rect.right + NODE_GAP;
      let top = rect.top;

      if (left + TOOLTIP_WIDTH + VIEWPORT_GAP > window.innerWidth) {
        left = rect.left - TOOLTIP_WIDTH - NODE_GAP;
      }

      if (left < VIEWPORT_GAP) {
        left = VIEWPORT_GAP;
      }

      top = Math.max(VIEWPORT_GAP, top);

      setPosition({
        left,
        top,
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef, visible]);

  if (!visible || !position) {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: TOOLTIP_WIDTH,
        padding: 12,
        borderRadius: 10,
        border: `1px solid ${accentColor}`,
        background: "#ffffff",
        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.16)",
        zIndex: 999999,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: accentColor, marginBottom: 6 }}>
        동작요소
      </div>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        {state.resolvedOption || optionValue || "옵션 없음"}
      </div>

      {state.loading && <div style={{ fontSize: 12, color: "#475569" }}>불러오는 중...</div>}
      {!state.loading && state.error && (
        <div style={{ fontSize: 12, color: "#b91c1c" }}>{state.error}</div>
      )}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <div style={{ fontSize: 12, color: "#64748b" }}>연결된 동작요소가 없습니다.</div>
      )}

      {!state.loading && !state.error && state.rows.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {state.rows.map((row, index) => (
            <div
              key={`${requestKey}-${row.row ?? index}-${index}`}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "8px 9px",
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 4,
                }}
              >
                {row.worker ? (
                  <span style={metaBadgeStyle("#e0f2fe", "#075985")}>{row.worker}</span>
                ) : null}
                {row.category ? (
                  <span style={metaBadgeStyle("#fef3c7", "#92400e")}>{row.category}</span>
                ) : null}
                {row.processLabel ? (
                  <span style={metaBadgeStyle("#ede9fe", "#5b21b6")}>{row.processLabel}</span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "#0f172a" }}>
                {row.actionElement || "-"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    ,
    document.body
  );
}

function metaBadgeStyle(background, color) {
  return {
    fontSize: 10,
    fontWeight: 700,
    color,
    background,
    borderRadius: 999,
    padding: "2px 6px",
  };
}
