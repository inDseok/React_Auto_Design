import { useEffect, useState } from "react";

const TYPE_STYLES = {
  success: { icon: "✓", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  error:   { icon: "✕", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  warning: { icon: "!", color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  info:    { icon: "i", color: "#0369a1", bg: "#f0f9ff", border: "#bae0ff" },
};

export default function GlobalPopup() {
  const [popup, setPopup] = useState(null); // { message, type }

  useEffect(() => {
    const handler = (e) => {
      setPopup({ message: e.detail.message, type: e.detail.type || "info" });
    };
    window.addEventListener("app:global-popup", handler);
    return () => window.removeEventListener("app:global-popup", handler);
  }, []);

  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(() => setPopup(null), 2500);
    return () => clearTimeout(t);
  }, [popup]);

  if (!popup) return null;

  const s = TYPE_STYLES[popup.type] || TYPE_STYLES.info;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onClick={() => setPopup(null)}
    >
      <div
        style={{
          minWidth: 240,
          maxWidth: 400,
          borderRadius: 16,
          background: s.bg,
          border: `1px solid ${s.border}`,
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
          padding: "20px 28px",
          textAlign: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 22, marginBottom: 8, color: s.color }}>{s.icon}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", whiteSpace: "pre-wrap" }}>
          {popup.message}
        </div>
      </div>
    </div>
  );
}
