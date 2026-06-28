import { describe, expect, it, vi } from "vitest";

import { registerRestartPreflightTask, runRestartPreflight } from "./restartPreflight";

describe("restartPreflight", () => {
  it("awaits every registered persistence task", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerRestartPreflightTask("first", first);
    const unregisterSecond = registerRestartPreflightTask("second", second);

    await runRestartPreflight("app-update");
    expect(first).toHaveBeenCalledWith("app-update");
    expect(second).toHaveBeenCalledWith("app-update");

    unregisterFirst();
    unregisterSecond();
  });

  it("rejects when any persistence task fails", async () => {
    const unregister = registerRestartPreflightTask("failing", async () => {
      throw new Error("save failed");
    });
    await expect(runRestartPreflight("app-update")).rejects.toThrow("save failed");
    unregister();
  });
});
