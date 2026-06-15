import { describe, expect, it } from "vitest";

import {
  createOutlineHeadingReference,
  createUserOutlineItemFromHeading,
  dedupeOutlineItems,
  mergeOutlineItems,
  resolveSourceReferenceTarget,
  scoreOutlineCandidates
} from "./documentReferences";
import type { PdfOutlineItem } from "./types";

function outlineItem(args: Partial<PdfOutlineItem> & Pick<PdfOutlineItem, "id" | "title" | "page">): PdfOutlineItem {
  return {
    id: args.id,
    title: args.title,
    source: args.source ?? "embedded",
    sourceId: args.sourceId ?? args.id,
    target: args.page
      ? {
          documentId: "doc-1",
          pageIndex: args.page - 1
        }
      : null,
    page: args.page,
    externalUrl: null,
    items: args.items ?? []
  };
}

describe("document reference helpers", () => {
  it("merges user outline items before embedded PDF outline items", () => {
    const user = outlineItem({ id: "user:1", title: "My Section", page: 8, source: "user" });
    const embedded = outlineItem({ id: "embedded:1", title: "PDF Section", page: 1 });

    expect(mergeOutlineItems([embedded], [user]).map((item) => item.id)).toEqual([
      "user:1",
      "embedded:1"
    ]);
  });

  it("dedupes outline marks with the same title and target", () => {
    const original = outlineItem({ id: "user:original", title: "Chapter 5", page: 42, source: "user" });
    const duplicate = outlineItem({ id: "user:duplicate", title: "  chapter   5  ", page: 42, source: "user" });
    const differentPage = outlineItem({ id: "user:different", title: "Chapter 5", page: 43, source: "user" });

    expect(dedupeOutlineItems([original, duplicate, differentPage]).map((item) => item.id)).toEqual([
      "user:original",
      "user:different"
    ]);
  });

  it("creates user outline entries and matching heading references", () => {
    const item = createUserOutlineItemFromHeading({
      documentId: "doc-1",
      title: "Chapter 5",
      pageNumber: 42
    });
    const reference = createOutlineHeadingReference(item);

    expect(item.source).toBe("user");
    expect(item.target?.pageIndex).toBe(41);
    expect(reference.kind).toBe("outline");
    expect(reference.outlineItemId).toBe(item.id);
    expect(reference.target?.pageIndex).toBe(41);
  });

  it("scores likely title and nearby page matches first", () => {
    const items = [
      outlineItem({ id: "embedded:far", title: "Appendix", page: 140 }),
      outlineItem({ id: "embedded:near", title: "Chapter 3 Coding", page: 32 })
    ];

    const [first] = scoreOutlineCandidates({
      outlineItems: items,
      headingTitle: "Chapter 3 Coding",
      currentPage: 33,
      query: ""
    });

    expect(first?.item.id).toBe("embedded:near");
  });

  it("falls back to the stored target when the referenced outline item is missing", () => {
    const reference = createOutlineHeadingReference(
      outlineItem({ id: "embedded:missing", title: "Missing", page: 12 })
    );

    expect(resolveSourceReferenceTarget(reference, [])?.pageIndex).toBe(11);
  });
});
