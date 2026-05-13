export const selectStyle = {
  minWidth: 220,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  fontSize: 13,
};

export const actionButtonStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: 0,
  background: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const secondaryButtonStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const chatFabStyle = {
  position: "fixed",
  right: 28,
  bottom: 28,
  width: 64,
  height: 64,
  borderRadius: "50%",
  border: 0,
  background:
    "linear-gradient(135deg, #1d4ed8 0%, #2563eb 52%, #60a5fa 100%)",
  color: "#fff",
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: "0.04em",
  boxShadow: "0 18px 42px rgba(37, 99, 235, 0.28)",
  cursor: "pointer",
  zIndex: 40,
};

export const optionPickerOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
  padding: 20,
  boxSizing: "border-box",
};

export const optionPickerModalStyle = {
  width: "min(760px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 40px)",
  background: "#fff",
  borderRadius: 20,
  border: "1px solid #dbe4f0",
  boxShadow: "0 28px 60px rgba(15, 23, 42, 0.18)",
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  overflow: "hidden",
};

export const optionPickerBadgeStyle = {
  alignSelf: "flex-start",
  padding: "4px 10px",
  borderRadius: 999,
  background: "linear-gradient(135deg, rgba(29,78,216,0.12), rgba(96,165,250,0.2))",
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 700,
};

export const optionPickerTitleStyle = {
  fontSize: 20,
  fontWeight: 800,
  color: "#0f172a",
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  wordBreak: "keep-all",
};

export const optionPickerSubtitleStyle = {
  fontSize: 14,
  lineHeight: 1.5,
  color: "#475569",
};

export const optionPickerListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  overflowY: "auto",
  paddingRight: 4,
};

export const optionPickerItemButtonStyle = {
  width: "100%",
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #dbe4f0",
  background: "#f8fbff",
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "normal",
  wordBreak: "break-word",
};

export const optionPickerIndexStyle = {
  width: 24,
  height: 24,
  borderRadius: 999,
  background: "#dbeafe",
  color: "#1d4ed8",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 800,
  flexShrink: 0,
};

export const optionPickerTextStyle = {
  flex: 1,
  minWidth: 0,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export const optionPickerFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 4,
  flexShrink: 0,
};

export const chatPanelStyle = {
  position: "fixed",
  right: 28,
  bottom: 104,
  width: 380,
  maxWidth: "calc(100vw - 32px)",
  height: 520,
  maxHeight: "calc(100vh - 140px)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 24,
  border: "1px solid #dbe4f0",
  background:
    "linear-gradient(180deg, rgba(239, 246, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 28%)",
  boxShadow: "0 24px 64px rgba(15, 23, 42, 0.18)",
  overflow: "hidden",
  zIndex: 39,
  backdropFilter: "blur(10px)",
};

export const chatPanelHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: "18px 18px 14px",
  borderBottom: "1px solid #e2e8f0",
  background: "rgba(239, 246, 255, 0.92)",
};

export const chatPanelTitleStyle = {
  fontSize: 16,
  fontWeight: 800,
  color: "#0f172a",
};

export const chatPanelSubtitleStyle = {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 1.5,
  color: "#475569",
};

export const chatCloseButtonStyle = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  border: "1px solid #bfdbfe",
  background: "linear-gradient(180deg, #ffffff 0%, #eff6ff 100%)",
  color: "#334155",
  fontSize: 22,
  lineHeight: 1,
  fontWeight: 400,
  boxShadow: "0 6px 14px rgba(37, 99, 235, 0.1)",
  cursor: "pointer",
  flexShrink: 0,
};

export const chatMessageListStyle = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  overflowY: "auto",
  background:
    "radial-gradient(circle at top left, rgba(96, 165, 250, 0.16), transparent 42%)",
};

export const chatBubbleStyle = {
  maxWidth: "88%",
  padding: "12px 14px",
  borderRadius: 18,
  border: "1px solid transparent",
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
};

export const chatBubbleRoleStyle = {
  marginBottom: 6,
  fontSize: 11,
  fontWeight: 700,
  opacity: 0.72,
};

export const chatBubbleTextStyle = {
  fontSize: 13,
  lineHeight: 1.6,
  userSelect: "text",
  WebkitUserSelect: "text",
};

export const chatComposerStyle = {
  padding: 16,
  borderTop: "1px solid #e2e8f0",
  background: "#fff",
};

export const chatTextareaStyle = {
  width: "100%",
  resize: "none",
  padding: "12px 14px",
  borderRadius: 16,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  lineHeight: 1.5,
  boxSizing: "border-box",
  outline: "none",
};

export const chatComposerActionsStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginTop: 12,
};

export const processPopupOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.22)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 56,
  padding: 24,
  boxSizing: "border-box",
};

export const processPopupCardStyle = {
  width: "min(920px, calc(100vw - 40px))",
  maxHeight: "calc(100vh - 48px)",
  background: "#fff",
  borderRadius: 24,
  border: "1px solid #dbe4f0",
  boxShadow: "0 28px 80px rgba(15, 23, 42, 0.22)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

export const processPopupHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  padding: "20px 22px 16px",
  borderBottom: "1px solid #e2e8f0",
  background: "linear-gradient(180deg, rgba(239,246,255,0.96), rgba(255,255,255,0.98))",
};

export const processPopupTitleStyle = {
  fontSize: 20,
  fontWeight: 800,
  color: "#0f172a",
};

export const processPopupSubtitleStyle = {
  marginTop: 6,
  fontSize: 13,
  lineHeight: 1.6,
  color: "#475569",
};

export const processPopupBodyStyle = {
  flex: 1,
  overflowY: "auto",
  padding: 22,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 16,
  background: "#f8fbff",
};

export const processPopupPartSectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  borderRadius: 18,
  border: "1px solid #dbe4f0",
  background: "#fff",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
};

export const processPopupPartTitleStyle = {
  fontSize: 16,
  fontWeight: 800,
  color: "#0f172a",
};

export const processPopupPartReplyStyle = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "#475569",
};

export const processPopupListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const processPopupItemStyle = {
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #dbe4f0",
  background: "#eff6ff",
};

export const processPopupItemTitleStyle = {
  fontSize: 14,
  fontWeight: 800,
  color: "#1e3a8a",
};

export const processPopupItemReasonStyle = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.5,
  color: "#334155",
};

export const processPopupItemOptionsStyle = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.5,
  color: "#0f766e",
};

export const processPopupEmptyStyle = {
  fontSize: 13,
  color: "#64748b",
};

export const processPopupFooterStyle = {
  padding: 18,
  borderTop: "1px solid #e2e8f0",
  background: "#fff",
  display: "flex",
  justifyContent: "flex-end",
};
