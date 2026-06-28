import type { Update } from "@tauri-apps/plugin-updater";
import { describe, expect, it, vi } from "vitest";

import { AppUpdater } from "./AppUpdater";

function fakeUpdate(overrides: Partial<Update> = {}) {
  return {
    available: true,
    body: "Release notes",
    currentVersion: "0.1.0",
    date: undefined,
    download: vi.fn(async () => undefined),
    downloadAndInstall: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    rid: 1,
    version: "0.2.0",
    ...overrides
  } as unknown as Update;
}

describe("AppUpdater", () => {
  it("publishes up-to-date when no update is returned", async () => {
    const updater = new AppUpdater({ check: vi.fn(async () => null), relaunch: vi.fn() });
    await updater.check("manual");
    expect(updater.getSnapshot()).toMatchObject({ status: "up-to-date" });
  });

  it("deduplicates checks and publishes an available update", async () => {
    const update = fakeUpdate();
    let resolveCheck!: (update: Update | null) => void;
    const check = vi.fn(() => new Promise<Update | null>((resolve) => { resolveCheck = resolve; }));
    const updater = new AppUpdater({ check, relaunch: vi.fn() });

    const first = updater.check("automatic");
    const second = updater.check("manual");
    expect(check).toHaveBeenCalledTimes(1);
    resolveCheck(update);
    await Promise.all([first, second]);

    expect(updater.getSnapshot()).toEqual({
      status: "available",
      version: "0.2.0",
      notes: "Release notes"
    });
  });

  it("reports determinate progress and reaches ready", async () => {
    const update = fakeUpdate({
      download: vi.fn(async (onEvent) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
        onEvent?.({ event: "Finished" });
      })
    });
    const updater = new AppUpdater({ check: vi.fn(async () => update), relaunch: vi.fn() });
    const states: string[] = [];
    updater.subscribe((state) => states.push(state.status));

    await updater.check("manual");
    await updater.download();

    expect(states).toContain("downloading");
    expect(updater.getSnapshot()).toMatchObject({ status: "ready", version: "0.2.0" });
  });

  it("runs persistence preflight before install and relaunch", async () => {
    const calls: string[] = [];
    const update = fakeUpdate({
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => { calls.push("install"); })
    });
    const updater = new AppUpdater({
      check: vi.fn(async () => update),
      relaunch: vi.fn(async () => { calls.push("relaunch"); })
    });
    await updater.check("manual");
    await updater.download();
    await updater.installAndRestart(async () => { calls.push("preflight"); });
    expect(calls).toEqual(["preflight", "install", "relaunch"]);
  });

  it("does not install when restart preflight fails", async () => {
    const update = fakeUpdate();
    const relaunch = vi.fn();
    const updater = new AppUpdater({ check: vi.fn(async () => update), relaunch });
    await updater.check("manual");
    await updater.download();
    await updater.installAndRestart(async () => { throw new Error("save failed"); });

    expect(update.install).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(updater.getSnapshot()).toMatchObject({
      status: "error",
      phase: "restart-preflight",
      recoverTo: "ready"
    });
  });

  it("recovers and retries a failed download", async () => {
    const download = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const update = fakeUpdate({ download });
    const updater = new AppUpdater({ check: vi.fn(async () => update), relaunch: vi.fn() });
    await updater.check("manual");
    await updater.download();
    expect(updater.getSnapshot()).toMatchObject({ status: "error", recoverTo: "available" });
    updater.recover();
    await updater.download();
    expect(download).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot()).toMatchObject({ status: "ready" });
  });

  it("does not relaunch when installation fails", async () => {
    const update = fakeUpdate({ install: vi.fn(async () => { throw new Error("invalid signature"); }) });
    const relaunch = vi.fn();
    const updater = new AppUpdater({ check: vi.fn(async () => update), relaunch });
    await updater.check("manual");
    await updater.download();
    await updater.installAndRestart(async () => undefined);
    expect(relaunch).not.toHaveBeenCalled();
    expect(updater.getSnapshot()).toMatchObject({ status: "error", phase: "install" });
  });

  it("closes its live update when disposed", async () => {
    const update = fakeUpdate();
    const updater = new AppUpdater({ check: vi.fn(async () => update), relaunch: vi.fn() });
    await updater.check("manual");
    await updater.dispose();
    expect(update.close).toHaveBeenCalledOnce();
  });
});
