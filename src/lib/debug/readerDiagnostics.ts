export type ReaderDiagnosticGroup =
  | "auto-fit"
  | "pane-layout"
  | "render-identity";

type ReaderDiagnosticFields = Record<string, unknown>;

const STORAGE_KEY = "readerDiagnostics";
const DEFAULT_ENABLED_GROUPS: ReaderDiagnosticGroup[] = [
  "auto-fit",
  "pane-layout"
];
const MAX_LOCAL_DIAGNOSTIC_EVENTS = 1000;

let cachedEnabledGroups: Set<ReaderDiagnosticGroup> | null = null;

function isReaderDiagnosticGroup(value: unknown): value is ReaderDiagnosticGroup {
  return (
    value === "auto-fit" ||
    value === "pane-layout" ||
    value === "render-identity"
  );
}

function persistEnabledGroups(groups: ReaderDiagnosticGroup[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

function loadEnabledGroups() {
  if (cachedEnabledGroups) {
    return cachedEnabledGroups;
  }

  const fallbackGroups = new Set<ReaderDiagnosticGroup>(DEFAULT_ENABLED_GROUPS);
  if (typeof window === "undefined") {
    cachedEnabledGroups = fallbackGroups;
    return cachedEnabledGroups;
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY);
  if (!storedValue) {
    cachedEnabledGroups = fallbackGroups;
    return cachedEnabledGroups;
  }

  try {
    const parsed = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) {
      cachedEnabledGroups = fallbackGroups;
      return cachedEnabledGroups;
    }

    cachedEnabledGroups = new Set(
      parsed.filter((group): group is ReaderDiagnosticGroup =>
        isReaderDiagnosticGroup(group)
      )
    );
    return cachedEnabledGroups;
  } catch {
    cachedEnabledGroups = fallbackGroups;
    return cachedEnabledGroups;
  }
}

export function getEnabledReaderDiagnosticGroups() {
  return [...loadEnabledGroups()];
}

export function setReaderDiagnosticGroups(groups: ReaderDiagnosticGroup[]) {
  cachedEnabledGroups = new Set(groups);
  persistEnabledGroups(groups);
}

export function resetReaderDiagnosticGroups() {
  cachedEnabledGroups = new Set(DEFAULT_ENABLED_GROUPS);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function isReaderDiagnosticEnabled(group: ReaderDiagnosticGroup) {
  return loadEnabledGroups().has(group);
}

export function readerDiagnostic(
  group: ReaderDiagnosticGroup,
  event: string,
  fields: ReaderDiagnosticFields = {}
) {
  if (!isReaderDiagnosticEnabled(group)) {
    return;
  }

  const payload = {
    scope: "reader-diagnostic",
    group,
    event,
    at: new Date().toISOString(),
    atMs: Date.now(),
    ...fields
  };

  if (typeof window !== "undefined") {
    const windowWithDiagnostics = window as Window & {
      __CALM_READER_LOCAL_DEBUG_EVENTS__?: ReaderDiagnosticFields[];
    };
    const events = windowWithDiagnostics.__CALM_READER_LOCAL_DEBUG_EVENTS__ ?? [];
    events.push(payload);
    while (events.length > MAX_LOCAL_DIAGNOSTIC_EVENTS) {
      events.shift();
    }
    windowWithDiagnostics.__CALM_READER_LOCAL_DEBUG_EVENTS__ = events;
  }

  console.info(`[READER-DIAGNOSTIC][${group}] ${event}`, payload);
}
