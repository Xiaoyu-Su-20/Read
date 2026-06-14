import { describe, expect, it } from "vitest";

import { makeRapidTurnOverlayModel, shouldActivateRapidTurn } from "./rapidTurn";

describe("rapidTurn", () => {
  it("activates on repeated keydown even without prior input", () => {
    expect(
      shouldActivateRapidTurn(
        null,
        {
          source: "keyboard",
          direction: "next",
          activationWindowMs: 220,
          isRepeat: true
        },
        1_000
      )
    ).toBe(true);
  });

  it("activates when the next matching input arrives within the activation window", () => {
    expect(
      shouldActivateRapidTurn(
        {
          at: 1_000,
          source: "wheel",
          direction: "previous"
        },
        {
          source: "wheel",
          direction: "previous",
          activationWindowMs: 180
        },
        1_120
      )
    ).toBe(true);
  });

  it("does not activate for mismatched direction or stale input", () => {
    expect(
      shouldActivateRapidTurn(
        {
          at: 1_000,
          source: "keyboard",
          direction: "next"
        },
        {
          source: "keyboard",
          direction: "previous",
          activationWindowMs: 220
        },
        1_120
      )
    ).toBe(false);

    expect(
      shouldActivateRapidTurn(
        {
          at: 1_000,
          source: "keyboard",
          direction: "next"
        },
        {
          source: "keyboard",
          direction: "next",
          activationWindowMs: 220
        },
        1_300
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
