// @vitest-environment jsdom

import { act, createElement, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPageLinkNode,
  createTextNode,
  createTopicCardNode,
  normalizeNoteBlocks,
  replaceBlockSourceReference,
  replaceBlockType
} from "../../../lib/notes";
import type { NoteBlock, NoteDocument, NotePageLinkNode } from "../../../lib/types";
import { captureModelSelection } from "../dom/noteBlockSelection";
import * as noteEditorDom from "../dom/noteEditorDom";
import ModelNoteEditor from "./ModelNoteEditor";
import type { NoteEditorHandle } from "./noteEditorTypes";

type OnChangeBlocksSpy = ReturnType<typeof vi.fn<(blocks: NoteBlock[]) => void>>;

type RenderedEditor = {
  container: HTMLDivElement;
  root: Root;
  onChangeBlocks: OnChangeBlocksSpy;
  onOpenPageLink: ReturnType<typeof vi.fn<(node: NotePageLinkNode) => void>>;
  editorRef: RefObject<NoteEditorHandle>;
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
  const onOpenPageLink = vi.fn<(node: NotePageLinkNode) => void>();
  const editorRef = createRef<NoteEditorHandle>();

  act(() => {
    root.render(
      createElement(ModelNoteEditor, {
        ref: editorRef,
        note,
        loading: false,
        ignoredSpellcheckWords: [],
        currentPage: 12,
        documentCapabilities: true,
        onChangeBlocks,
        onBlur: vi.fn(),
        onOpenPageLink
      })
    );
  });

  return { container, root, onChangeBlocks, onOpenPageLink, editorRef };
}

function rerenderEditor(rendered: RenderedEditor, note: NoteDocument) {
  act(() => {
    rendered.root.render(
      createElement(ModelNoteEditor, {
        ref: rendered.editorRef,
        note,
        loading: false,
        ignoredSpellcheckWords: [],
        currentPage: 12,
        documentCapabilities: true,
        onChangeBlocks: rendered.onChangeBlocks,
        onBlur: vi.fn(),
        onOpenPageLink: rendered.onOpenPageLink
      })
    );
  });
}

function blockContent(container: HTMLDivElement, index: number) {
  const content = container.querySelectorAll<HTMLElement>(".note-editor__block-content")[index];
  if (!content) {
    throw new Error(`Missing block content at index ${index}`);
  }
  return content;
}

function editorBody(container: HTMLDivElement) {
  const body = container.querySelector<HTMLElement>(".note-editor__body");
  if (!body) {
    throw new Error("Missing editor body");
  }
  return body;
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

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 100,
    height: bottom - top,
    top,
    right: 100,
    bottom,
    left: 0,
    toJSON: () => ({})
  } as DOMRect;
}

