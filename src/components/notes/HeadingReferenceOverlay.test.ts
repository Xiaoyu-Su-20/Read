import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import HeadingReferenceOverlay from "./HeadingReferenceOverlay";
import type { HeadingReferenceDecoration } from "./headingReferenceDecorations";

const decorations: HeadingReferenceDecoration[] = [
  {
    blockId: "heading-1",
    blockType: "heading1",
    reference: {
      id: "ref-1",
      documentId: "doc-1",
      kind: "direct",
      outlineItemId: null,
      outlineSource: null,
      title: "Chapter 1",
      target: {
        documentId: "doc-1",
        pageIndex: 14
      },
      createdAt: "2026-06-20T00:00:00Z"
    },
    left: 144,
    top: 82
  }
];

function collectElements(node: unknown): Array<ReactElement<{ [key: string]: unknown }>> {
  if (!node) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectElements);
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<{ [key: string]: unknown }>;
  return [element, ...collectElements(element.props.children)];
}

describe("HeadingReferenceOverlay", () => {
  it("renders out-of-flow heading reference buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(HeadingReferenceOverlay, {
        decorations,
        onOpenReference: vi.fn(),
        onOpenContextMenu: vi.fn()
      })
    );

    expect(markup).toContain("note-editor__heading-reference-layer");
    expect(markup).toContain("note-editor__heading-reference--heading1");
    expect(markup).toContain('data-block-id="heading-1"');
    expect(markup).toContain('data-block-type="heading1"');
    expect(markup).toContain('data-heading-reference-indicator="true"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Chapter 1");
  });

  it("routes button clicks to the open-reference callback", () => {
    const onOpenReference = vi.fn();
    const onOpenContextMenu = vi.fn();
    const tree = HeadingReferenceOverlay({
      decorations,
      onOpenReference,
      onOpenContextMenu
    });
    const elements = collectElements(tree);
    const button = elements.find(
      (element) =>
        element.props.className ===
        "note-editor__heading-reference note-editor__heading-reference--heading1"
    );

    expect(button).toBeDefined();

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const onPointerDown = button?.props.onPointerDown as ((event: unknown) => void) | undefined;
    const onClick = button?.props.onClick as ((event: unknown) => void) | undefined;

    onPointerDown?.({
      button: 0,
      preventDefault,
      stopPropagation
    });
    onClick?.({
      preventDefault,
      stopPropagation
    });

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(stopPropagation).toHaveBeenCalledTimes(2);
    expect(onOpenReference).toHaveBeenCalledWith(decorations[0]?.reference);
  });

  it("routes context menu events to the heading-reference menu callback", () => {
    const onOpenContextMenu = vi.fn();
    const tree = HeadingReferenceOverlay({
      decorations,
      onOpenReference: vi.fn(),
      onOpenContextMenu
    });
    const elements = collectElements(tree);
    const button = elements.find(
      (element) =>
        element.props.className ===
        "note-editor__heading-reference note-editor__heading-reference--heading1"
    );

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const onContextMenu = button?.props.onContextMenuCapture as ((event: unknown) => void) | undefined;

    onContextMenu?.({
      clientX: 120,
      clientY: 88,
      preventDefault,
      stopPropagation
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onOpenContextMenu).toHaveBeenCalledWith({
      blockId: "heading-1",
      blockType: "heading1",
      clientX: 120,
      clientY: 88,
      reference: decorations[0]?.reference
    });
  });
});
