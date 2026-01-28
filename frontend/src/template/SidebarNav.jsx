import React from "react";
import { Link, useLocation } from "react-router-dom";
import { FaBars, FaCalculator, FaCogs, FaClock, FaProjectDiagram, FaStream } from "react-icons/fa";
import "../css/template/SidebarNav.css";
import { useApp } from "../state/AppContext";


export default function SidebarNav({ collapsed, setCollapsed }) {

  const location = useLocation();
  const { state } = useApp();


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
      >
        <FaCogs className="nav-icon" />
        <span className="nav-text">서브 부품 구성도</span>
      </Link>

      <Link
        to={
          state.bomId && state.selectedSpec
            ? `/sequence?bomId=${state.bomId}&spec=${encodeURIComponent(state.selectedSpec)}`
            : "/sequence"
        }
        className={`nav-item ${
          location.pathname.startsWith("/sequence") ? "active" : ""
        }`}
      >
        <FaStream className="nav-icon" />
        <span className="nav-text">시퀀스 구성</span>
      </Link>

      <Link
        to={
          state.bomId && state.selectedSpec
            ? `/assembly?bomId=${state.bomId}&spec=${encodeURIComponent(state.selectedSpec)}`
            : "/assembly"
        }

        className={`nav-item ${
          location.pathname.startsWith("/assembly") ? "active" : ""
        }`}
      >
        <FaCalculator className="nav-icon" />
        <span className="nav-text">조립 총공수</span>
      </Link>

      
      <Link
        to="/time"
        className={`nav-item ${location.pathname === "/time" ? "active" : ""}`}
      >
        <FaClock className="nav-icon" />
        <span className="nav-text">작업시간 분석표</span>
      </Link>

      <Link
        to="/lob"
        className={`nav-item ${location.pathname === "/lob" ? "active" : ""}`}
      >
        <FaProjectDiagram className="nav-icon" />
        <span className="nav-text">LOB 분석표</span>
      </Link>

    </nav>
  );
}
