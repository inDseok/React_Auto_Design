import React from "react";

import {
  optionPickerBadgeStyle,
  optionPickerFooterStyle,
  optionPickerIndexStyle,
  optionPickerItemButtonStyle,
  optionPickerListStyle,
  optionPickerModalStyle,
  optionPickerOverlayStyle,
  optionPickerSubtitleStyle,
  optionPickerTextStyle,
  optionPickerTitleStyle,
  secondaryButtonStyle,
} from "./SequenceEditor.styles";

export default function SequenceOptionPicker({
  item,
  loading,
  onSelectOption,
  onSkip,
}) {
  if (!item) {
    return null;
  }

  return (
    <div style={optionPickerOverlayStyle}>
      <div style={optionPickerModalStyle}>
        <div style={optionPickerBadgeStyle}>옵션 선택 필요</div>
        <div style={optionPickerTitleStyle}>{item.nodeLabel}</div>
        <div style={optionPickerSubtitleStyle}>
          선택한 부품 또는 공정의 옵션을 선택해주세요. 모르는 경우에는 넘어갈 수 있습니다.
        </div>
        <div style={optionPickerListStyle}>
          {(item.options || []).map((option, index) => (
            <button
              key={`${item.nodeLabel}-${option}-${index}`}
              type="button"
              onClick={() => onSelectOption(index)}
              style={optionPickerItemButtonStyle}
              disabled={loading}
            >
              <span style={optionPickerIndexStyle}>{index + 1}</span>
              <span style={optionPickerTextStyle}>{option}</span>
            </button>
          ))}
        </div>
        <div style={optionPickerFooterStyle}>
          <button
            type="button"
            onClick={onSkip}
            style={secondaryButtonStyle}
            disabled={loading}
          >
            넘어가기
          </button>
        </div>
      </div>
    </div>
  );
}
