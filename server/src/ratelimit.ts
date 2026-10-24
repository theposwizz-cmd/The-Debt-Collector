import type { NextFunction, Request, Response } from "express";

/**
 * Per-IP limit for routes that spend Anthropic credits (chat, receipts, nudges via fast-forward).
 * A sliding one-minute window, in memory: enough to stop a public visitor hammering the key,
 * generous enough that a normal demo never notices.
 */
export function aiRateLimit(perMinute = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  // Forget idle visitors so the map can't grow forever.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of hits) if (!times.some((t) => t > cutoff)) hits.delete(ip);
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= perMinute) {
      const retry = Math.ceil((recent[0] + windowMs - now) / 1000);
      res.set("Retry-After", String(retry));
      return res.status(429).json({ error: `The Collector needs a breather. Too many requests from here; try again in ${retry}s.` });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}
