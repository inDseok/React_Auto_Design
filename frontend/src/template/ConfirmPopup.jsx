export default function ConfirmPopup({ message, onConfirm, onCancel, confirmLabel = "확인", cancelLabel = "취소", danger = false }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          minWidth: 280,
          maxWidth: "calc(100vw - 32px)",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
          padding: "20px 24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", marginBottom: 16, lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onConfirm} style={danger ? dangerButtonStyle : primaryButtonStyle}>
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryButtonStyle = {
  border: 0,
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const dangerButtonStyle = {
  border: 0,
  background: "#dc2626",
  color: "#fff",
  borderRadius: 10,
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  borderRadius: 10,
  padding: "9px 14px",
  fontSize: 13,
  cursor: "pointer",
};
