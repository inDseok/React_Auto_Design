import React, { useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { apiUpload } from "../api/client";

export default function UploadBom() {
  const { actions } = useApp();

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // 🔒 업로드 중복 방지
  const uploadingRef = useRef(false);

  function onSelectFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setErr("");
  }

  async function onUpload() {
    if (!file) return;
    if (uploadingRef.current) return;

    uploadingRef.current = true;
    setLoading(true);
    setErr("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const data = await apiUpload("/api/bom/upload", formData);

      if (!data?.bom_id) {
        throw new Error("서버 응답에 bom_id가 없습니다.");
      }

      // ✅ 새 BOM 시작
      actions.setBomContext(data.bom_id);
      actions.setSelectedSpec?.(null);
      actions.setSelectedNode?.(null);
      actions.clearTreeCache?.();

      console.log("NEW bomId:", data.bom_id);

      // 업로드 성공 후 파일 초기화
      setFile(null);
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      uploadingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div>
        <input
          type="file"
          accept=".xls,.xlsx,.xlsm,.xlsb"
          onChange={onSelectFile}
          disabled={loading}
        />
      </div>

      <button
        onClick={onUpload}
        disabled={!file || loading}
        style={{ marginTop: 8 }}
      >
        BOM 업로드
      </button>

      {loading && <div>업로드 중...</div>}
      {err && <div style={{ color: "crimson" }}>{err}</div>}
    </div>
  );
}
