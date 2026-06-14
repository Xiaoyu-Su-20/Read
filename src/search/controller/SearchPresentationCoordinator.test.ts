import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchPresentationCoordinator } from "./SearchPresentationCoordinator";

describe("SearchPresentationCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("commits at 140 ms when cheap work is ready", async () => {
    const commits: number[] = [];
    const coordinator = new SearchPresentationCoordinator();
    coordinator.begin({ canCommitFirst: () => true, commit: () => commits.push(Date.now()) });
    await vi.advanceTimersByTimeAsync(139);
    expect(commits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(commits).toEqual([140]);
  });

  it("forces the first commit at 180 ms and coalesces streaming updates", async () => {
    const commits: number[] = [];
    const coordinator = new SearchPresentationCoordinator();
    coordinator.begin({ canCommitFirst: () => false, commit: () => commits.push(Date.now()) });
    await vi.advanceTimersByTimeAsync(180);
    expect(commits).toEqual([180]);
    coordinator.liveChanged();
    await vi.advanceTimersByTimeAsync(50);
    coordinator.liveChanged();
    await vi.advanceTimersByTimeAsync(69);
    expect(commits).toEqual([180]);
    await vi.advanceTimersByTimeAsync(1);
    expect(commits).toEqual([180, 300]);
  });
});

