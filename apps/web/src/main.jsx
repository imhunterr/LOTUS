import React from "react";
import ReactDOM from "react-dom/client";
import Application from "./application/Application";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Application />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
