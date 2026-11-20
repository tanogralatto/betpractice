import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { recoverFromStaleVersion } from "./recover";
import "./styles.css";

// Vite avisa con este evento cuando no puede bajar un archivo de la app (versión vieja en caché).
window.addEventListener("vite:preloadError", (e) => {
  if (recoverFromStaleVersion()) e.preventDefault();
});
(window as any).__crMontada = true;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
