// src/pages/Sequence/zones/ZoneControls.jsx
import React, { useMemo, useState } from "react";

export default function ZoneControls({
  zones,
  mode,
  zoneDraftName,
  draftStartId,
  draftEndId,
  onStartCreateZone,
  onCancelCreateZone,
  onSetDraftName,
  onRemoveZone,
}) {
  const canCreate = useMemo(() => {
    return mode === "creating" && zoneDraftName.trim() && draftStartId && draftEndId;
  }, [mode, zoneDraftName, draftStartId, draftEndId]);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ minWidth: 360, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 14 }}>Zone</div>
          {mode !== "creating" ? (
            <button onClick={onStartCreateZone}>Zone 추가</button>
          ) : (
            <button onClick={onCancelCreateZone}>취소</button>
          )}
        </div>

        {mode === "creating" && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <input
              value={zoneDraftName}
              onChange={(e) => onSetDraftName(e.target.value)}
              placeholder="공정명 입력 (예: 광검사)"
              style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
            />

            <div style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>
              시작 노드: {draftStartId || "미선택"}
              <br />
              끝 노드: {draftEndId || "미선택"}
              <br />
              노드를 클릭해서 시작/끝을 선택하세요.
            </div>

            <div style={{ fontSize: 12, color: "#777", lineHeight: 1.5 }}>
              규칙
              <br />
              start에서 end로 갈 수 있어야 함
              <br />
              다른 Zone과 노드가 겹치면 생성 불가
            </div>

            <div style={{ fontSize: 12, color: canCreate ? "#0a7" : "#999" }}>
              {canCreate ? "생성 가능 상태" : "이름, 시작, 끝을 모두 선택해야 합니다"}
            </div>
          </div>
        )}

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {zones.length === 0 ? (
            <div style={{ fontSize: 12, color: "#777" }}>아직 Zone이 없습니다.</div>
          ) : (
            zones.map((z) => (
              <div
                key={z.zoneId}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 13 }}>{z.name}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>
                    start: {z.startNodeId} / end: {z.endNodeId} / nodes: {z.nodeIds.length}
                  </div>
                </div>
                <button onClick={() => onRemoveZone(z.zoneId)} style={{ fontSize: 12 }}>
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
