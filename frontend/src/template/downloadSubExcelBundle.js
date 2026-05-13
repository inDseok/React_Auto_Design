import { API_BASE } from "../api/client";
import { getDisplaySpecName } from "../pages/Sequence/sequenceEditorUtils";
import { showPopup } from "./popupUtils";

const TACT_STORAGE_KEY = "lob_tact_inputs_v1";
const EQUIPMENT_STORAGE_KEY = "lob_equipment_rows_v1";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStoredTactTimeSeconds(bomId) {
  try {
    const raw = localStorage.getItem(TACT_STORAGE_KEY);
    if (!raw) return 0;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.bomId !== bomId) return 0;

    const tactInputs = parsed.tactInputs || {};
    const workDays = toNumber(tactInputs.workDaysPerYear);
    const realAvailable = toNumber(tactInputs.realAvailableMinutes);
    const annualVehicles = toNumber(tactInputs.annualVehicleTarget);
    const qtyPerVehicle = toNumber(tactInputs.quantityPerVehicle);
    const lineCount = toNumber(tactInputs.lineCount);

    const annualRequiredQuantity = annualVehicles * qtyPerVehicle;
    const dailyRequiredQuantity = workDays > 0 ? annualRequiredQuantity / workDays : 0;
    const lineTactMinutes =
      dailyRequiredQuantity > 0 ? (realAvailable / dailyRequiredQuantity) * lineCount : 0;

    return lineTactMinutes * 60;
  } catch (error) {
    console.error("Failed to read tact time for excel bundle", error);
    return 0;
  }
}

function getStoredAnnualVehicleTarget(bomId) {
  try {
    const raw = localStorage.getItem(TACT_STORAGE_KEY);
    if (!raw) return 0;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.bomId !== bomId) return 0;

    return toNumber(parsed?.tactInputs?.annualVehicleTarget);
  } catch (error) {
    console.error("Failed to read annual vehicle target for excel bundle", error);
    return 0;
  }
}

function getStoredTactInputs(bomId) {
  try {
    const raw = localStorage.getItem(TACT_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.bomId !== bomId) return {};

    return parsed.tactInputs || {};
  } catch (error) {
    console.error("Failed to read tact inputs for excel bundle", error);
    return {};
  }
}

function getStoredEquipmentRows(bomId) {
  try {
    const raw = localStorage.getItem(EQUIPMENT_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.bomId !== bomId) return [];

    return Array.isArray(parsed.equipmentRows) ? parsed.equipmentRows : [];
  } catch (error) {
    console.error("Failed to read equipment rows for excel bundle", error);
    return [];
  }
}

export async function downloadSubExcelBundle({ bomId, spec }) {
  if (!bomId) {
    showPopup("BOM을 먼저 선택하세요.", "warning");
    return;
  }

  try {
    const tactTime = getStoredTactTimeSeconds(bomId);
    const annualVehicleTarget = getStoredAnnualVehicleTarget(bomId);
    const tactInputs = getStoredTactInputs(bomId);
    const equipmentRows = getStoredEquipmentRows(bomId);
    const res = await fetch(`${API_BASE}/api/sub/bom/${bomId}/export_excel_bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        spec,
        tactTime,
        annualVehicleTarget,
        tactInputs,
        equipmentRows,
      }),
    });

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
    const baseName = (getDisplaySpecName(spec) || "통합엑셀").trim();
    link.download = `${baseName}_${yyyymmdd}.xlsx`;
    link.click();
    link.remove();
  } catch (error) {
    showPopup("엑셀 다운로드 실패: " + String(error?.message ?? error), "error");
  }
}
