import type { CSSProperties } from "react";

import type { ParagraphTopic, TopicColorRole } from "./types";

export const TOPIC_COLOR_ROLES = [
  "accent",
  "interactive",
  "accentSoft",
  "interactiveSoft",
  "neutral",
  "emphasis"
] as const satisfies readonly TopicColorRole[];

export const DEFAULT_TOPIC_COLOR: TopicColorRole = "accent";
export const MAX_TOPIC_LENGTH = 80;

export const topicColorRoleLabels: Record<TopicColorRole, string> = {
  accent: "Theme accent",
  interactive: "Theme interactive",
  accentSoft: "Soft accent",
  interactiveSoft: "Soft interactive",
  neutral: "Neutral",
  emphasis: "Emphasis"
};

const LEGACY_TOPIC_COLOR_MAP: Record<string, TopicColorRole> = {
  blue: "interactive",
  green: "interactiveSoft",
  amber: "accent",
  rose: "emphasis",
  violet: "accentSoft",
  slate: "neutral"
};

function normalizeTopicColorRole(value: string | null | undefined): TopicColorRole {
  if (!value) {
    return DEFAULT_TOPIC_COLOR;
  }

  if (TOPIC_COLOR_ROLES.includes(value as TopicColorRole)) {
    return value as TopicColorRole;
  }

  return LEGACY_TOPIC_COLOR_MAP[value] ?? DEFAULT_TOPIC_COLOR;
}

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

  const color = normalizeTopicColorRole(topic.color);

  return {
    id: topic.id || crypto.randomUUID(),
    text,
    color
  };
}

export function normalizeParagraphTopics(topics: ParagraphTopic[] | null | undefined) {
  const normalized: ParagraphTopic[] = [];

  for (const topic of topics ?? []) {
    const nextTopic = normalizeParagraphTopic(topic);
    if (!nextTopic) {
      continue;
    }
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

export function resolveTopicAppearance(
  color: TopicColorRole
): CSSProperties & Record<`--${string}`, string> {
  const role = normalizeTopicColorRole(color);
  const suffix = role.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

  return {
    "--topic-bg": `var(--topic-role-${suffix}-bg)`,
    "--topic-border": `var(--topic-role-${suffix}-border)`,
    "--topic-text": `var(--topic-role-${suffix}-text)`,
    "--topic-hover-bg": `var(--topic-role-${suffix}-hover-bg)`,
    "--topic-hover-border": `var(--topic-role-${suffix}-hover-border)`,
    "--topic-focus": `var(--topic-role-${suffix}-focus)`,
    "--topic-ring": `var(--topic-role-${suffix}-ring)`,
    "--topic-swatch": `var(--topic-role-${suffix}-swatch)`
  };
}
