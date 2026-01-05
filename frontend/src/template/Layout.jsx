import React, { useState } from "react";
import HeaderBar from "./HeaderBar";
import SidebarNav from "./SidebarNav";
import "../css/template/Layout.css";
import SpecSelector from "../pages/SpecSelector";
import UploadBom from "../pages/UploadBom";

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`layout ${collapsed ? "collapsed" : ""}`}>

      <SidebarNav 
        collapsed={collapsed}
        setCollapsed={setCollapsed}
      />

      <div className="layout-main">

      <HeaderBar />

      {/* 🔷 Upload + Spec → 같은 Row */}
      <div className="top-bar">

        <div className="top-left">
          <UploadBom />
        </div>

        <div className="spec-panel">
          <SpecSelector />
        </div>

      </div>

      <main>
        {children}
      </main>

      </div>
    </div>
  );
}
