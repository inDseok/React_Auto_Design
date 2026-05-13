import { useEffect } from "react";

export default function SavedPopup({ onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          minWidth: 220,
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
          padding: "20px 28px",
          textAlign: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 22, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>저장했습니다.</div>
      </div>
    </div>
  );
}
