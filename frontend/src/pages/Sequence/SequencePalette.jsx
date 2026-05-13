import React, { useMemo, useState } from "react";
import { useSequenceDnD } from "./SequenceDnDContext";

export default function SequencePalette({
  parts = [],
  loading = false,
  error = null,
  usedPartNodeNames = [],
  selectedPartNodeNames = [],
  onTogglePartSelection,
  onClearPartSelection,
  onAutoBuildSequence,
  autoBuildLoading = false,
  useAiForAutoBuild = false,
  onToggleUseAiForAutoBuild,
}) {
  const [, setDragItem] = useSequenceDnD();
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [showAiTooltip, setShowAiTooltip] = useState(false);
  const usedPartNodeNameSet = useMemo(
    () => new Set(usedPartNodeNames.filter(Boolean)),
    [usedPartNodeNames]
  );
  const selectedPartNodeNameSet = useMemo(
    () => new Set(selectedPartNodeNames.filter(Boolean)),
    [selectedPartNodeNames]
  );

  const onDragStart = (e, payload) => {
    setDragItem(payload);
    e.dataTransfer.effectAllowed = "move";
  };

  const partTree = useMemo(() => {
    const nodesByName = new Map();

    parts.forEach((part, index) => {
      const nodeName = part.nodeName || `part-${index}`;
      const rawPath = Array.isArray(part.treePath) ? part.treePath : [];
      const displayPath = rawPath.length ? rawPath : [part.partBase ?? part.partId ?? "PART"];

      nodesByName.set(nodeName, {
        key: nodeName,
        parentName: part.parentName || null,
        label: displayPath[displayPath.length - 1] || part.partBase || part.partId,
        pathLabel: displayPath.join(" > "),
        part,
        children: [],
        order: index,
      });
    });

    const roots = [];

    nodesByName.forEach((item) => {
      const parent = item.parentName ? nodesByName.get(item.parentName) : null;
      if (parent) {
        parent.children.push(item);
      } else {
        roots.push(item);
      }
    });

    const sortTree = (items) => {
      items.sort((a, b) => a.order - b.order);
      items.forEach((item) => sortTree(item.children));
    };

    sortTree(roots);
    return roots;
  }, [parts]);

  const toggleGroup = (groupKey) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const renderPartNode = (item, depth = 0) => {
    const { part } = item;
    const displayLabel = part.partBase ?? part.partId;
    const isMatched = Boolean(part.partBase);
    const hasChildren = item.children.length > 0;
    const isCollapsed = collapsedGroups[item.key] === true;
    const isUsed = usedPartNodeNameSet.has(part.nodeName);
    const isSelected = selectedPartNodeNameSet.has(part.nodeName);

    return (
      <div key={item.key} style={{ marginBottom: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 6,
            paddingLeft: depth * 14,
          }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleGroup(item.key)}
            style={{
              width: 18,
              minWidth: 18,
              border: 0,
              background: "transparent",
              color: hasChildren ? "#475569" : "transparent",
              cursor: hasChildren ? "pointer" : "default",
              padding: 0,
              fontSize: 11,
            }}
            aria-label={hasChildren ? "하위 부품 펼치기" : "하위 부품 없음"}
          >
            {hasChildren ? (isCollapsed ? "▸" : "▾") : "•"}
          </button>

          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onTogglePartSelection?.(part)}
            onClick={(event) => event.stopPropagation()}
            style={{
              alignSelf: "center",
              margin: 0,
              cursor: "pointer",
            }}
            aria-label={`${displayLabel} 선택`}
          />

          <div
            draggable
            onDragStart={(e) =>
              onDragStart(e, {
                nodeType: "PART",
                data: {
                  partId: part.partId,
                  partName: part.partName,
                  nodeName: part.nodeName,
                  inhouse: part.inhouse,
                  partBase: part.partBase,
                  sourceSheet: part.sourceSheet,
                  option: "",
                  statusLabel: "",
                },
              })
            }
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 6,
              border: isMatched ? "1px solid #cbd5e1" : "1px dashed #fca5a5",
              cursor: "grab",
              background: isUsed ? "#e5e7eb" : isMatched ? "#ffffff" : "#fef2f2",
              color: isUsed ? "#64748b" : "#0f172a",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={
              isMatched
                ? `DB 기준: ${part.partBase}\n원본: ${part.partId}\n시트: ${part.sourceSheet}\n트리: ${item.pathLabel}`
                : `매칭 실패\n원본: ${part.partId}\n트리: ${item.pathLabel}`
            }
          >
            {displayLabel}
          </div>
        </div>

        {!isCollapsed && hasChildren ? (
          <div style={{ marginTop: 4 }}>
            {item.children.map((child) => renderPartNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      style={{
        width: 240,
        borderRight: "1px solid #e2e8f0",
        padding: 12,
        overflowY: "auto",
        background: "#ffffff",
      }}
    >
      <style>
        {`
          @keyframes sequence-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      {/* ===============================
          PART 섹션
         =============================== */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>PART</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => onClearPartSelection?.()}
              disabled={selectedPartNodeNames.length === 0}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                background: selectedPartNodeNames.length === 0 ? "#f8fafc" : "#ffffff",
                color: selectedPartNodeNames.length === 0 ? "#94a3b8" : "#334155",
                padding: "6px 7px",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                whiteSpace: "nowrap",
                cursor: selectedPartNodeNames.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              초기화
            </button>
            <div
              style={{ position: "relative", display: "inline-flex" }}
              onMouseEnter={() => setShowAiTooltip(true)}
              onMouseLeave={() => setShowAiTooltip(false)}
            >
              <button
                type="button"
                onClick={() => onToggleUseAiForAutoBuild?.()}
                style={{
                  border: `1px solid ${useAiForAutoBuild ? "#2563eb" : "#cbd5e1"}`,
                  borderRadius: 8,
                  background: useAiForAutoBuild ? "#dbeafe" : "#ffffff",
                  color: useAiForAutoBuild ? "#1d4ed8" : "#334155",
                  padding: "6px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
                aria-describedby="sequence-ai-toggle-tooltip"
              >
                AI 사용
              </button>
              {showAiTooltip ? (
                <div
                  id="sequence-ai-toggle-tooltip"
                  role="tooltip"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 20,
                    minWidth: 220,
                    maxWidth: 260,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#0f172a",
                    color: "#f8fafc",
                    fontSize: 11,
                    lineHeight: 1.45,
                    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.22)",
                    whiteSpace: "normal",
                    textAlign: "left",
                  }}
                >
                  자동 구성 시 AI가 DB 추천 결과를 추가로 검토합니다. 끄면 AI 없이 DB 기준으로만 자동 구성합니다.
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onAutoBuildSequence?.()}
              disabled={autoBuildLoading || selectedPartNodeNames.length === 0}
              style={{
                border: 0,
                borderRadius: 8,
                background:
                  autoBuildLoading || selectedPartNodeNames.length === 0
                    ? "#cbd5e1"
                    : "#2563eb",
                color: "#fff",
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                whiteSpace: "nowrap",
                cursor:
                  autoBuildLoading || selectedPartNodeNames.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {autoBuildLoading ? "생성 중..." : "자동구성"}
            </button>
          </div>
        </div>

        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              fontSize: 12,
              color: "#475569",
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid #cbd5e1",
                borderTopColor: "#2563eb",
                animation: "sequence-spin 0.8s linear infinite",
              }}
            />
            PART 조회 중...
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {!loading && parts.length === 0 && (
          <div style={{ fontSize: 12, color: "#64748b" }}>
            사용 가능한 부품 없음
          </div>
        )}

        {!loading && partTree.map((item) => renderPartNode(item))}
      </div>
    </div>
  );
}