function placeEditorInScrollSurface(
  container: HTMLDivElement,
  scrollTop: number,
  blockTop: number
) {
  const surface = document.createElement("div");
  surface.className = "notes-pane__scroll-surface";
  document.body.insertBefore(surface, container);
  surface.appendChild(container);
  surface.scrollTop = scrollTop;
  const initialScrollTop = scrollTop;

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this === surface) {
      return rect(0, 100);
    }
    if (this.hasAttribute("data-block-id")) {
      const blocks = Array.from(container.querySelectorAll("[data-block-id]"));
      const index = blocks.indexOf(this);
      const top = blockTop + index * 24 - (surface.scrollTop - initialScrollTop);
      return rect(top, top + 24);
    }
    return rect(0, 0);
  });

  return surface;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ModelNoteEditor interactions", () => {
  it("copies PageLinks and Topic cards using their visible plain-text forms", () => {
    const topic = createTopicCardNode({ id: "topic", text: "Topic", color: "accent" });
    const pageLink = createPageLinkNode({
      id: "page-link",
      text: "(p. 27)",
      bookPageLabel: "27",
      documentId: "book-1",
      pdfPageIndex: 26
    });
    expect(topic).toBeTruthy();
    const { container } = renderEditor(
      createNote([
        {
          id: "a",
          type: "paragraph",
          children: [
            createTextNode("Before "),
            topic!,
            createTextNode("and "),
            pageLink,
            createTextNode(" after")
          ]
        }
      ])
    );
    const body = editorBody(container);
    const clipboard = new Map<string, string>();
    setCaret(blockContent(container, 0), 0);

    act(() => {
      body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", {
      value: {
        setData: (type: string, value: string) => clipboard.set(type, value)
      }
    });
    act(() => {
      body.dispatchEvent(copyEvent);
    });

    expect(clipboard.get("text/plain")).toBe("Before [Topic] and (27) after");
    expect(clipboard.get("application/x-calmreader-note-fragment")).toContain(
      'data-inline-type="topic-card"'
    );
    expect(clipboard.get("application/x-calmreader-note-fragment")).toContain(
      'data-inline-type="page-link"'
    );
  });

  it("selects the complete note across model blocks with Ctrl+A", () => {
    const blocks: NoteBlock[] = [
      { id: "a", type: "paragraph", children: [createTextNode("First")] },
      { id: "b", type: "heading2", children: [createTextNode("Middle")] },
      { id: "c", type: "paragraph", children: [createTextNode("Last")] }
    ];
    const { container } = renderEditor(createNote(blocks));
    const first = blockContent(container, 0);
    setCaret(first, 2);

    act(() => {
      first.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });

    const selection = captureModelSelection(editorBody(container), blocks);
    expect(selection?.anchor.blockId).toBe("a");
    expect(selection?.focus.blockId).toBe("c");
    expect(window.getSelection()?.toString()).toContain("Middle");
  });

  it("undoes and redoes one typed character after the controller normalizes the local update", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      }
    ]);
    const rendered = renderEditor(note);
    const content = blockContent(rendered.container, 0);

    setCaret(content, 0);
    act(() => {
      dispatchBeforeInput(content, "insertText", "!");
    });
    expect(latestBlocks(rendered.onChangeBlocks)[0].children).toEqual([
      createTextNode("!Hello")
    ]);
    const normalizedEcho = normalizeNoteBlocks(latestBlocks(rendered.onChangeBlocks), note.bookId);
    rerenderEditor(rendered, { ...note, blocks: normalizedEcho });

    act(() => {
      blockContent(rendered.container, 0).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    expect(blockContent(rendered.container, 0).textContent).toBe("Hello");

    act(() => {
      blockContent(rendered.container, 0).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "y",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    expect(blockContent(rendered.container, 0).textContent).toBe("!Hello");
  });

  it("reloads external block updates for the same note id", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Original")]
      }
    ]);
    const rendered = renderEditor(note);
    const updatedNote: NoteDocument = {
      ...note,
      blocks: [
        {
          id: "a",
          type: "paragraph",
          children: [createTextNode("External update")]
        }
      ]
    };

    rerenderEditor(rendered, updatedNote);

    expect(blockContent(rendered.container, 0).textContent).toBe("External update");
  });

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

  it("continues collapsed-caret formatting across separate text inputs", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    let content = blockContent(container, 0);

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
    content = blockContent(container, 0);
    act(() => {
      dispatchBeforeInput(content, "insertText", "?");
    });

    expect(latestBlocks(onChangeBlocks)[0].children).toEqual([
      createTextNode("Hello"),
      createTextNode("!?", { bold: true })
    ]);
  });

  it("preserves newly typed bold text through a later edit in the same paragraph", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello")]
      }
    ]);
    const rendered = renderEditor(note);
    let content = blockContent(rendered.container, 0);

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
      dispatchBeforeInput(content, "insertText", "!");
    });

    const formattedEcho = normalizeNoteBlocks(latestBlocks(rendered.onChangeBlocks), note.bookId);
    rerenderEditor(rendered, { ...note, blocks: formattedEcho });
    content = blockContent(rendered.container, 0);
    setCaret(content, 0);
    act(() => {
      dispatchBeforeInput(content, "insertText", "?");
    });

    expect(latestBlocks(rendered.onChangeBlocks)[0].children).toEqual([
      createTextNode("?Hello"),
      createTextNode("!", { bold: true })
    ]);
  });

  it("preserves a newly formatted range through a later edit in the same paragraph", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ]);
    const rendered = renderEditor(note);
    let content = blockContent(rendered.container, 0);

    setSelection(content, 6, 11);
    act(() => {
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "i",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });

    const formattedEcho = normalizeNoteBlocks(latestBlocks(rendered.onChangeBlocks), note.bookId);
    rerenderEditor(rendered, { ...note, blocks: formattedEcho });
    content = blockContent(rendered.container, 0);
    setCaret(content, 0);
    act(() => {
      dispatchBeforeInput(content, "insertText", "?");
    });

    expect(latestBlocks(rendered.onChangeBlocks)[0].children).toEqual([
      createTextNode("?Hello "),
      createTextNode("world", { italic: true })
    ]);
  });

  it("regenerates inline HTML only for the changed block during typing", () => {
    const renderHtmlSpy = vi.spyOn(noteEditorDom, "renderNoteInlineNodesHtml");
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Alpha")]
      },
      {
        id: "b",
        type: "paragraph",
        children: [createTextNode("Hello")]
      },
      {
        id: "c",
        type: "paragraph",
        children: [createTextNode("Omega")]
      }
    ]);
    const { container } = renderEditor(note);
    const baselineCalls = renderHtmlSpy.mock.calls.length;
    const content = blockContent(container, 1);

    setCaret(content, 5);
    act(() => {
      dispatchBeforeInput(content, "insertText", "!");
    });

    expect(renderHtmlSpy.mock.calls.length - baselineCalls).toBe(1);
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

  it("minimally advances the notes viewport when Enter creates a block below it", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("At the viewport edge")]
      }
    ]);
    const { container, onChangeBlocks } = renderEditor(note);
    const surface = placeEditorInScrollSurface(container, 40, 76);
    const content = blockContent(container, 0);

    setCaret(content, "At the viewport edge".length);
    act(() => {
      dispatchBeforeInput(content, "insertParagraph");
    });

    const blocks = latestBlocks(onChangeBlocks);
    const selection = captureModelSelection(editorBody(container), blocks);
    const newBlock = container.querySelectorAll<HTMLElement>("[data-block-id]")[1];
    expect(blocks).toHaveLength(2);
    expect(selection?.focus.blockId).toBe(blocks[1].id);
    expect(newBlock.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      surface.getBoundingClientRect().bottom
    );
    expect(surface.scrollTop).toBe(64);
  });

  it("does not move the notes viewport when the block created by Enter is visible", () => {
    const note = createNote([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Already visible")]
      }
    ]);
    const { container } = renderEditor(note);
    const surface = placeEditorInScrollSurface(container, 25, 30);
    const content = blockContent(container, 0);

    setCaret(content, "Already visible".length);
    act(() => {
      dispatchBeforeInput(content, "insertParagraph");
    });

    expect(surface.scrollTop).toBe(25);
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

  it("places Enter on a new empty paragraph after the current empty block", () => {
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
      dispatchBeforeInput(emptyContent, "insertParagraph");
    });

    const blocks = latestBlocks(onChangeBlocks);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].children).toEqual([createTextNode("Before")]);
    expect(blocks[1].children).toEqual([createTextNode("")]);
    expect(blocks[2].children).toEqual([createTextNode("")]);
    expect(blocks[3].children).toEqual([createTextNode("After")]);

    const selection = captureModelSelection(editorBody(container), blocks);
    expect(selection?.focus.blockId).toBe(blocks[2].id);
    expect(selection?.anchor.blockId).toBe(blocks[2].id);
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

  it("opens a heading source-reference icon like a normal page link", () => {
    const note = createNote([
      {
        id: "a",
        type: "heading1",
        children: [createTextNode("Chapter")],
        sourceReference: {
          id: "ref-1",
          documentId: "book-1",
          kind: "direct",
          outlineItemId: null,
          outlineSource: null,
          title: "Chapter",
          target: {
            documentId: "book-1",
            pageIndex: 8
          },
          createdAt: "2026-06-24T00:00:00.000Z"
        }
      }
    ]);
    const { container, onOpenPageLink } = renderEditor(note);
    const headingIcon = container.querySelector<HTMLElement>("[data-inline-type='page-link']");
    expect(headingIcon).toBeTruthy();

    act(() => {
      headingIcon?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onOpenPageLink).toHaveBeenCalledTimes(1);
    expect(onOpenPageLink.mock.calls[0]?.[0]).toMatchObject({
      type: "page-link",
      pdfPageIndex: 9
    });
  });

  it("resolves a heading page-link through the canonical model path", () => {
    const note = createNote([
      {
        id: "a",
        type: "heading1",
        children: [createTextNode("Chapter")],
        sourceReference: {
          id: "ref-1",
          documentId: "book-1",
          kind: "direct",
          outlineItemId: null,
          outlineSource: null,
          title: "Chapter",
          target: {
            documentId: "book-1",
            pageIndex: 8
          },
          createdAt: "2026-06-24T00:00:00.000Z"
        }
      }
    ]);
    const { container, onOpenPageLink, editorRef } = renderEditor(note);
    const headingIcon = container.querySelector<HTMLElement>("[data-inline-type='page-link']");
    expect(headingIcon).toBeTruthy();
    const pageLinkId = headingIcon?.dataset.pageLinkId ?? null;
    expect(pageLinkId).toBeTruthy();

    const resolved = pageLinkId ? editorRef.current?.getPageLink(pageLinkId) : null;
    expect(resolved).toMatchObject({
      id: pageLinkId,
      type: "page-link",
      pdfPageIndex: 9,
      documentId: "book-1",
      bookPageLabel: "9"
    });

    act(() => {
      headingIcon?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onOpenPageLink).toHaveBeenCalledTimes(1);
    expect(onOpenPageLink.mock.calls[0]?.[0]).toMatchObject({
      id: pageLinkId,
      type: "page-link",
      pdfPageIndex: 9,
      documentId: "book-1",
      bookPageLabel: "9"
    });

    if (!pageLinkId) {
      throw new Error("Missing rendered heading page-link id");
    }
    const opened = editorRef.current?.openPageLink(pageLinkId);
    expect(opened).toMatchObject({
      id: pageLinkId,
      type: "page-link",
      pdfPageIndex: 9
    });
  });

  it("keeps a heading-reference page-link clickable after paragraph-heading conversion", () => {
    const headingBlocks = replaceBlockSourceReference(
      [
        {
          id: "heading",
          type: "heading1",
          children: [createTextNode("Chapter")]
        }
      ],
      "heading",
      {
        id: "ref-1",
        documentId: "book-1",
        kind: "direct",
        outlineItemId: null,
        outlineSource: null,
        title: "Chapter",
        target: {
          documentId: "book-1",
          pageIndex: 8
        },
        createdAt: "2026-06-24T00:00:00.000Z"
      },
      "book-1"
    );
    const paragraphBlocks = replaceBlockType(headingBlocks, "heading", "paragraph");
    const roundTrippedBlocks = replaceBlockType(paragraphBlocks, "heading", "heading1");
    const note = createNote(roundTrippedBlocks);
    const { container, onOpenPageLink } = renderEditor(note);
    const headingIcon = container.querySelector<HTMLElement>("[data-inline-type='page-link']");
    expect(headingIcon).toBeTruthy();

    act(() => {
      headingIcon?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0
        })
      );
      headingIcon?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onOpenPageLink).toHaveBeenCalledTimes(1);
    expect(onOpenPageLink.mock.calls[0]?.[0]).toMatchObject({
      type: "page-link",
      pdfPageIndex: 9,
      origin: {
        kind: "heading-reference",
        ownerBlockId: "heading"
      }
    });
  });

  it("opens a heading page-link when the click lands on the svg path", () => {
    const note = createNote(
      replaceBlockSourceReference(
        [
          {
            id: "heading",
            type: "heading1",
            children: [createTextNode("Heading 1")]
          }
        ],
        "heading",
        {
          id: "ref-1",
          documentId: "book-1",
          kind: "direct",
          outlineItemId: null,
          outlineSource: null,
          title: "Heading 1",
          target: {
            documentId: "book-1",
            pageIndex: 3
          },
          createdAt: "2026-06-24T00:00:00.000Z"
        },
        "book-1"
      )
    );
    const { container, onOpenPageLink } = renderEditor(note);
    const iconPath = container.querySelector<SVGPathElement>(
      "[data-inline-type='page-link'] .page-link__icon path"
    );
    expect(iconPath).toBeTruthy();

    act(() => {
      iconPath?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onOpenPageLink).toHaveBeenCalledTimes(1);
    expect(onOpenPageLink.mock.calls[0]?.[0]).toMatchObject({
      type: "page-link",
      pdfPageIndex: 4,
      origin: {
        kind: "heading-reference",
        ownerBlockId: "heading"
      }
    });
  });
});
