import type { SearchSourceId } from "./SearchRequest";

export type SearchMode = "instant" | "local" | "progressive" | "full" | "broad-query";

export type SearchStage = {
  id: string;
  delayMs: number;
  sourceId: SearchSourceId;
  pageNumbers?: number[];
};

export type SearchRankingPolicy = {
  currentPage: number;
  nearbyPages: ReadonlySet<number>;
};

export type SearchPlan = {
  mode: SearchMode;
  stages: SearchStage[];
  ranking: SearchRankingPolicy;
};

export type SearchPlanningContext = {
  query: string;
  currentPage: number;
  totalPages: number;
  extractedPages: ReadonlySet<number>;
  availableSources: ReadonlySet<SearchSourceId>;
  explicitFullSearch: boolean;
  documentSizeClass: "small" | "medium" | "large";
};

