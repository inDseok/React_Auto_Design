import React, { useEffect, useRef } from "react";

import {
  actionButtonStyle,
  chatBubbleRoleStyle,
  chatBubbleStyle,
  chatBubbleTextStyle,
  chatCloseButtonStyle,
  chatComposerActionsStyle,
  chatComposerStyle,
  chatMessageListStyle,
  chatPanelHeaderStyle,
  chatPanelStyle,
  chatPanelSubtitleStyle,
  chatPanelTitleStyle,
  chatTextareaStyle,
  secondaryButtonStyle,
} from "./SequenceEditor.styles";

export default function SequenceChatPanel({
  open,
  messages,
  input,
  loading,
  onClose,
  onChangeInput,
  onReset,
  onSubmit,
}) {
  const messageListRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages]);

  if (!open) {
    return null;
  }

  const canSubmit = !loading && String(input || "").trim();

  return (
    <div style={chatPanelStyle}>
      <div style={chatPanelHeaderStyle}>
        <div>
          <div style={chatPanelTitleStyle}>시퀀스 채팅</div>
          <div style={chatPanelSubtitleStyle}>
            자연어로 부품부터 공정까지 추천합니다. 팝업에서 부품/공정을 고른 뒤 옵션을 선택하세요.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={chatCloseButtonStyle}
          aria-label="채팅창 닫기"
        >
          ×
        </button>
      </div>

      <div ref={messageListRef} style={chatMessageListStyle}>
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              ...chatBubbleStyle,
              alignSelf: message.role === "user" ? "flex-end" : "flex-start",
              background: message.role === "user" ? "#0f172a" : "#f8fafc",
              color: message.role === "user" ? "#fff" : "#0f172a",
              borderColor: message.role === "user" ? "#0f172a" : "#dbe4f0",
            }}
          >
            <div style={chatBubbleRoleStyle}>
              {message.role === "user" ? "나" : "추천 도우미"}
            </div>
            <div style={chatBubbleTextStyle}>{message.text}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={chatComposerStyle}>
        <textarea
          value={input}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) {
                onSubmit();
              }
            }
          }}
          placeholder="예: 메인 베젤과 렌즈 중심으로 바코드와 체결 공정을 추천해줘"
          rows={3}
          style={chatTextareaStyle}
        />
        <div style={chatComposerActionsStyle}>
          <button
            type="button"
            onClick={onReset}
            style={secondaryButtonStyle}
          >
            대화 초기화
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              ...actionButtonStyle,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {loading ? "추천 중..." : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
