import type { Ref } from "react";

import {
  SELECTABLE_TOPIC_COLOR_ROLES,
  topicColorRoleLabels,
  resolveTopicAppearance
} from "../../../../lib/paragraphTopics";
import type { TopicColorRole } from "../../../../lib/types";
import type { SubmenuDirection } from "./menuPlacement";

type TopicColorSubmenuProps = {
  direction: SubmenuDirection;
  offsetY: number;
  innerRef?: Ref<HTMLDivElement>;
  currentColor: TopicColorRole;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onSelect: (color: TopicColorRole) => void;
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
      {SELECTABLE_TOPIC_COLOR_ROLES.map((color) => (
        <button
          key={color}
          className="topic-color-submenu__item"
          type="button"
          aria-label={topicColorRoleLabels[color]}
          title={topicColorRoleLabels[color]}
          onClick={() => onSelect(color)}
        >
          <span
            className={`topic-color-submenu__swatch${
              color === currentColor ? " topic-color-submenu__swatch--active" : ""
            }`}
            style={resolveTopicAppearance(color)}
            aria-hidden="true"
          />
          <span className="topic-color-submenu__label">{topicColorRoleLabels[color]}</span>
        </button>
      ))}
    </div>
  );
}
