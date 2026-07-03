// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { nativePdfSelectionOwnsCopy } from "./NativePdfTextLayer";

function createClipboardSurfaces() {
  const readerSurface = document.createElement("div");
  const readerFocusTarget = document.createElement("div");
  readerSurface.append(readerFocusTarget);

  const noteRoot = document.createElement("div");
  noteRoot.dataset.noteEditorRoot = "true";
  const noteTarget = document.createElement("span");
  noteRoot.append(noteTarget);

  document.body.append(readerSurface, noteRoot);
  return { noteRoot, noteTarget, readerFocusTarget, readerSurface };
}

describe("native PDF clipboard ownership", () => {
  it("uses the focused reader even when a stale notes selection still exists", () => {
    const { readerFocusTarget, readerSurface } = createClipboardSurfaces();

    expect(
      nativePdfSelectionOwnsCopy({
        activeElement: readerFocusTarget,
        eventTarget: document,
        readerSurface
      })
    ).toBe(true);
  });

  it("does not override a copy event dispatched from the note editor", () => {
    const { noteTarget, readerFocusTarget, readerSurface } = createClipboardSurfaces();

    expect(
      nativePdfSelectionOwnsCopy({
        activeElement: readerFocusTarget,
        eventTarget: noteTarget,
        readerSurface
      })
    ).toBe(false);
  });

  it("does not reuse a retained PDF selection after focus leaves the reader", () => {
    const { noteTarget, readerSurface } = createClipboardSurfaces();

    expect(
      nativePdfSelectionOwnsCopy({
        activeElement: noteTarget,
        eventTarget: document,
        readerSurface
      })
    ).toBe(false);
  });
});
