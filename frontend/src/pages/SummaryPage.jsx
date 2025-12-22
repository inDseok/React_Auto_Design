import React from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppContext";

export default function SummaryPage() {
  const { state } = useApp();

  return (
    <div style={{ padding: 16 }}>
      <h2>SUMMARY PAGE</h2>

      <div style={{ marginBottom: 12 }}>
        <div>bomId: {String(state.bomId)}</div>
        <div>selectedSpec: {String(state.selectedSpec)}</div>
        <div>sourceSheet: {String(state.sourceSheet)}</div>
        <div>selectedNodeId: {String(state.selectedNodeId)}</div>
      </div>

      <Link to="/sub">SUB 페이지로 이동</Link>
    </div>
  );
}
