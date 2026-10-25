import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERVALS_DAYS, applyReview, isDue, nextDue } from "../src/schedule.ts";

test("interval ladder advances on pass and resets on fail", () => {
  const now = new Date();
  const prop = {
    id: "p_x",
    text: "claim",
    topicId: "t",
    prereqs: [],
    createdAt: now.toISOString(),
    sourceSessionId: "s",
    reviewLevel: 0,
    dueAt: nextDue(0, now),
    lastReviewedAt: null,
    timesSeen: 0,
    passes: 0,
  };

  applyReview(prop, true, now);
  assert.equal(prop.reviewLevel, 1);
  assert.equal(prop.timesSeen, 1);
  assert.equal(prop.passes, 1);
  assert.equal(new Date(prop.dueAt).getTime() - now.getTime(), INTERVALS_DAYS[1] * 86400_000);

  applyReview(prop, false, now);
  assert.equal(prop.reviewLevel, 0);
  assert.equal(prop.timesSeen, 2);
  assert.equal(prop.passes, 1);
  assert.equal(new Date(prop.dueAt).getTime() - now.getTime(), INTERVALS_DAYS[0] * 86400_000);
});

test("review level caps at the top of the ladder", () => {
  const now = new Date();
  const prop = {
    id: "p_y",
    text: "claim",
    topicId: "t",
    prereqs: [],
    createdAt: now.toISOString(),
    sourceSessionId: "s",
    reviewLevel: INTERVALS_DAYS.length - 1,
    dueAt: nextDue(0, now),
    lastReviewedAt: null,
    timesSeen: 0,
    passes: 0,
  };
  applyReview(prop, true, now);
  assert.equal(prop.reviewLevel, INTERVALS_DAYS.length - 1);
});

test("isDue boundary", () => {
  const now = new Date();
  const past = { dueAt: new Date(now.getTime() - 1).toISOString() };
  const future = { dueAt: new Date(now.getTime() + 86400_000).toISOString() };
  assert.ok(isDue(past as never, now));
  assert.ok(!isDue(future as never, now));
});
