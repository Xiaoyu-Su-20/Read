import { describe, expect, it, vi } from "vitest";

import { createDocumentStateWriterGeneration } from "./documentStateWriter";

describe("document state writer generations", () => {
  it("remain monotonic when multiple viewers mount in the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_783_100_000_000);

    const first = createDocumentStateWriterGeneration();
    const second = createDocumentStateWriterGeneration();

    expect(second).toBe(first + 1);
    expect(Number.isSafeInteger(second)).toBe(true);
    vi.restoreAllMocks();
  });
});
