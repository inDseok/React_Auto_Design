import React, { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { apiPatch, apiDelete, apiPost } from "../api/client";

import {
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Button,
  Space,
  Alert,
  Popconfirm,
  message,
  Checkbox,
} from "antd";

export default function SelectedPartPanel({ node, onUpdateNodes }) {
  const { state, actions } = useApp();
  const [form] = Form.useForm();

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // node 변경 시 form 초기화
  useEffect(() => {
    if (!node) {
      form.resetFields();
      return;
    }

    form.setFieldsValue({
      id: node.id ?? "",
      part_no: node.part_no ?? "",
      material: node.material ?? "",
      qty: node.qty ?? "",
      type: node.type ?? "PART",
      inhouse: node.inhouse ?? false  
    });

    setErr("");
  }, [node, form]);

  if (!node) {
    return (
      <Card>
        선택된 부품이 없습니다.
      </Card>
    );
  }

  async function onSave(values) {
    if (!state.bomId || !state.selectedSpec) {
      setErr("BOM 또는 사양이 없습니다.");
      return;
    }

    setSaving(true);
    setErr("");

    try {
      const payload = {
        id: values.id || null,
        part_no: values.part_no || null,
        material: values.material || null,
        qty:
          values.qty === "" || values.qty === null
            ? null
            : Number(values.qty),
        type: values.type || "PART",
        inhouse: values.inhouse ?? false
      };

      const updatedTree = await apiPatch(
        `/api/bom/${encodeURIComponent(state.bomId)}/node/${encodeURIComponent(
          node.id
        )}`,
        payload
      );

      onUpdateNodes(updatedTree.nodes);
      actions.setSelectedNode(values.id);

      message.success("저장되었습니다.");
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

    try {
      const payload = {
        parent_id: node.id,
        id: "새 부품",
        part_no: "",
        material: "",
        qty: 1,
        inhouse: false 
      };

      const created = await apiPost(
        `/api/bom/${encodeURIComponent(state.bomId)}/node`,
        payload
      );

      onUpdateNodes(created.nodes);
      actions.setSelectedNode("새 부품");

      message.success("하위 부품이 추가되었습니다.");
    } catch (e) {
      setErr(String(e?.message ?? e));
    }
  }

  async function handleDelete() {
    if (!state.bomId || !state.selectedSpec) {
      setErr("BOM 또는 사양이 없습니다.");
      return;
    }

    setSaving(true);
    setErr("");

    try {
      const deletedTree = await apiDelete(
        `/api/bom/${encodeURIComponent(
          state.bomId
        )}/node/${encodeURIComponent(node.id)}?spec=${encodeURIComponent(
          state.selectedSpec
        )}`
      );

      if (deletedTree?.nodes) {
        onUpdateNodes(deletedTree.nodes);
      }

      actions.setSelectedNode(null);
      message.success("삭제되었습니다.");
    } catch (e) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function handleDeselect() {
    actions.setSelectedNode(null);
  }

  return (
    <Card title="선택된 부품" style={{ minWidth: 260 }}>
      {err && (
        <Alert
          type="error"
          message={err}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}
  
      <Form layout="vertical" form={form} onFinish={onSave}>
        {!node && (
          <p>선택된 부품이 없습니다.</p>
        )}
  
        {node && (
          <>
            <Form.Item name="id" label="부품명">
              <Input />
            </Form.Item>
  
            <Form.Item name="part_no" label="품번">
              <Input />
            </Form.Item>
  
            <Form.Item name="material" label="재질">
              <Input />
            </Form.Item>
  
            <Form.Item name="qty" label="수량">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
  
            <Form.Item name="type" label="구분">
              <Radio.Group>
                <Radio value="SUB">외주</Radio>
                <Radio value="PART">사내 부품</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item
              name="inhouse"
              valuePropName="checked"
            >
              <Checkbox>사내 조립</Checkbox>
            </Form.Item>

            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                저장
              </Button>
  
              <Button onClick={handleDeselect}>선택 해제</Button>
  
              <Button onClick={handleAddChild}>하위 부품 추가</Button>
  
              <Popconfirm
                title="삭제하시겠습니까?"
                onConfirm={handleDelete}
                okText="삭제"
                cancelText="취소"
              >
                <Button danger>삭제</Button>
              </Popconfirm>
            </Space>
          </>
        )}
      </Form>
    </Card>
  );
}