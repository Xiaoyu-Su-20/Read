import type { SearchMode, SearchRankingPolicy, SearchStage } from "./SearchPlan";
import type { SearchGroupId, SearchResult, SearchResultBatch } from "./SearchResult";

export type SearchGenerationState = {
  id: number;
  query: string;
  mode: SearchMode;
  completed: boolean;
  progress: { completedPages: number; totalPages: number } | null;
};

function groupForPage(pageNumber: number, ranking: SearchRankingPolicy): SearchGroupId {
  if (pageNumber === ranking.currentPage) return "nearby-page";
  if (ranking.nearbyPages.has(pageNumber)) return "nearby-page";
  return "across-document";
}

export class SearchGeneration {
  readonly results = new Map<string, SearchResult>();
  readonly truncatedGroups = new Set<SearchGroupId>();
  readonly warnings: string[] = [];
  readonly expectedStages = new Map<SearchGroupId, Set<string>>();
  readonly completedStages = new Map<SearchGroupId, Set<string>>();
  readonly stageProgress = new Map<string, number>();
  completed = false;
  private readonly totalPageCount: number;

  constructor(
    readonly id: number,
    readonly query: string,
    readonly mode: SearchMode,
    readonly ranking: SearchRankingPolicy,
    stages: readonly SearchStage[]
  ) {
    this.totalPageCount = stages.reduce((sum, stage) => sum + (stage.pageNumbers?.length ?? 0), 0);
    for (const stage of stages) {
      for (const groupId of this.groupsForStage(stage)) {
        const expected = this.expectedStages.get(groupId) ?? new Set<string>();
        expected.add(stage.id);
        this.expectedStages.set(groupId, expected);
      }
    }
  }

  get publicState(): SearchGenerationState {
    return {
      id: this.id,
      query: this.query,
      mode: this.mode,
      completed: this.completed,
      progress: this.progress
    };
  }

  get progress() {
    const completedPages = [...this.stageProgress.values()].reduce((sum, value) => sum + value, 0);
    return this.totalPageCount > 0
      ? { completedPages: Math.min(completedPages, this.totalPageCount), totalPages: this.totalPageCount }
      : null;
  }

  addBatch(batch: SearchResultBatch) {
    for (const result of batch.results) this.addResult(result);
    if (batch.progress) this.stageProgress.set(batch.stageId, batch.progress.completedPages);
    if (batch.completed) {
      for (const [groupId, stages] of this.expectedStages) {
        if (!stages.has(batch.stageId)) continue;
        const completed = this.completedStages.get(groupId) ?? new Set<string>();
        completed.add(batch.stageId);
        this.completedStages.set(groupId, completed);
      }
    }
  }

  addWarning(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  markStageComplete(stageId: string) {
    for (const [groupId, stages] of this.expectedStages) {
      if (!stages.has(stageId)) continue;
      const completed = this.completedStages.get(groupId) ?? new Set<string>();
      completed.add(stageId);
      this.completedStages.set(groupId, completed);
    }
  }

  isGroupComplete(groupId: SearchGroupId) {
    const expected = this.expectedStages.get(groupId);
    if (!expected || expected.size === 0) return true;
    const completed = this.completedStages.get(groupId);
    return completed?.size === expected.size;
  }

  areStagesComplete(stageIds: ReadonlySet<string>) {
    for (const stageId of stageIds) {
      const completed = [...this.completedStages.values()].some((stages) => stages.has(stageId));
      if (!completed) return false;
    }
    return true;
  }

  private groupsForStage(stage: SearchStage) {
    if (stage.sourceId === "notes") return new Set<SearchGroupId>(["notes"]);
    if (stage.sourceId === "document-name") return new Set<SearchGroupId>(["pdf-names"]);
    return new Set((stage.pageNumbers ?? []).map((page) => groupForPage(page, this.ranking)));
  }

  private addResult(result: SearchResult) {
    if (this.results.has(result.id)) {
      this.results.set(result.id, result);
      return;
    }
    const kindCount = [...this.results.values()].filter((existing) => existing.kind === result.kind).length;
    const limit = result.kind === "pdf" ? 200 : 50;
    if (kindCount >= limit) {
      this.truncatedGroups.add(
        result.kind === "note" ? "notes"
          : result.kind === "document" ? "pdf-names"
            : result.location === "current" || result.location === "nearby" ? "nearby-page"
              : "across-document"
      );
      return;
    }
    this.results.set(result.id, result);
  }
}
