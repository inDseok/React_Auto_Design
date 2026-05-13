import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext";
import { apiGet, apiPatch, apiDelete, apiPost } from "../../api/client";

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
  List,
  Tag,
} from "antd";

export default function SelectedPartPanel({ node, onUpdateNodes, onBeforeMutate }) {
  const { state, actions } = useApp();
  const [form] = Form.useForm();

  const nodeRef = useRef(node);
  useEffect(() => { nodeRef.current = node; }, [node]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [formValues, setFormValues] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

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
      inhouse: node.inhouse ?? false,
      recommended_part_base: node.recommended_part_base ?? null,
      recommended_source_sheet: node.recommended_source_sheet ?? null,
    });
    setFormValues({
      id: node.id ?? "",
      part_no: node.part_no ?? "",
      material: node.material ?? "",
      qty: node.qty ?? "",
      type: node.type ?? "PART",
      inhouse: node.inhouse ?? false,
      recommended_part_base: node.recommended_part_base ?? null,
      recommended_source_sheet: node.recommended_source_sheet ?? null,
    });
    setSuggestions([]);

    setErr("");
  }, [node, form]);

  useEffect(() => {
    if (!node || !state.bomId || !state.selectedSpec) {
      setSuggestions([]);
      return;
    }

    const isInhouse = formValues.inhouse === true;
    const queryName = String(formValues.id ?? "").trim();
    const queryPartNo = String(formValues.part_no ?? "").trim();

    if (!isInhouse || (!queryName && !queryPartNo)) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams({
          spec: state.selectedSpec,
          limit: "5",
        });
        if (queryName) params.set("name", queryName);
        if (queryPartNo) params.set("part_no", queryPartNo);

        const data = await apiGet(
          `/api/sub/bom/${encodeURIComponent(state.bomId)}/part-suggestions?${params.toString()}`
        );
        setSuggestions(Array.isArray(data?.items) ? data.items : []);
      } catch (e) {
        console.error("추천 조회 실패:", e);
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [formValues.id, formValues.inhouse, formValues.part_no, node, state.bomId, state.selectedSpec]);

  async function onSave(values) {
    if (!state.bomId || !state.selectedSpec) {
      setErr("BOM 또는 사양이 없습니다.");
      return;
    }

    setSaving(true);
    setErr("");
    const rollbackUndo = onBeforeMutate?.();

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
        inhouse: values.inhouse ?? false,
        recommended_part_base: values.recommended_part_base || null,
        recommended_source_sheet: values.recommended_source_sheet || null,
        recommended_match_score: formValues.recommended_match_score || null,
      };
      
      const updatedTree = await apiPatch(
        `/api/sub/bom/${encodeURIComponent(state.bomId)}/node/${encodeURIComponent(
          node.id
        )}?spec=${encodeURIComponent(state.selectedSpec)}`,
        payload
      );

      onUpdateNodes(updatedTree.nodes);
      actions.setSelectedNode(node.name);

      message.success("저장되었습니다.");
    } catch (e) {
      rollbackUndo?.();
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

    const rollbackUndo = onBeforeMutate?.();

    try {
      const payload = {
        parent_name: node.id,
        id: "새 부품",
        part_no: "",
        material: "",
        qty: 1,
        inhouse: false 
      };

      const created = await apiPost(
        `/api/sub/bom/${encodeURIComponent(state.bomId)}/node?spec=${encodeURIComponent(
          state.selectedSpec
        )}`,
        payload
      );

      onUpdateNodes(created.nodes);
      actions.setSelectedNode("새 부품");

      message.success("하위 부품이 추가되었습니다.");
    } catch (e) {
      rollbackUndo?.();
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
    const rollbackUndo = onBeforeMutate?.();

    try {
      const deletedTree = await apiDelete(
        `/api/sub/bom/${encodeURIComponent(
          state.bomId
        )}/node/${encodeURIComponent(node.name)}?spec=${encodeURIComponent(
          state.selectedSpec
        )}`
      );

      if (deletedTree?.nodes) {
        onUpdateNodes(deletedTree.nodes);
      }

      actions.setSelectedNode(null);
      message.success("삭제되었습니다.");
    } catch (e) {
      rollbackUndo?.();
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function handleDeselect() {
    actions.setSelectedNode(null);
  }

  async function handleClearRecommendation() {
    if (!state.bomId || !state.selectedSpec || !node) return;
    const rollbackUndo = onBeforeMutate?.();
    try {
      setSaving(true);
      const payload = { recommended_part_base: null, recommended_source_sheet: null, recommended_match_score: null };
      const updatedTree = await apiPatch(
        `/api/sub/bom/${encodeURIComponent(state.bomId)}/node/${encodeURIComponent(node.id)}?spec=${encodeURIComponent(state.selectedSpec)}`,
        payload
      );
      onUpdateNodes(updatedTree.nodes);
      if (nodeRef.current?.id !== node.id) return;
      form.setFieldsValue(payload);
      setFormValues((prev) => ({ ...prev, ...payload }));
      message.success("적용이 해제되었습니다.");
    } catch (e) {
      rollbackUndo?.();
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function handleApplySuggestion(item) {
    if (!state.bomId || !state.selectedSpec || !node) {
      return;
    }

    const targetNodeId = node.id;
    const rollbackUndo = onBeforeMutate?.();

    try {
      setSaving(true);

      const nextInhouse = form.getFieldValue("inhouse") ?? formValues.inhouse ?? node.inhouse ?? false;

      const payload = {
        inhouse: nextInhouse,
        recommended_part_base: item.db_part_raw,
        recommended_source_sheet: item.sheet,
        recommended_match_score: {
          combined: item.score_combined,
          rapidfuzz: item.score_rapidfuzz,
          jaro_winkler: item.score_jaro_winkler,
          source: "sub-manual-recommendation",
        },
      };

      const updatedTree = await apiPatch(
        `/api/sub/bom/${encodeURIComponent(state.bomId)}/node/${encodeURIComponent(node.id)}?spec=${encodeURIComponent(state.selectedSpec)}`,
        payload
      );

      onUpdateNodes(updatedTree.nodes);
      if (nodeRef.current?.id !== targetNodeId) return;
      form.setFieldsValue(payload);
      setFormValues((prev) => ({ ...prev, ...payload }));
      message.success("시퀀스 추천 부품으로 반영되었습니다.");
    } catch (e) {
      rollbackUndo?.();
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="선택된 부품"
      style={{ minWidth: 260, height: "100%", display: "flex", flexDirection: "column" }}
      bodyStyle={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 12 }}
    >
      {err && (
        <Alert
          type="error"
          title={err}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}
  
      <Form
        layout="vertical"
        form={form}
        onFinish={onSave}
        onValuesChange={(_, allValues) => setFormValues(allValues)}
      >
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

            <Form.Item name="recommended_part_base" hidden>
              <Input />
            </Form.Item>

            <Form.Item name="recommended_source_sheet" hidden>
              <Input />
            </Form.Item>

            {formValues.inhouse && (() => {
              const manualPart = formValues.recommended_part_base || node?.recommended_part_base;
              const autoMatch = !manualPart && suggestions.find(s => s.score_combined >= 90);
              if (manualPart) {
                return (
                  <div style={{ marginBottom: 16, padding: "8px 12px", borderRadius: 6, background: "#f0f9ff", border: "1px solid #bae0ff" }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>시퀀스 구성 페이지에 표시되는 부품 <span style={{ color: "#2563eb" }}>· 수동 지정</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 600, color: "#0369a1", flex: 1 }}>{manualPart}</div>
                      <Button size="small" danger onClick={handleClearRecommendation}>적용 해제</Button>
                    </div>
                  </div>
                );
              }
              if (autoMatch) {
                return (
                  <div style={{ marginBottom: 16, padding: "8px 12px", borderRadius: 6, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>시퀀스 구성 페이지에 표시되는 부품 <span style={{ color: "#16a34a" }}>· 자동 매칭 ({autoMatch.score_combined}점)</span></div>
                    <div style={{ fontWeight: 600, color: "#15803d" }}>{autoMatch.db_part_raw}</div>
                  </div>
                );
              }
              return (
                <div style={{ marginBottom: 16, padding: "8px 12px", borderRadius: 6, background: "#fafafa", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>시퀀스 구성 페이지에 표시되는 부품</div>
                  <div style={{ color: "#94a3b8" }}>없음 — DB 추천에서 적용하거나 유사도 90점 이상 부품이 있으면 자동 표시됩니다</div>
                </div>
              );
            })()}

            {formValues.inhouse && (
              <Card
                size="small"
                title="DB 유사 부품 추천"
                style={{ marginBottom: 16, background: "#f8fbff" }}
                loading={loadingSuggestions}
              >
                {suggestions.length === 0 ? (
                  <div style={{ color: "#667085" }}>
                    부품명 또는 품번 기준으로 일치 후보가 없거나 아직 검색 중입니다.
                  </div>
                ) : (
                  <List
                    size="small"
                    dataSource={suggestions}
                    renderItem={(item) => {
                      const activePartBase = formValues.recommended_part_base || node?.recommended_part_base;
                      const isActive = activePartBase && item.db_part_raw === activePartBase;
                      return (
                        <List.Item
                          style={isActive ? { background: "#fffbe6", borderRadius: 6, padding: "4px 8px" } : undefined}
                          actions={[
                            isActive ? (
                              <Tag key="active" color="gold" style={{ margin: 0 }}>시퀀스에 표시됨</Tag>
                            ) : (
                              <Button
                                key="apply"
                                size="small"
                                onClick={() => handleApplySuggestion(item)}
                              >
                                적용
                              </Button>
                            ),
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space wrap>
                                <span style={isActive ? { fontWeight: 600 } : undefined}>{item.db_part_raw}</span>
                                <Tag color="blue">{item.sheet}</Tag>
                              </Space>
                            }
                            description={
                              <Space wrap size={[8, 4]}>
                                <span>종합 {item.score_combined}</span>
                                <span>JW {item.score_jaro_winkler}</span>
                                <span>RF {item.score_rapidfuzz}</span>
                              </Space>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            )}

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
