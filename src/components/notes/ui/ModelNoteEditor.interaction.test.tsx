// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTextNode } from "../../../lib/notes";
import type { NoteBlock, NoteDocument } from "../../../lib/types";
import ModelNoteEditor from "./ModelNoteEditor";

type OnChangeBlocksSpy = ReturnType<typeof vi.fn<(blocks: NoteBlock[]) => void>>;

type RenderedEditor = {
  container: HTMLDivElement;
  root: Root;
  onChangeBlocks: OnChangeBlocksSpy;
};

function createNote(blocks: NoteBlock[]): NoteDocument {
  return {
    id: "note-1",
    title: "Editor",
    bookId: "book-1",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    version: 1,
    blocks
  };
}

function renderEditor(note: NoteDocument): RenderedEditor {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChangeBlocks: OnChangeBlocksSpy = vi.fn();

  act(() => {
    root.render(
      createElement(ModelNoteEditor, {
        note,
        loading: false,
        ignoredSpellcheckWords: [],
        currentPage: 12,
        documentCapabilities: true,
        onChangeBlocks,
        onBlur: vi.fn(),
        onOpenPageLink: vi.fn()
      })
    );
  });

  return { container, root, onChangeBlocks };
}

function blockContent(container: HTMLDivElement, index: number) {
  const content = container.querySelectorAll<HTMLElement>(".note-editor__block-content")[index];
  if (!content) {
    throw new Error(`Missing block content at index ${index}`);
  }
  return content;
}

function firstTextNode(content: HTMLElement) {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text)) {
    throw new Error("Missing text node");
  }
  return node;
}

function setCaret(content: HTMLElement, offset: number) {
  const selection = window.getSelection();
  const range = document.createRange();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode();

  if (text instanceof Text) {
    range.setStart(text, Math.min(offset, text.data.length));
  } else {
    range.setStart(content, 0);
  }

  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  content.focus();
}

function setSelection(content: HTMLElement, start: number, end: number) {
  const text = firstTextNode(content);
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  selection?.removeAllRanges();
  selection?.addRange(range);
  content.focus();
}

function dispatchBeforeInput(
  target: HTMLElement,
  inputType: string,
  data: string | null = null
) {
  const event = new Event("beforeinput", {
    bubbles: true,
    cancelable: true
  }) as InputEvent;
  Object.defineProperties(event, {
    inputType: { value: inputType },
    data: { value: data }
  });
  target.dispatchEvent(event);
}

function dispatchInput(target: HTMLElement, inputType: string, data: string | null = null) {
  const event = new Event("input", {
    bubbles: true,
    cancelable: true
  }) as InputEvent;
  Object.defineProperties(event, {
    inputType: { value: inputType },
    data: { value: data }
  });
  target.dispatchEvent(event);
}

function dispatchComposition(target: HTMLElement, type: "compositionstart" | "compositionend", data = "") {
  const event = new CompositionEvent(type, {
    bubbles: true,
    cancelable: true,
    data
  });
  target.dispatchEvent(event);
}

