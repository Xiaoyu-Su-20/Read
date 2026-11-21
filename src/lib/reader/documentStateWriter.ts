let lastWriterGeneration = 0;

export function createDocumentStateWriterGeneration() {
  const timeFloor = Date.now() * 1_000;
  lastWriterGeneration = Math.max(lastWriterGeneration + 1, timeFloor);
  return lastWriterGeneration;
}

export function isStaleDocumentStateWriterError(error: unknown) {
  return String(error).includes("Stale document state save skipped");
}
