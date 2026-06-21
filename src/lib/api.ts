import { invoke } from "@tauri-apps/api/core";
import { debugAction, runDebugProcess } from "./debugLog";

import type {
  DocumentDeleteState,
  DocumentPayload,
  DocumentRecord,
  RenderedPagePayload,
  DocumentState,
  NoteDocument,
  NoteDeleteState,
  NoteIndexEntry,
  FolderRecord,
  FolderTreeNode,
  NativeTextPagePayload,
  PdfOutlineItem,
  StandaloneNoteSearchHit
} from "./types";

function invokeLogged<T>(command: string, args?: Record<string, unknown>) {
  return runDebugProcess(`tauri.invoke.${command}`, args ?? {}, () =>
    invoke<T>(command, args)
  );
}

export function listLibrary() {
  debugAction("frontend.before-list-library", {
    epochMs: Date.now(),
    navigationMs: performance.now()
  });

  const startedAt = performance.now();

  return invokeLogged<FolderTreeNode>("list_library")
    .then((library) => {
      debugAction("frontend.after-list-library", {
        durationMs: performance.now() - startedAt,
        epochMs: Date.now()
      });
      return library;
    })
    .catch((error) => {
      debugAction("frontend.list-library-error", {
        durationMs: performance.now() - startedAt,
        epochMs: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    });
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

export function reorderCollections(collectionIds: string[]) {
  return invokeLogged<FolderTreeNode>("reorder_collections", {
    collectionIds
  });
}

export function reorderCollectionDocuments(collectionId: string, documentIds: string[]) {
  return invokeLogged<FolderTreeNode>("reorder_collection_documents", {
    collectionId,
    documentIds
  });
}

export function renameDocument(documentId: string, newName: string) {
  return invokeLogged<DocumentRecord>("rename_document", {
    documentId,
    newName
  });
}

export function deleteDocument(documentId: string) {
  return invokeLogged<DocumentRecord>("delete_document", {
    documentId
  });
}

export function getDocumentDeleteState(documentId: string) {
  return invokeLogged<DocumentDeleteState>("get_document_delete_state", {
    documentId
  });
}

export function renameFolder(folderId: string, newName: string) {
  return invokeLogged<FolderRecord>("rename_folder", {
    folderId,
    newName
  });
}

export function deleteFolder(folderId: string) {
  return invokeLogged<FolderRecord>("delete_folder", {
    folderId
  });
}

export function removeFromLibrary(documentId: string, destinationDirectory: string) {
  return invokeLogged<DocumentRecord>("remove_from_library", {
    documentId,
    destinationDirectory
  });
}

export function openDocument(documentId: string, options?: { openSessionId?: string }) {
  return invokeLogged<DocumentPayload>("open_document", {
    documentId,
    openSessionId: options?.openSessionId ?? null
  });
}

export function readDocumentBytes(documentId: string) {
  return invokeLogged<number[]>("read_document_bytes", {
    documentId
  });
}

export function renderPdfPage(
  documentId: string,
  pageNumber: number,
  zoom: number,
  options?: { openSessionId?: string; requestSequence?: number }
) {
  return invokeLogged<RenderedPagePayload>("render_pdf_page", {
    documentId,
    pageNumber,
    zoom,
    openSessionId: options?.openSessionId ?? null,
    requestSequence: options?.requestSequence ?? null
  });
}

export function warmPdfDisplayLists(
  documentId: string,
  pageNumbers: number[],
  options?: { openSessionId?: string }
) {
  return invokeLogged<void>("warm_pdf_display_lists", {
    documentId,
    pageNumbers,
    openSessionId: options?.openSessionId ?? null
  });
}

export function getPdfNativeTextPage(
  documentId: string,
  pageNumber: number,
  options?: { openSessionId?: string }
) {
  return invokeLogged<NativeTextPagePayload>("get_pdf_native_text_page", {
    documentId,
    pageNumber,
    openSessionId: options?.openSessionId ?? null
  });
}

export function getPdfNativeOutline(documentId: string, options?: { openSessionId?: string }) {
  return invokeLogged<PdfOutlineItem[]>("get_pdf_native_outline", {
    documentId,
    openSessionId: options?.openSessionId ?? null
  });
}

export function saveDocumentState(documentId: string, readerState: DocumentState) {
  return invokeLogged<void>("save_document_state", {
    documentId,
    readerState
  });
}

export function getOrCreateNoteForBook(documentId: string) {
  return invokeLogged<NoteDocument>("get_or_create_note_for_book", {
    documentId
  });
}

export function listStandaloneNotes() {
  return invokeLogged<NoteIndexEntry[]>("list_standalone_notes");
}

export function createStandaloneNote() {
  return invokeLogged<NoteDocument>("create_standalone_note");
}

export function openStandaloneNote(noteId: string) {
  return invokeLogged<NoteDocument>("open_standalone_note", {
    noteId
  });
}

export function renameStandaloneNote(noteId: string, title: string) {
  return invokeLogged<NoteDocument>("rename_standalone_note", {
    noteId,
    title
  });
}

export function deleteStandaloneNote(noteId: string) {
  return invokeLogged<NoteDocument>("delete_standalone_note", {
    noteId
  });
}

export function getStandaloneNoteDeleteState(noteId: string) {
  return invokeLogged<NoteDeleteState>("get_standalone_note_delete_state", {
    noteId
  });
}

export function searchStandaloneNotes(query: string) {
  return invokeLogged<StandaloneNoteSearchHit[]>("search_standalone_notes", {
    query
  });
}

export function saveNote(note: NoteDocument) {
  return invokeLogged<NoteDocument>("save_note", {
    note
  });
}

export function logNoteDebugEvent(event: string, fields: Record<string, unknown>) {
  return invoke<void>("log_note_debug_event", {
    event,
    fields
  }).catch(() => undefined);
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
