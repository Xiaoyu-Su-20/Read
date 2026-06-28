import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { debugAction, reportFrontendError } from "../debugLog";
import { AppUpdater, type UpdateState } from "./AppUpdater";

const AUTO_CHECK_DELAY_MS = 8_000;
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const UPDATE_CHANNEL = import.meta.env.MODE === "rc"
  ? "rc"
  : import.meta.env.VITE_UPDATE_CHANNEL ?? "stable";

function updaterInitialState(): UpdateState {
  if (import.meta.env.DEV) return { status: "disabled", reason: "development" };
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return { status: "disabled", reason: "unsupported" };
  }
  if (import.meta.env.VITE_UPDATER_CONFIGURED !== "true") {
    return { status: "disabled", reason: "unconfigured" };
  }
  return { status: "idle" };
}

export function useAppUpdater({
  automaticUpdates,
  settingsHydrated
}: {
  automaticUpdates: boolean;
  settingsHydrated: boolean;
}) {
  const updater = useMemo(
    () => new AppUpdater({ check, relaunch }, updaterInitialState()),
    []
  );
  const state = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const disposeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    void getVersion().then(setCurrentVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (disposeTimerRef.current !== null) {
      window.clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    return () => {
      disposeTimerRef.current = window.setTimeout(() => {
        disposeTimerRef.current = null;
        void updater.dispose();
      }, 0);
    };
  }, [updater]);

  useEffect(() => {
    if (!settingsHydrated || !automaticUpdates || state.status === "disabled") return;
    const initialTimer = window.setTimeout(() => {
      debugAction("updater.automatic-check", { channel: UPDATE_CHANNEL });
      void updater.check("automatic");
    }, AUTO_CHECK_DELAY_MS);
    const interval = window.setInterval(() => {
      void updater.check("automatic");
    }, AUTO_CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [automaticUpdates, settingsHydrated, state.status === "disabled", updater]);

  useEffect(() => {
    if (state.status !== "error") return;
    reportFrontendError(`updater.${state.phase}`, new Error(state.message), {
      channel: UPDATE_CHANNEL,
      version: state.version ?? null
    });
  }, [state]);

  return { currentVersion, updater, state };
}
