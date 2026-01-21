import React, { useEffect, useRef } from "react";

function RowContextMenu({
  x,
  y,
  onClose,
  onInsertSameGroup,
  onInsertNewGroup,
  onDeleteRow,
  onDeleteGroup,
  onDeleteOptionGroup,
}) {
  const menuRef = useRef(null);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: y,
        left: x,
        background: "#fff",
        border: "1px solid #ccc",
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        zIndex: 1000,
        padding: 4,
        minWidth: 180,
      }}
    >
      <MenuItem label="같은 그룹에 행 추가" onClick={onInsertSameGroup} />
      <MenuItem label="새 그룹 추가" onClick={onInsertNewGroup} />
      <hr style={{ margin: "4px 0" }} />
      <MenuItem label="이 행 삭제" onClick={onDeleteRow} />
      <MenuItem label="이 옵션 삭제" onClick={onDeleteOptionGroup} />
      <MenuItem label="그룹 전체 삭제" onClick={onDeleteGroup} danger />
    </div>
  );
}

function MenuItem({ label, onClick, danger = false }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "6px 10px",
        cursor: "pointer",
        color: danger ? "#d32f2f" : "#333",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f2f2f2")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </div>
  );
}

export default RowContextMenu;
