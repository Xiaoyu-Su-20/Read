import { invoke } from "@tauri-apps/api/core";
import { runDebugProcess } from "./debugLog";

import type {
  DocumentPayload,
  DocumentRecord,
  RenderedPagePayload,
  DocumentState,
  FolderRecord,
  FolderTreeNode
} from "./types";

function invokeLogged<T>(command: string, args?: Record<string, unknown>) {
  return runDebugProcess(`tauri.invoke.${command}`, args ?? {}, () =>
    invoke<T>(command, args)
  );
}

export function listLibrary() {
  return invokeLogged<FolderTreeNode>("list_library");
}

export function rescanLibrary() {
  return invokeLogged<FolderTreeNode>("rescan_library");
}

export function getLibraryRoot() {
  return invokeLogged<string>("get_library_root");
}

export function createFolder(name: string, parentFolderId?: string) {
  return invokeLogged<FolderRecord>("create_folder", {
    name,
    parentFolderId
  });
}

export function importPdf(sourcePath: string, destinationFolderId?: string) {
  return invokeLogged<DocumentRecord>("import_pdf", {
    sourcePath,
    destinationFolderId
  });
}

export function moveDocument(documentId: string, destinationFolderId: string) {
  return invokeLogged<DocumentRecord>("move_document", {
    documentId,
    destinationFolderId
  });
}

export function renameDocument(documentId: string, newName: string) {
  return invokeLogged<DocumentRecord>("rename_document", {
    documentId,
    newName
  });
}

export function renameFolder(folderId: string, newName: string) {
  return invokeLogged<FolderRecord>("rename_folder", {
    folderId,
    newName
  });
}

export function removeFromLibrary(documentId: string, destinationDirectory: string) {
  return invokeLogged<DocumentRecord>("remove_from_library", {
    documentId,
    destinationDirectory
  });
}

export function openDocument(documentId: string) {
  return invokeLogged<DocumentPayload>("open_document", {
    documentId
  });
}

export function readDocumentBytes(documentId: string) {
  return invokeLogged<number[]>("read_document_bytes", {
    documentId
  });
}

export function renderPdfPage(
  documentId: string,
  pageNumber: number
) {
  return invokeLogged<RenderedPagePayload>("render_pdf_page", {
    documentId,
    pageNumber
  });
}

export function saveDocumentState(documentId: string, readerState: DocumentState) {
  return invokeLogged<void>("save_document_state", {
    documentId,
    readerState
  });
}

export function listRecentDocuments() {
  return invokeLogged<DocumentRecord[]>("list_recent_documents");
}

export function openLibraryFolder() {
  return invokeLogged<void>("open_library_folder");
}

export function showDocumentInExplorer(documentId: string) {
  return invokeLogged<void>("show_document_in_explorer", {
    documentId
  });
}

export function showFolderInExplorer(folderId?: string) {
  return invokeLogged<void>("show_folder_in_explorer", {
    folderId
  });
}
