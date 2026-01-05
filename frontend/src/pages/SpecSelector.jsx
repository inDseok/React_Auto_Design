import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { Spin, Radio, Button, Alert, Collapse, Typography } from "antd";

const { Panel } = Collapse;
const { Text } = Typography;

export default function SpecSelector() {
  const { state, actions } = useApp();
  const [specs, setSpecs] = useState([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
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
          `http://localhost:8000/api/bom/${state.bomId}/specs`,
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

  function onConfirm() {
    if (!selected) return;
    actions.setSpec(selected);
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
    <Collapse
      defaultActiveKey={["1"]}
      style={{ marginBottom: 12, background: "white" }}
    >
      <Panel header="사양 선택" key="1">
        {err && (
          <Alert
            type="error"
            message="사양 불러오기 실패"
            description={err}
            showIcon
            style={{ marginBottom: 10 }}
          />
        )}

        <Spin spinning={loading} tip="사양 불러오는 중...">
          <Radio.Group
            onChange={(e) => setSelected(e.target.value)}
            value={selected}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {specs.map((s) => (
              <Radio key={s} value={s}>
                {s}
              </Radio>
            ))}
          </Radio.Group>

          <Button
            type="primary"
            onClick={onConfirm}
            disabled={!selected || loading}
            style={{ marginTop: 12 }}
          >
            사양 확정
          </Button>

          {selected && (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary">선택됨: {selected}</Text>
            </div>
          )}
        </Spin>
      </Panel>
    </Collapse>
  );
}
