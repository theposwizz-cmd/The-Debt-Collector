import { describe, expect, it } from "vitest";
import { levelFor, nudgeDue } from "./nudge.js";

describe("nudge ladder", () => {
  it("sends the first nudge immediately", () => {
    expect(nudgeDue(0, 0, null)).toBe(true);
  });

  it("waits until day 2 for the second, day 4 for the third, then every 2 days", () => {
    expect(nudgeDue(1, 1.9, 1.9)).toBe(false);
    expect(nudgeDue(1, 2, 2)).toBe(true);
    expect(nudgeDue(2, 3.5, 1.5)).toBe(false);
    expect(nudgeDue(2, 4, 2)).toBe(true);
    expect(nudgeDue(3, 5, 1)).toBe(false);
    expect(nudgeDue(3, 6, 2)).toBe(true);
  });

  it("sends at most one nudge per simulated day even after a big jump", () => {
    expect(nudgeDue(2, 10, 0.1)).toBe(false);
  });

  it("stops after the cap", () => {
    expect(nudgeDue(6, 100, 10)).toBe(false);
  });

  it("maps nudge numbers to escalation levels", () => {
    expect([1, 2, 3, 4, 5].map(levelFor)).toEqual([1, 2, 3, 3, 3]);
  });
});
