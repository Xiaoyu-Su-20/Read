export type NavigationSource = "keyboard" | "wheel";

export type NavigationDirection = "next" | "previous";

export type RapidTurnIntent = {
  source: NavigationSource;
  direction: NavigationDirection;
  activationWindowMs: number;
  isRepeat?: boolean;
};

export type RapidTurnLastInput = {
  at: number;
  source: NavigationSource;
  direction: NavigationDirection;
};

export type RapidTurnOverlayModel = {
  visible: boolean;
  targetPage: number;
  pageCount: number;
  isFinalizing: boolean;
  progress: number;
};

export function shouldActivateRapidTurn(
  lastInput: RapidTurnLastInput | null,
  intent: RapidTurnIntent,
  now: number
) {
  if (intent.isRepeat) {
    return true;
  }

  if (!lastInput) {
    return false;
  }

  return (
    lastInput.source === intent.source &&
    lastInput.direction === intent.direction &&
    now - lastInput.at <= intent.activationWindowMs
  );
}

export function makeRapidTurnOverlayModel(
  targetPage: number,
  pageCount: number,
  isFinalizing: boolean
): RapidTurnOverlayModel {
  const normalizedPageCount = Math.max(pageCount, 1);
  const clampedTargetPage = Math.min(Math.max(targetPage, 1), normalizedPageCount);

  return {
    visible: true,
    targetPage: clampedTargetPage,
    pageCount: normalizedPageCount,
    isFinalizing,
    progress: clampedTargetPage / normalizedPageCount
  };
}
