import { invoke } from "@tauri-apps/api/core";

type DebugFields = Record<string, unknown>;
type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
type MirroredDebugEvent = {
  event: string;
  fields: DebugFields;
};
type BrowserMemorySnapshot = {
  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;
};

declare global {
  interface Window {
    __CALM_READER_LOCAL_DEBUG_EVENTS__?: DebugFields[];
  }
}

export const isDebugModeEnabled =
  import.meta.env.VITE_DEBUG_UI === "true";
const shouldMirrorDebugEvents =
  (import.meta.env.DEV || isDebugModeEnabled) &&
  import.meta.env.VITE_MIRROR_DEBUG_EVENTS !== "false";
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
const currentLogLevel = resolveLogLevel();
let mirroredDebugQueue: MirroredDebugEvent[] = [];
let mirroredDebugFlushTimer: number | null = null;
let droppedMirroredDebugEventCount = 0;

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
  if (explicitLevel === "error" || event.endsWith(":error")) {
    return "error";
  }

  if (event === "reader.render-stale-ignored") {
    return "warn";
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

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
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

export function debugLocalAction(event: string, fields: DebugFields = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const payload = {
    scope: "frontend-local",
    event,
    at: new Date().toISOString(),
    atMs: Date.now(),
    performanceNow: Math.round(performance.now()),
    ...fields
  };
  const events = window.__CALM_READER_LOCAL_DEBUG_EVENTS__ ?? [];
  events.push(payload);
  while (events.length > MAX_LOCAL_DEBUG_EVENTS) {
    events.shift();
  }
  window.__CALM_READER_LOCAL_DEBUG_EVENTS__ = events;

  if (isDebugModeEnabled) {
    console.info(payload);
  }
}

export function debugLocalMemory(event: string, fields: DebugFields = {}) {
  debugLocalAction(event, {
    ...fields,
    ...browserMemorySnapshot()
  });
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

function emit(level: "info" | "error", event: string, fields: DebugFields = {}) {
  if (!isDebugModeEnabled && !shouldMirrorDebugEvents) {
    return;
  }

  if (!shouldEmitEvent(event, level)) {
    return;
  }

  const payload = {
    scope: "frontend",
    event,
    at: new Date().toISOString(),
    atMs: Date.now(),
    ...fields
  };

  if (isDebugModeEnabled) {
    const resolvedLevel = eventLevel(event, level);
    if (resolvedLevel === "error") {
      console.error(payload);
    } else if (resolvedLevel === "warn") {
      console.warn(payload);
    } else {
      console.info(payload);
    }
  }

  if (shouldMirrorDebugEvents) {
    enqueueMirroredDebugEvent(event, payload);
  }
}

export function debugAction(event: string, fields?: DebugFields) {
  emit("info", event, fields);
}

export function debugError(event: string, error: unknown, fields: DebugFields = {}) {
  emit("error", event, {
    ...fields,
    error: normalizeError(error)
  });
}

export function startDebugProcess(event: string, fields: DebugFields = {}) {
  if (!isDebugModeEnabled) {
    return {
      checkpoint(_checkpointEvent: string, _checkpointFields?: DebugFields) {},
      finish(_finishFields?: DebugFields) {},
      fail(_error: unknown, _failureFields?: DebugFields) {}
    };
  }

  const startedAt = performance.now();
  emit("info", `${event}:start`, fields);

  return {
    checkpoint(checkpointEvent: string, checkpointFields: DebugFields = {}) {
      emit("info", `${event}:${checkpointEvent}`, {
        ...fields,
        ...checkpointFields,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    },
    finish(finishFields: DebugFields = {}) {
      emit("info", `${event}:finish`, {
        ...fields,
        ...finishFields,
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    },
    fail(error: unknown, failureFields: DebugFields = {}) {
      debugError(`${event}:error`, error, {
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
