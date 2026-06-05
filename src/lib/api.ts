import { invoke } from "@tauri-apps/api/core";

import type {
  DocumentPayload,
  DocumentRecord,
  DocumentState,
  FolderRecord,
  FolderTreeNode
} from "./types";

export function listLibrary() {
  return invoke<FolderTreeNode>("list_library");
}

export function createFolder(name: string, parentFolderId?: string) {
  return invoke<FolderRecord>("create_folder", {
    name,
    parentFolderId
  });
}

export function importPdf(sourcePath: string, destinationFolderId?: string) {
  return invoke<DocumentRecord>("import_pdf", {
    sourcePath,
    destinationFolderId
  });
}

export function moveDocument(documentId: string, destinationFolderId: string) {
  return invoke<DocumentRecord>("move_document", {
    documentId,
    destinationFolderId
  });
}

export function openDocument(documentId: string) {
  return invoke<DocumentPayload>("open_document", {
    documentId
  });
}

export function saveDocumentState(documentId: string, readerState: DocumentState) {
  return invoke<void>("save_document_state", {
    documentId,
    readerState
  });
}

export function listRecentDocuments() {
  return invoke<DocumentRecord[]>("list_recent_documents");
}
