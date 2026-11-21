import type {
  DocumentState,
  ReaderLocationHandoff,
  ReaderViewMode,
  ViewerApi,
  ViewerSnapshot
} from "../types";

export type PendingReaderLocationHandoff = ReaderLocationHandoff & {
  targetMode: ReaderViewMode;
  token: number;
};

export class ReaderModeHandoffCoordinator {
  private sequence = 0;
  private pending: PendingReaderLocationHandoff | null = null;
  private publicationGate: PendingReaderLocationHandoff | null = null;

  resetForDocument(documentId: string | null) {
    if (this.pending?.documentId !== documentId) {
      this.pending = null;
    }
    if (this.publicationGate?.documentId !== documentId) {
      this.publicationGate = null;
    }
  }

  preferredPage(documentId: string, fallbackPage: number) {
    const active = this.pending ?? this.publicationGate;
    return active?.documentId === documentId ? active.pageNumber : fallbackPage;
  }

  capture(
    documentId: string,
    pageNumber: number,
    sourceMode: ReaderViewMode,
    targetMode: ReaderViewMode
  ) {
    const handoff: PendingReaderLocationHandoff = {
      documentId,
      pageNumber,
      sourceMode,
      targetMode,
      token: ++this.sequence
    };
    this.pending = handoff;
    this.publicationGate = null;
    return handoff;
  }

  apply(
    mode: ReaderViewMode,
    documentId: string | null,
    api: ViewerApi
  ) {
    const handoff = this.pending;
    if (
      !handoff ||
      handoff.targetMode !== mode ||
      handoff.documentId !== documentId
    ) {
      return null;
    }

    this.pending = null;
    this.publicationGate = handoff;
    api.goToPage(handoff.pageNumber, {
      alignment: mode === "scroll" ? "top" : "page"
    });
    return handoff;
  }

  shouldPublishSnapshot(
    mode: ReaderViewMode,
    documentId: string | null,
    snapshot: ViewerSnapshot
  ) {
    if (this.isPendingDestination(mode, documentId)) {
      return false;
    }
    const gate = this.publicationGate;
    if (!gate || gate.targetMode !== mode || gate.documentId !== documentId) {
      return true;
    }
    if (snapshot.currentPage !== gate.pageNumber) {
      return false;
    }
    this.publicationGate = null;
    return true;
  }

  shouldPublishState(
    mode: ReaderViewMode,
    documentId: string | null,
    state: DocumentState | null
  ) {
    if (this.isPendingDestination(mode, documentId)) {
      return false;
    }
    const gate = this.publicationGate;
    return (
      !gate ||
      gate.targetMode !== mode ||
      gate.documentId !== documentId ||
      state?.lastPage === gate.pageNumber
    );
  }

  private isPendingDestination(mode: ReaderViewMode, documentId: string | null) {
    return (
      this.pending?.targetMode === mode && this.pending.documentId === documentId
    );
  }
}
