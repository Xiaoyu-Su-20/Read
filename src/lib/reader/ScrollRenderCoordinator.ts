import { cancelPdfPageRender, renderPdfPage } from "../api";
import { debugAction } from "../debugLog";
import type { RenderedPagePayload } from "../types";
import type { CachedRenderedPage } from "./PageCache";
import { toCachedRenderedPage } from "./PdfPageRenderer";

export type RasterIdentity = {
  documentId: string;
  documentGenerationId: string;
  pageNumber: number;
  rasterScale: number;
  rotation: number;
  normalizationToken: string | null;
  renderVariant: RenderedPagePayload["renderVariant"];
};

export type RenderPriority = "visible" | "overscan";

export type RenderDemand = {
  identity: RasterIdentity;
  priority: RenderPriority;
  distanceFromReadingLine: number;
};

export type RenderLease = {
  promise: Promise<CachedRenderedPage>;
  release: () => void;
};

type RenderJob = {
  demand: RenderDemand;
  key: string;
  slotKey: string;
  requestId: string;
  requestSequence: number;
  queuedAt: number;
  state: "queued" | "active";
  leaseCount: number;
  obsolete: boolean;
  settled: boolean;
  promise: Promise<CachedRenderedPage>;
  resolve: (page: CachedRenderedPage) => void;
  reject: (error: unknown) => void;
};

type CoordinatorOptions = {
  maxConcurrent?: number;
  execute?: (
    demand: RenderDemand,
    requestId: string,
    requestSequence: number
  ) => Promise<RenderedPagePayload>;
  cancel?: (requestId: string) => Promise<void>;
  materialize?: (payload: RenderedPagePayload, demand: RenderDemand) => Promise<CachedRenderedPage>;
};

const PRIORITY_ORDER: Record<RenderPriority, number> = {
  visible: 0,
  overscan: 1
};

function cancelledError() {
  return new DOMException("Scroll raster request was superseded.", "AbortError");
}

const RENDER_IDENTITY_CHANGED_CODE = "RENDER_IDENTITY_CHANGED";

export class ScrollRenderIdentityChangedError extends Error {
  constructor(message = "Scroll raster identity changed.") {
    super(message);
    this.name = "ScrollRenderIdentityChangedError";
  }
}

export function isScrollRenderIdentityChangedError(error: unknown) {
  return (
    error instanceof ScrollRenderIdentityChangedError ||
    String(error).includes(RENDER_IDENTITY_CHANGED_CODE)
  );
}

export function makeRasterIdentityKey(identity: RasterIdentity) {
  return [
    identity.documentId,
    identity.documentGenerationId,
    identity.pageNumber,
    Math.round(identity.rasterScale * 10_000),
    identity.rotation,
    identity.normalizationToken ?? "raw",
    identity.renderVariant
  ].join(":");
}

function makeRasterSlotKey(identity: RasterIdentity) {
  return `${identity.documentId}:${identity.documentGenerationId}:${identity.pageNumber}`;
}

async function decodePageImage(page: CachedRenderedPage) {
  const image = new Image();
  image.src = page.imageUrl;
  await image.decode();
  return page;
}

function revokeUnadmittedPage(page: CachedRenderedPage, reason: string) {
  if (!page.imageUrl.startsWith("blob:")) return;
  debugAction("scroll-render.unadmitted-url-revoked", {
    identity: page.logicalKey,
    page: page.pageNumber,
    reason
  });
  URL.revokeObjectURL(page.imageUrl);
}

export class ScrollRenderCoordinator {
  private readonly maxConcurrent: number;
  private readonly execute: NonNullable<CoordinatorOptions["execute"]>;
  private readonly cancel: NonNullable<CoordinatorOptions["cancel"]>;
  private readonly materialize: NonNullable<CoordinatorOptions["materialize"]>;
  private readonly jobsByKey = new Map<string, RenderJob>();
  private readonly desiredBySlot = new Map<string, string>();
  private activeCount = 0;
  private nextSequence = 0;
  private readonly coordinatorId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private disposed = false;

