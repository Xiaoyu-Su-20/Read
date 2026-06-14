import { describe, expect, it } from "vitest";

import { createSearchPlan, orderPagesOutward } from "./SearchPlanner";
import { analyzeQuery } from "./queryAnalysis";
import { classifyDocumentSize, selectSearchMode } from "./SearchModes";

describe("search planning", () => {
  it("normalizes whitespace and identifies meaningful tokens", () => {
    expect(analyzeQuery("  The   Deep Work ")).toEqual({
      normalizedQuery: "the deep work",
      tokens: ["the", "deep", "work"],
      meaningfulTokens: ["deep", "work"],
      isCommonTerm: false
    });
  });

  it("selects deterministic modes and document sizes", () => {
    expect(selectSearchMode(analyzeQuery("a"), false)).toBe("instant");
    expect(selectSearchMode(analyzeQuery("the"), false)).toBe("broad-query");
    expect(selectSearchMode(analyzeQuery("focus"), false)).toBe("local");
    expect(selectSearchMode(analyzeQuery("focused"), false)).toBe("progressive");
    expect(selectSearchMode(analyzeQuery("deep work"), false)).toBe("full");
    expect(selectSearchMode(analyzeQuery("focus"), true)).toBe("full");
    expect(classifyDocumentSize(100)).toBe("small");
    expect(classifyDocumentSize(101)).toBe("medium");
    expect(classifyDocumentSize(401)).toBe("large");
  });

  it("orders pages outward and removes overlap between stages", () => {
    expect(orderPagesOutward(4, 7)).toEqual([5, 3, 6, 2, 7, 1]);
    const plan = createSearchPlan({
      query: "focused",
      currentPage: 4,
      totalPages: 20,
      extractedPages: new Set([1, 4, 15]),
      availableSources: new Set(["notes", "pdf-text", "document-name"]),
      explicitFullSearch: false,
      documentSizeClass: "small"
    });
    expect(plan.mode).toBe("progressive");
    expect(plan.stages.find((stage) => stage.id === "nearby-2")?.delayMs).toBe(80);
    expect(plan.stages.find((stage) => stage.id === "nearby-5")?.delayMs).toBe(160);
    expect(plan.stages.find((stage) => stage.id === "extracted-pages")?.delayMs).toBe(250);
    const pages = plan.stages.flatMap((stage) => stage.pageNumbers ?? []);
    expect(new Set(pages).size).toBe(pages.length);
    expect(new Set(pages)).toEqual(new Set(Array.from({ length: 20 }, (_, index) => index + 1)));
  });

  it("restricts broad queries to the current page", () => {
    const plan = createSearchPlan({
      query: "the",
      currentPage: 9,
      totalPages: 40,
      extractedPages: new Set([8, 9, 10]),
      availableSources: new Set(["notes", "pdf-text", "document-name"]),
      explicitFullSearch: false,
      documentSizeClass: "small"
    });
    expect(plan.mode).toBe("broad-query");
    expect(plan.stages.filter((stage) => stage.sourceId === "pdf-text")).toEqual([
      { id: "current-page", delayMs: 0, sourceId: "pdf-text", pageNumbers: [9] }
    ]);
  });
});
