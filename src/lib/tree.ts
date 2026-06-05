import type { DocumentRecord, FolderTreeNode } from "./types";

export type FlatFolder = {
  id: string;
  name: string;
  depth: number;
  pathLabel: string;
};

export function flattenFolders(
  node: FolderTreeNode,
  parents: string[] = [],
  depth = 0
): FlatFolder[] {
  const currentPath = [...parents, node.folder.name];
  const current: FlatFolder = {
    id: node.folder.id,
    name: node.folder.name,
    depth,
    pathLabel: currentPath.join(" / ")
  };

  return [
    current,
    ...node.folders.flatMap((child) => flattenFolders(child, currentPath, depth + 1))
  ];
}

export function findFolderNode(
  node: FolderTreeNode,
  folderId: string
): FolderTreeNode | null {
  if (node.folder.id === folderId) {
    return node;
  }

  for (const child of node.folders) {
    const match = findFolderNode(child, folderId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function collectDocuments(node: FolderTreeNode): DocumentRecord[] {
  return [
    ...node.documents,
    ...node.folders.flatMap((child) => collectDocuments(child))
  ];
}
