import type { SearchGroupId, SearchResult } from "./SearchResult";

export type SearchViewGroupAction = {
  kind: "search-entire-document";
  label: string;
};

export type SearchViewGroup = {
  id: SearchGroupId;
  label: string;
  results: readonly SearchResult[];
  total: number;
  countIsFinal: boolean;
  state: "idle" | "searching" | "complete";
  truncated: boolean;
  action: SearchViewGroupAction | null;
};

export type SearchViewSnapshot = {
  query: string;
  stale: boolean;
  groups: readonly SearchViewGroup[];
  warnings: readonly string[];
  progress: {
    completedPages: number;
    totalPages: number;
  } | null;
};

