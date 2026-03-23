import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaBars, FaCalculator, FaCogs, FaClock, FaProjectDiagram, FaStream } from "react-icons/fa";
import "../css/template/SidebarNav.css";
import { useApp } from "../state/AppContext";
import { downloadSubExcelBundle } from "./downloadSubExcelBundle";


export default function SidebarNav({ collapsed, setCollapsed }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useApp();
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const sequencePath = useMemo(
    () =>
      state.bomId && state.selectedSpec
        ? `/sequence?bomId=${state.bomId}&spec=${encodeURIComponent(state.selectedSpec)}`
        : "/sequence",
    [state.bomId, state.selectedSpec]
  );
  const assemblyPath = useMemo(
    () =>
      state.bomId && state.selectedSpec
        ? `/assembly?bomId=${state.bomId}&spec=${encodeURIComponent(state.selectedSpec)}`
        : "/assembly",
    [state.bomId, state.selectedSpec]
  );
  const timePath = useMemo(
    () =>
      state.bomId && state.selectedSpec
        ? `/time?bomId=${state.bomId}&spec=${encodeURIComponent(state.selectedSpec)}`
        : "/time",
    [state.bomId, state.selectedSpec]
  );
  const lobPath = useMemo(
    () =>
      state.bomId && state.selectedSpec
        ? `/lob?bomId=${state.bomId}&spec=${encodeURIComponent(state.selectedSpec)}`
        : "/lob",
    [state.bomId, state.selectedSpec]
  );

  const isSequencePage = location.pathname.startsWith("/sequence");
  const isAssemblyPage = location.pathname.startsWith("/assembly");

  const requestPageSave = async (pageType) =>
    new Promise((resolve) => {
      window.dispatchEvent(
        new CustomEvent(`app:${pageType}-save-request`, {
          detail: {
            respond: resolve,
          },
        })
      );
    });

  const requestDirtyCheck = async (pageType) =>
    new Promise((resolve) => {
      window.dispatchEvent(
        new CustomEvent(`app:${pageType}-dirty-check-request`, {
          detail: {
            respond: resolve,
          },
        })
      );
    });

  const handleProtectedNavigation = async (event, targetPath) => {
    const shouldPrompt = isSequencePage || isAssemblyPage;

    if (!shouldPrompt) {
      return;
    }

    if (targetPath === `${location.pathname}${location.search}`) {
      return;
    }

    event.preventDefault();

    const pageType = isSequencePage ? "sequence" : "assembly";
    const hasUnsavedChanges = await requestDirtyCheck(pageType);

    if (!hasUnsavedChanges) {
      navigate(targetPath);
      return;
    }

    setPendingNavigation(targetPath);
  };

  const closePendingNavigation = () => setPendingNavigation(null);

  const navigateWithOptionalSave = async (shouldSave) => {
    if (!pendingNavigation) {
      return;
    }

    const targetPath = pendingNavigation;
    const pageType = isSequencePage ? "sequence" : "assembly";

    if (shouldSave) {
      const ok = await requestPageSave(pageType);
      if (!ok) {
        return;
      }
    }

    setPendingNavigation(null);
    navigate(targetPath);
  };


  return (
    <nav className={collapsed ? "sidebar collapsed" : "sidebar"}>


      <div
        className="menu-btn"
        onClick={() => setCollapsed(prev => !prev)}
        role="button"
      >
        <FaBars />
      </div>

      <Link
        to="/sub"
        className={`nav-item ${location.pathname === "/sub" ? "active" : ""}`}
        onClick={(event) => handleProtectedNavigation(event, "/sub")}
      >
        <FaCogs className="nav-icon" />
        <span className="nav-text">서브 부품 구성도</span>
      </Link>

      <Link
        to={sequencePath}
        className={`nav-item ${
          location.pathname.startsWith("/sequence") ? "active" : ""
        }`}
        onClick={(event) => handleProtectedNavigation(event, sequencePath)}
      >
        <FaStream className="nav-icon" />
        <span className="nav-text">시퀀스 구성</span>
      </Link>

      <Link
        to={assemblyPath}

        className={`nav-item ${
          location.pathname.startsWith("/assembly") ? "active" : ""
        }`}
        onClick={(event) => handleProtectedNavigation(event, assemblyPath)}
      >
        <FaCalculator className="nav-icon" />
        <span className="nav-text">조립 총공수</span>
      </Link>

      
      <Link
        to={timePath}
        className={`nav-item ${location.pathname === "/time" ? "active" : ""}`}
        onClick={(event) => handleProtectedNavigation(event, timePath)}
      >
        <FaClock className="nav-icon" />
        <span className="nav-text">작업시간 분석표</span>
      </Link>

      <Link
        to={lobPath}
        className={`nav-item ${location.pathname.startsWith("/lob") ? "active" : ""}`}
        onClick={(event) => handleProtectedNavigation(event, lobPath)}
      >
        <FaProjectDiagram className="nav-icon" />
        <span className="nav-text">LOB 분석표</span>
      </Link>

      <div className="sidebar-spacer" />
      <button
        type="button"
        className="sidebar-download-btn"
        onClick={() => downloadSubExcelBundle({ bomId: state.bomId, spec: state.selectedSpec })}
      >
        <span className="sidebar-download-icon">XLS</span>
        <span className="nav-text">엑셀 다운로드</span>
      </button>

      {pendingNavigation && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={closePendingNavigation}
        >
          <div
            style={{
              width: 360,
              maxWidth: "calc(100vw - 32px)",
              borderRadius: 16,
              background: "#fff",
              boxShadow: "0 20px 50px rgba(15, 23, 42, 0.22)",
              padding: 20,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: "#475569", marginBottom: 8 }}>
              저장하시겠습니까?
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => navigateWithOptionalSave(true)} style={primaryButtonStyle}>
                네
              </button>
              <button type="button" onClick={() => navigateWithOptionalSave(false)} style={secondaryButtonStyle}>
                아니오
              </button>
              <button type="button" onClick={closePendingNavigation} style={secondaryButtonStyle}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

    </nav>
  );
}

const secondaryButtonStyle = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  borderRadius: 10,
  padding: "9px 14px",
  fontSize: 13,
  cursor: "pointer",
};

const primaryButtonStyle = {
  border: 0,
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
