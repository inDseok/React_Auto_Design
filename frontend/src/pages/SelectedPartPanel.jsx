import React, { useEffect, useState } from "react";
import { apiPatch } from "../api/client";
import { useApp } from "../state/AppContext";

export default function SelectedPartPanel({ node }) {
  const { state, actions } = useApp();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!node) {
      setForm(null);
      return;
    }
    setForm({
      name: node.name ?? "",
      id: node.id ?? "",
      part_no: node.part_no ?? "",
      material: node.material ?? "",
      qty: node.qty ?? 1,
    });
  }, [node]);

  if (!node || !form) {
    return <div>선택된 부품이 없습니다.</div>;
  }

  async function onSave() {
    setSaving(true);
    setErr("");
    try {
      const tree = await apiPatch(
        `/api/bom/${state.bomId}/node/${node.id}`,
        form
      );
      actions.setTreeCache({
        spec: state.selectedSpec,
        tree,
      });
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 12, marginTop: 12 }}>
      <h3>선택된 부품 수정</h3>

      <label>
        부품명
        <input
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
      </label>

      <label>
        품번
        <input
          value={form.part_no}
          onChange={(e) => setForm({ ...form, part_no: e.target.value })}
        />
      </label>

      <label>
        재질
        <input
          value={form.material}
          onChange={(e) => setForm({ ...form, material: e.target.value })}
        />
      </label>

      <label>
        수량
        <input
          type="number"
          step="1"
          value={form.qty}
          onChange={(e) =>
            setForm({ ...form, qty: Number(e.target.value) })
          }
        />
      </label>

      <div style={{ marginTop: 8 }}>
        <button onClick={onSave} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      {err && <div style={{ color: "crimson" }}>{err}</div>}
    </div>
  );
}