  constructor(options: CoordinatorOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.execute = options.execute ?? ((demand, requestId, requestSequence) => {
      const { identity } = demand;
      return renderPdfPage(identity.documentId, identity.pageNumber, identity.rasterScale, {
        openSessionId: identity.documentGenerationId,
        requestId,
        requestSequence,
        expectedNormalizationToken: identity.normalizationToken,
        expectedRenderVariant: identity.renderVariant,
        rotation: identity.rotation,
        bypassInFlightJoin: true
      }).catch((error) => {
        if (isScrollRenderIdentityChangedError(error)) {
          throw new ScrollRenderIdentityChangedError(String(error));
        }
        throw error;
      });
    });
    this.cancel = options.cancel ?? (async (requestId) => {
      await cancelPdfPageRender(requestId);
    });
    this.materialize = options.materialize ?? (async (payload, demand) => {
      const page = toCachedRenderedPage(
        demand.identity.documentId,
        demand.identity.rasterScale,
        payload,
        {
          documentGenerationId: demand.identity.documentGenerationId,
          logicalKey: makeRasterIdentityKey(demand.identity),
          rotation: demand.identity.rotation
        }
      );
      try {
        return await decodePageImage(page);
      } catch (error) {
        revokeUnadmittedPage(page, "decode-error");
        throw error;
      }
    });
  }

  request(demand: RenderDemand): RenderLease {
    if (this.disposed) {
      debugAction("scroll-render.request-rejected", {
        identity: makeRasterIdentityKey(demand.identity),
        reason: "coordinator-disposed"
      });
      return { promise: Promise.reject(cancelledError()), release: () => undefined };
    }

    const key = makeRasterIdentityKey(demand.identity);
    const slotKey = makeRasterSlotKey(demand.identity);
    const desiredKey = this.desiredBySlot.get(slotKey);
    if (desiredKey && desiredKey !== key) {
      const superseded = this.jobsByKey.get(desiredKey);
      if (superseded) this.markObsolete(superseded, "newer-page-identity");
    }

    const existing = this.jobsByKey.get(key);
    if (existing && !existing.obsolete) {
      existing.leaseCount += 1;
      if (
        PRIORITY_ORDER[demand.priority] < PRIORITY_ORDER[existing.demand.priority] ||
        demand.distanceFromReadingLine < existing.demand.distanceFromReadingLine
      ) {
        existing.demand = demand;
        debugAction("scroll-render.priority-updated", {
          identity: key,
          priority: demand.priority
        });
        this.pump();
      }
      return this.createLease(existing);
    }

    let resolve!: (page: CachedRenderedPage) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<CachedRenderedPage>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const requestSequence = ++this.nextSequence;
    const job: RenderJob = {
      demand,
      key,
      slotKey,
      requestId: `scroll-${demand.identity.documentGenerationId}-${this.coordinatorId}-${requestSequence}`,
      requestSequence,
      queuedAt: performance.now(),
      state: "queued",
      leaseCount: 1,
      obsolete: false,
      settled: false,
      promise,
      resolve,
      reject
    };
    this.jobsByKey.set(key, job);
    this.desiredBySlot.set(slotKey, key);
    debugAction("scroll-render.queued", {
      identity: key,
      priority: demand.priority,
      requestId: job.requestId
    });
    this.pump();
    return this.createLease(job);
  }

  reprioritize(demand: RenderDemand) {
    const job = this.jobsByKey.get(makeRasterIdentityKey(demand.identity));
    if (!job || job.obsolete || job.state !== "queued") return;
    if (
      job.demand.priority === demand.priority &&
      job.demand.distanceFromReadingLine === demand.distanceFromReadingLine
    ) {
      return;
    }
    job.demand = demand;
    debugAction("scroll-render.priority-updated", {
      identity: job.key,
      priority: demand.priority
    });
    this.pump();
  }

  cancelAll(reason = "coordinator-reset") {
    for (const job of [...this.jobsByKey.values()]) {
      this.markObsolete(job, reason);
    }
    this.desiredBySlot.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll("coordinator-disposed");
  }

