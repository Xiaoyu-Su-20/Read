import type { MouseEvent, PointerEvent } from "react";

import type { DocumentSourceReference } from "../../lib/types";
import type { HeadingReferenceDecoration } from "./headingReferenceDecorations";

type HeadingReferenceOverlayProps = {
  decorations: HeadingReferenceDecoration[];
  onOpenReference: (reference: DocumentSourceReference) => void;
  onOpenContextMenu: (
    args: {
      blockId: string;
      blockType: HeadingReferenceDecoration["blockType"];
      clientX: number;
      clientY: number;
      reference: DocumentSourceReference;
    }
  ) => void;
};

function BookmarkIcon() {
  return (
    <svg viewBox="5 3 14 18" aria-hidden="true" focusable="false">
      <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function suppressOverlayPointerEvent(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function handleOverlayPointerDown(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation();

  if (event.button === 0) {
    event.preventDefault();
  }
}

export default function HeadingReferenceOverlay({
  decorations,
  onOpenReference,
  onOpenContextMenu
}: HeadingReferenceOverlayProps) {
  if (decorations.length === 0) {
    return null;
  }

  return (
    <div className="note-editor__heading-reference-layer">
      {decorations.map((decoration) => (
        <button
          key={decoration.blockId}
          className={`note-editor__heading-reference note-editor__heading-reference--${decoration.blockType}`}
          type="button"
          data-heading-reference-indicator="true"
          data-block-id={decoration.blockId}
          data-block-type={decoration.blockType}
          tabIndex={-1}
          title={decoration.reference.title}
          aria-label={decoration.reference.title}
          style={{
            left: decoration.left,
            top: decoration.top
          }}
          onPointerDown={handleOverlayPointerDown}
          onClick={(event) => {
            suppressOverlayPointerEvent(event);
            onOpenReference(decoration.reference);
          }}
          onContextMenuCapture={(event) => {
            suppressOverlayPointerEvent(event);
            onOpenContextMenu({
              blockId: decoration.blockId,
              blockType: decoration.blockType,
              clientX: event.clientX,
              clientY: event.clientY,
              reference: decoration.reference
            });
          }}
        >
          <BookmarkIcon />
        </button>
      ))}
    </div>
  );
}
