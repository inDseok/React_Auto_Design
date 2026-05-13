export function showPopup(message, type = "info") {
  window.dispatchEvent(
    new CustomEvent("app:global-popup", { detail: { message, type } })
  );
}
