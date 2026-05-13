import React, { useEffect, useMemo, useState } from "react";

import {
  actionButtonStyle,
  processPopupBodyStyle,
  processPopupCardStyle,
  processPopupEmptyStyle,
  processPopupFooterStyle,
  processPopupHeaderStyle,
  processPopupItemReasonStyle,
  processPopupItemStyle,
  processPopupItemTitleStyle,
  processPopupListStyle,
  processPopupOverlayStyle,
  processPopupPartSectionStyle,
  processPopupPartTitleStyle,
  processPopupTitleStyle,
  secondaryButtonStyle,
} from "./SequenceEditor.styles";

const getVisibleRecommendationReason = (reason) => {
  const normalized = String(reason || "").trim();
  if (!normalized) {
    return "";
  }
  if (/^graph traversal depth=\d+$/i.test(normalized)) {
    return "";
  }
  return normalized;
};

const normalizeDisplayValue = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const buildProcessRecommendationTitle = (item, process) => {
  const partBase = normalizeDisplayValue(
    process?.partBase || process?.contextPartBase || item?.partData?.partBase || item?.partLabel
  );

  return partBase || normalizeDisplayValue(process?.displayLabel || process?.operationLabel || process?.label || process?.processKey);
};

const buildProcessRecommendationSubtitle = (process) =>
  normalizeDisplayValue(
    process?.displayLabel || process?.operationLabel || process?.label || process?.processKey
  );

export default function SequenceProcessRecommendationPopup({
  open,
  title,
  items,
  onClose,
  onConfirmSelections,
}) {
  const [selectedPartKeys, setSelectedPartKeys] = useState({});
  const [selectedProcessKeys, setSelectedProcessKeys] = useState({});

  useEffect(() => {
    if (!open) {
      setSelectedPartKeys({});
      setSelectedProcessKeys({});
    }
  }, [open, items]);

  const selectedPayload = useMemo(() => {
    const selectedItems = [];
    for (const item of items || []) {
      const partKey = item.itemKey || item.partNodeName || item.partLabel;
      if (!selectedPartKeys[partKey]) {
        continue;
      }
      const selectedProcesses = (item.processes || []).filter(
        (process) => selectedProcessKeys[`${partKey}::${process.processKey}`]
      );
      selectedItems.push({ item, processes: selectedProcesses });
    }
    return selectedItems;
  }, [items, selectedPartKeys, selectedProcessKeys]);

  const selectedPartCount = selectedPayload.length;
  const selectedProcessCount = selectedPayload.reduce(
    (sum, entry) => sum + entry.processes.length,
    0
  );

  if (!open) {
    return null;
  }

  return (
    <div style={processPopupOverlayStyle}>
      <div style={processPopupCardStyle}>
        <div style={processPopupHeaderStyle}>
          <div>
            <div style={processPopupTitleStyle}>{title || "부품별 추천 공정"}</div>
          </div>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            닫기
          </button>
        </div>

        <div style={processPopupBodyStyle}>
          {(items || []).map((item, itemIndex) => (
            <div
              key={item.itemKey || `${item.partNodeName || item.partLabel || "part"}-${itemIndex}`}
              style={processPopupPartSectionStyle}
            >
              <button
                type="button"
                onClick={() =>
                  setSelectedPartKeys((prev) => ({
                    ...prev,
                    [item.itemKey || item.partNodeName || item.partLabel]:
                      !prev[item.itemKey || item.partNodeName || item.partLabel],
                  }))
                }
                style={{
                  ...processPopupItemStyle,
                  width: "100%",
                  textAlign: "left",
                  border:
                    selectedPartKeys[item.itemKey || item.partNodeName || item.partLabel]
                      ? "1px solid #2563eb"
                      : processPopupItemStyle.border,
                  background:
                    selectedPartKeys[item.itemKey || item.partNodeName || item.partLabel]
                      ? "#dbeafe"
                      : "#ffffff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    readOnly
                    checked={
                      !!selectedPartKeys[item.itemKey || item.partNodeName || item.partLabel]
                    }
                  />
                  <div style={processPopupPartTitleStyle}>{item.partLabel}</div>
                </div>
              </button>
              {Array.isArray(item.processes) && item.processes.length ? (
                <div style={processPopupListStyle}>
                  {item.processes.map((process) => {
                    const selectionKey = `${
                      item.itemKey || item.partNodeName || item.partLabel
                    }::${process.processKey}`;
                    const isSelected = !!selectedProcessKeys[selectionKey];
                    const isPartSelected = !!selectedPartKeys[
                      item.itemKey || item.partNodeName || item.partLabel
                    ];
                    const visibleReason = getVisibleRecommendationReason(process.reason);
                    const processSubtitle = buildProcessRecommendationSubtitle(process);
                    return (
                      <button
                        key={process.processKey}
                        type="button"
                        disabled={!isPartSelected}
                        onClick={() =>
                          setSelectedProcessKeys((prev) => ({
                            ...prev,
                            [selectionKey]: !prev[selectionKey],
                          }))
                        }
                        style={{
                          ...processPopupItemStyle,
                          cursor: isPartSelected ? "pointer" : "not-allowed",
                          textAlign: "left",
                          width: "100%",
                          border: isSelected ? "1px solid #2563eb" : processPopupItemStyle.border,
                          background: isSelected
                            ? "#eff6ff"
                            : isPartSelected
                              ? processPopupItemStyle.background
                              : "#f8fafc",
                          opacity: isPartSelected ? 1 : 0.5,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 6,
                          }}
                        >
                          <input type="checkbox" readOnly checked={isSelected} />
                          <div style={processPopupItemTitleStyle}>
                            {buildProcessRecommendationTitle(item, process)}
                          </div>
                        </div>
                        {processSubtitle ? (
                          <div style={processPopupItemReasonStyle}>{processSubtitle}</div>
                        ) : null}
                        {visibleReason ? (
                          <div style={processPopupItemReasonStyle}>{visibleReason}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={processPopupEmptyStyle}>추천 공정이 없습니다.</div>
              )}
            </div>
          ))}
        </div>

        <div style={processPopupFooterStyle}>
          <div style={{ marginRight: "auto", fontSize: 12, color: "#475569" }}>
            선택된 부품 {selectedPartCount}개 / 공정 {selectedProcessCount}개
          </div>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirmSelections?.(selectedPayload)}
            disabled={selectedPartCount === 0}
            style={{
              ...actionButtonStyle,
              opacity: selectedPartCount === 0 ? 0.5 : 1,
              cursor: selectedPartCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
