import { describe, expect, it } from "vitest";

import {
  makeRapidTurnOverlayModel,
  shouldActivateRapidTurn,
  type RapidTurnSample,
  shouldResetRapidTurnSession
} from "./rapidTurn";

describe("rapidTurn", () => {
  function sample(
    at: number,
    direction: "next" | "previous",
    page: number,
    source: "keyboard" | "wheel" = "keyboard"
  ): RapidTurnSample {
    return { at, direction, page, source };
  }

  it("activates on the second sequential turn within the activation window", () => {
    expect(
      shouldActivateRapidTurn(
        [sample(1_000, "next", 2)],
        {
          source: "keyboard",
          direction: "next",
          activationWindowMs: 220
        },
        1_100,
        3
      )
    ).toBe(true);
  });

  it("activates after multiple sequential page turns within the activation window", () => {
    expect(
      shouldActivateRapidTurn(
        [sample(1_000, "next", 2), sample(1_110, "next", 3)],
        {
          source: "keyboard",
          direction: "next",
          activationWindowMs: 220
        },
        1_120,
        4
      )
    ).toBe(true);
  });

  it("can activate across input sources when turn cadence stays consistent", () => {
    expect(
      shouldActivateRapidTurn(
        [sample(1_000, "previous", 9, "wheel"), sample(1_090, "previous", 8, "keyboard")],
        {
          source: "wheel",
          direction: "previous",
          activationWindowMs: 180
        },
        1_120,
        7
      )
    ).toBe(true);
  });

  it("does not activate for mismatched direction, stale turns, or non-sequential pages", () => {
    expect(
      shouldActivateRapidTurn(
        [sample(1_000, "next", 2), sample(1_100, "next", 3)],
        {
          source: "keyboard",
          direction: "previous",
          activationWindowMs: 220
        },
        1_120,
        2
      )
    ).toBe(false);

    expect(
      shouldActivateRapidTurn(
        [sample(1_000, "next", 2), sample(1_050, "next", 3)],
        {
          source: "keyboard",
          direction: "next",
          activationWindowMs: 220
        },
        1_300,
        4
      )
    ).toBe(false);

    expect(
      shouldActivateRapidTurn(
        [sample(1_000, "next", 2), sample(1_090, "next", 4)],
        {
          source: "keyboard",
          direction: "next",
          activationWindowMs: 220
        },
        1_120,
        6
      )
    ).toBe(false);
  });

  it("resets an active session when the navigation stream changes direction", () => {
    expect(
      shouldResetRapidTurnSession(
        {
          active: true,
          source: "keyboard",
          direction: "next"
        },
        {
          source: "keyboard",
          direction: "previous",
          activationWindowMs: 220
        }
      )
    ).toBe(true);
  });

  it("does not reset when repeated input stays in the same direction", () => {
    expect(
      shouldResetRapidTurnSession(
        {
          active: true,
          source: "keyboard",
          direction: "next"
        },
        {
          source: "wheel",
          direction: "next",
          activationWindowMs: 220
        }
      )
    ).toBe(false);
  });

  it("builds a clamped overlay model with normalized progress", () => {
    expect(makeRapidTurnOverlayModel(12, 100, false)).toEqual({
      visible: true,
      targetPage: 12,
      pageCount: 100,
      isFinalizing: false,
      progress: 0.12
    });

    expect(makeRapidTurnOverlayModel(0, 0, true)).toEqual({
      visible: true,
      targetPage: 1,
      pageCount: 1,
      isFinalizing: true,
      progress: 1
    });
  });
});
