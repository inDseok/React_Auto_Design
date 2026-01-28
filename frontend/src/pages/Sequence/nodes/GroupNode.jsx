import React from "react";

/**
 * GroupNode
 *
 * 역할
 * - 시퀀스 노드들을 묶는 그룹 존
 * - 내부 노드들은 parentNode + extent="parent" 로 이 그룹에 귀속됨
 * - 그룹 이동 시 내부 노드 같이 이동
 *
 * data
 * - label: 그룹 이름
 */
export default function GroupNode({ data }) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          borderRadius: 14,
          padding: 10,
  
          background: "rgba(59, 130, 246, 0.08)",
          border: "2px dashed #3b82f6",
  
          pointerEvents: "none", // ⭐ 핵심
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "#1e3a8a",
            marginBottom: 6,
            userSelect: "none",
          }}
        >
          {data?.label || "GROUP"}
        </div>
      </div>
    );
  }
  