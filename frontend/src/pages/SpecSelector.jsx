import React, { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";

export default function SpecSelector() {
  const { state, actions } = useApp();
  const [specs, setSpecs] = useState([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!state.bomId) return;

    async function loadSpecs() {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(
          `http://localhost:8000/api/bom/${state.bomId}/specs`,
          { credentials: "include" }
        );

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const data = await res.json();
        setSpecs(data);
      } catch (e) {
        setErr(String(e.message ?? e));
      } finally {
        setLoading(false);
      }
    }

    loadSpecs();
  }, [state.bomId]);

  function onConfirm() {
    if (!selected) return;
    // ✅ 이게 핵심
    actions.setSpec(selected);
  }

  if (!state.bomId) {
    return <div>BOM을 먼저 업로드하세요.</div>;
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <h4>사양 선택</h4>

      {loading && <div>사양 불러오는 중...</div>}
      {err && <div style={{ color: "crimson" }}>{err}</div>}

      {specs.map((s) => (
        <div key={s}>
          <label>
            <input
              type="radio"
              name="spec"
              value={s}
              checked={selected === s}
              onChange={() => setSelected(s)}
            />
            {s}
          </label>
        </div>
      ))}

      <button onClick={onConfirm} disabled={!selected}>
        사양 확정
      </button>
    </div>
  );
}
