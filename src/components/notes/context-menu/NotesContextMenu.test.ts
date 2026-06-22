import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NotesContextMenu from "./NotesContextMenu";

describe("NotesContextMenu", () => {
  it("renders heading blocks without separate heading-link actions", () => {
    const markup = renderToStaticMarkup(
      createElement(NotesContextMenu, {
        documentCapabilities: true,
        state: {
          target: "body",
          blockId: "heading-1",
          blockType: "heading2",
          canAddPageLink: true,
          canTurnIntoTopicCard: false,
          anchor: { x: 12, y: 24 }
        },
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
        onInsertSectionBreak: vi.fn(),
        onRemoveSectionBreak: vi.fn(),
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

    expect(markup).toContain("Add PageLink");
    expect(markup).toContain("Insert Section Break");
    expect(markup).not.toContain("Add pagemark");
    expect(markup).not.toContain("Remove pagemark");
  });

  it("renders section breaks without paste and with a remove action", () => {
    const markup = renderToStaticMarkup(
      createElement(NotesContextMenu, {
        documentCapabilities: true,
        state: {
          target: "body",
          blockId: "break-1",
          blockType: "sectionBreak",
          canAddPageLink: false,
          canTurnIntoTopicCard: false,
          anchor: { x: 12, y: 24 }
        },
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
        onInsertSectionBreak: vi.fn(),
        onRemoveSectionBreak: vi.fn(),
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

    expect(markup).toContain("Remove Section Break");
    expect(markup).not.toContain("Paste");
    expect(markup).not.toContain("Insert Section Break");
  });

  it("renders topic-card actions with a color submenu trigger", () => {
    const markup = renderToStaticMarkup(
      createElement(NotesContextMenu, {
        documentCapabilities: true,
        state: {
          target: "topic-card",
          blockId: "paragraph-1",
          topicId: "topic-1",
          topicColor: "amber",
          anchor: { x: 12, y: 24 }
        },
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
        onInsertSectionBreak: vi.fn(),
        onRemoveSectionBreak: vi.fn(),
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

    expect(markup).toContain("Edit topic");
    expect(markup).toContain("Change color");
    expect(markup).toContain("Remove topic");
  });
});
