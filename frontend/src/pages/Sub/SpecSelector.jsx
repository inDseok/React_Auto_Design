import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext";
import { apiGet } from "../../api/client";
import { Spin, Button, Alert, Select, Space, Tag, Progress } from "antd";
import { getDisplaySpecName, isManualSequenceSpec } from "../Sequence/sequenceEditorUtils";

const { Option } = Select;
const POLL_INTERVAL_MS = 1500;
const ACTIVE_STATUSES = new Set(["queued", "running", "pending"]);

function getSubSpecDisplayName(spec) {
  return isManualSequenceSpec(spec) ? "수동" : getDisplaySpecName(spec);
}

function buildStatusMessage(status) {
  if (!status) {
    return "";
  }
  return status.message || {
    queued: "BOM 분석 작업이 대기열에 있습니다.",
    running: "BOM 분석 작업이 진행 중입니다.",
    completed: "BOM 분석이 완료되었습니다.",
    failed: "BOM 분석에 실패했습니다.",
  }[status.status] || "";
}

export default function SpecSelector() {
  const { state, actions } = useApp();
  const [specs, setSpecs] = useState([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");
  const [bomStatus, setBomStatus] = useState(null);

  const reqIdRef = useRef(0);
  const pollTimerRef = useRef(null);
  const selectedSpecLabel = getSubSpecDisplayName(state.selectedSpec);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!state.bomId) {
      setSpecs([]);
      setSelected("");
      setBomStatus(null);
      setErr("");
      return;
    }

    const reqId = ++reqIdRef.current;
    const manualSelectedSpec = isManualSequenceSpec(state.selectedSpec);
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    async function loadSpecs() {
      try {
        const data = await apiGet(`/api/sub/bom/${state.bomId}/specs`);
        if (reqId !== reqIdRef.current) {
          return;
        }
        setSpecs(Array.isArray(data) ? data : []);
      } catch (error) {
        if (reqId !== reqIdRef.current) {
          return;
        }
        setErr(String(error?.message ?? error));
      }
    }

    async function loadStatusAndMaybeSpecs() {
      setLoading(true);
      setErr("");

      try {
        if (manualSelectedSpec) {
          setBomStatus(null);
          const manualSpecs = [state.selectedSpec].filter(Boolean);
          setSpecs(manualSpecs);
          if (!selected && manualSpecs[0]) {
            setSelected(manualSpecs[0]);
          }
          return;
        }

        const status = await apiGet(`/api/sub/bom/${state.bomId}/status`);
        if (reqId !== reqIdRef.current) {
          return;
        }

        setBomStatus(status);

        if (status.status === "completed") {
          await loadSpecs();
          return;
        }

        if (status.status === "failed") {
          setSpecs([]);
          setErr(status.error_message || "BOM 분석 작업이 실패했습니다.");
          return;
        }

        setSpecs([]);
        pollTimerRef.current = setTimeout(loadStatusAndMaybeSpecs, POLL_INTERVAL_MS);
      } catch (error) {
        if (reqId !== reqIdRef.current) {
          return;
        }
        setErr(String(error?.message ?? error));
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
        }
      }
    }

    loadStatusAndMaybeSpecs();
  }, [selected, state.bomId, state.selectedSpec]);

  async function onConfirm() {
    if (!selected) {
      return;
    }

    const cacheKey = `${state.bomId}::${selected}`;
    const cached = state.treeCache?.[cacheKey];

    setConfirming(true);
    setErr("");

    try {
      if (!Array.isArray(cached?.nodes)) {
        const data = await apiGet(
          `/api/sub/bom/${state.bomId}/tree?spec=${encodeURIComponent(selected)}`
        );
        actions.setTreeCacheEntry?.(cacheKey, {
          nodes: data.nodes ?? [],
        });
      }

      actions.setSpec(selected);
      localStorage.setItem("spec", selected);
    } catch (error) {
      setErr(String(error?.message ?? error));
    } finally {
      setConfirming(false);
    }
  }

  if (!state.bomId) {
    return (
      <Alert
        title="BOM을 먼저 업로드하세요."
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
      />
    );
  }

  const isProcessing = ACTIVE_STATUSES.has(bomStatus?.status);
  const statusMessage = buildStatusMessage(bomStatus);
  const progressPercent = Math.max(0, Math.min(100, Number(bomStatus?.progress ?? 0)));

  return (
    <div
      style={{
        marginBottom: 12,
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#102a43" }}>사양 선택</div>
        </div>
        {selectedSpecLabel && <Tag color="blue">{selectedSpecLabel}</Tag>}
      </div>

      {err && (
        <Alert
          type="error"
          title="사양 불러오기 실패"
          description={err}
          showIcon
          style={{ marginBottom: 10 }}
        />
      )}

      {bomStatus && bomStatus.status !== "completed" ? (
        <Alert
          type={bomStatus.status === "failed" ? "error" : "info"}
          showIcon
          message={bomStatus.status === "failed" ? "BOM 분석 실패" : "BOM 분석 진행 중"}
          description={
            <div style={{ display: "grid", gap: 10 }}>
              <div>{statusMessage}</div>
              {bomStatus.status !== "failed" ? <Progress percent={progressPercent} size="small" /> : null}
            </div>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Spin spinning={loading || confirming} tip={confirming ? "트리 준비 중..." : "상태 확인 중..."}>
        <Space.Compact style={{ width: "100%" }}>
          <Select
            placeholder={isProcessing ? "BOM 분석이 끝나면 사양을 선택할 수 있습니다" : "사양을 선택하세요"}
            value={selected || undefined}
            onChange={(value) => setSelected(value)}
            showSearch
            optionFilterProp="children"
            style={{ width: "100%" }}
            size="large"
            disabled={isProcessing || bomStatus?.status === "failed"}
          >
            {specs
              .filter((spec) => getSubSpecDisplayName(spec))
              .map((spec) => (
                <Option key={spec} value={spec}>
                  {getSubSpecDisplayName(spec)}
                </Option>
              ))}
          </Select>

          <Button
            type="primary"
            onClick={onConfirm}
            disabled={!selected || loading || confirming || isProcessing || bomStatus?.status === "failed"}
            size="large"
          >
            선택
          </Button>
        </Space.Compact>
      </Spin>
    </div>
  );
}
