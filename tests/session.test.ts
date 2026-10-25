import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSession, listSessions, loadSession, nextOpenStep, saveSession } from "../src/session.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drongo-session-"));
}

test("learn session starts in measure phase with an opening message", () => {
  const s = createSession({ mode: "learn", topicName: "B-Trees", goal: "implement one" });
  assert.equal(s.phase, "measure");
  assert.equal(s.topicId, "b-trees");
  assert.equal(s.messages.length, 1);
  assert.match(s.messages[0].content!, /I want to learn: B-Trees/);
});

test("practice session starts in practice phase", () => {
  const s = createSession({ mode: "practice", topicName: "Practice", goal: "", practiceIds: ["p_1"] });
  assert.equal(s.phase, "practice");
  assert.deepEqual(s.practiceIds, ["p_1"]);
});

test("session round-trips through disk and lists newest first", async () => {
  const dir = tmpDir();
  const a = createSession({ mode: "learn", topicName: "Alpha", goal: "" });
  const b = createSession({ mode: "learn", topicName: "Beta", goal: "" });
  saveSession(a, dir);
  await new Promise((r) => setTimeout(r, 3)); // updatedAt has ms resolution
  saveSession(b, dir);

  const loaded = loadSession(a.id, dir)!;
  assert.equal(loaded.topicName, "Alpha");

  const list = listSessions(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id); // later updatedAt sorts first
});

test("loadSession rejects ids that look like path traversal", () => {
  const dir = tmpDir();
  assert.equal(loadSession("../config", dir), null);
  assert.equal(loadSession("a/b", dir), null);
});

test("nextOpenStep skips done steps", () => {
  const s = createSession({ mode: "learn", topicName: "T", goal: "" });
  const now = new Date().toISOString();
  s.plan = {
    steps: [
      { id: "step_1", title: "one", description: "", doneAt: now, attemptCount: 0, blockedAt: null },
      { id: "step_2", title: "two", description: "", doneAt: null, attemptCount: 0, blockedAt: null },
    ],
  };
  assert.equal(nextOpenStep(s.plan)!.id, "step_2");
});
