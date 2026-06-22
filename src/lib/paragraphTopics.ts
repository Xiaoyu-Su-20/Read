import type { CSSProperties } from "react";

import type { InteractiveColorKey, ParagraphTopic } from "./types";

export const INTERACTIVE_COLOR_KEYS = [
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
  "slate"
] as const satisfies readonly InteractiveColorKey[];

export const DEFAULT_TOPIC_COLOR: InteractiveColorKey = "blue";
export const MAX_TOPIC_LENGTH = 80;

export const interactiveColorLabels: Record<InteractiveColorKey, string> = {
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  violet: "Violet",
  slate: "Slate"
};

const INTERACTIVE_COLOR_BASES: Record<InteractiveColorKey, string> = {
  blue: "#5d81e6",
  green: "#5d9a74",
  amber: "#c38a45",
  rose: "#c96f87",
  violet: "#8a72cb",
  slate: "#7f8999"
};

export function normalizeTopicText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeParagraphTopic(
  topic: ParagraphTopic | null | undefined
): ParagraphTopic | null {
  if (!topic) {
    return null;
  }

  const text = normalizeTopicText(topic.text);
  if (!text) {
    return null;
  }

  const color = INTERACTIVE_COLOR_KEYS.includes(topic.color)
    ? topic.color
    : DEFAULT_TOPIC_COLOR;

  return {
    id: topic.id || crypto.randomUUID(),
    text,
    color
  };
}

export function normalizeParagraphTopics(topics: ParagraphTopic[] | null | undefined) {
  const normalized: ParagraphTopic[] = [];
  const seenIds = new Set<string>();

  for (const topic of topics ?? []) {
    const nextTopic = normalizeParagraphTopic(topic);
    if (!nextTopic) {
      continue;
    }

    if (seenIds.has(nextTopic.id)) {
      const nextId = crypto.randomUUID();
      seenIds.add(nextId);
      normalized.push({
        ...nextTopic,
        id: nextId
      });
      continue;
    }

    seenIds.add(nextTopic.id);
    normalized.push(nextTopic);
  }

  return normalized;
}

export function topicPlainText(topic: ParagraphTopic) {
  return `[${normalizeTopicText(topic.text)}]`;
}

export function paragraphTopicsPlainText(topics: ParagraphTopic[]) {
  const normalized = normalizeParagraphTopics(topics);
  return normalized.map(topicPlainText).join(" ");
}

export function paragraphTopicsMarkdown(topics: ParagraphTopic[]) {
  const normalized = normalizeParagraphTopics(topics);
  return normalized.map((topic) => `**${normalizeTopicText(topic.text)}:**`).join(" ");
}

export function topicBaseColor(color: InteractiveColorKey) {
  return INTERACTIVE_COLOR_BASES[color];
}

export function resolveTopicAppearance(
  color: InteractiveColorKey
): CSSProperties & Record<`--${string}`, string> {
  const base = topicBaseColor(color);

  return {
    "--topic-base": base,
    "--topic-bg": `color-mix(in srgb, ${base} 18%, transparent)`,
    "--topic-border": `color-mix(in srgb, ${base} 30%, transparent)`,
    "--topic-text": `color-mix(in srgb, ${base} 56%, var(--text-primary))`,
    "--topic-hover-bg": `color-mix(in srgb, ${base} 24%, transparent)`,
    "--topic-hover-border": `color-mix(in srgb, ${base} 36%, transparent)`,
    "--topic-focus": `color-mix(in srgb, ${base} 34%, transparent)`,
    "--topic-ring": `color-mix(in srgb, ${base} 54%, var(--focus-ring))`
  };
}
