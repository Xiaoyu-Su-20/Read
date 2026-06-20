import React from "react";
import ReactDOM from "react-dom/client";

import { debugAction, debugLocalAction } from "./lib/debugLog";
import "./styles.css";

function startupTrace(step: string, fields: Record<string, unknown> = {}) {
  const payload = {
    step,
    epochMs: Date.now(),
    navigationMs: Math.round(performance.now()),
    ...fields
  };
  console.info(`[CR-STARTUP][main] ${step}`, payload);
  debugLocalAction(`frontend.startup.main.${step}`, payload);
  debugAction(`frontend.startup.main.${step}`, payload);
}

window.addEventListener("error", (event) => {
  console.error("[CR-STARTUP][main] window-error", {
    error: event.error,
    message: event.message
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[CR-STARTUP][main] unhandled-rejection", {
    reason: event.reason
  });
});

async function bootstrap() {
  startupTrace("module-loaded");
  debugAction("frontend.main-module", {
    epochMs: Date.now(),
    navigationMs: performance.now()
  });

  const rootElement = document.getElementById("root");
  startupTrace("before-create-root", {
    rootExists: Boolean(rootElement)
  });

  if (!rootElement) {
    throw new Error("Missing #root element");
  }

  const root = ReactDOM.createRoot(rootElement);
  startupTrace("after-create-root");
  debugAction("frontend.before-render", {
    epochMs: Date.now(),
    navigationMs: performance.now()
  });

  root.render(
    <div style={{ color: "#f66", padding: "16px", fontFamily: "sans-serif" }}>
      Frontend bootstrap started
    </div>
  );
  startupTrace("bootstrap-placeholder-rendered");

  const appImportStartedAt = performance.now();
  const { default: App } = await import("./App");
  startupTrace("app-module-imported", {
    durationMs: Math.round(performance.now() - appImportStartedAt)
  });

  startupTrace("before-root-render");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  startupTrace("after-root-render-call");
}

void bootstrap().catch((error) => {
  console.error("[CR-STARTUP][main] bootstrap-failed", error);
  startupTrace("bootstrap-failed", {
    error: error instanceof Error ? error.message : String(error)
  });

  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML =
      '<div style="padding:16px;color:#ff8080;font-family:sans-serif;">Frontend startup failed. Open devtools for details.</div>';
  }
});
