import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AppProvider } from "./state/AppContext";

import Layout from "./template/Layout";
import SubPage from "./pages/Sub/SubPage";
import TimePage from "./pages/TimePage";
import LobPage from "./pages/LobPage";
import Total from "./pages/Total";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>

        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/sub" replace />} />
            <Route path="total" element={<Total />} />
            <Route path="/sub" element={<SubPage />} />
            <Route path="/time" element={<TimePage />} />
            <Route path="/lob" element={<LobPage />} />
          </Routes>
        </Layout>

      </BrowserRouter>
    </AppProvider>
  );
}
