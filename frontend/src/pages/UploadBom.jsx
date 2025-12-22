import React, { useState } from "react";
import { useApp } from "../state/AppContext";
import { apiUpload } from "../api/client";

export default function UploadBom() {
  const { actions } = useApp();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onChangeFile(e) {
    console.log("UploadBom onChangeFile fired"); // ← 추가
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setErr("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("http://localhost:8000/api/bom/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await apiUpload("/api/bom/upload", formData);
      actions.setBomContext(data.bom_id);

      // FastAPI: create_bom_run → meta.bom_id
      if (!data.bom_id) {
        throw new Error("서버 응답에 bom_id가 없습니다.");
      }

      // ✅ 여기서만 bomId 세팅
      actions.setBomContext(data.bom_id);
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
      e.target.value = ""; // 같은 파일 다시 선택 가능하게
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label>
        <input
          type="file"
          accept=".xls,.xlsx,.xlsm, .xlsb"
          onChange={onChangeFile}
          disabled={loading}
        />
      </label>

      {loading && <div>업로드 중...</div>}
      {err && <div style={{ color: "crimson" }}>{err}</div>}
    </div>
  );
}
