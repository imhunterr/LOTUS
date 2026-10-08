import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Manufacturer from "./pages/Manufacturer";
import Distributor from "./pages/Distributor";
import Prescriber from "./pages/Prescriber";
import Pharmacy from "./pages/Pharmacy";
import Patient from "./pages/Patient";
import Regulator from "./pages/Regulator";
import Verify from "./pages/Verify";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="manufacturer" element={<Manufacturer />} />
          <Route path="distributor" element={<Distributor />} />
          <Route path="prescriber" element={<Prescriber />} />
          <Route path="pharmacy" element={<Pharmacy />} />
          <Route path="patient" element={<Patient />} />
          <Route path="regulator" element={<Regulator />} />
          <Route path="verify" element={<Verify />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
