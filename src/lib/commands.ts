import type { Bookmark, DocumentRecord, PaletteItem } from "./types";

export function filterPaletteItems(items: PaletteItem[], query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return items;
  }

  return items.filter((item) => {
    const haystack = [
      item.title,
      item.subtitle ?? "",
      item.meta ?? "",
      ...(item.keywords ?? [])
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function sortRecentDocuments(documents: DocumentRecord[]) {
  return [...documents].sort((left, right) =>
    (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? "")
  );
}

export function findBookmarkAtPage(bookmarks: Bookmark[], page: number) {
  return bookmarks.find((bookmark) => bookmark.page === page) ?? null;
}

export function dedupeBookmarks(bookmarks: Bookmark[]) {
  const seenPages = new Set<number>();
  const result: Bookmark[] = [];

  for (const bookmark of bookmarks) {
    if (seenPages.has(bookmark.page)) {
      continue;
    }
    seenPages.add(bookmark.page);
    result.push(bookmark);
  }

  return result;
}

export function formatShortcut(shortcut: string[]) {
  return shortcut.join(" ");
}
