import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import type { NativeTextPagePayload, PageTextLayerData } from "../types";

const TEXT_NODE_TYPE = 3;
const DEFAULT_ASCENT_RATIO = 0.8;

type TextStyle = {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
};

export type PdfTextRunSnapshot = {
  pageIndex: number;
  text: string;
  span: Node;
  left: number;
  right: number;
  top: number;
  bottom: number;
  baseline: number;
  fontSize: number;
  height: number;
  width: number;
  isNumeric: boolean;
  hasEOL: boolean;
};

export type PdfSelectedTextRunFragment = PdfTextRunSnapshot & {
  selectedEnd: number;
  selectedStart: number;
};

export type PdfRangeLike = {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
};

export type PdfSelectionLike = {
  getRangeAt: (index: number) => PdfRangeLike;
  rangeCount: number;
};

export type NativePdfSelectionLike = {
  anchorIndex: number;
  focusIndex: number;
};

type TextItem = import("pdfjs-dist/types/src/display/api").TextItem;

function isTextItem(
  item: import("pdfjs-dist/types/src/display/api").TextContent["items"][number]
): item is TextItem {
  return "str" in item;
}

function removeNullCharacters(value: string) {
  return value.replace(/\x00/g, "");
}

function getAscentRatio(style: TextStyle | undefined) {
  if (typeof style?.ascent === "number") {
    return style.ascent;
  }
  if (typeof style?.descent === "number") {
    return 1 + style.descent;
  }
  return DEFAULT_ASCENT_RATIO;
}

