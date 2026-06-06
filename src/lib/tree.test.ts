import { describe, expect, it } from "vitest";

import { collectDocuments, findFolderNode, flattenFolders } from "./tree";
import type { FolderTreeNode } from "./types";

const library: FolderTreeNode = {
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
        id: "work",
        name: "Work",
        parentId: "root",
        createdAt: null
      },
      documents: [
        {
          id: "doc-1",
          title: "Spec",
          fileName: "spec.pdf",
          folderId: "work",
          relativePath: "Work/spec.pdf",
          fingerprint: "123",
          importedAt: "2026-01-01T00:00:00Z",
          lastOpenedAt: null,
          availability: "available"
        }
      ],
      folders: []
    }
  ]
};

describe("tree helpers", () => {
  it("flattens nested folders into display labels", () => {
    const folders = flattenFolders(library);
    expect(folders.map((folder) => folder.pathLabel)).toEqual([
      "Library",
      "Library / Work"
    ]);
  });

  it("finds a folder node recursively", () => {
    expect(findFolderNode(library, "work")?.folder.name).toBe("Work");
    expect(findFolderNode(library, "missing")).toBeNull();
  });

  it("collects documents from the whole tree", () => {
    expect(collectDocuments(library)).toHaveLength(1);
  });
});
