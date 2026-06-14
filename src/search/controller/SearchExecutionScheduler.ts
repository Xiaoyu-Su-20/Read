import type { SearchStage } from "../model/SearchPlan";

export const CHEAP_SOURCE_DELAY_MS = 60;
export const PDF_SOURCE_DELAY_MS = 220;

type ScheduleArgs = {
  stages: readonly SearchStage[];
  extractedPages: ReadonlySet<number>;
  explicitFullSearch: boolean;
  signal: AbortSignal;
  runStage: (stage: SearchStage) => Promise<void>;
};

export class SearchExecutionScheduler {
  async execute({ stages, extractedPages, explicitFullSearch, signal, runStage }: ScheduleArgs) {
    let pdfStageChain = Promise.resolve();
    await Promise.all(stages.map(async (stage) => {
      const isCachedCurrentPage =
        stage.sourceId === "pdf-text" &&
        stage.id === "current-page" &&
        (stage.pageNumbers ?? []).every((page) => extractedPages.has(page));
      const isCheap = stage.sourceId !== "pdf-text" || isCachedCurrentPage;
      const gate = explicitFullSearch ? 0 : isCheap ? CHEAP_SOURCE_DELAY_MS : PDF_SOURCE_DELAY_MS;
      await this.wait(gate + stage.delayMs, signal);
      if (stage.sourceId === "pdf-text") {
        const queued = pdfStageChain.then(() => runStage(stage));
        pdfStageChain = queued.catch(() => undefined);
        await queued;
      } else {
        await runStage(stage);
      }
    }));
  }

  private wait(delayMs: number, signal: AbortSignal) {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, delayMs);
      signal.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }
}

