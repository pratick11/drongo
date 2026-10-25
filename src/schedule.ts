import type { Proposition } from "./graph.ts";

// Simplified spaced repetition: a fixed ladder of intervals. Passing recall
// climbs one rung, failing resets to 1 day. Inspectable, predictable, no magic.
export const INTERVALS_DAYS = [1, 3, 7, 14, 30, 60];

export function nextDue(level: number, from: Date = new Date()): string {
  const clamped = Math.min(Math.max(level, 0), INTERVALS_DAYS.length - 1);
  const days = INTERVALS_DAYS[clamped];
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function applyReview(prop: Proposition, passed: boolean, now: Date = new Date()): Proposition {
  prop.timesSeen += 1;
  prop.lastReviewedAt = now.toISOString();
  if (passed) {
    prop.passes += 1;
    prop.reviewLevel = Math.min(prop.reviewLevel + 1, INTERVALS_DAYS.length - 1);
  } else {
    prop.reviewLevel = 0;
  }
  prop.dueAt = nextDue(prop.reviewLevel, now);
  return prop;
}

export function isDue(prop: Proposition, now: Date = new Date()): boolean {
  return new Date(prop.dueAt).getTime() <= now.getTime();
}
