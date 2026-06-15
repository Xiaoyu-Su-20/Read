import type { NoteBlockType } from "../../../lib/types";
import BlockTypeSubmenu from "./BlockTypeSubmenu";
import type { PanePoint } from "./menuPlacement";
import type { NotesContextMenuState } from "./useContextMenuController";

type NotesContextMenuProps = {
  state: NotesContextMenuState | null;
  position: PanePoint | null;
  submenuOpen: boolean;
  submenuDirection: "right" | "left";
  menuRef: { current: HTMLDivElement | null };
  submenuRef: { current: HTMLDivElement | null };
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void | Promise<void>;
  onTurnInto: (type: NoteBlockType) => void;
  onAddPageLink: () => void;
  onLinkHeadingToCurrentPage: () => void;
  onLinkHeadingToSection: () => void;
  onCreateSectionFromHeading: () => void;
  onRemoveHeadingReference: () => void;
  onOpenPage: () => void;
  onEditPageLink: () => void;
  onCopyPageReference: () => void;
  onRemovePageLink: () => void;
  onOpenSubmenu: () => void;
  onScheduleCloseSubmenu: () => void;
};

export default function NotesContextMenu({
  state,
  position,
  submenuOpen,
  submenuDirection,
  menuRef,
  submenuRef,
  onCopy,
  onCut,
  onPaste,
  onTurnInto,
  onAddPageLink,
  onLinkHeadingToCurrentPage,
  onLinkHeadingToSection,
  onCreateSectionFromHeading,
  onRemoveHeadingReference,
  onOpenPage,
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
    state.target === "body" &&
    (state.blockType === "heading1" || state.blockType === "heading2" || state.blockType === "heading3");

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
        {state.target === "page-link" ? (
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
            {state.target === "body" && state.canAddPageLink ? (
              <button className="editor-context-menu__item" type="button" onClick={onAddPageLink}>
                Add PageLink
              </button>
            ) : null}
            {isHeadingTarget ? (
              <>
                <button className="editor-context-menu__item" type="button" onClick={onLinkHeadingToCurrentPage}>
                  Link heading to current page
                </button>
                <button className="editor-context-menu__item" type="button" onClick={onLinkHeadingToSection}>
                  Link heading to PDF section
                </button>
                <button className="editor-context-menu__item" type="button" onClick={onCreateSectionFromHeading}>
                  Create PDF section from heading
                </button>
                {state.sourceReference ? (
                  <button className="editor-context-menu__item" type="button" onClick={onRemoveHeadingReference}>
                    Remove heading link
                  </button>
                ) : null}
              </>
            ) : null}
            {state.target === "body" ? (
              <div
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
                    direction={submenuDirection}
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