  private createLease(job: RenderJob): RenderLease {
    let released = false;
    return {
      promise: job.promise,
      release: () => {
        if (released) return;
        released = true;
        job.leaseCount = Math.max(job.leaseCount - 1, 0);
        if (job.leaseCount === 0 && !job.settled) {
          this.markObsolete(job, "last-lease-released");
        }
      }
    };
  }

  private markObsolete(job: RenderJob, reason: string) {
    if (job.obsolete) return;
    job.obsolete = true;
    if (this.desiredBySlot.get(job.slotKey) === job.key) {
      this.desiredBySlot.delete(job.slotKey);
    }
    debugAction("scroll-render.superseded", {
      identity: job.key,
      reason,
      requestId: job.requestId,
      state: job.state
    });
    if (!job.settled) {
      job.settled = true;
      job.reject(cancelledError());
    }
    if (job.state === "queued") {
      if (this.jobsByKey.get(job.key) === job) {
        this.jobsByKey.delete(job.key);
      }
      this.pump();
      return;
    }
    void this.cancel(job.requestId).catch((error) => {
      debugAction("scroll-render.cancel-error", {
        error: error instanceof Error ? error.message : String(error),
        requestId: job.requestId
      });
    });
  }

  private pump() {
    if (this.disposed) return;
    while (this.activeCount < this.maxConcurrent) {
      const next = [...this.jobsByKey.values()]
        .filter((job) => job.state === "queued" && !job.obsolete)
        .sort((left, right) => {
          const priorityDelta = PRIORITY_ORDER[left.demand.priority] - PRIORITY_ORDER[right.demand.priority];
          if (priorityDelta !== 0) return priorityDelta;
          const distanceDelta = left.demand.distanceFromReadingLine - right.demand.distanceFromReadingLine;
          return distanceDelta !== 0 ? distanceDelta : left.queuedAt - right.queuedAt;
        })[0];
      if (!next) return;
      this.start(next);
    }
  }

  private start(job: RenderJob) {
    job.state = "active";
    this.activeCount += 1;
    debugAction("scroll-render.started", {
      identity: job.key,
      priority: job.demand.priority,
      queueWaitMs: Math.round(performance.now() - job.queuedAt),
      requestId: job.requestId
    });

    void this.execute(job.demand, job.requestId, job.requestSequence)
      .then(async (payload) => {
        if (job.obsolete || this.disposed) return null;
        const { identity } = job.demand;
        const payloadVariant = payload.renderVariant === "normalized" ? "normalized" : "raw";
        if (
          payload.pageNumber !== identity.pageNumber ||
          payload.normalizationToken !== identity.normalizationToken ||
          payloadVariant !== identity.renderVariant
        ) {
          debugAction("scroll-render.identity-mismatch", {
            received: {
              normalizationToken: payload.normalizationToken,
              pageNumber: payload.pageNumber,
              renderVariant: payloadVariant
            },
            requested: {
              normalizationToken: identity.normalizationToken,
              pageNumber: identity.pageNumber,
              renderVariant: identity.renderVariant,
              rotation: identity.rotation
            }
          });
          throw new ScrollRenderIdentityChangedError();
        }
        const materialized = await this.materialize(payload, job.demand);
        if (job.obsolete || this.disposed) {
          revokeUnadmittedPage(materialized, "obsolete-after-decode");
          return null;
        }
        return materialized;
      })
      .then((page) => {
        if (!page || job.settled) return;
        job.settled = true;
        debugAction("scroll-render.ready", {
          identity: job.key,
          requestId: job.requestId
        });
        job.resolve(page);
      })
      .catch((error) => {
        if (job.settled) return;
        job.settled = true;
        job.reject(error);
      })
      .finally(() => {
        this.activeCount = Math.max(this.activeCount - 1, 0);
        if (this.jobsByKey.get(job.key) === job) {
          this.jobsByKey.delete(job.key);
          if (this.desiredBySlot.get(job.slotKey) === job.key) {
            this.desiredBySlot.delete(job.slotKey);
          }
        }
        this.pump();
      });
  }
}
