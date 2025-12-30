import React, { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { apiPatch, apiDelete, apiPost } from "../api/client";

export default function SelectedPartPanel({  node, onUpdateNodes }) {
  const { state,actions } = useApp();

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // 선택 노드 바뀌면 form 초기화
  useEffect(() => {
    if (!node) {
      setForm(null);
      return;
    }

    setForm({
      id: node.id ?? "",
      part_no: node.part_no ?? "",
      material: node.material ?? "",
      qty: node.qty ?? "",
    });
    setErr("");
  }, [node]);

  if (!node) {
    return (
      <div style={{ padding: 12, border: "1px solid #ddd" }}>
        선택된 부품이 없습니다.
      </div>
    );
  }
  function handleDeselect() {
    actions.setSelectedNode(null);   // ← 선택 해제
  }

  function onChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function onSave() {
    if (!state.bomId || !state.selectedSpec) {
      setErr("BOM 또는 사양이 없습니다.");
      return;
    }

    setSaving(true);
    setErr("");

    try {
      const payload = {
        id: form.id || null,
        part_no: form.part_no || null,
        material: form.material || null,
        qty:
          form.qty === "" || form.qty === null
            ? null
            : Number(form.qty),
      };

      const updatedTree = await apiPatch(
        `/api/bom/${encodeURIComponent(state.bomId)}/node/${encodeURIComponent(node.id)}`,
        payload
      );
      
      // 🔴 여기서 nodes를 즉시 갱신
      onUpdateNodes(updatedTree.nodes);

      actions.setSelectedNode(form.id);

      alert("저장되었습니다.");
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddChild() {
    if (!state.bomId || !state.selectedSpec) {
      setErr("BOM 또는 사양이 없습니다.");
      return;
    }
    if (!node) {
      setErr("선택된 노드가 없습니다.");
      return;
    }
  
    try {
      const payload = {
        parent_id: node.id,
        id: "새 부품",
        part_no: "",
        material: "",
        qty: 1,
      };
  
      const created = await apiPost(
        `/api/bom/${encodeURIComponent(state.bomId)}/node`,
        payload
      );
  
      onUpdateNodes(created.nodes);
  
      // 새 노드 선택
      actions.setSelectedNode("새 부품");

  
    } catch (e) {
      setErr(String(e?.message ?? e));
    }
  }
  
  async function handleDelete() {
    if (!node) return;
    if (!state.bomId || !state.selectedSpec) {
      setErr("BOM 또는 사양이 없습니다.");
      return;
    }
  
    const ok = window.confirm("정말 이 부품을 삭제하시겠습니까?");
    if (!ok) return;
  
    setSaving(true);
    setErr("");
  
    try {
      const deletedTree = await apiDelete(
        `/api/bom/${encodeURIComponent(state.bomId)}/node/${encodeURIComponent(node.id)}?spec=${encodeURIComponent(state.selectedSpec)}`
      );
  
      // 서버가 최신 nodes를 내려준다고 가정
      if (deletedTree?.nodes) {
        onUpdateNodes(deletedTree.nodes);
      }
  
      // 선택 해제
      actions.setSelectedNode(null);
  
      alert("삭제되었습니다.");
    } catch (e) {
      console.error(e);
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }
  
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid #ddd",
        minWidth: 260,
      }}
    >
      <h4>선택된 부품</h4>

      <div style={{ marginBottom: 8 }}>
        <label>부품명</label>
        <input
          name="id"
          value={form?.id ?? ""}
          onChange={onChange}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label>품번</label>
        <input
          name="part_no"
          value={form?.part_no ?? ""}
          onChange={onChange}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label>재질</label>
        <input
          name="material"
          value={form?.material ?? ""}
          onChange={onChange}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>수량</label>
        <input
          name="qty"
          type="number"
          step="1"
          value={form?.qty ?? ""}
          onChange={onChange}
          style={{ width: "100%" }}
        />
      </div>

      {err && <div style={{ color: "crimson" }}>{err}</div>}

      <button onClick={onSave} disabled={saving}>
        {saving ? "저장 중..." : "저장"}
      </button>
              {/* 🔵 선택 해제 버튼 추가 */}
              <button onClick={handleDeselect}>
          선택 해제
      </button>
      <button onClick={handleAddChild}>
        하위 부품 추가
      </button>
      <button
        onClick={handleDelete}
        disabled={saving}
        style={{ color: "crimson" }}>
        삭제
      </button>
    </div>
  );
}