function isNodeWithinSpan(node: Node | null, span: Node) {
  let current = node;
  while (current) {
    if (current === span) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function getNodeTextLength(node: Node | null) {
  if (!node) {
    return 0;
  }
  if (node.nodeType === TEXT_NODE_TYPE) {
    return node.textContent?.length ?? 0;
  }

  let total = 0;
  for (const child of Array.from(node.childNodes ?? [])) {
    total += getNodeTextLength(child);
  }
  return total;
}

function getOffsetWithinAncestor(ancestor: Node, container: Node, offset: number): number {
  if (ancestor === container) {
    if (ancestor.nodeType === TEXT_NODE_TYPE) {
      return Math.max(0, Math.min(offset, ancestor.textContent?.length ?? 0));
    }

    let total = 0;
    const childNodes = Array.from(ancestor.childNodes ?? []);
    for (let index = 0; index < Math.max(0, Math.min(offset, childNodes.length)); index += 1) {
      total += getNodeTextLength(childNodes[index] ?? null);
    }
    return total;
  }

  let total = 0;
  for (const child of Array.from(ancestor.childNodes ?? [])) {
    if (child === container || isNodeWithinSpan(container, child)) {
      return total + getOffsetWithinAncestor(child, container, offset);
    }
    total += getNodeTextLength(child);
  }

  return total;
}

function isNodeWithinAncestor(node: Node | null, ancestor: Node) {
  let current = node;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function findRunIndexForSubtree(
  runs: readonly PdfTextRunSnapshot[],
  node: Node | null,
  direction: "start" | "end"
) {
  if (!node) {
    return -1;
  }

  if (direction === "start") {
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (
        run &&
        (isNodeWithinSpan(node, run.span) || isNodeWithinAncestor(run.span, node))
      ) {
        return index;
      }
    }
    return -1;
  }

  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (
      run &&
      (isNodeWithinSpan(node, run.span) || isNodeWithinAncestor(run.span, node))
    ) {
      return index;
    }
  }
  return -1;
}

function resolveBoundaryRunIndex(
  runs: readonly PdfTextRunSnapshot[],
  container: Node,
  offset: number,
  direction: "start" | "end"
) {
  const directIndex = runs.findIndex((run) => isNodeWithinSpan(container, run.span));
  if (directIndex !== -1) {
    return directIndex;
  }

  const childNodes = Array.from(container.childNodes ?? []);
  if (direction === "start") {
    const startOffset = Math.max(0, Math.min(offset, childNodes.length));
    for (let index = startOffset; index < childNodes.length; index += 1) {
      const childIndex = findRunIndexForSubtree(runs, childNodes[index] ?? null, "start");
      if (childIndex !== -1) {
        return childIndex;
      }
    }
  } else {
    const endOffset = Math.max(0, Math.min(offset, childNodes.length));
    for (let index = endOffset - 1; index >= 0; index -= 1) {
      const childIndex = findRunIndexForSubtree(runs, childNodes[index] ?? null, "end");
      if (childIndex !== -1) {
        return childIndex;
      }
    }
  }

  return findRunIndexForSubtree(runs, container, direction);
}

function compareNumbers(left: number, right: number) {
  return left - right;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort(compareNumbers);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? 0;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function joinTextWithSeparator(left: string, right: string, separator: string) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (/\s$/.test(left) || /^\s/.test(right) || separator === "") {
    return left + right;
  }
  return left + separator + right;
}

function shouldMergeSoftHyphen(left: string, right: string) {
  return /[A-Za-z]-$/.test(left) && /^[A-Za-z]/.test(right);
}

function shouldAddInlineSpace(
  previous: PdfSelectedTextRunFragment,
  current: PdfSelectedTextRunFragment
) {
  if (!previous.text || !current.text) {
    return false;
  }
  if (/\s$/.test(previous.text) || /^\s/.test(current.text)) {
    return false;
  }
  if (/^[,.;:!?%)\]\}]/.test(current.text)) {
    return false;
  }
  if (/[(\[\{'"\u2018\u201C]$/.test(previous.text)) {
    return false;
  }

  const gap = current.left - previous.right;
  const threshold = Math.max(0.5, Math.min(previous.fontSize, current.fontSize) * 0.12);
  return gap > threshold;
}

function isSuperscriptFootnote(
  previous: PdfSelectedTextRunFragment | null,
  current: PdfSelectedTextRunFragment
) {
  if (!previous || !current.text || !current.isNumeric) {
    return false;
  }

  const baselineLiftThreshold = Math.max(0.5, previous.fontSize * 0.12);
  if (current.baseline > previous.baseline - baselineLiftThreshold) {
    return false;
  }

  const gap = current.left - previous.right;
  if (gap > previous.fontSize * 0.3) {
    return false;
  }

  const isNearBodySize = current.fontSize <= previous.fontSize * 1.02;
  const isSmaller = current.fontSize <= previous.fontSize * 0.82;
  if (!isNearBodySize && !isSmaller) {
    return false;
  }

  return /[\p{L}\p{N}\]\)\}'"\u2019\u201D.,;:!?]$/u.test(previous.text);
}

function cloneFragment(
  fragment: PdfSelectedTextRunFragment,
  overrides: Partial<PdfSelectedTextRunFragment> = {}
): PdfSelectedTextRunFragment {
  return {
    ...fragment,
    ...overrides
  };
}

type LineGroup = {
  baseline: number;
  bottom: number;
  fontSize: number;
  fragments: PdfSelectedTextRunFragment[];
  left: number;
  right: number;
  top: number;
};

function groupFragmentsIntoLines(fragments: PdfSelectedTextRunFragment[]) {
  const lines: LineGroup[] = [];

  for (const fragment of fragments) {
    const currentLine = lines[lines.length - 1];
    if (!currentLine) {
      lines.push({
        baseline: fragment.baseline,
        bottom: fragment.bottom,
        fontSize: fragment.fontSize,
        fragments: [fragment],
        left: fragment.left,
        right: fragment.right,
        top: fragment.top
      });
      continue;
    }

    const tolerance = Math.max(0.5, Math.min(currentLine.fontSize, fragment.fontSize) * 0.35);
    if (Math.abs(fragment.baseline - currentLine.baseline) <= tolerance) {
      currentLine.fragments.push(fragment);
      currentLine.baseline = (currentLine.baseline + fragment.baseline) / 2;
      currentLine.bottom = Math.max(currentLine.bottom, fragment.bottom);
      currentLine.fontSize = median([
        currentLine.fontSize,
        fragment.fontSize
      ]);
      currentLine.left = Math.min(currentLine.left, fragment.left);
      currentLine.right = Math.max(currentLine.right, fragment.right);
      currentLine.top = Math.min(currentLine.top, fragment.top);
      continue;
    }

    lines.push({
      baseline: fragment.baseline,
      bottom: fragment.bottom,
      fontSize: fragment.fontSize,
      fragments: [fragment],
      left: fragment.left,
      right: fragment.right,
      top: fragment.top
    });
  }

  return lines;
}

function hasSuspiciousLayout(lines: LineGroup[]) {
  if (lines.length < 2) {
    return false;
  }

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const tolerance = Math.max(0.5, Math.min(previous?.fontSize ?? 0, current?.fontSize ?? 0) * 0.35);
    if ((current?.top ?? 0) < (previous?.top ?? 0) - tolerance) {
      return true;
    }
  }

  return false;
}

