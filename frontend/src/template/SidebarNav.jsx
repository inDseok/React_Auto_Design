import React from "react";
import { Link, useLocation } from "react-router-dom";
import { FaBars, FaCogs, FaClock, FaProjectDiagram } from "react-icons/fa";
import "../css/template/SidebarNav.css";

export default function SidebarNav({ collapsed, setCollapsed }) {

  const location = useLocation();

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
