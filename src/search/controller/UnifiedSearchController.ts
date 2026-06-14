import type { DocumentRecord, NoteDocument } from "../../lib/types";
import { SearchGeneration, type SearchGenerationState } from "../model/SearchGenerationState";
import type { SearchPhase } from "../model/SearchPhase";
import type { SearchPlan, SearchStage } from "../model/SearchPlan";
import type { PdfSearchPort, SearchRequest, SearchSourceId } from "../model/SearchRequest";
import type { SearchGroupId, SearchResult, SearchSource } from "../model/SearchResult";
import type { SearchViewGroup, SearchViewSnapshot } from "../model/SearchViewSnapshot";
import { classifyDocumentSize } from "../planning/SearchModes";
import { analyzeQuery } from "../planning/queryAnalysis";
import {
  SEARCH_GROUP_DEFINITIONS,
  rankSearchResults,
  resultsForGroup
} from "../ranking/mergeSearchResults";
import { stabilizeResultOrder } from "../ranking/stabilizeResultOrder";
import { CHEAP_SOURCE_DELAY_MS, SearchExecutionScheduler } from "./SearchExecutionScheduler";
import { SearchPresentationCoordinator } from "./SearchPresentationCoordinator";

export type UnifiedSearchContext = {
  currentPage: number;
  totalPages: number;
  activeDocumentId: string | null;
  currentNote: NoteDocument | null;
  documents: readonly DocumentRecord[];
  pdfPort: PdfSearchPort | null;
};

export type SearchSelectionOrigin = "keyboard" | "pointer" | null;

export type UnifiedSearchState = {
  open: boolean;
  inputQuery: string;
  liveGeneration: SearchGenerationState | null;
  committedView: SearchViewSnapshot;
  phase: SearchPhase;
  activeResultId: string | null;
  selectionOrigin: SearchSelectionOrigin;
  expandedGroups: ReadonlySet<SearchGroupId>;
};

type SearchPlanner = (context: import("../model/SearchPlan").SearchPlanningContext) => SearchPlan;

const EMPTY_CONTEXT: UnifiedSearchContext = {
  currentPage: 1,
  totalPages: 0,
  activeDocumentId: null,
  currentNote: null,
  documents: [],
  pdfPort: null
};

function capabilitySignature(context: UnifiedSearchContext) {
  return [Boolean(context.currentNote), Boolean(context.pdfPort && context.totalPages > 0), context.documents.length > 0].join(":");
}

function supportsGroup(context: UnifiedSearchContext, groupId: SearchGroupId) {
  if (groupId === "notes") return Boolean(context.currentNote);
  if (groupId === "documents") return context.documents.length > 0;
  return Boolean(context.pdfPort && context.totalPages > 0);
}

function emptyCommittedView(context: UnifiedSearchContext, query = ""): SearchViewSnapshot {
  return {
    query,
    stale: false,
    groups: SEARCH_GROUP_DEFINITIONS
      .filter((definition) => supportsGroup(context, definition.id))
      .map((definition) => ({
        id: definition.id,
        label: definition.label,
        results: [],
        total: 0,
        countIsFinal: true,
        state: "idle" as const,
        truncated: false,
        action: null
      })),
    warnings: [],
    progress: null
  };
}

export class UnifiedSearchController {
  private context = EMPTY_CONTEXT;
  private state: UnifiedSearchState = {
    open: false,
    inputQuery: "",
    liveGeneration: null,
    committedView: emptyCommittedView(EMPTY_CONTEXT),
    phase: "idle",
    activeResultId: null,
    selectionOrigin: null,
    expandedGroups: new Set()
  };
  private listeners = new Set<() => void>();
  private generationSequence = 0;
  private abortController: AbortController | null = null;
  private currentGeneration: SearchGeneration | null = null;
  private phaseTimer: number | null = null;

