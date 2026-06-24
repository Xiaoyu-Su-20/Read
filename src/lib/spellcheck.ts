const WORD_PATTERN = /[\p{L}\p{N}](?:[\p{L}\p{N}'’_-]*[\p{L}\p{N}])?|[\p{L}\p{N}]/gu;

function trimSpellcheckWord(value: string) {
  return value.trim();
}

export function canonicalSpellcheckWord(value: string) {
  return trimSpellcheckWord(value).toLocaleLowerCase();
}

export function extractStandaloneSpellcheckWord(value: string) {
  const trimmed = trimSpellcheckWord(value);
  if (trimmed.length === 0) {
    return null;
  }

  WORD_PATTERN.lastIndex = 0;
  const matches = Array.from(trimmed.matchAll(WORD_PATTERN));
  if (matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  if (!match || match.index !== 0 || match[0].length !== trimmed.length) {
    return null;
  }

  return match[0];
}

export function findSpellcheckWordRange(text: string, offset: number) {
  if (!text.length) {
    return null;
  }

  const safeOffset = Math.max(0, Math.min(offset, text.length));
  WORD_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0];
    const start = match.index ?? 0;
    const end = start + word.length;
    const hitsWord =
      (safeOffset >= start && safeOffset < end) ||
      (safeOffset === text.length && end === text.length) ||
      (safeOffset === end && end > start);
    if (!hitsWord) {
      continue;
    }

    return {
      word,
      start,
      end
    };
  }

  return null;
}

export function normalizeIgnoredSpellcheckWords(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") {
      continue;
    }

    const word = extractStandaloneSpellcheckWord(candidate);
    if (!word) {
      continue;
    }

    const canonical = canonicalSpellcheckWord(word);
    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    normalized.push(canonical);
  }

  return normalized;
}
