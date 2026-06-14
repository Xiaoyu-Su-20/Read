import { describe, expect, it } from "vitest";

import type { SearchResult } from "../model/SearchResult";
import { stabilizeResultOrder } from "./stabilizeResultOrder";

const common = { snippet: "match", highlights: [] };

function pdf(id: string, pageNumber: number): SearchResult {
  return {
    ...common,
    id,
    kind: "pdf",
    sourceId: "pdf-text",
    title: `Page ${pageNumber}`,
    pageNumber,
    matchIndex: 0,
    location: "across"
  };
}

describe("stabilizeResultOrder", () => {
  it("keeps existing rows in place and appends unseen results", () => {
    expect(stabilizeResultOrder([pdf("late", 20)], [pdf("early", 2), pdf("late", 20)]).map((result) => result.id))
      .toEqual(["late", "early"]);
  });
});

