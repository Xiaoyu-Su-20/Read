import { invoke } from "@tauri-apps/api/core";

type DebugFields = Record<string, unknown>;
type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
type RuntimeLogPolicy = "off" | "errors-only" | "verbose";
type MirroredDebugEvent = {
  event: string;
  fields: DebugFields;
};
type BrowserMemorySnapshot = {
  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;
};
type SupportLoggingBridge = {
  disable: () => Promise<RuntimeLogPolicy>;
  enable: () => Promise<RuntimeLogPolicy>;
  getPolicy: () => RuntimeLogPolicy;
};

declare global {
  interface Window {
    __CALM_READER_LOCAL_DEBUG_EVENTS__?: DebugFields[];
    __READR_SUPPORT_LOGGING__?: SupportLoggingBridge;
  }
}

const SUPPORT_LOGGING_SESSION_KEY = "readr.support-logging-enabled";
const MIRRORED_DEBUG_FLUSH_MS = 100;
const MIRRORED_DEBUG_BATCH_SIZE = 50;
const MAX_MIRRORED_DEBUG_QUEUE = 500;
const MAX_LOCAL_DEBUG_EVENTS = 1000;
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

let currentLogPolicy = resolveInitialPolicy();
const currentLogLevel = resolveLogLevel();
let mirroredDebugQueue: MirroredDebugEvent[] = [];
let mirroredDebugFlushTimer: number | null = null;
let droppedMirroredDebugEventCount = 0;

export const isDebugModeEnabled =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_UI === "true";

function isSupportLoggingEnabledForSession() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.sessionStorage.getItem(SUPPORT_LOGGING_SESSION_KEY) === "1";
}

function resolveInitialPolicy(): RuntimeLogPolicy {
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_UI === "true") {
    return "verbose";
  }

  if (
    String(import.meta.env.VITE_READR_SUPPORT_LOG ?? "").trim() === "1" ||
    isSupportLoggingEnabledForSession()
  ) {
    return "verbose";
  }

  return "errors-only";
}

function isVerboseLoggingEnabled() {
  return currentLogPolicy === "verbose";
}

function resolveLogLevel(): LogLevel {
  const rawLevel = String(import.meta.env.VITE_READER_LOG_LEVEL ?? "").trim().toLowerCase();
  switch (rawLevel) {
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return rawLevel;
    default:
      return "info";
  }
}

function eventLevel(event: string, explicitLevel: "info" | "error"): LogLevel {
  if (
    explicitLevel === "error" ||
    event.endsWith(":error") ||
    event.endsWith("-error") ||
    event.endsWith(".error")
  ) {
    return "error";
  }

  if (event === "reader.render-stale-ignored") {
    return "warn";
  }

  if (event.startsWith("scroll-render.") || event.startsWith("continuous-reader.geometry-")) {
    return "info";
  }

  if (
    event === "reader.open:click" ||
    event === "reader.open:document-ready" ||
    event === "reader.initial-page:resolved" ||
    event === "reader.open:active-document-committed" ||
    event === "view.collection:click" ||
    event === "view.collection:first-frame" ||
    event === "view.collection:pointer-down" ||
    event === "view.collection:presented" ||
    event === "view.collection:state-committed" ||
    event === "view.collection:first-painted" ||
    event === "view.document:click" ||
    event === "view.document:state-committed" ||
    event === "view.document:component-mounted" ||
    event === "view.document:first-painted" ||
    event === "reader:mounted" ||
    event === "reader:unmounted" ||
    event === "pdf-runtime:dispose-start" ||
    event === "pdf-runtime:dispose-finished" ||
    event === "reader.render:first-request" ||
    event === "reader.render:response-received" ||
    event === "reader.navigation-intent" ||
    event === "reader.navigate-header" ||
    event === "reader.page-request-ignored" ||
    event === "reader.render-result-accepted" ||
    event === "reader.render-result-discarded" ||
    event === "viewer.image:src-assigned" ||
    event === "viewer.image:load" ||
    event === "viewer.image:decode-finished" ||
    event === "viewer.slot-promotion-accepted" ||
    event === "viewer.slot-promotion-discarded" ||
    event === "reader.first-visible" ||
    event === "reader.open:summary" ||
    event === "frontend.event-loop-gap" ||
    event === "frontend.long-task" ||
    event === "frontend.native-text.requested" ||
    event === "frontend.native-text.response-received" ||
    event === "frontend.native-text.response-discarded" ||
    event === "frontend.native-text.state-enqueued" ||
    event === "frontend.native-text.load-failed" ||
    event === "frontend.native-text-layer.mounted" ||
    event === "frontend.native-text-layer.ready" ||
    event === "frontend.native-text-layer.missing" ||
    event === "frontend.native-text-layer.unmounted" ||
    event === "frontend.native-text-layer.selectable-frame" ||
    event === "reader.outline-load-scheduled" ||
    event === "reader.outline-load-started" ||
    event === "reader.outline-load-completed" ||
    event === "reader.outline-load-cancelled" ||
    event === "reader.outline-load-failed" ||
    event === "native-outline.loaded" ||
    event === "command.get_pdf_native_outline:execution-started" ||
    event === "pdf-runtime.ensure-document-start" ||
    event === "pdf-runtime.ensure-document-cache-hit" ||
    event === "pdf-runtime.bytes-read-start" ||
    event === "pdf-runtime.bytes-loaded" ||
    event === "pdf-runtime.bytes-converted" ||
    event === "pdf-runtime.document-load-start" ||
    event === "pdf-runtime.document-loaded" ||
    event === "pdf-runtime.ensure-document-error" ||
    event === "pdf-runtime.page-text-error"
  ) {
    return "info";
  }

  return "trace";
}

