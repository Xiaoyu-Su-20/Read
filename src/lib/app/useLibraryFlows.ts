import { open } from "@tauri-apps/plugin-dialog";

import { startDebugProcess } from "../debugLog";
import type { DocumentPayload, FolderTreeNode, PaletteItem } from "../types";
import { nextCollectionName } from "./helpers";

type UseLibraryFlowsArgs = {
  libraryTree: FolderTreeNode | null;
  collectionOptions: {
    id: string;
    pathLabel: string;
  }[];
  activeDocument: DocumentPayload | null;
  selectedCollection: FolderTreeNode | null;
  closePalette: () => void;
  openSelection: (title: string, items: PaletteItem[], emptyMessage: string) => void;
  openPrompt: (
    title: string,
    placeholder: string,
    confirmLabel: string,
    onSubmit: (value: string) => void | Promise<void>,
    initialValue?: string
  ) => void;
  setStatusMessage: (message: string) => void;
  createCollection: (name: string) => Promise<unknown>;
  importDocumentToCollection: (sourcePath: string, destinationFolderId: string) => Promise<unknown>;
  moveActiveDocument: (destinationFolderId: string) => Promise<unknown>;
  renameActiveDocument: (newName: string) => Promise<unknown>;
  renameCollection: (collectionId: string, newName: string) => Promise<unknown>;
  removeActiveDocument: (destinationDirectory: string) => Promise<unknown>;
  rescanLibraryState: () => Promise<void>;
};

export function useLibraryFlows({
  libraryTree,
  collectionOptions,
  activeDocument,
  selectedCollection,
  closePalette,
  openSelection,
  openPrompt,
  setStatusMessage,
  createCollection,
  importDocumentToCollection,
  moveActiveDocument,
  renameActiveDocument,
  renameCollection,
  removeActiveDocument,
  rescanLibraryState
}: UseLibraryFlowsArgs) {
  async function promptImportFlow() {
    const process = startDebugProcess("app.prompt-import-flow");
    const selection = await open({
      multiple: false,
      filters: [
        {
          name: "PDF",
          extensions: ["pdf"]
        }
      ]
    });

    if (typeof selection !== "string") {
      process.finish({
        selected: false
      });
      return;
    }

    if (collectionOptions.length === 0) {
      setStatusMessage("Create a collection before importing a PDF.");
      process.finish({
        selected: true,
        destinationFolderId: null
      });
      return;
    }

    openSelection(
      "Import into collection",
      collectionOptions.map((folder) => ({
        id: folder.id,
        title: folder.pathLabel,
        subtitle: "Collection",
        glyph: "folder" as const,
        onSelect: async () => {
          await importDocumentToCollection(selection, folder.id);
          closePalette();
        }
      })),
      "Create a collection first."
    );
    process.finish({
      selected: true,
      deferredSelection: true
    });
  }

  async function createCollectionFlow() {
    await createCollection(nextCollectionName(libraryTree));
  }

  function moveDocumentFlow() {
    if (!activeDocument) {
      setStatusMessage("Open a document before moving it.");
      return;
    }

    const availableDestinations = collectionOptions.filter(
      (folder) => folder.id !== activeDocument.document.folderId
    );

    openSelection(
      "Move document to collection",
      availableDestinations.map((folder) => ({
        id: folder.id,
        title: folder.pathLabel,
        subtitle: activeDocument.document.title,
        glyph: "folder" as const,
        onSelect: async () => {
          await moveActiveDocument(folder.id);
          closePalette();
        }
      })),
      "There is no other folder available yet."
    );
  }

  function renameDocumentFlow() {
    if (!activeDocument) {
      setStatusMessage("Open a document before renaming it.");
      return;
    }

    openPrompt(
      "Rename document",
      "New PDF name",
      "Rename",
      async (value) => {
        await renameActiveDocument(value);
      },
      activeDocument.document.fileName
    );
  }

  function renameFolderFlow() {
    if (!selectedCollection) {
      setStatusMessage("Select a collection before renaming it.");
      return;
    }

    openPrompt(
      "Rename collection",
      "New collection name",
      "Rename",
      async (value) => {
        await renameCollection(selectedCollection.folder.id, value);
      },
      selectedCollection.folder.name
    );
  }

  async function removeFromLibraryFlow() {
    if (!activeDocument) {
      setStatusMessage("Open a document before removing it from the library.");
      return;
    }

    const process = startDebugProcess("library.remove-from-library-flow", {
      documentId: activeDocument.document.id
    });

    const selection = await open({
      directory: true,
      multiple: false
    });

    if (typeof selection !== "string") {
      process.finish({
        selected: false
      });
      return;
    }

    await removeActiveDocument(selection);
    process.finish({
      selected: true
    });
  }

  async function rescanLibraryFlow() {
    await rescanLibraryState();
  }

  return {
    promptImportFlow,
    createCollectionFlow,
    moveDocumentFlow,
    renameDocumentFlow,
    renameFolderFlow,
    removeFromLibraryFlow,
    rescanLibraryFlow
  };
}
