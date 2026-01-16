import { useState } from "react";

const API_BASE = "http://localhost:8000/api/assembly";

export function useAssemblyData() {
  const [sheets, setSheets] = useState([]);
  const [parts, setParts] = useState([]);
  const [options, setOptions] = useState([]);

  // -----------------------------
  // 시트 목록 로딩
  // -----------------------------
  const loadSheets = async () => {
    try {
      const res = await fetch(`${API_BASE}/sheets`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("시트 로딩 실패");

      const data = await res.json();
      setSheets(data);
    } catch (err) {
      console.error("loadSheets error:", err);
    }
  };

  // -----------------------------
  // 부품 기준 목록 로딩
  // -----------------------------
  const loadParts = async (sheet) => {
    if (!sheet) {
      setParts([]);
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/part-bases?sheet=${encodeURIComponent(sheet)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("부품 기준 로딩 실패");

      const data = await res.json();
      setParts(data);
    } catch (err) {
      console.error("loadParts error:", err);
      setParts([]);
    }
  };

  // -----------------------------
  // 옵션 목록 로딩
  // -----------------------------
  const loadOptions = async (sheet, partBase) => {
    if (!sheet || !partBase) {
      setOptions([]);
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/options?sheet=${encodeURIComponent(
          sheet
        )}&part_base=${encodeURIComponent(partBase)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("옵션 로딩 실패");

      const data = await res.json();
      setOptions(data);
    } catch (err) {
      console.error("loadOptions error:", err);
      setOptions([]);
    }
  };

  // -----------------------------
  // tasks 로딩 (실제 rows)
  // -----------------------------
  const loadTasks = async (sheet, partBase, option) => {
    if (!sheet || !partBase || !option) return [];

    try {
      const res = await fetch(
        `${API_BASE}/tasks?sheet=${encodeURIComponent(
          sheet
        )}&part_base=${encodeURIComponent(
          partBase
        )}&option=${encodeURIComponent(option)}`,
        { credentials: "include" }
      );

      if (!res.ok) throw new Error("tasks 로딩 실패");

      const data = await res.json();
      return data;
    } catch (err) {
      console.error("loadTasks error:", err);
      return [];
    }
  };

  // -----------------------------
  // 저장
  // -----------------------------
  const saveRowsToDB = async (bomId, spec, rows) => {
    try {
      const cleanedRows = rows.map((row) => {
        const {
          __groupKey,
          __isNew,
          __rowspan,
          __groupIndex,
          ...rest
        } = row;
        return rest;
      });
  
      const url = `${API_BASE}/bom/${bomId}/spec/${spec}/save`;
      console.log("save URL =", url);
  
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(cleanedRows),
      });
  
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "저장 실패");
      }
  
      return true;
    } catch (err) {
      console.error("saveRowsToDB error:", err);
      return false;
    }
  };

  // -----------------------------
  // 로드
  // -----------------------------
  const loadSavedRows = async (bomId, spec) => {
    try {
      if (!bomId || !spec) {
        console.warn("loadSavedRows: bomId/spec 없음", { bomId, spec });
        return [];
      }
  
      const url = `${API_BASE}/bom/${bomId}/spec/${spec}/load`;
  
      const res = await fetch(url, {
        credentials: "include",
      });
  
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "로드 실패");
      }
  
      const data = await res.json();
      return data.rows || [];
    } catch (err) {
      console.error("loadSavedRows error:", err);
      return [];
    }
  };
    
  const runAutoMatch = async (bomId, spec) => {
    try {
      const url = `${API_BASE}/bom/${bomId}/spec/${spec}/auto-match`;
  
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
      });
  
      const text = await res.text();
  
      if (!res.ok) {
        throw new Error(text || "자동 매칭 실패");
      }
  
      const data = JSON.parse(text);
      return data.added || [];
    } catch (err) {
      console.error("runAutoMatch error:", err);
      return [];
    }
  };
  
  
  return {
    sheets,
    parts,
    options,

    loadSheets,
    loadParts,
    loadOptions,
    loadTasks,

    saveRowsToDB,
    loadSavedRows,
    runAutoMatch,
  };
}