function normalizeLineFragments(line: LineGroup) {
  const fragments = [...line.fragments]
    .filter((fragment) => fragment.text.length > 0)
    .sort((left, right) => {
      if (Math.abs(left.left - right.left) > 0.01) {
        return left.left - right.left;
      }
      return left.pageIndex - right.pageIndex;
    })
    .map((fragment) => cloneFragment(fragment, { text: sanitizePdfCopiedText(fragment.text) }));

  if (fragments.length === 0) {
    return {
      ...line,
      fragments,
      text: ""
    };
  }

  const rewrittenFragments: PdfSelectedTextRunFragment[] = [];
  for (const fragment of fragments) {
    const previous =
      rewrittenFragments.length > 0
        ? rewrittenFragments[rewrittenFragments.length - 1] ?? null
        : null;
    if (isSuperscriptFootnote(previous, fragment)) {
      rewrittenFragments.push(cloneFragment(fragment, { text: `[${fragment.text}]` }));
      continue;
    }
    rewrittenFragments.push(fragment);
  }

  let text = "";
  for (const fragment of rewrittenFragments) {
    const previous = rewrittenFragments[rewrittenFragments.indexOf(fragment) - 1];
    if (!previous) {
      text = fragment.text;
      continue;
    }

    const separator = shouldAddInlineSpace(previous, fragment) ? " " : "";
    text = joinTextWithSeparator(text, fragment.text, separator);
  }

  return {
    ...line,
    fragments: rewrittenFragments,
    text: text.trim()
  };
}

export function sanitizePdfCopiedText(value: string) {
  return removeNullCharacters(pdfjsLib.normalizeUnicode(value));
}

function quadBounds(quad: NativeTextPagePayload["chars"][number]["quad"]) {
  const xs = [quad.ul.x, quad.ur.x, quad.ll.x, quad.lr.x];
  const ys = [quad.ul.y, quad.ur.y, quad.ll.y, quad.lr.y];
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys)
  };
}

function shouldSplitNativeFragment(
  currentText: string,
  previousChar: NativeTextPagePayload["chars"][number] | null,
  previousBounds: ReturnType<typeof quadBounds> | null,
  nextChar: NativeTextPagePayload["chars"][number],
  nextBounds: ReturnType<typeof quadBounds>
) {
  if (!currentText) {
    return false;
  }

  if (/\s$/.test(currentText) || /^\s/.test(nextChar.text)) {
    return true;
  }

  if (!previousChar || !previousBounds) {
    return false;
  }

  if (previousChar.lineIndex !== nextChar.lineIndex) {
    return true;
  }

  const previousBaseline = average([previousChar.quad.ll.y, previousChar.quad.lr.y]);
  const nextBaseline = average([nextChar.quad.ll.y, nextChar.quad.lr.y]);
  const baselineDelta = Math.abs(nextBaseline - previousBaseline);
  const baselineThreshold = Math.max(0.5, Math.min(previousChar.size, nextChar.size) * 0.18);
  if (baselineDelta > baselineThreshold) {
    return true;
  }

  const sizeDelta = Math.abs(nextChar.size - previousChar.size);
  const sizeThreshold = Math.max(0.5, Math.min(previousChar.size, nextChar.size) * 0.12);
  if (sizeDelta > sizeThreshold) {
    return true;
  }

  const gap = nextBounds.left - previousBounds.right;
  const gapThreshold = Math.max(0.5, Math.min(previousChar.size, nextChar.size) * 0.18);
  if (gap > gapThreshold) {
    return true;
  }

  const numericTransition =
    /^\d+$/.test(nextChar.text) !== /^\d+$/.test(previousChar.text) &&
    gap >= -Math.max(0.5, Math.min(previousChar.size, nextChar.size) * 0.05);
  if (numericTransition && baselineDelta > baselineThreshold * 0.75) {
    return true;
  }

  return false;
}

