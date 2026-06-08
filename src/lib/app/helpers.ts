import type { DocumentState, FolderTreeNode } from "../types";

export type CollectionOption = {
  id: string;
  name: string;
  pathLabel: string;
};

export function now() {
  return new Date().toISOString();
}

export function makeBookmark(page: number): DocumentState["bookmarks"][number] {
  return {
    id: `bookmark-${page}-${Date.now()}`,
    page,
    label: `Page ${page}`,
    createdAt: now()
  };
}

export function isPassiveStatusMessage(message: string) {
  return (
    message === "Ready" ||
    message === "Open a document to use reader commands." ||
    /^Opened \d+ pages\.$/.test(message)
  );
}

export function nextCollectionName(tree: FolderTreeNode | null) {
  const highest = (tree?.folders ?? []).reduce((max, folder) => {
    const match = /^Collection (\d+)$/i.exec(folder.folder.name);
    const value = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
    return Math.max(max, Number.isNaN(value) ? 0 : value);
  }, 0);

  return `Collection ${Math.max(highest + 1, 1)}`;
}

export function toCollectionOptions(collections: FolderTreeNode[]): CollectionOption[] {
  return collections.map((collection) => ({
    id: collection.folder.id,
    name: collection.folder.name,
    pathLabel: collection.folder.name
  }));
}
