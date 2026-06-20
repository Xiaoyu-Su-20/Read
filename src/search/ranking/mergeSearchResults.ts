import type { SearchResult, SearchResultGroup } from "../model/SearchResult";
import type { SearchRankingPolicy } from "../model/SearchPlan";

const GROUP_LIMITS = {
  notes: 50,
  "nearby-page": 200,
  "across-document": 200,
  "pdf-names": 50
} as const;

export const SEARCH_GROUP_DEFINITIONS = [
  { id: "notes" as const, label: "Notes", matches: (r: SearchResult) => r.kind === "note" },
  {
    id: "nearby-page" as const,
    label: "Doc · Near",
    matches: (r: SearchResult) =>
      r.kind === "pdf" && (r.location === "current" || r.location === "nearby")
  },
  {
    id: "across-document" as const,
    label: "Doc · Far",
    matches: (r: SearchResult) => r.kind === "pdf" && r.location === "across"
  },
  {
    id: "pdf-names" as const,
    label: "PDF Names",
    matches: (r: SearchResult) => r.kind === "document"
  }
] as const;

export function rankSearchResults(results: Iterable<SearchResult>, policy: SearchRankingPolicy) {
  const unique = new Map<string, SearchResult>();
  for (const result of results) unique.set(result.id, result);
  return [...unique.values()].sort((left, right) => {
    const tier = (result: SearchResult) => {
      if (result.kind === "note") return 0;
      if (result.kind === "pdf" && result.pageNumber === policy.currentPage) return 1;
      if (result.kind === "pdf" && policy.nearbyPages.has(result.pageNumber)) return 2;
      if (result.kind === "document") return 3;
      return 4;
    };
    const tierDifference = tier(left) - tier(right);
    if (tierDifference) return tierDifference;
    if (left.kind === "pdf" && right.kind === "pdf") {
      return left.pageNumber - right.pageNumber || left.matchIndex - right.matchIndex;
    }
    return left.title.localeCompare(right.title);
  });
}

export function groupSearchResults(results: SearchResult[]): SearchResultGroup[] {
  return SEARCH_GROUP_DEFINITIONS.map((definition) => {
    const matching = results.filter(definition.matches);
    const limit = GROUP_LIMITS[definition.id];
    return {
      id: definition.id,
      label: definition.label,
      results: matching.slice(0, limit),
      total: matching.length,
      truncated: matching.length > limit
    };
  }).filter((group) => group.total > 0);
}

export function resultsForGroup(results: readonly SearchResult[], groupId: SearchResultGroup["id"]) {
  const definition = SEARCH_GROUP_DEFINITIONS.find((candidate) => candidate.id === groupId);
  return definition ? results.filter(definition.matches).slice(0, GROUP_LIMITS[groupId]) : [];
}
