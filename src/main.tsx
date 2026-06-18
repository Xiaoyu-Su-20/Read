import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { debugAction } from "./lib/debugLog";
import "./styles.css";

debugAction("frontend.main-module", {
  epochMs: Date.now(),
  navigationMs: performance.now()
});

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

debugAction("frontend.before-render", {
  epochMs: Date.now(),
  navigationMs: performance.now()
});

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
