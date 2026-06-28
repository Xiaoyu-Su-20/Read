import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export type UpdateSource = "automatic" | "manual";

export type UpdateState =
  | { status: "disabled"; reason: "development" | "unconfigured" | "unsupported" }
  | { status: "idle" }
  | { status: "checking"; source: UpdateSource }
  | { status: "up-to-date"; checkedAt: number }
  | { status: "available"; version: string; notes: string | null }
  | {
      status: "downloading";
      version: string;
      downloadedBytes: number;
      totalBytes: number | null;
      progress: number | null;
    }
  | { status: "ready"; version: string; notes: string | null }
  | { status: "installing"; version: string }
  | {
      status: "error";
      phase: "check" | "download" | "install" | "restart-preflight";
      message: string;
      recoverTo: "idle" | "available" | "ready";
      version?: string;
      notes?: string | null;
    };

export type UpdaterAdapter = {
  check: () => Promise<Update | null>;
  relaunch: () => Promise<void>;
};

type StateListener = (state: UpdateState) => void;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown updater error.");
}

export class AppUpdater {
  private state: UpdateState;
  private update: Update | null = null;
  private checkPromise: Promise<void> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private disposed = false;
  private listeners = new Set<StateListener>();

  constructor(
    private readonly adapter: UpdaterAdapter,
    initialState: UpdateState = { status: "idle" }
  ) {
    this.state = initialState;
  }

  getSnapshot = () => this.state;

  subscribe = (listener: StateListener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: UpdateState) {
    if (this.disposed) return;
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  async check(source: UpdateSource): Promise<void> {
    if (this.disposed || this.state.status === "disabled") return;
    if (this.checkPromise) return this.checkPromise;
    if (this.downloadPromise || this.state.status === "installing") return;

    this.publish({ status: "checking", source });
    this.checkPromise = (async () => {
      try {
        const nextUpdate = await this.adapter.check();
        if (this.disposed) {
          await nextUpdate?.close();
          return;
        }

        await this.update?.close();
        this.update = nextUpdate;
        if (!nextUpdate) {
          this.publish({ status: "up-to-date", checkedAt: Date.now() });
          return;
        }

        this.publish({
          status: "available",
          version: nextUpdate.version,
          notes: nextUpdate.body?.trim() || null
        });
      } catch (error) {
        this.publish({
          status: "error",
          phase: "check",
          message: errorMessage(error),
          recoverTo: "idle"
        });
      } finally {
        this.checkPromise = null;
      }
    })();
    return this.checkPromise;
  }

  async download(): Promise<void> {
    if (this.disposed || !this.update || this.state.status !== "available") return;
    if (this.downloadPromise) return this.downloadPromise;

    const update = this.update;
    const version = update.version;
    const notes = update.body?.trim() || null;
    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    this.publish({
      status: "downloading",
      version,
      downloadedBytes,
      totalBytes,
      progress: null
    });

    this.downloadPromise = (async () => {
      try {
        await update.download((event: DownloadEvent) => {
          if (this.disposed) return;
          if (event.event === "Started") {
            totalBytes = event.data.contentLength ?? null;
            downloadedBytes = 0;
          } else if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
          }

          if (event.event !== "Finished") {
            this.publish({
              status: "downloading",
              version,
              downloadedBytes,
              totalBytes,
              progress:
                totalBytes && totalBytes > 0
                  ? Math.min(downloadedBytes / totalBytes, 1)
                  : null
            });
          }
        });
        this.publish({ status: "ready", version, notes });
      } catch (error) {
        this.publish({
          status: "error",
          phase: "download",
          message: errorMessage(error),
          recoverTo: "available",
          version,
          notes
        });
      } finally {
        this.downloadPromise = null;
      }
    })();
    return this.downloadPromise;
  }

  async installAndRestart(prepareForRestart: () => Promise<void>): Promise<void> {
    if (this.disposed || !this.update || this.state.status !== "ready") return;
    const update = this.update;
    const version = update.version;
    const notes = update.body?.trim() || null;

    this.publish({ status: "installing", version });
    try {
      await prepareForRestart();
    } catch (error) {
      this.publish({
        status: "error",
        phase: "restart-preflight",
        message: errorMessage(error),
        recoverTo: "ready",
        version,
        notes
      });
      return;
    }

    try {
      await update.install();
      await this.adapter.relaunch();
    } catch (error) {
      this.publish({
        status: "error",
        phase: "install",
        message: errorMessage(error),
        recoverTo: "ready",
        version,
        notes
      });
    }
  }

  recover() {
    if (this.state.status !== "error") return;
    if (this.state.recoverTo === "available" && this.state.version) {
      this.publish({
        status: "available",
        version: this.state.version,
        notes: this.state.notes ?? null
      });
    } else if (this.state.recoverTo === "ready" && this.state.version) {
      this.publish({
        status: "ready",
        version: this.state.version,
        notes: this.state.notes ?? null
      });
    } else {
      this.publish({ status: "idle" });
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    const update = this.update;
    this.update = null;
    await update?.close();
  }
}