export function buildNativeSelectedRunFragments(
  textLayer: NativeTextPagePayload,
  selection: NativePdfSelectionLike | null | undefined
) {
  if (!selection || textLayer.chars.length === 0) {
    return [];
  }

  const start = Math.max(0, Math.min(selection.anchorIndex, selection.focusIndex));
  const end = Math.min(
    textLayer.chars.length - 1,
    Math.max(selection.anchorIndex, selection.focusIndex)
  );
  if (end < start) {
    return [];
  }

  const fragments: PdfSelectedTextRunFragment[] = [];
  let fragmentChars: NativeTextPagePayload["chars"] = [];
  let fragmentBounds: Array<ReturnType<typeof quadBounds>> = [];

  const flushFragment = () => {
    if (fragmentChars.length === 0) {
      return;
    }

    const text = fragmentChars.map((char) => char.text).join("");
    const bounds = {
      left: Math.min(...fragmentBounds.map((bound) => bound.left)),
      right: Math.max(...fragmentBounds.map((bound) => bound.right)),
      top: Math.min(...fragmentBounds.map((bound) => bound.top)),
      bottom: Math.max(...fragmentBounds.map((bound) => bound.bottom))
    };
    const baselines = fragmentChars.map((char) => average([char.quad.ll.y, char.quad.lr.y]));
    const sizes = fragmentChars.map((char) => char.size);
    const span = {
      nodeType: 1,
      textContent: text,
      parentNode: null,
      childNodes: []
    } as unknown as Node;

    fragments.push({
      pageIndex: fragments.length,
      text,
      span,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      baseline: average(baselines),
      fontSize: average(sizes),
      height: Math.max(...fragmentBounds.map((bound) => bound.bottom - bound.top)),
      width: bounds.right - bounds.left,
      isNumeric: /^\d+$/.test(text),
      hasEOL: false,
      selectedStart: 0,
      selectedEnd: text.length
    });

    fragmentChars = [];
    fragmentBounds = [];
  };

  for (let index = start; index <= end; index += 1) {
    const char = textLayer.chars[index];
    if (!char) {
      flushFragment();
      continue;
    }

    const bounds = quadBounds(char.quad);
    const previousChar = fragmentChars[fragmentChars.length - 1] ?? null;
    const previousBounds = fragmentBounds[fragmentBounds.length - 1] ?? null;
    if (
      previousChar &&
      shouldSplitNativeFragment(
        fragmentChars.map((item) => item.text).join(""),
        previousChar,
        previousBounds,
        char,
        bounds
      )
    ) {
      flushFragment();
    }

    fragmentChars.push(char);
    fragmentBounds.push(bounds);
  }

  flushFragment();
  return fragments;
}

