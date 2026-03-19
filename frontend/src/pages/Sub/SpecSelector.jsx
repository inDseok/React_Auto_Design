import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext";
import { Spin, Button, Alert, Typography, Select, Space, Tag } from "antd";

const { Text } = Typography;
const { Option } = Select;

export default function SpecSelector() {
  const { state, actions } = useApp();
  const [specs, setSpecs] = useState([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");

  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!state.bomId) {
      setSpecs([]);
      setSelected("");
      return;
    }

    const reqId = ++reqIdRef.current;

    async function loadSpecs() {
      setLoading(true);
      setErr("");

      try {
        const res = await fetch(
          `http://localhost:8000/api/sub/bom/${state.bomId}/specs`,
          { credentials: "include" }
        );

        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();

        if (reqId !== reqIdRef.current) return;

        setSpecs(data);
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setErr(String(e?.message ?? e));
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    }

    loadSpecs();
  }, [state.bomId]);

  async function onConfirm() {
    if (!selected) return;
    const cacheKey = `${state.bomId}::${selected}`;
    const cached = state.treeCache?.[cacheKey];

    setConfirming(true);
    setErr("");

    try {
      if (!Array.isArray(cached?.nodes)) {
        const res = await fetch(
          `http://localhost:8000/api/sub/bom/${state.bomId}/tree?spec=${encodeURIComponent(
            selected
          )}`,
          { credentials: "include" }
        );

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const data = await res.json();
        actions.setTreeCacheEntry?.(cacheKey, {
          nodes: data.nodes ?? [],
        });
      }

      actions.setSpec(selected);
      localStorage.setItem("spec", selected);
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      setConfirming(false);
    }
  }

  if (!state.bomId) {
    return (
      <Alert
        message="BOM을 먼저 업로드하세요."
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
      />
    );
  }

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
        {state.selectedSpec && <Tag color="blue">{state.selectedSpec}</Tag>}
      </div>

      {err && (
        <Alert
          type="error"
          message="사양 불러오기 실패"
          description={err}
          showIcon
          style={{ marginBottom: 10 }}
        />
      )}

      <Spin spinning={loading || confirming} tip={confirming ? "트리 준비 중..." : "사양 불러오는 중..."}>
        <Space.Compact style={{ width: "100%" }}>
          <Select
            placeholder="사양을 선택하세요"
            value={selected || undefined}
            onChange={(value) => setSelected(value)}
            showSearch
            optionFilterProp="children"
            style={{ width: "100%" }}
            size="large"
          >
            {specs.map((s) => (
              <Option key={s} value={s}>
                {s}
              </Option>
            ))}
          </Select>

          <Button
            type="primary"
            onClick={onConfirm}
            disabled={!selected || loading || confirming}
            size="large"
          >
            선택
          </Button>
        </Space.Compact>
      </Spin>
    </div>
  );
}
