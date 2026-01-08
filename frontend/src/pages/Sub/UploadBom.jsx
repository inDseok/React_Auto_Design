import React, { useRef, useState } from "react";
import { useApp } from "../../state/AppContext";
import { apiUpload } from "../../api/client";
import { Upload, Button, Alert, Spin, Typography } from "antd";
import { UploadOutlined } from "@ant-design/icons";

const { Text } = Typography;

export default function UploadBom() {
  const { actions } = useApp();

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const uploadingRef = useRef(false);

  function beforeUpload(f) {
    setFile(f);
    setErr("");
    return false; // 자동 업로드 막기
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

      const data = await apiUpload("/api/sub/bom/upload", formData);

      if (!data?.bom_id) {
        throw new Error("서버 응답에 bom_id가 없습니다.");
      }

      actions.setBomContext(data.bom_id);
      actions.setSelectedSpec?.(null);
      actions.setSelectedNode?.(null);
      actions.clearTreeCache?.();

      console.log("NEW bomId:", data.bom_id);

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

      <Spin spinning={loading} tip="업로드 중...">

        <Upload
          beforeUpload={beforeUpload}
          maxCount={1}
          accept=".xls,.xlsx,.xlsm,.xlsb"
          showUploadList={{
            showRemoveIcon: !loading,
          }}
          onRemove={() => setFile(null)}
        >
          <Button icon={<UploadOutlined />} disabled={loading}>
            파일 선택
          </Button>
        </Upload>

        {file && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">
              선택된 파일: {file.name}
            </Text>
          </div>
        )}

        <Button
          type="primary"
          onClick={onUpload}
          disabled={!file || loading}
          style={{ marginTop: 10 }}
        >
          BOM 업로드
        </Button>

        {err && (
          <Alert
            type="error"
            message="업로드 오류"
            description={err}
            showIcon
            style={{ marginTop: 12 }}
          />
        )}

      </Spin>
    </div>
  );
}