  constructor(
    private readonly planner: SearchPlanner,
    private readonly sources: ReadonlyMap<SearchSourceId, SearchSource>,
    private readonly executionScheduler = new SearchExecutionScheduler(),
    private readonly presentationCoordinator = new SearchPresentationCoordinator()
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  setContext(context: UnifiedSearchContext) {
    const capabilitiesChanged = capabilitySignature(context) !== capabilitySignature(this.context);
    const searchContextChanged =
      context.activeDocumentId !== this.context.activeDocumentId ||
      context.currentPage !== this.context.currentPage ||
      context.currentNote !== this.context.currentNote ||
      context.pdfPort !== this.context.pdfPort;
    this.context = context;

    if (capabilitiesChanged) {
      this.cancelGeneration();
      this.state = {
        ...this.state,
        liveGeneration: null,
        committedView: emptyCommittedView(context, this.state.inputQuery),
        phase: this.state.inputQuery.trim() ? "typing" : "idle",
        activeResultId: null,
        selectionOrigin: null
      };
      this.emit();
      if (this.state.open && this.state.inputQuery.trim()) this.beginGeneration(false);
      return;
    }

    if (this.state.open && this.state.phase !== "cancelled" && this.state.inputQuery.trim() && searchContextChanged) {
      this.cancelGeneration();
      this.markCommittedViewStale();
      this.beginGeneration(false);
    }
  }

  open(query?: string) {
    if (!this.state.open) {
      this.patch({ open: true, committedView: emptyCommittedView(this.context, this.state.inputQuery) });
    }
    if (query !== undefined && query !== this.state.inputQuery) this.setQuery(query);
  }

  close() {
    this.cancelGeneration();
    this.state = {
      open: false,
      inputQuery: "",
      liveGeneration: null,
      committedView: emptyCommittedView(this.context),
      phase: "idle",
      activeResultId: null,
      selectionOrigin: null,
      expandedGroups: new Set()
    };
    this.emit();
  }

  setQuery(query: string) {
    this.cancelGeneration();
    if (!query.trim()) {
      this.state = {
        ...this.state,
        inputQuery: query,
        liveGeneration: null,
        committedView: emptyCommittedView(this.context),
        phase: "idle",
        activeResultId: null,
        selectionOrigin: null
      };
      this.emit();
      return;
    }

    this.state = {
      ...this.state,
      inputQuery: query,
      liveGeneration: null,
      committedView: { ...this.state.committedView, stale: this.state.committedView.query !== query },
      phase: "typing",
      activeResultId: null,
      selectionOrigin: null
    };
    this.emit();
    this.beginGeneration(false);
  }

  searchEntireDocument() {
    if (!this.state.inputQuery.trim() || !this.context.pdfPort) return;
    this.cancelGeneration();
    this.patch({ phase: "settling", selectionOrigin: null });
    this.beginGeneration(true);
  }

  cancel() {
    this.cancelGeneration();
    this.patch({ phase: "cancelled", liveGeneration: null });
  }

  toggleGroup(groupId: SearchGroupId) {
    const expandedGroups = new Set(this.state.expandedGroups);
    if (expandedGroups.has(groupId)) expandedGroups.delete(groupId);
    else expandedGroups.add(groupId);
    this.patch({ expandedGroups });
  }

  setActiveResult(resultId: string | null, origin: SearchSelectionOrigin = "pointer") {
    const nextOrigin = resultId ? origin : null;
    if (this.state.activeResultId === resultId && this.state.selectionOrigin === nextOrigin) return;
    const previousOrigin = this.state.selectionOrigin;
    this.patch({ activeResultId: resultId, selectionOrigin: nextOrigin });
    if (
      previousOrigin === "keyboard" &&
      origin !== "keyboard" &&
      this.currentGeneration?.completed
    ) {
      this.commitGeneration(this.currentGeneration, true);
    }
  }

  moveActiveResult(direction: 1 | -1) {
    if (this.state.committedView.stale) return null;
    const results = this.visibleResults();
    if (results.length === 0) return null;
    const currentIndex = results.findIndex((result) => result.id === this.state.activeResultId);
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : results.length - 1
      : (currentIndex + direction + results.length) % results.length;
    const result = results[nextIndex];
    this.patch({ activeResultId: result.id, selectionOrigin: "keyboard" });
    return result;
  }

  getActiveResult() {
    if (this.state.committedView.stale) return null;
    return this.visibleResults().find((result) => result.id === this.state.activeResultId) ?? null;
  }

  private visibleResults() {
    const initialLimits: Record<SearchGroupId, number> = {
      notes: 3,
      "current-page": 3,
      "nearby-pages": 5,
      "across-document": 5,
      documents: 5
    };
    return this.state.committedView.groups.flatMap((group) =>
      group.results.slice(0, this.state.expandedGroups.has(group.id) ? group.results.length : initialLimits[group.id])
    ).filter((result) => result.kind !== "document" || result.available);
  }

  private beginGeneration(explicitFullSearch: boolean) {
    const query = this.state.inputQuery;
    const extractedPages = this.context.pdfPort?.getExtractedPageNumbers() ?? new Set<number>();
    const availableSources = new Set<SearchSourceId>();
    if (this.context.currentNote) availableSources.add("notes");
    if (this.context.documents.length > 0) availableSources.add("document-name");
    if (this.context.pdfPort && this.context.totalPages > 0) availableSources.add("pdf-text");
    const plan = this.planner({
      query,
      currentPage: this.context.currentPage,
      totalPages: this.context.totalPages,
      extractedPages,
      availableSources,
      explicitFullSearch,
      documentSizeClass: classifyDocumentSize(this.context.totalPages)
    });
    const generation = new SearchGeneration(
      ++this.generationSequence,
      query,
      plan.mode,
      plan.ranking,
      plan.stages
    );
    this.currentGeneration = generation;
    const cheapStageIds = new Set(plan.stages.filter((stage) =>
      stage.sourceId !== "pdf-text" ||
      (stage.id === "current-page" && (stage.pageNumbers ?? []).every((page) => extractedPages.has(page)))
    ).map((stage) => stage.id));
    const abortController = new AbortController();
    this.abortController = abortController;
    this.state = { ...this.state, liveGeneration: generation.publicState };

    if (!explicitFullSearch) {
      this.phaseTimer = window.setTimeout(() => {
        this.phaseTimer = null;
        if (this.isCurrentGeneration(generation)) this.patch({ phase: "settling" });
      }, CHEAP_SOURCE_DELAY_MS);
    }

    this.presentationCoordinator.begin({
      canCommitFirst: () => generation.areStagesComplete(cheapStageIds),
      commit: (final) => this.commitGeneration(generation, final)
    });

    void this.executionScheduler.execute({
      stages: plan.stages,
      extractedPages,
      explicitFullSearch,
      signal: abortController.signal,
      runStage: (stage) => this.runStage(generation, stage, abortController.signal)
    }).then(() => {
      if (!this.isCurrentGeneration(generation) || abortController.signal.aborted) return;
      generation.completed = true;
      this.presentationCoordinator.finish();
    }).catch((error) => {
      if (abortController.signal.aborted || !this.isCurrentGeneration(generation)) return;
      generation.addWarning(error instanceof Error ? error.message : "Unable to complete search.");
      generation.completed = true;
      this.presentationCoordinator.finish();
    });
  }

  private async runStage(generation: SearchGeneration, stage: SearchStage, signal: AbortSignal) {
    try {
      const source = this.sources.get(stage.sourceId);
      const request = this.makeRequest(generation, stage);
      if (!source || !request) {
        generation.markStageComplete(stage.id);
        return;
      }
      for await (const batch of source.search(request, signal)) {
        if (!this.isCurrentGeneration(generation) || signal.aborted) return;
        generation.addBatch(batch);
        this.presentationCoordinator.liveChanged();
      }
      generation.markStageComplete(stage.id);
    } catch (error) {
      if (signal.aborted || !this.isCurrentGeneration(generation)) return;
      generation.markStageComplete(stage.id);
      generation.addWarning(error instanceof Error ? error.message : `Unable to search ${stage.sourceId}.`);
      this.presentationCoordinator.liveChanged();
    }
  }

  private makeRequest(generation: SearchGeneration, stage: SearchStage): SearchRequest | null {
    const normalizedQuery = analyzeQuery(generation.query).normalizedQuery;
    const base = { query: generation.query, normalizedQuery, stageId: stage.id };
    if (stage.sourceId === "notes" && this.context.currentNote) {
      return { ...base, sourceId: "notes", note: this.context.currentNote };
    }
    if (stage.sourceId === "document-name") {
      return { ...base, sourceId: "document-name", documents: this.context.documents };
    }
    if (stage.sourceId === "pdf-text" && this.context.pdfPort) {
      return {
        ...base,
        sourceId: "pdf-text",
        pageNumbers: stage.pageNumbers ?? [],
        currentPage: this.context.currentPage,
        nearbyPages: generation.ranking.nearbyPages,
        port: this.context.pdfPort,
        concurrency: 2
      };
    }
    return null;
  }

  private commitGeneration(generation: SearchGeneration, final: boolean) {
    if (!this.isCurrentGeneration(generation)) return;
    const ranked = rankSearchResults(generation.results.values(), generation.ranking);
    const sameQuery = this.state.committedView.query === generation.query;
    const searchesEntireDocument = generation.mode === "full" || generation.mode === "progressive";
    const groups: SearchViewGroup[] = SEARCH_GROUP_DEFINITIONS
      .filter((definition) => supportsGroup(this.context, definition.id))
      .map((definition) => {
        const sortedResults = resultsForGroup(ranked, definition.id);
        const previous = sameQuery
          ? this.state.committedView.groups.find((group) => group.id === definition.id)?.results ?? []
          : [];
        const groupComplete = generation.isGroupComplete(definition.id);
        const allowFinalSort = groupComplete && this.state.selectionOrigin !== "keyboard";
        const results = previous.length > 0 && !allowFinalSort
          ? stabilizeResultOrder(previous, sortedResults)
          : sortedResults;
        const expected = generation.expectedStages.get(definition.id)?.size ?? 0;
        const action = definition.id === "across-document" && this.context.pdfPort && !searchesEntireDocument
          ? { kind: "search-entire-document" as const, label: "Search entire document" }
          : null;
        return {
          id: definition.id,
          label: definition.label,
          results,
          total: results.length,
          countIsFinal: groupComplete,
          state: expected === 0 ? "idle" : groupComplete ? "complete" : "searching",
          truncated: generation.truncatedGroups.has(definition.id),
          action
        };
      });
    const availableIds = new Set(groups.flatMap((group) => group.results.map((result) => result.id)));
    const activeResultId = !this.state.committedView.stale && this.state.activeResultId && availableIds.has(this.state.activeResultId)
      ? this.state.activeResultId
      : groups.flatMap((group) => group.results).find((result) => result.kind !== "document" || result.available)?.id ?? null;
    this.state = {
      ...this.state,
      liveGeneration: generation.publicState,
      committedView: {
        query: generation.query,
        stale: false,
        groups,
        warnings: [...generation.warnings],
        progress: generation.progress
      },
      phase: final || generation.completed ? "complete" : "streaming",
      activeResultId,
      selectionOrigin: this.state.committedView.stale ? null : this.state.selectionOrigin
    };
    this.emit();
  }

  private markCommittedViewStale() {
    this.state = {
      ...this.state,
      committedView: { ...this.state.committedView, stale: true },
      phase: "typing",
      activeResultId: null,
      selectionOrigin: null
    };
    this.emit();
  }

  private isCurrentGeneration(generation: SearchGeneration) {
    return this.state.liveGeneration?.id === generation.id;
  }

  private cancelGeneration() {
    this.generationSequence += 1;
    this.abortController?.abort();
    this.abortController = null;
    if (this.phaseTimer !== null) window.clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.presentationCoordinator.cancel();
    this.currentGeneration = null;
  }

  private patch(patch: Partial<UnifiedSearchState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
