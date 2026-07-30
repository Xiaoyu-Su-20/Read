import { describe, expect, it } from "vitest";

import type { DocumentRecord } from "./types";
import {
  sortCollectionDocuments,
  sortCollectionDocumentsByName,
  sortCollectionDocumentsByRecent
} from "./collectionSorting";

function document(
  id: string,
  lastOpenedAt: string | null,
  title = id
): DocumentRecord {
  return {
    id,
    title,
    fileName: `${id}.pdf`,
    folderId: "Collection 1",
    relativePath: `Collection 1/${id}.pdf`,
    fingerprint: id,
    importedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt,
    availability: "available"
  };
}

describe("sortCollectionDocumentsByRecent", () => {
  it("sorts opened documents newest-first and preserves manual order for ties", () => {
    const sorted = sortCollectionDocumentsByRecent([
      document("unopened-a", null),
      document("older", "2026-01-02T00:00:00Z"),
      document("newer", "2026-01-03T00:00:00Z"),
      document("unopened-b", null)
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      "newer",
      "older",
      "unopened-a",
      "unopened-b"
    ]);
  });
});

describe("sortCollectionDocumentsByName", () => {
  it("sorts by title using numeric comparison and preserves manual order for title ties", () => {
    const sorted = sortCollectionDocumentsByName([
      document("manual-first", null, "Book 2"),
      document("zeta", null, "Zeta"),
      document("alpha", null, "Alpha"),
      document("book-10", null, "Book 10"),
      document("manual-second", null, "book 2")
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      "alpha",
      "manual-first",
      "manual-second",
      "book-10",
      "zeta"
    ]);
  });
});

describe("sortCollectionDocuments", () => {
  it("returns manual order unchanged for manual mode", () => {
    const documents = [
      document("second", "2026-01-02T00:00:00Z", "B"),
      document("first", "2026-01-03T00:00:00Z", "A")
    ];

    expect(sortCollectionDocuments(documents, "manual")).toEqual(documents);
  });
});
