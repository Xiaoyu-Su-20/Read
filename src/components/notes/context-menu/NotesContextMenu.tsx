import type { InteractiveColorKey, NoteBlockType } from "../../../lib/types";
import BlockTypeSubmenu from "./BlockTypeSubmenu";
import TopicColorSubmenu from "./TopicColorSubmenu";
import type { PanePoint } from "./menuPlacement";
import type { NotesContextMenuState } from "./useContextMenuController";

type NotesContextMenuProps = {
  documentCapabilities: boolean;
  state: NotesContextMenuState | null;
  position: PanePoint | null;
  submenuKind: "turn-into" | "topic-color" | null;
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
  onRemoveSectionBreak: () => void;
  onAddPageLink: () => void;
  onOpenPage: () => void;
  onEditPageLink: () => void;
  onCopyPageReference: () => void;
  onRemovePageLink: () => void;
  onEditTopic: () => void;
  onRemoveTopic: () => void;
  onChangeTopicColor: (color: InteractiveColorKey) => void;
  onOpenSubmenu: (kind: "turn-into" | "topic-color") => void;
  onScheduleCloseSubmenu: () => void;
  onTurnIntoTopicCard: () => void;
};

export default function NotesContextMenu({
  documentCapabilities,
  state,
  position,
  submenuKind,
  submenuPlacement,
  menuRef,
  submenuRef,
  submenuAnchorRef,
  onCopy,
  onCut,
  onPaste,
  onTurnInto,
  onInsertSectionBreak,
  onRemoveSectionBreak,
  onAddPageLink,
  onOpenPage,
  onEditPageLink,
  onCopyPageReference,
  onRemovePageLink,
  onEditTopic,
  onRemoveTopic,
  onChangeTopicColor,
  onOpenSubmenu,
  onScheduleCloseSubmenu,
  onTurnIntoTopicCard
}: NotesContextMenuProps) {
  if (!state) {
    return null;
  }

  const menuPosition = position ?? state.anchor;
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
        ) : state.target === "topic-card" ? (
          <>
            <button className="editor-context-menu__item" type="button" onClick={onEditTopic}>
              Edit topic
            </button>
            <div
              ref={submenuAnchorRef}
              className="editor-context-menu__group editor-context-menu__group--has-submenu"
              onMouseEnter={() => onOpenSubmenu("topic-color")}
              onMouseLeave={onScheduleCloseSubmenu}
            >
              <button
                className="editor-context-menu__item editor-context-menu__item--with-caret"
                type="button"
                onClick={() => {
                  if (submenuKind === "topic-color") {
                    onScheduleCloseSubmenu();
                    return;
                  }

                  onOpenSubmenu("topic-color");
                }}
              >
                Change color
              </button>
              {submenuKind === "topic-color" ? (
                <TopicColorSubmenu
                  direction={submenuPlacement.direction}
                  offsetY={submenuPlacement.offsetY}
                  innerRef={submenuRef}
                  currentColor={state.topicColor}
                  onMouseEnter={() => onOpenSubmenu("topic-color")}
                  onMouseLeave={onScheduleCloseSubmenu}
                  onSelect={onChangeTopicColor}
                />
              ) : null}
            </div>
            <button className="editor-context-menu__item" type="button" onClick={onRemoveTopic}>
              Remove topic
            </button>
          </>
        ) : (
          <>
            <button className="editor-context-menu__item" type="button" onClick={onCopy}>
              Copy
            </button>
            {!isSectionBreakTarget ? (
              <button className="editor-context-menu__item" type="button" onClick={onPaste}>
                Paste
              </button>
            ) : null}
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
            {isSectionBreakTarget ? (
              <button className="editor-context-menu__item" type="button" onClick={onRemoveSectionBreak}>
                Remove Section Break
              </button>
            ) : null}
            {state.target === "body" ? (
              <div
                ref={submenuAnchorRef}
                className="editor-context-menu__group editor-context-menu__group--has-submenu"
                onMouseEnter={() => onOpenSubmenu("turn-into")}
                onMouseLeave={onScheduleCloseSubmenu}
              >
                <button
                  className="editor-context-menu__item editor-context-menu__item--with-caret"
                  type="button"
                  onClick={() => {
                    if (submenuKind === "turn-into") {
                      onScheduleCloseSubmenu();
                      return;
                    }

                    onOpenSubmenu("turn-into");
                  }}
                >
                  Turn into
                </button>
                {submenuKind === "turn-into" ? (
                  <BlockTypeSubmenu
                    direction={submenuPlacement.direction}
                    offsetY={submenuPlacement.offsetY}
                    innerRef={submenuRef}
                    onMouseEnter={() => onOpenSubmenu("turn-into")}
                    onMouseLeave={onScheduleCloseSubmenu}
                    canTurnIntoTopicCard={state.canTurnIntoTopicCard}
                    onSelect={(type) => {
                      onTurnInto(type);
                    }}
                    onSelectTopicCard={onTurnIntoTopicCard}
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
