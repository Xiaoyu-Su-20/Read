import { sortCollectionDocumentsByRecent } from "../lib/collectionSorting";
import { ROOT_FOLDER_ID, type DocumentRecord, type FolderTreeNode } from "../lib/types";

export type MobileCollection = {
  id: string;
  name: string;
  documents: DocumentRecord[];
};

export function mobileCollectionsFromTree(tree: FolderTreeNode | null): MobileCollection[] {
  if (!tree) {
    return [];
  }

  const collections: MobileCollection[] = [];

  function visit(node: FolderTreeNode) {
    if (node.folder.id !== ROOT_FOLDER_ID) {
      collections.push({
        id: node.folder.id,
        name: node.folder.name,
        documents: [...node.documents]
      });
    }

    node.folders.forEach(visit);
  }

  visit(tree);
  return collections;
}

export function mostRecentDocuments(collections: MobileCollection[], limit = 6) {
  return sortCollectionDocumentsByRecent(
    collections.flatMap((collection) => collection.documents)
  ).slice(0, limit);
}

export function makeMobileMockLibrary(): FolderTreeNode {
  const now = new Date().toISOString();
  const documents: DocumentRecord[] = [
    "Meditations",
    "Beyond Good and Evil",
    "The Republic",
    "Discourse on Method"
  ].map((title, index) => ({
    id: `mock-document-${index + 1}`,
    title,
    fileName: `${title}.pdf`,
    folderId: "mock-philosophy",
    relativePath: `${title}.pdf`,
    fingerprint: `mock-${index + 1}`,
    importedAt: now,
    lastOpenedAt: index < 2 ? new Date(Date.now() - index * 3_600_000).toISOString() : null,
    availability: "available"
  }));

  return {
    folder: {
      id: ROOT_FOLDER_ID,
      name: "Library",
      parentId: null,
      createdAt: now
    },
    documents: [],
    folders: [
      {
        folder: {
          id: "mock-philosophy",
          name: "Philosophy",
          parentId: ROOT_FOLDER_ID,
          createdAt: now
        },
        documents,
        folders: []
      },
      {
        folder: {
          id: "mock-literature",
          name: "Literature",
          parentId: ROOT_FOLDER_ID,
          createdAt: now
        },
        documents: [],
        folders: []
      }
    ]
  };
}
