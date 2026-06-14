export const SEARCH_MANIFEST = {
  notes: {
    cost: "instant",
    minimumCharacters: 1,
    defaultPriority: 100,
    canStreamResults: false
  },
  documentName: {
    cost: "low",
    minimumCharacters: 2,
    defaultPriority: 80,
    canStreamResults: false
  },
  pdfText: {
    cost: "high",
    minimumCharacters: 2,
    defaultPriority: 60,
    canStreamResults: true
  }
} as const;

