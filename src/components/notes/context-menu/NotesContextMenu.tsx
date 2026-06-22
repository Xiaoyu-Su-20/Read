import type { NoteBlockType } from "../../../lib/types";
import BlockTypeSubmenu from "./BlockTypeSubmenu";
import type { PanePoint } from "./menuPlacement";
import type { NotesContextMenuState } from "./useContextMenuController";

type NotesContextMenuProps = {
  documentCapabilities: boolean;
  state: NotesContextMenuState | null;
  position: PanePoint | null;
  submenuOpen: boolean;
  submenuPlacement: {
    direction: "right" | "left";
    offsetY: number;
  };
  menuRef: { current: HTMLDivElement | null };
  submenuRef: { current: HTMLDivElement | null };
  submenuAnchorRef: { current: HTMLDivElement | null };
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void | Promise<void>;
  onTurnInto: (type: NoteBlockType) => void;
  onInsertSectionBreak: () => void;
  onAddPageLink: () => void;
  onAddHeadingPagemark: () => void;
  onRemoveHeadingReference: () => void;
  onOpenPage: () => void;
  onOpenHeadingReferencePage: () => void;
  onEditPageLink: () => void;
  onCopyPageReference: () => void;
  onRemovePageLink: () => void;
  onOpenSubmenu: () => void;
  onScheduleCloseSubmenu: () => void;
};

export default function NotesContextMenu({
  documentCapabilities,
  state,
  position,
  submenuOpen,
  submenuPlacement,
  menuRef,
  submenuRef,
  submenuAnchorRef,
  onCopy,
  onCut,
  onPaste,
  onTurnInto,
  onInsertSectionBreak,
  onAddPageLink,
  onAddHeadingPagemark,
  onRemoveHeadingReference,
  onOpenPage,
  onOpenHeadingReferencePage,
  onEditPageLink,
  onCopyPageReference,
  onRemovePageLink,
  onOpenSubmenu,
  onScheduleCloseSubmenu
}: NotesContextMenuProps) {
  if (!state) {
    return null;
  }

  const menuPosition = position ?? state.anchor;
  const isHeadingTarget =
    documentCapabilities &&
    state.target === "body" &&
    (state.blockType === "heading1" || state.blockType === "heading2" || state.blockType === "heading3");
  const isSectionBreakTarget =
    state.target === "body" && state.blockType === "sectionBreak";

  return (
    <div className="notes-context-menu-layer" role="presentation">
      <div
        ref={menuRef}
        className="editor-context-menu"
        role="menu"
        style={{
          left: menuPosition.x,
          top: menuPosition.y
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {state.target === "page-link" && documentCapabilities ? (
          <>
            <button className="editor-context-menu__item" type="button" onClick={onOpenPage}>
              Open Page
            </button>
            <button className="editor-context-menu__item" type="button" onClick={onEditPageLink}>
              Edit PageLink
            </button>
            <button
              className="editor-context-menu__item"
              type="button"
              onClick={onCopyPageReference}
            >
              Copy Page Reference
            </button>
            <button className="editor-context-menu__item" type="button" onClick={onRemovePageLink}>
              Remove PageLink
            </button>
          </>
        ) : state.target === "heading-reference" ? (
          <>
            <button className="editor-context-menu__item" type="button" onClick={onOpenHeadingReferencePage}>
              Open Page
            </button>
            <button className="editor-context-menu__item" type="button" onClick={onRemoveHeadingReference}>
              Remove pagemark
            </button>
          </>
        ) : (
          <>
            <button className="editor-context-menu__item" type="button" onClick={onCopy}>
              Copy
            </button>
            <button className="editor-context-menu__item" type="button" onClick={onPaste}>
              Paste
            </button>
            <button className="editor-context-menu__item" type="button" onClick={onCut}>
              Cut
            </button>
            {state.target === "body" && documentCapabilities && state.canAddPageLink ? (
              <button className="editor-context-menu__item" type="button" onClick={onAddPageLink}>
                Add PageLink
              </button>
            ) : null}
            {state.target === "body" && !isSectionBreakTarget ? (
              <button className="editor-context-menu__item" type="button" onClick={onInsertSectionBreak}>
                Insert Section Break
              </button>
            ) : null}
            {isHeadingTarget ? (
              <>
                <button className="editor-context-menu__item" type="button" onClick={onAddHeadingPagemark}>
                  Add pagemark
                </button>
                {state.sourceReference ? (
                  <button className="editor-context-menu__item" type="button" onClick={onRemoveHeadingReference}>
                    Remove pagemark
                  </button>
                ) : null}
              </>
            ) : null}
            {state.target === "body" ? (
              <div
                ref={submenuAnchorRef}
                className="editor-context-menu__group editor-context-menu__group--has-submenu"
                onMouseEnter={onOpenSubmenu}
                onMouseLeave={onScheduleCloseSubmenu}
              >
                <button
                  className="editor-context-menu__item editor-context-menu__item--with-caret"
                  type="button"
                  onClick={() => {
                    if (submenuOpen) {
                      onScheduleCloseSubmenu();
                      return;
                    }

                    onOpenSubmenu();
                  }}
                >
                  Turn into
                </button>
                {submenuOpen ? (
                  <BlockTypeSubmenu
                    direction={submenuPlacement.direction}
                    offsetY={submenuPlacement.offsetY}
                    innerRef={submenuRef}
                    onMouseEnter={onOpenSubmenu}
                    onMouseLeave={onScheduleCloseSubmenu}
                    onSelect={(type) => {
                      onTurnInto(type);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
