export async function downloadSubExcelBundle({ bomId, spec }) {
  if (!bomId) {
    alert("BOM을 먼저 선택하세요.");
    return;
  }

  try {
    const res = await fetch(
      `http://localhost:8000/api/sub/bom/${bomId}/export_excel_bundle`,
      {
        method: "GET",
        credentials: "include",
      }
    );

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const blob = await res.blob();
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const yyyymmdd = `${yyyy}${mm}${dd}`;

    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    const baseName = (spec || bomId || "통합엑셀").trim();
    link.download = `${baseName}_${yyyymmdd}.xlsx`;
    link.click();
    link.remove();
  } catch (error) {
    alert("엑셀 다운로드 실패: " + String(error?.message ?? error));
  }
}