export function buildPageTextRunSnapshots(
  textLayer: PageTextLayerData,
  textDivs: readonly Node[]
) {
  const textItems = textLayer.textContent.items.filter(isTextItem);
  const {
    pageHeight,
    pageX,
    pageY
  } = textLayer.viewportRawDims;
  const transform = [1, 0, 0, -1, -pageX, pageY + pageHeight] as const;

  const runs: PdfTextRunSnapshot[] = [];
  for (let index = 0; index < Math.min(textItems.length, textDivs.length); index += 1) {
    const item = textItems[index];
    const span = textDivs[index];
    if (!item || !span || item.str.length === 0) {
      continue;
    }

    const style = textLayer.textContent.styles[item.fontName] as TextStyle | undefined;
    const tx = pdfjsLib.Util.transform(transform, item.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    if (style?.vertical) {
      angle += Math.PI / 2;
    }

    const fontSize = Math.hypot(tx[2], tx[3]);
    const fontAscent = fontSize * getAscentRatio(style);
    const left = angle === 0 ? tx[4] : tx[4] + fontAscent * Math.sin(angle);
    const top = angle === 0 ? tx[5] - fontAscent : tx[5] - fontAscent * Math.cos(angle);
    const width = Math.max(style?.vertical ? item.height : item.width, 0);

    runs.push({
      pageIndex: index,
      text: item.str,
      span,
      left,
      right: left + width,
      top,
      bottom: top + fontSize,
      baseline: top + fontAscent,
      fontSize,
      height: fontSize,
      width,
      isNumeric: /^\d+$/.test(item.str),
      hasEOL: item.hasEOL
    });
  }

  return runs;
}

export function extractSelectedRunFragments(
  selection: PdfSelectionLike | null | undefined,
  runs: readonly PdfTextRunSnapshot[]
) {
  if (!selection || selection.rangeCount === 0 || runs.length === 0) {
    return [];
  }

  const fragments: PdfSelectedTextRunFragment[] = [];
  for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
    const range = selection.getRangeAt(rangeIndex);
    const startIndex = resolveBoundaryRunIndex(
      runs,
      range.startContainer,
      range.startOffset,
      "start"
    );
    const endIndex = resolveBoundaryRunIndex(
      runs,
      range.endContainer,
      range.endOffset,
      "end"
    );
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      continue;
    }

    for (let runIndex = startIndex; runIndex <= endIndex; runIndex += 1) {
      const run = runs[runIndex];
      if (!run) {
        continue;
      }

      const startOffset =
        runIndex === startIndex
          ? isNodeWithinSpan(range.startContainer, run.span)
            ? getOffsetWithinAncestor(run.span, range.startContainer, range.startOffset)
            : 0
          : 0;
      const endOffset =
        runIndex === endIndex
          ? isNodeWithinSpan(range.endContainer, run.span)
            ? getOffsetWithinAncestor(run.span, range.endContainer, range.endOffset)
            : run.text.length
          : run.text.length;
      const selectedStart = Math.max(0, Math.min(startOffset, run.text.length));
      const selectedEnd = Math.max(selectedStart, Math.min(endOffset, run.text.length));
      const text = run.text.slice(selectedStart, selectedEnd);
      if (!text) {
        continue;
      }

      fragments.push({
        ...run,
        selectedEnd,
        selectedStart,
        text
      });
    }
  }

  return fragments;
}

export function normalizeSelectedRunFragments(fragments: readonly PdfSelectedTextRunFragment[]) {
  const selectedFragments = fragments
    .map((fragment) => cloneFragment(fragment, { text: sanitizePdfCopiedText(fragment.text) }))
    .filter((fragment) => fragment.text.length > 0);
  if (selectedFragments.length === 0) {
    return "";
  }

  const lines = groupFragmentsIntoLines(selectedFragments).map(normalizeLineFragments);
  const suspiciousLayout = hasSuspiciousLayout(lines);
  const lineGaps: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (!previous || !current) {
      continue;
    }
    lineGaps.push(Math.max(0, current.top - previous.top));
  }
  const medianLineGap = median(lineGaps);

  let output = "";
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    if (!current?.text) {
      continue;
    }

    if (!output) {
      output = current.text;
      continue;
    }

    if (shouldMergeSoftHyphen(output, current.text)) {
      output = output.slice(0, -1) + current.text;
      continue;
    }

    if (suspiciousLayout) {
      output += `\n${current.text}`;
      continue;
    }

    const previous = lines[index - 1];
    const gap = previous ? Math.max(0, current.top - previous.top) : 0;
    const paragraphThreshold = Math.max(
      medianLineGap * 1.6,
      medianLineGap + (previous?.fontSize ?? current.fontSize) * 0.5
    );
    if (previous && gap > paragraphThreshold && medianLineGap > 0) {
      output += `\n\n${current.text}`;
      continue;
    }

    output = joinTextWithSeparator(output, current.text, " ");
  }

  return output.trim();
}
