import { open } from "@tauri-apps/plugin-dialog";

import { startDebugProcess } from "../debugLog";
import type { DocumentPayload, FolderTreeNode, PaletteItem } from "../types";
import { nextCollectionName } from "./helpers";

function normalizeLibraryPath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

type UseLibraryFlowsArgs = {
  libraryTree: FolderTreeNode | null;
  libraryRoot: string;
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
  importDocumentsToCollection: (sourcePaths: string[], destinationFolderId: string) => Promise<unknown>;
  moveActiveDocument: (destinationFolderId: string) => Promise<unknown>;
  renameActiveDocument: (newName: string) => Promise<unknown>;
  renameCollection: (collectionId: string, newName: string) => Promise<unknown>;
  removeActiveDocument: (destinationDirectory: string) => Promise<unknown>;
  rescanLibraryState: () => Promise<void>;
  changeLibraryRootState: (newRoot: string, options?: { moveExisting?: boolean }) => Promise<unknown>;
};

export function useLibraryFlows({
  libraryTree,
  libraryRoot,
  collectionOptions,
  activeDocument,
  selectedCollection,
  closePalette,
  openSelection,
  openPrompt,
  setStatusMessage,
  createCollection,
  importDocumentToCollection,
  importDocumentsToCollection,
  moveActiveDocument,
  renameActiveDocument,
  renameCollection,
  removeActiveDocument,
  rescanLibraryState,
  changeLibraryRootState
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

  async function promptImportIntoCollectionFlow(collectionId: string) {
    const process = startDebugProcess("app.prompt-import-into-collection-flow", {
      collectionId
    });
    const selection = await open({
      multiple: true,
      filters: [
        {
          name: "PDF",
          extensions: ["pdf"]
        }
      ]
    });

    const sourcePaths =
      typeof selection === "string"
        ? [selection]
        : Array.isArray(selection)
          ? selection.filter((entry): entry is string => typeof entry === "string")
          : [];

    if (sourcePaths.length === 0) {
      process.finish({
        selected: false
      });
      return;
    }

    await importDocumentsToCollection(sourcePaths, collectionId);
    closePalette();
    process.finish({
      importedCount: sourcePaths.length,
      selected: true
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

  async function changeLibraryRootFlow() {
    const process = startDebugProcess("library.change-root-picker-flow", {
      currentLibraryRoot: libraryRoot
    });
    const selection = await open({
      directory: true,
      multiple: false,
      defaultPath: libraryRoot || undefined
    });

    if (typeof selection !== "string") {
      process.finish({
        selected: false
      });
      return;
    }

    if (normalizeLibraryPath(selection) === normalizeLibraryPath(libraryRoot)) {
      setStatusMessage("That folder is already the current library location.");
      process.finish({
        selected: true,
        unchanged: true
      });
      return;
    }

    openSelection(
      "Use selected library folder",
      [
        {
          id: "move-library-root",
          title: "Move current library here",
          subtitle: "Move existing collections and PDFs into the new folder",
          glyph: "folder-open" as const,
          onSelect: async () => {
            await changeLibraryRootState(selection, { moveExisting: true });
            closePalette();
          }
        },
        {
          id: "switch-library-root-only",
          title: "Use new folder only",
          subtitle: "Switch Readr to the selected folder without moving existing files",
          glyph: "folder" as const,
          onSelect: async () => {
            await changeLibraryRootState(selection, { moveExisting: false });
            closePalette();
          }
        }
      ],
      "Choose how to use the selected folder."
    );

    process.finish({
      selected: true,
      deferredSelection: true,
      nextLibraryRoot: selection
    });
  }

  return {
    promptImportFlow,
    promptImportIntoCollectionFlow,
    createCollectionFlow,
    moveDocumentFlow,
    renameDocumentFlow,
    renameFolderFlow,
    removeFromLibraryFlow,
    rescanLibraryFlow,
    changeLibraryRootFlow
  };
}
