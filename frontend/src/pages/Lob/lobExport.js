import { getDisplaySpecName } from "../Sequence/sequenceEditorUtils";
import { showPopup } from "../../template/popupUtils";

const API_BASE = "http://localhost:8000/api/lob";

export async function downloadWorkerLobExcel({
  spec,
  tactTime,
  neckTime,
  expectedCycleTime,
  workerRows,
}) {
  if (!Array.isArray(workerRows) || workerRows.length === 0) {
    showPopup("다운로드할 작업자 LOB 데이터가 없습니다.", "warning");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/worker/export_excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        spec,
        tactTime,
        neckTime,
        expectedCycleTime,
        workerRows,
      }),
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const blob = await res.blob();
    const link = document.createElement("a");
    const url = window.URL.createObjectURL(blob);
    link.href = url;
    link.download = `${getDisplaySpecName(spec) || "worker_lob"}_worker_lob.xlsx`;
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    showPopup("작업자 LOB 엑셀 다운로드 실패: " + String(error?.message ?? error), "error");
  }
}
