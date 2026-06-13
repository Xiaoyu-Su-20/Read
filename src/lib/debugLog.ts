type DebugFields = Record<string, unknown>;

export const isDebugModeEnabled =
  import.meta.env.VITE_DEBUG_UI === "true";

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
  if (!isDebugModeEnabled) {
    return;
  }

  const payload = {
    scope: "frontend",
    event,
    at: new Date().toISOString(),
    ...fields
  };

  if (level === "error") {
    console.error(payload);
    return;
  }

  console.info(payload);
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