function latestBlocks(onChangeBlocks: OnChangeBlocksSpy) {
  const lastCall = onChangeBlocks.mock.calls[onChangeBlocks.mock.calls.length - 1];
  const blocks = lastCall?.[0];
  expect(blocks).toBeTruthy();
  return blocks!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelNoteEditor interactions", () => {
  it("toggles bold on selected text without execCommand", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ]);
    const originalExecCommand = (document as Document & { execCommand?: typeof document.execCommand })
      .execCommand;
    (document as Document & { execCommand?: (commandId: string) => boolean }).execCommand =
      vi.fn(() => true);
    const execSpy = vi.spyOn(document as Document & { execCommand: (commandId: string) => boolean }, "execCommand");
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setSelection(content, 6, 11);
    act(() => {
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });

    expect(execSpy).not.toHaveBeenCalled();
    expect(latestBlocks(onChangeBlocks)[0].children).toEqual([
      createTextNode("Hello "),
      createTextNode("world", { bold: true })
    ]);
    (document as Document & { execCommand?: typeof document.execCommand }).execCommand =
      originalExecCommand;
  });

  it("applies pending bold marks to inserted text at a collapsed caret", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setCaret(content, 5);
    act(() => {
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    act(() => {
      dispatchBeforeInput(content, "insertText", "!");
    });

    expect(latestBlocks(onChangeBlocks)[0].children).toEqual([
      createTextNode("Hello"),
      createTextNode("!", { bold: true })
    ]);
  });

  it("replaces the selected text through insertReplacementText", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setSelection(content, 6, 11);
    act(() => {
      dispatchBeforeInput(content, "insertReplacementText", "reader");
    });

    expect(latestBlocks(onChangeBlocks)[0].children).toEqual([
      createTextNode("Hello reader")
    ]);
  });

  it("splits the current block on insertParagraph", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setCaret(content, 5);
    act(() => {
      dispatchBeforeInput(content, "insertParagraph");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children).toEqual([createTextNode("Hello")]);
    expect(blocks[1].children).toEqual([createTextNode(" world")]);
  });

  it("treats insertLineBreak the same as insertParagraph", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setCaret(content, 5);
    act(() => {
      dispatchBeforeInput(content, "insertLineBreak");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children).toEqual([createTextNode("Hello")]);
    expect(blocks[1].children).toEqual([createTextNode(" world")]);
  });

  it("does not collapse a structural split when a follow-up input event fires", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setCaret(content, 5);
    act(() => {
      dispatchBeforeInput(content, "insertParagraph");
    });
    act(() => {
      dispatchInput(content, "insertParagraph");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children).toEqual([createTextNode("Hello")]);
    expect(blocks[1].children).toEqual([createTextNode(" world")]);
  });

  it("merges backward at the start of the following block", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      },
      {
        id: "b",
        type: "paragraph",
        children: [createTextNode(" world")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 1);

    setCaret(content, 0);
    act(() => {
      dispatchBeforeInput(content, "deleteContentBackward");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children).toEqual([createTextNode("Hello world")]);
  });

  it("deletes forward within one block through beforeinput", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setCaret(content, 0);
    act(() => {
      dispatchBeforeInput(content, "deleteContentForward");
    });

    expect(latestBlocks(onChangeBlocks)[0].children).toEqual([createTextNode("ello")]);
  });

  it("does not collapse sibling paragraphs when an empty block is removed", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Before")]
      },
      {
        id: "b",
        type: "paragraph",
        children: [createTextNode("")]
      },
      {
        id: "c",
        type: "paragraph",
        children: [createTextNode("After")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const emptyContent = blockContent(container, 1);

    setCaret(emptyContent, 0);
    act(() => {
      dispatchBeforeInput(emptyContent, "deleteContentBackward");
    });
    act(() => {
      dispatchInput(emptyContent, "deleteContentBackward");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].children).toEqual([createTextNode("Before")]);
    expect(blocks[1].children).toEqual([createTextNode("After")]);
  });

  it("removes an emptied trailing paragraph instead of merging its stale text", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("dad")]
      },
      {
        id: "b",
        type: "paragraph",
        children: [createTextNode("add")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const secondContent = blockContent(container, 1);

    setCaret(secondContent, 3);
    act(() => {
      dispatchBeforeInput(secondContent, "deleteContentBackward");
    });
    act(() => {
      dispatchBeforeInput(secondContent, "deleteContentBackward");
    });
    act(() => {
      dispatchBeforeInput(secondContent, "deleteContentBackward");
    });
    act(() => {
      dispatchBeforeInput(secondContent, "deleteContentBackward");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children).toEqual([createTextNode("dad")]);
  });

  it("commits composition text through one canonical model replacement", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const content = blockContent(container, 0);

    setCaret(content, 5);
    act(() => {
      dispatchComposition(content, "compositionstart", "");
    });
    act(() => {
      content.textContent = "Hello世";
      dispatchInput(content, "insertText", "世");
    });
    act(() => {
      dispatchComposition(content, "compositionend", "世");
    });

    expect(latestBlocks(onChangeBlocks)[0].children).toEqual([createTextNode("Hello世")]);
  });
});
