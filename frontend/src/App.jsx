import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./state/AppContext";

import SubPage from "./pages/SubPage";
import SummaryPage from "./pages/SummaryPage";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/sub" replace />} />
          <Route path="/sub" element={<SubPage />} />
          <Route path="/summary" element={<SummaryPage />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
