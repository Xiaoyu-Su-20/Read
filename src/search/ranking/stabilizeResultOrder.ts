import type { SearchResult } from "../model/SearchResult";

export function stabilizeResultOrder(
  previous: readonly SearchResult[],
  next: readonly SearchResult[]
) {
  const nextById = new Map(next.map((result) => [result.id, result]));
  const stable = previous.flatMap((result) => {
    const replacement = nextById.get(result.id);
    if (!replacement) return [];
    nextById.delete(result.id);
    return [replacement];
  });
  return [...stable, ...next.filter((result) => nextById.has(result.id))];
}

