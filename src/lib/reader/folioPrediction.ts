import type { NativeTextLine, NativeTextPagePayload } from "../types";

export type FolioPrediction = {
  label: string;
  confidence: "high" | "medium";
};

export type FolioPredictionEvidence = {
  candidateCount: number;
  location: "bottom" | "top";
  score: number;
};

type ScoredCandidate = {
  label: string;
  location: "bottom" | "top";
  score: number;
};

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const BOTTOM_MARGIN_START = 0.86;
const TOP_MARGIN_END = 0.1;
const HIGH_CONFIDENCE_SCORE = 0.8;
const MEDIUM_CONFIDENCE_SCORE = 0.65;

function lineCenter(line: NativeTextLine) {
  return {
    x: (line.bounds.x0 + line.bounds.x1) / 2,
    y: (line.bounds.y0 + line.bounds.y1) / 2
  };
}

function alignmentScore(centerX: number, pageWidth: number) {
  if (pageWidth <= 0) return 0;
  const relativeX = centerX / pageWidth;
  const distanceFromCenter = Math.abs(relativeX - 0.5);
  if (distanceFromCenter <= 0.13) return 0.34;
  if (relativeX <= 0.24 || relativeX >= 0.76) return 0.27;
  return 0;
}

function isolationScore(line: NativeTextLine, page: NativeTextPagePayload) {
  const { y } = lineCenter(line);
  const nearestLineDistance = page.lines
    .filter((candidate) => candidate.index !== line.index)
    .map((candidate) => Math.abs(lineCenter(candidate).y - y))
    .reduce((nearest, distance) => Math.min(nearest, distance), Number.POSITIVE_INFINITY);
  return nearestLineDistance >= page.sourceHeight * 0.025 ? 0.18 : 0.08;
}

/**
 * Finds a printed Arabic page number (folio) in a PDF page's outer margin.
 * This is deliberately conservative: callers should fall back to the PDF page
 * number whenever it returns null.
 */
export function predictFolio(page: NativeTextPagePayload): {
  prediction: FolioPrediction | null;
  evidence: FolioPredictionEvidence | null;
} {
  if (page.sourceWidth <= 0 || page.sourceHeight <= 0) {
    return { prediction: null, evidence: null };
  }

  const candidates: ScoredCandidate[] = page.lines.flatMap((line) => {
    const label = line.text.trim();
    if (!POSITIVE_INTEGER.test(label)) return [];

    const center = lineCenter(line);
    const relativeY = center.y / page.sourceHeight;
    const location = relativeY >= BOTTOM_MARGIN_START ? "bottom" : relativeY <= TOP_MARGIN_END ? "top" : null;
    if (!location) return [];

    const score =
      (location === "bottom" ? 0.5 : 0.36) +
      alignmentScore(center.x, page.sourceWidth) +
      isolationScore(line, page);
    return [{ label, location, score }];
  });

  const ranked = candidates.sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < MEDIUM_CONFIDENCE_SCORE) {
    return { prediction: null, evidence: null };
  }

  const second = ranked[1];
  // Two similarly plausible, differently numbered folios are ambiguous.
  if (second && second.label !== best.label && best.score - second.score < 0.05) {
    return { prediction: null, evidence: null };
  }

  return {
    prediction: {
      label: best.label,
      confidence: best.score >= HIGH_CONFIDENCE_SCORE ? "high" : "medium"
    },
    evidence: {
      candidateCount: candidates.length,
      location: best.location,
      score: best.score
    }
  };
}
