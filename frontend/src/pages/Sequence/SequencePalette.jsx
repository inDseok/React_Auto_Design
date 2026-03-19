import React, { useMemo, useState } from "react";
import { useSequenceDnD } from "./SequenceDnDContext";

export default function SequencePalette({
  parts = [],
  processes = [],
  loading = false,
  error = null,
}) {
  const [, setDragItem] = useSequenceDnD();
  const [collapsedGroups, setCollapsedGroups] = useState({});

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

          <div
            draggable
            onDragStart={(e) =>
              onDragStart(e, {
                nodeType: "PART",
                data: {
                  partId: part.partId,
                  partName: part.partName,
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
              background: isMatched ? "#ffffff" : "#fef2f2",
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
          }}
        >
          PART
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

      {/* ===============================
          PROCESS 섹션
         =============================== */}
      <div>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          PROCESS
        </div>

        {processes.map((p) => (
          <div
            key={p.processKey}
            draggable
            onDragStart={(e) =>
              onDragStart(e, {
                nodeType: "PROCESS",
                data: {
                  processKey: p.processKey,
                  processType: p.processType,
                  label: p.label,          // 공정 표시명
                  partBase: p.partBase,
                  sourceSheet: p.sourceSheet,
                },
              })
            }
            style={{
              padding: "6px 8px",
              marginBottom: 6,
              borderRadius: 6,
              border: "1px solid #fed7aa",
              cursor: "grab",
              background: "#fff7ed",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={`${p.sourceSheet} / ${p.partBase}`}
          >
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
