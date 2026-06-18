import { invoke } from "@tauri-apps/api/core";

type DebugFields = Record<string, unknown>;
type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export const isDebugModeEnabled =
  import.meta.env.VITE_DEBUG_UI === "true";
const shouldMirrorDebugEvents = import.meta.env.DEV || isDebugModeEnabled;
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};
const currentLogLevel = resolveLogLevel();

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
    void invoke("log_note_debug_event", {
      event,
      fields: {
        ...payload,
        mirroredScope: "frontend"
      }
    }).catch(() => {
      // Keep debug mirroring non-blocking and invisible to the reader path.
    });
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