function shouldEmitEvent(event: string, explicitLevel: "info" | "error") {
  return LOG_LEVEL_RANK[eventLevel(event, explicitLevel)] <= LOG_LEVEL_RANK[currentLogLevel];
}

function normalizeError(error: unknown, verbose: boolean) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(verbose && error.stack ? { stack: error.stack } : {})
    };
  }

  return {
    message: String(error)
  };
}

function browserMemorySnapshot(): BrowserMemorySnapshot {
  const performanceWithMemory = performance as Performance & {
    memory?: BrowserMemorySnapshot;
  };
  const memory = performanceWithMemory.memory;
  return {
    usedJSHeapSize: memory?.usedJSHeapSize,
    totalJSHeapSize: memory?.totalJSHeapSize,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit
  };
}

function createPayload(scope: string, event: string, fields: DebugFields = {}) {
  return {
    scope,
    event,
    at: new Date().toISOString(),
    atMs: Date.now(),
    ...fields
  };
}

function emitConsole(level: LogLevel, payload: Record<string, unknown>) {
  if (!isVerboseLoggingEnabled()) {
    return;
  }

  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.info(payload);
  }
}

function scheduleMirroredDebugFlush() {
  if (mirroredDebugFlushTimer !== null || typeof window === "undefined") {
    return;
  }

  mirroredDebugFlushTimer = window.setTimeout(() => {
    mirroredDebugFlushTimer = null;
    void flushMirroredDebugEvents();
  }, MIRRORED_DEBUG_FLUSH_MS);
}

async function flushMirroredDebugEvents() {
  if (mirroredDebugQueue.length === 0) {
    return;
  }

  const batch = mirroredDebugQueue.splice(0, MIRRORED_DEBUG_BATCH_SIZE);
  await invoke("log_note_debug_events", {
    events: batch
  }).catch(() => undefined);

  if (mirroredDebugQueue.length > 0) {
    scheduleMirroredDebugFlush();
  }
}

function enqueueMirroredDebugEvent(event: string, fields: DebugFields) {
  if (mirroredDebugQueue.length >= MAX_MIRRORED_DEBUG_QUEUE) {
    mirroredDebugQueue.shift();
    droppedMirroredDebugEventCount += 1;
  }

  const mirroredFields = {
    ...fields,
    mirroredScope: "frontend",
    ...(droppedMirroredDebugEventCount > 0
      ? { mirroredDroppedCount: droppedMirroredDebugEventCount }
      : {})
  };
  droppedMirroredDebugEventCount = 0;
  mirroredDebugQueue.push({ event, fields: mirroredFields });
  scheduleMirroredDebugFlush();
}

