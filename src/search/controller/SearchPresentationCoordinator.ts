export const FIRST_COMMIT_ELIGIBLE_MS = 140;
export const FIRST_COMMIT_DEADLINE_MS = 180;
export const PRESENTATION_COMMIT_INTERVAL_MS = 120;

type PresentationCallbacks = {
  canCommitFirst: () => boolean;
  commit: (final: boolean) => void;
};

export class SearchPresentationCoordinator {
  private eligible = false;
  private firstCommitted = false;
  private finalPending = false;
  private lastCommitAt = 0;
  private eligibleTimer: number | null = null;
  private deadlineTimer: number | null = null;
  private streamingTimer: number | null = null;
  private callbacks: PresentationCallbacks | null = null;

  begin(callbacks: PresentationCallbacks) {
    this.cancel();
    this.callbacks = callbacks;
    this.eligibleTimer = window.setTimeout(() => {
      this.eligible = true;
      this.eligibleTimer = null;
      if (callbacks.canCommitFirst()) this.commit(false);
    }, FIRST_COMMIT_ELIGIBLE_MS);
    this.deadlineTimer = window.setTimeout(() => {
      this.deadlineTimer = null;
      this.commit(false);
    }, FIRST_COMMIT_DEADLINE_MS);
  }

  liveChanged() {
    if (!this.callbacks) return;
    if (!this.firstCommitted) {
      if (this.eligible && this.callbacks.canCommitFirst()) this.commit(false);
      return;
    }
    this.scheduleStreamingCommit();
  }

  finish() {
    this.finalPending = true;
    if (!this.firstCommitted) {
      if (this.eligible) this.commit(true);
      return;
    }
    this.scheduleStreamingCommit();
  }

  cancel() {
    if (this.eligibleTimer !== null) window.clearTimeout(this.eligibleTimer);
    if (this.deadlineTimer !== null) window.clearTimeout(this.deadlineTimer);
    if (this.streamingTimer !== null) window.clearTimeout(this.streamingTimer);
    this.eligibleTimer = null;
    this.deadlineTimer = null;
    this.streamingTimer = null;
    this.callbacks = null;
    this.eligible = false;
    this.firstCommitted = false;
    this.finalPending = false;
    this.lastCommitAt = 0;
  }

  private scheduleStreamingCommit() {
    if (this.streamingTimer !== null || !this.callbacks) return;
    const waitMs = Math.max(0, PRESENTATION_COMMIT_INTERVAL_MS - (Date.now() - this.lastCommitAt));
    this.streamingTimer = window.setTimeout(() => {
      this.streamingTimer = null;
      this.commit(this.finalPending);
    }, waitMs);
  }

  private commit(final: boolean) {
    if (!this.callbacks) return;
    if (this.eligibleTimer !== null) window.clearTimeout(this.eligibleTimer);
    if (this.deadlineTimer !== null) window.clearTimeout(this.deadlineTimer);
    this.eligibleTimer = null;
    this.deadlineTimer = null;
    this.firstCommitted = true;
    this.lastCommitAt = Date.now();
    this.callbacks.commit(final || this.finalPending);
    if (final || this.finalPending) this.finalPending = false;
  }
}

