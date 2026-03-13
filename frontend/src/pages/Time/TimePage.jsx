import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "../../state/AppContext";
import { useAssemblyData } from "../Assembly/useAssemblyData";
import { computeRowspanInfo } from "../Assembly/groupUtils";
import TimeAnalysisView from "./TimeAnalysisView";
import { buildGroupOrder, buildGroupRowsMap, getSummary } from "./timeUtils";

export default function TimePage() {
  const [params] = useSearchParams();
  const { state, actions } = useApp();
  const { loadSavedRows } = useAssemblyData();

  const paramBomId = params.get("bomId");
  const paramSpec = params.get("spec");
  const bomId = paramBomId || state.bomId;
  const spec = paramSpec || state.selectedSpec;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (paramBomId && paramBomId !== state.bomId) {
      actions.setBomContext(paramBomId);
    }
  }, [paramBomId, state.bomId]);

  useEffect(() => {
    if (paramSpec && paramSpec !== state.selectedSpec) {
      actions.setSpec(paramSpec);
    }
  }, [paramSpec, state.selectedSpec]);

  useEffect(() => {
    const load = async () => {
      if (!bomId || !spec) {
        setRows([]);
        return;
      }

      setLoading(true);
      try {
        const saved = await loadSavedRows(bomId, spec);
        setRows(saved);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bomId, spec]);

  const processedRows = useMemo(() => computeRowspanInfo(rows), [rows]);
  const groupOrder = useMemo(() => buildGroupOrder(processedRows), [processedRows]);
  const groupRowsMap = useMemo(() => buildGroupRowsMap(processedRows), [processedRows]);

  const summary = useMemo(() => {
    return getSummary(processedRows, groupOrder);
  }, [processedRows, groupOrder]);

  if (!bomId || !spec) {
    return (
      <div style={{ padding: 24 }}>
        BOM 또는 사양 정보가 없습니다. 조립 총공수 페이지에서 대상 BOM/사양을 먼저 선택하세요.
      </div>
    );
  }

  return (
    <TimeAnalysisView
      bomId={bomId}
      spec={spec}
      loading={loading}
      processedRows={processedRows}
      groupOrder={groupOrder}
      groupRowsMap={groupRowsMap}
      summary={summary}
    />
  );
}
