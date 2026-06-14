const COMMON_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
  "it", "of", "on", "or", "that", "the", "this", "to", "was", "with"
]);

export type QueryAnalysis = {
  normalizedQuery: string;
  tokens: string[];
  meaningfulTokens: string[];
  isCommonTerm: boolean;
};

export function analyzeQuery(query: string): QueryAnalysis {
  const normalizedQuery = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];
  const meaningfulTokens = tokens.filter((token) => !COMMON_STOPWORDS.has(token));
  return {
    normalizedQuery,
    tokens,
    meaningfulTokens,
    isCommonTerm: tokens.length === 1 && COMMON_STOPWORDS.has(tokens[0] ?? "")
  };
}

