import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NotesContextMenu from "./NotesContextMenu";

function renderMenu(
  state:
    | {
        target: "body";
        blockId: string;
        blockType: "paragraph" | "heading1" | "heading2" | "heading3";
        canAddPageLink: boolean;
        canTurnIntoTopicCard: boolean;
        anchor: { x: number; y: number };
      }
    | {
        target: "topic-card";
        blockId: string;
        topicId: string;
        topicColor: "accent";
        anchor: { x: number; y: number };
      }
) {
  return renderToStaticMarkup(
    createElement(NotesContextMenu, {
      documentCapabilities: true,
      state,
      position: null,
      submenuKind: null,
      submenuPlacement: {
        direction: "right",
        offsetY: 0
      },
      menuRef: { current: null },
      submenuRef: { current: null },
      submenuAnchorRef: { current: null },
      onCopy: vi.fn(),
      onCut: vi.fn(),
      onPaste: vi.fn(),
      onTurnInto: vi.fn(),
      onAddPageLink: vi.fn(),
      onOpenPage: vi.fn(),
      onEditPageLink: vi.fn(),
      onCopyPageReference: vi.fn(),
      onRemovePageLink: vi.fn(),
      onEditTopic: vi.fn(),
      onRemoveTopic: vi.fn(),
      onChangeTopicColor: vi.fn(),
      onOpenSubmenu: vi.fn(),
      onScheduleCloseSubmenu: vi.fn(),
      onTurnIntoTopicCard: vi.fn()
    })
  );
}

describe("NotesContextMenu", () => {
  it("renders body actions without section-break commands", () => {
    const markup = renderMenu({
      target: "body",
      blockId: "paragraph-1",
      blockType: "paragraph",
      canAddPageLink: true,
      canTurnIntoTopicCard: false,
      anchor: { x: 12, y: 24 }
    });

    expect(markup).toContain("Add PageLink");
    expect(markup).toContain("Create Topic Card");
    expect(markup).toContain("Turn into");
    expect(markup).not.toContain("Section Break");
  });

  it("renders topic-card actions with a color submenu trigger", () => {
    const markup = renderMenu({
      target: "topic-card",
      blockId: "paragraph-1",
      topicId: "topic-1",
      topicColor: "accent",
      anchor: { x: 12, y: 24 }
    });

    expect(markup).toContain("Edit topic");
    expect(markup).toContain("Change color");
    expect(markup).toContain("Remove topic");
  });
});
