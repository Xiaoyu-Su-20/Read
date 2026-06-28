import { describe, expect, it } from "vitest";

import type { DocumentRecord } from "./types";
import { sortCollectionDocumentsByRecent } from "./collectionSorting";

function document(id: string, lastOpenedAt: string | null): DocumentRecord {
  return {
    id,
    title: id,
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