async function sendFrontendError(event: string, fields: DebugFields) {
  await invoke("report_frontend_error", {
    event,
    fields
  }).catch(() => undefined);
}

export function getLoggingPolicy(): RuntimeLogPolicy {
  return currentLogPolicy;
}

export async function setSupportLoggingEnabled(enabled: boolean) {
  currentLogPolicy =
    enabled || import.meta.env.DEV || import.meta.env.VITE_DEBUG_UI === "true"
      ? "verbose"
      : "errors-only";

  if (typeof window !== "undefined") {
    if (enabled) {
      window.sessionStorage.setItem(SUPPORT_LOGGING_SESSION_KEY, "1");
    } else {
      window.sessionStorage.removeItem(SUPPORT_LOGGING_SESSION_KEY);
    }
  }

  await invoke("set_support_logging_enabled", {
    enabled
  }).catch(() => undefined);

  return currentLogPolicy;
}

export function initializeLoggingBridge() {
  if (typeof window === "undefined") {
    return;
  }

  window.__READR_SUPPORT_LOGGING__ = {
    disable: () => setSupportLoggingEnabled(false),
    enable: () => setSupportLoggingEnabled(true),
    getPolicy: () => getLoggingPolicy()
  };

  if (isSupportLoggingEnabledForSession()) {
    void setSupportLoggingEnabled(true);
  }

  void invoke<RuntimeLogPolicy>("get_logging_policy")
    .then((policy) => {
      currentLogPolicy = policy;
    })
    .catch(() => undefined);
}

export function debugLocalAction(event: string, fields: DebugFields = {}) {
  if (typeof window === "undefined" || !isVerboseLoggingEnabled()) {
    return;
  }

  const payload = createPayload("frontend-local", event, {
    performanceNow: Math.round(performance.now()),
    ...fields
  });
  const events = window.__CALM_READER_LOCAL_DEBUG_EVENTS__ ?? [];
  events.push(payload);
  while (events.length > MAX_LOCAL_DEBUG_EVENTS) {
    events.shift();
  }
  window.__CALM_READER_LOCAL_DEBUG_EVENTS__ = events;
  console.info(payload);
}

export function debugLocalMemory(event: string, fields: DebugFields = {}) {
  debugLocalAction(event, {
    ...fields,
    ...browserMemorySnapshot()
  });
}

export function traceEvent(event: string, fields: DebugFields = {}) {
  if (currentLogPolicy !== "verbose" || !shouldEmitEvent(event, "info")) {
    return;
  }

  const payload = createPayload("frontend-trace", event, fields);
  emitConsole(eventLevel(event, "info"), payload);
  enqueueMirroredDebugEvent(event, payload);
}

export function reportFrontendError(event: string, error: unknown, fields: DebugFields = {}) {
  const payload = createPayload("frontend-error", event, {
    ...fields,
    error: normalizeError(error, isVerboseLoggingEnabled())
  });

  emitConsole("error", payload);
  void sendFrontendError(event, payload);
}

export function debugAction(event: string, fields?: DebugFields) {
  traceEvent(event, fields);
}

export function debugError(event: string, error: unknown, fields: DebugFields = {}) {
  reportFrontendError(event, error, fields);
}

export function startDebugProcess(event: string, fields: DebugFields = {}) {
  const startedAt = performance.now();
  traceEvent(`${event}:start`, fields);

  return {
    checkpoint(checkpointEvent: string, checkpointFields: DebugFields = {}) {
      traceEvent(`${event}:${checkpointEvent}`, {
        ...fields,
        ...checkpointFields,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    },
    finish(finishFields: DebugFields = {}) {
      traceEvent(`${event}:finish`, {
        ...fields,
        ...finishFields,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    },
    fail(error: unknown, failureFields: DebugFields = {}) {
      reportFrontendError(`${event}:error`, error, {
        ...fields,
        ...failureFields,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    }
  };
}

export async function runDebugProcess<T>(
  event: string,
  fields: DebugFields,
  action: () => Promise<T>
) {
  const process = startDebugProcess(event, fields);

  try {
    const result = await action();
    process.finish();
    return result;
  } catch (error) {
    process.fail(error);
    throw error;
  }
}
