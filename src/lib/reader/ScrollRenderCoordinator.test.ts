import { describe, expect, it, vi } from "vitest";

import { renderPdfPage } from "../api";
import type { RenderedPagePayload } from "../types";
import type { CachedRenderedPage } from "./PageCache";
import {
  ScrollRenderCoordinator,
  isScrollRenderIdentityChangedError,
  makeRasterIdentityKey,
  type RasterIdentity,
  type RenderDemand
} from "./ScrollRenderCoordinator";

vi.mock("../api", () => ({
  cancelPdfPageRender: vi.fn(async () => undefined),
  renderPdfPage: vi.fn()
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function identity(pageNumber: number, rasterScale = 1): RasterIdentity {
  return {
    documentId: "doc",
    documentGenerationId: "session",
    pageNumber,
    rasterScale,
    rotation: 0,
    normalizationToken: null,
    renderVariant: "raw"
  };
}

function demand(
  pageNumber: number,
  priority: RenderDemand["priority"],
  distanceFromReadingLine: number,
  rasterScale = 1
): RenderDemand {
  return { identity: identity(pageNumber, rasterScale), priority, distanceFromReadingLine };
}

function payload(pageNumber: number): RenderedPagePayload {
  return {
    imageBytes: [1, 2, 3],
    pageNumber,
    width: 10,
    height: 20,
    pageBaseWidth: 10,
    pageBaseHeight: 20,
    cacheKey: `cache:${pageNumber}`,
    renderVariant: "raw",
    normalizationToken: null,
    textLayerTransform: { sourceWidth: 10, sourceHeight: 20, matrix: [1, 0, 0, 1, 0, 0] }
  };
}

function materialized(rendered: RenderedPagePayload, request: RenderDemand): CachedRenderedPage {
  const { imageBytes, ...metadata } = rendered;
  return {
    ...metadata,
    documentId: request.identity.documentId,
    documentGenerationId: request.identity.documentGenerationId,
    imageUrl: `asset://${rendered.pageNumber}`,
    requestKey: rendered.cacheKey,
    logicalKey: makeRasterIdentityKey(request.identity),
    renderZoom: request.identity.rasterScale,
    rotation: request.identity.rotation,
    encodedByteSize: imageBytes.length,
    estimatedResidentBytes: rendered.width * rendered.height * 4 + imageBytes.length
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ScrollRenderCoordinator", () => {
  it("bypasses backend in-flight joining for coordinator-owned renders", async () => {
    vi.mocked(renderPdfPage).mockResolvedValueOnce(payload(1));
    const coordinator = new ScrollRenderCoordinator({
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const lease = coordinator.request(demand(1, "visible", 0));
    await expect(lease.promise).resolves.toMatchObject({ pageNumber: 1 });
    expect(renderPdfPage).toHaveBeenCalledWith(
      "doc",
      1,
      1,
      expect.objectContaining({
        openSessionId: "session",
        bypassInFlightJoin: true
      })
    );
  });

  it("can accept new work after reusable cleanup cancels current requests", async () => {
    const execute = vi.fn(async (request: RenderDemand) => payload(request.identity.pageNumber));
    const coordinator = new ScrollRenderCoordinator({
      maxConcurrent: 1,
      execute,
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const cancelled = coordinator.request(demand(1, "visible", 0));
    coordinator.cancelAll("strict-effect-replay");
    await expect(cancelled.promise).rejects.toMatchObject({ name: "AbortError" });
    await flush();

    const resumed = coordinator.request(demand(2, "visible", 0));
    await expect(resumed.promise).resolves.toMatchObject({ pageNumber: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects requests made after permanent disposal without starting work", async () => {
    const execute = vi.fn(async (request: RenderDemand) => payload(request.identity.pageNumber));
    const coordinator = new ScrollRenderCoordinator({
      execute,
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    coordinator.dispose();
    const lease = coordinator.request(demand(1, "visible", 0));

    await expect(lease.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps nearby raster scales distinct in coordinator keys", () => {
    expect(makeRasterIdentityKey(identity(1, 1.001))).not.toBe(
      makeRasterIdentityKey(identity(1, 1.002))
    );
  });

  it("prioritizes visible queued pages before overscan pages", async () => {
    const pending: Array<ReturnType<typeof deferred<RenderedPagePayload>>> = [];
    const starts: number[] = [];
    const coordinator = new ScrollRenderCoordinator({
      maxConcurrent: 1,
      execute: (request) => {
        starts.push(request.identity.pageNumber);
        const next = deferred<RenderedPagePayload>();
        pending.push(next);
        return next.promise;
      },
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const blocker = coordinator.request(demand(1, "visible", 0));
    const overscan = coordinator.request(demand(2, "overscan", 10));
    const visible = coordinator.request(demand(3, "visible", 100));
    expect(starts).toEqual([1]);

    pending[0].resolve(payload(1));
    await blocker.promise;
    await flush();
    expect(starts).toEqual([1, 3]);

    coordinator.dispose();
    await expect(overscan.promise).rejects.toMatchObject({ name: "AbortError" });
    await expect(visible.promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("caps active work and joins exact raster identities", () => {
    const execute = vi.fn(() => deferred<RenderedPagePayload>().promise);
    const coordinator = new ScrollRenderCoordinator({
      maxConcurrent: 2,
      execute,
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const first = coordinator.request(demand(1, "visible", 0));
    const joined = coordinator.request(demand(1, "visible", 0));
    const second = coordinator.request(demand(2, "visible", 20));
    const third = coordinator.request(demand(3, "visible", 40));

    expect(first.promise).toBe(joined.promise);
    expect(execute).toHaveBeenCalledTimes(2);
    coordinator.dispose();
    void first.promise.catch(() => undefined);
    void second.promise.catch(() => undefined);
    void third.promise.catch(() => undefined);
  });

  it("drops a superseded queued identity before execution", async () => {
    const firstRender = deferred<RenderedPagePayload>();
    const starts: string[] = [];
    const coordinator = new ScrollRenderCoordinator({
      maxConcurrent: 1,
      execute: (request) => {
        starts.push(makeRasterIdentityKey(request.identity));
        return request.identity.pageNumber === 1
          ? firstRender.promise
          : Promise.resolve(payload(request.identity.pageNumber));
      },
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const blocker = coordinator.request(demand(1, "visible", 0));
    const stale = coordinator.request(demand(2, "overscan", 20, 1));
    const current = coordinator.request(demand(2, "visible", 10, 1.05));
    await expect(stale.promise).rejects.toMatchObject({ name: "AbortError" });

    firstRender.resolve(payload(1));
    await blocker.promise;
    await expect(current.promise).resolves.toMatchObject({ pageNumber: 2, renderZoom: 1.05 });
    expect(starts).not.toContain(makeRasterIdentityKey(identity(2, 1)));
  });

  it("cancels active obsolete work and never materializes its result", async () => {
    const oldRender = deferred<RenderedPagePayload>();
    const cancel = vi.fn(async () => undefined);
    const materialize = vi.fn(async (rendered, request) => materialized(rendered, request));
    const coordinator = new ScrollRenderCoordinator({
      maxConcurrent: 1,
      execute: (request) =>
        request.identity.rasterScale === 1
          ? oldRender.promise
          : Promise.resolve(payload(request.identity.pageNumber)),
      cancel,
      materialize
    });

    const stale = coordinator.request(demand(4, "visible", 0, 1));
    const current = coordinator.request(demand(4, "visible", 0, 1.1));
    await expect(stale.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);

    oldRender.resolve(payload(4));
    await expect(current.promise).resolves.toMatchObject({ renderZoom: 1.1 });
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize.mock.calls[0][1].identity.rasterScale).toBe(1.1);
  });

  it("keeps a same-identity replacement queued when an obsolete request finishes", async () => {
    const firstRender = deferred<RenderedPagePayload>();
    const starts: number[] = [];
    const coordinator = new ScrollRenderCoordinator({
      maxConcurrent: 1,
      execute: (request) => {
        starts.push(request.identity.pageNumber);
        return starts.length === 1
          ? firstRender.promise
          : Promise.resolve(payload(request.identity.pageNumber));
      },
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const obsolete = coordinator.request(demand(7, "visible", 0));
    obsolete.release();
    await expect(obsolete.promise).rejects.toMatchObject({ name: "AbortError" });

    const replacement = coordinator.request(demand(7, "visible", 0));
    firstRender.resolve(payload(7));

    await expect(replacement.promise).resolves.toMatchObject({ pageNumber: 7 });
    expect(starts).toEqual([7, 7]);
  });

  it("returns a typed error when the backend payload identity changed", async () => {
    const coordinator = new ScrollRenderCoordinator({
      execute: async () => ({
        ...payload(8),
        normalizationToken: "new-token",
        renderVariant: "normalized"
      }),
      cancel: async () => undefined,
      materialize: async (rendered, request) => materialized(rendered, request)
    });

    const lease = coordinator.request(demand(8, "visible", 0));
    await expect(lease.promise).rejects.toSatisfy(isScrollRenderIdentityChangedError);
  });
});
