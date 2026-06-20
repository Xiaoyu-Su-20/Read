import { describe, expect, it } from "vitest";

import {
  dedupeOutlineItems,
  resolveSourceReferenceTarget
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
  it("dedupes outline marks with the same title and target", () => {
    const original = outlineItem({ id: "user:original", title: "Chapter 5", page: 42, source: "user" });
    const duplicate = outlineItem({ id: "user:duplicate", title: "  chapter   5  ", page: 42, source: "user" });
    const differentPage = outlineItem({ id: "user:different", title: "Chapter 5", page: 43, source: "user" });

    expect(dedupeOutlineItems([original, duplicate, differentPage]).map((item) => item.id)).toEqual([
      "user:original",
      "user:different"
    ]);
  });

  it("falls back to the stored target when the referenced outline item is missing", () => {
    const reference = {
      id: "ref-1",
      documentId: "doc-1",
      kind: "outline" as const,
      outlineItemId: "embedded:missing",
      outlineSource: "embedded" as const,
      title: "Missing",
      target: {
        documentId: "doc-1",
        pageIndex: 11
      },
      createdAt: "2026-06-20T00:00:00Z"
    };

    expect(resolveSourceReferenceTarget(reference, [])?.pageIndex).toBe(11);
  });
});
