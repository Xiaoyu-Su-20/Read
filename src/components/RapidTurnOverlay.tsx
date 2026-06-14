import type { RapidTurnOverlayModel } from "../lib/reader/rapidTurn";

type RapidTurnOverlayProps = {
  overlay: RapidTurnOverlayModel;
};

export default function RapidTurnOverlay({ overlay }: RapidTurnOverlayProps) {
  return (
    <div className="rapid-turn-overlay" role="status" aria-live="polite">
      <div className="rapid-turn-overlay__label">
        {`Page ${overlay.targetPage} of ${overlay.pageCount}`}
      </div>
      <div className="rapid-turn-overlay__track" aria-hidden="true">
        <div
          className="rapid-turn-overlay__fill"
          style={{ transform: `scaleX(${overlay.progress})` }}
        />
      </div>
    </div>
  );
}
