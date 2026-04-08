import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from './App.tsx';
import './index.css';
import Impressum from "./Impressum.jsx";
import Datenschutz from "./Datenschutz.jsx";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/impressum" element={<Impressum />} />
        <Route path="/datenschutz" element={<Datenschutz />} />
        {/* Legacy paths */}
        <Route path="/imprint" element={<Impressum />} />
        <Route path="/privacy" element={<Datenschutz />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
