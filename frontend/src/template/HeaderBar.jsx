import React from "react";
import "../css/template/HeaderBar.css";

export default function HeaderBar() {
  return (
    <header className="header-bar">

      <div className="header-left">
        <img
          src="/static/img/SL.png"
          className="header-logo"
          alt="logo"
        />
      </div>

      <div className="header-center">
        공정설계 자동화
      </div>

      <div className="header-right" />

    </header>
  );
}
