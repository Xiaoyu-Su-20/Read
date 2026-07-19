import { describe, expect, it } from "vitest";

import { mobileCollectionsFromTree, mostRecentDocuments } from "./mobileLibrary";
import type { DocumentRecord, FolderTreeNode } from "../lib/types";

function document(id: string, lastOpenedAt: string | null): DocumentRecord {
  return {
    id,
    title: id,
    fileName: `${id}.pdf`,
    folderId: "collection",
    relativePath: `${id}.pdf`,
    fingerprint: id,
    importedAt: "2026-07-18T00:00:00.000Z",
    lastOpenedAt,
    availability: "available"
  };
}

describe("mobileLibrary", () => {
  it("flattens non-root collections and preserves document order", () => {
    const tree: FolderTreeNode = {
      folder: {
        id: "root",
        name: "Library",
        parentId: null,
        createdAt: null
      },
      documents: [],
      folders: [
        {
          folder: {
            id: "collection",
            name: "Collection",
            parentId: "root",
            createdAt: null
          },
          documents: [
            document("older", "2026-07-17T00:00:00.000Z"),
            document("newer", "2026-07-18T00:00:00.000Z")
          ],
          folders: []
        }
      ]
    };

    const collections = mobileCollectionsFromTree(tree);

    expect(collections).toHaveLength(1);
    expect(collections[0].documents.map((item) => item.id)).toEqual(["older", "newer"]);
  });

  it("returns the most recent documents across collections", () => {
    const documents = mostRecentDocuments(
      [
        {
          id: "a",
          name: "A",
          documents: [document("old", "2026-07-16T00:00:00.000Z")]
        },
        {
          id: "b",
          name: "B",
          documents: [document("new", "2026-07-18T00:00:00.000Z")]
        }
      ],
      1
    );

    expect(documents.map((item) => item.id)).toEqual(["new"]);
  });
});
