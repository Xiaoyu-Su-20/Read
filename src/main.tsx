import React from "react";
import ReactDOM from "react-dom/client";

import {
  debugLocalAction,
  initializeLoggingBridge,
  reportFrontendError,
  traceEvent
} from "./lib/debugLog";
import "./styles.css";

function startupTrace(step: string, fields: Record<string, unknown> = {}) {
  const payload = {
    step,
    epochMs: Date.now(),
    navigationMs: Math.round(performance.now()),
    ...fields
  };
  debugLocalAction(`frontend.startup.main.${step}`, payload);
  traceEvent(`frontend.startup.main.${step}`, payload);
}

initializeLoggingBridge();

document.body.classList.toggle("app-env--dev", import.meta.env.DEV);

// The webview has zoom gestures enabled so that touchpad pinches reach the page as
// ctrl+wheel events (WebView2 drops them otherwise). Cancel the webview's own
// whole-UI zoom here; the reader handles zoom itself.
window.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
  },
  { passive: false, capture: true }
);

window.addEventListener(
  "keydown",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    if (["+", "=", "-", "_", "0"].includes(event.key)) {
      event.preventDefault();
    }
  },
  { capture: true }
);

window.addEventListener("error", (event) => {
  reportFrontendError("frontend.startup.main.window-error", event.error, {
    message: event.message
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportFrontendError("frontend.startup.main.unhandled-rejection", event.reason, {
    reasonType: typeof event.reason
  });
});

async function bootstrap() {
  startupTrace("module-loaded");
  traceEvent("frontend.main-module", {
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

  const appImportStartedAt = performance.now();
  const { default: App } = await import("./App");
  startupTrace("app-module-imported", {
    durationMs: Math.round(performance.now() - appImportStartedAt)
  });

  startupTrace("before-root-render");
  traceEvent("frontend.before-render", {
    epochMs: Date.now(),
    navigationMs: performance.now()
  });
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  startupTrace("after-root-render-call");
}

void bootstrap().catch((error) => {
  reportFrontendError("frontend.startup.main.bootstrap-failed", error);
  startupTrace("bootstrap-failed", {
    error: error instanceof Error ? error.message : String(error)
  });

  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML =
      '<div style="padding:16px;color:#ff8080;font-family:sans-serif;">Frontend startup failed. Open devtools for details.</div>';
  }
});
