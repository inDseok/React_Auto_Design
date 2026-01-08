import React, { useState } from "react";
import HeaderBar from "./HeaderBar";
import SidebarNav from "./SidebarNav";
import "../css/template/Layout.css";
import SpecSelector from "../pages/Sub/SpecSelector";
import UploadBom from "../pages/Sub/UploadBom";

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


      <main>
        {children}
      </main>

      </div>
    </div>
  );
}
