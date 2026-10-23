import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { aiRateLimit } from "./ratelimit.js";

function call(limit: ReturnType<typeof aiRateLimit>, ip: string) {
  let status = 200;
  let passed = false;
  const res = { set: () => res, status: (s: number) => ((status = s), res), json: () => res } as unknown as Response;
  limit({ ip } as Request, res, () => (passed = true));
  return passed ? 200 : status;
}

describe("AI rate limit", () => {
  it("allows up to the limit per IP, then answers 429", () => {
    const limit = aiRateLimit(3);
    expect([1, 2, 3].map(() => call(limit, "1.1.1.1"))).toEqual([200, 200, 200]);
    expect(call(limit, "1.1.1.1")).toBe(429);
    expect(call(limit, "2.2.2.2")).toBe(200); // other visitors unaffected
  });
});
