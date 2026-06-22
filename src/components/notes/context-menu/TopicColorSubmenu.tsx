import type { Ref } from "react";

import {
  INTERACTIVE_COLOR_KEYS,
  interactiveColorLabels,
  resolveTopicAppearance
} from "../../../lib/paragraphTopics";
import type { InteractiveColorKey } from "../../../lib/types";
import type { SubmenuDirection } from "./menuPlacement";

type TopicColorSubmenuProps = {
  direction: SubmenuDirection;
  offsetY: number;
  innerRef?: Ref<HTMLDivElement>;
  currentColor: InteractiveColorKey;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onSelect: (color: InteractiveColorKey) => void;
};

export default function TopicColorSubmenu({
  direction,
  offsetY,
  innerRef,
  currentColor,
  onMouseEnter,
  onMouseLeave,
  onSelect
}: TopicColorSubmenuProps) {
  return (
    <div
      ref={innerRef}
      className={`block-type-submenu block-type-submenu--${direction} topic-color-submenu`}
      style={{ top: `${offsetY}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {INTERACTIVE_COLOR_KEYS.map((color) => (
        <button
          key={color}
          className="topic-color-submenu__item"
          type="button"
          onClick={() => onSelect(color)}
        >
          <span
            className={`topic-color-submenu__swatch${
              color === currentColor ? " topic-color-submenu__swatch--active" : ""
            }`}
            style={resolveTopicAppearance(color)}
            aria-hidden="true"
          />
          <span>{interactiveColorLabels[color]}</span>
        </button>
      ))}
    </div>
  );
}
