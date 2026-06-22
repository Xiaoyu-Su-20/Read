import type { Ref } from "react";

import type { NoteBlockType } from "../../../lib/types";
import type { SubmenuDirection } from "./menuPlacement";

type BlockTypeSubmenuProps = {
  direction: SubmenuDirection;
  offsetY: number;
  innerRef?: Ref<HTMLDivElement>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  canTurnIntoTopicCard?: boolean;
  onSelect: (type: NoteBlockType) => void;
  onSelectTopicCard?: () => void;
};

export default function BlockTypeSubmenu({
  direction,
  offsetY,
  innerRef,
  onMouseEnter,
  onMouseLeave,
  canTurnIntoTopicCard = false,
  onSelect,
  onSelectTopicCard
}: BlockTypeSubmenuProps) {
  const options: Array<{ label: string; type: NoteBlockType }> = [
    { label: "Normal text", type: "paragraph" },
    { label: "Heading 1", type: "heading1" },
    { label: "Heading 2", type: "heading2" },
    { label: "Heading 3", type: "heading3" }
  ];

  return (
    <div
      ref={innerRef}
      className={`block-type-submenu block-type-submenu--${direction}`}
      style={{ top: `${offsetY}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {options.map((option) => (
        <button
          key={option.type}
          className="editor-context-menu__item"
          type="button"
          onClick={() => onSelect(option.type)}
        >
          {option.label}
        </button>
      ))}
      <button
        className="editor-context-menu__item"
        type="button"
        disabled={!canTurnIntoTopicCard}
        onClick={() => {
          onSelectTopicCard?.();
        }}
      >
        Topic card
      </button>
    </div>
  );
}
