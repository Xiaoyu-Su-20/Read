import { noteBlockText } from "../../lib/notes";
import type { SearchSource } from "../model/SearchResult";
import { findMatchIndexes, makeSnippet } from "./searchText";

export const notesSearch: SearchSource = {
  id: "notes",
  async *search(request, signal) {
    if (request.sourceId !== "notes") return;
    const results = [];
    const titleIndex = request.note.title.toLocaleLowerCase().indexOf(request.normalizedQuery);
    if (titleIndex >= 0) {
      const preview = makeSnippet(request.note.title, titleIndex, request.normalizedQuery.length);
      if (preview) {
        results.push({
          id: `note:${request.note.id}:title`,
          kind: "note" as const,
          sourceId: "notes" as const,
          title: request.note.title,
          noteId: request.note.id,
          blockId: request.note.blocks[0]?.id ?? "",
          ...preview
        });
      }
    }
    for (const block of request.note.blocks) {
      if (signal.aborted || results.length >= 51) break;
      const text = noteBlockText(block);
      const matchIndex = findMatchIndexes(text, request.normalizedQuery, 1)[0];
      if (matchIndex === undefined) continue;
      const preview = makeSnippet(text, matchIndex, request.normalizedQuery.length);
      if (!preview) continue;
      results.push({
        id: `note:${request.note.id}:${block.id}`,
        kind: "note" as const,
        sourceId: "notes" as const,
        title: request.note.title,
        noteId: request.note.id,
        blockId: block.id,
        ...preview
      });
    }
    if (!signal.aborted) {
      yield { sourceId: "notes", stageId: request.stageId, results, completed: true };
    }
  }
};
