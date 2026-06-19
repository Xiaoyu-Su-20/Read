export type NavigationSource = "keyboard" | "wheel";

export type NavigationDirection = "next" | "previous";

export type RapidTurnIntent = {
  source: NavigationSource;
  direction: NavigationDirection;
  activationWindowMs: number;
};

export type RapidTurnSample = {
  at: number;
  source: NavigationSource;
  direction: NavigationDirection;
  page: number;
};

export type RapidTurnOverlayModel = {
  visible: boolean;
  targetPage: number;
  pageCount: number;
  isFinalizing: boolean;
  progress: number;
};

export type RapidTurnSessionState = {
  active: boolean;
  source: NavigationSource | null;
  direction: NavigationDirection | null;
};

export function shouldResetRapidTurnSession(
  session: RapidTurnSessionState,
  intent: RapidTurnIntent
) {
  return session.active && session.direction !== intent.direction;
}

export function shouldActivateRapidTurn(
  recentSamples: RapidTurnSample[],
  intent: RapidTurnIntent,
  now: number,
  nextPage: number
) {
  const windowStart = now - intent.activationWindowMs;
  const matchingSamples = recentSamples.filter(
    (sample) => sample.direction === intent.direction && sample.at >= windowStart
  );
  if (matchingSamples.length === 0) {
    return false;
  }

  const previousSample = matchingSamples[matchingSamples.length - 1];
  const expectedStep = intent.direction === "next" ? 1 : -1;
  if (nextPage - previousSample.page !== expectedStep) {
    return false;
  }

  return matchingSamples.length >= 1;
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
