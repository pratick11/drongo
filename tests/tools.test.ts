import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeTool } from "../src/tools.ts";
import { createSession, loadSession, REPAIR_CAP, saveSession, type Session } from "../src/session.ts";

// Decision-point loop mechanics: repair cap, block, and teach-phase plan
// revision with frozen completed steps. All deterministic — no LLM, no network.

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drongo-tools-"));
}

function teachSession(dir: string, doneCount = 1): Session {
  const now = new Date().toISOString();
  const s = createSession({ mode: "learn", topicName: "Mock Topic", goal: "g" });
  s.phase = "teach";
  s.plan = {
    steps: [
      { id: "step_1", title: "Foundations", description: "base", doneAt: doneCount >= 1 ? now : null, attemptCount: 0, blockedAt: null },
      { id: "step_2", title: "Mechanism", description: "mid", doneAt: doneCount >= 2 ? now : null, attemptCount: 0, blockedAt: null },
      { id: "step_3", title: "Application", description: "top", doneAt: null, attemptCount: 0, blockedAt: null },
    ],
  };
  s.currentStepId = doneCount >= 2 ? "step_3" : "step_2";
  s.assessment = { solid: ["base"], gaps: [], notes: "", at: now };
  saveSession(s, dir);
  return s;
}

async function call(name: string, args: unknown, dir: string, session: Session) {
  return executeTool(name, JSON.stringify(args), { dataDir: dir, session });
}

test("report_move counts repairs, enforces the cap, and persists", async () => {
  const dir = tmpDir();
  const s = teachSession(dir);

  const r1 = await call("report_move", { stepId: "step_2", move: "repair", note: "smaller example" }, dir, s);
  assert.equal(r1.ok, true);
  const r2 = await call("report_move", { stepId: "step_2", move: "repair", note: "trace line by line" }, dir, s);
  assert.equal(r2.ok, true);
  assert.match(r2.output, new RegExp(`final repair`));

  assert.equal(s.plan!.steps[1].attemptCount, REPAIR_CAP);
  const r3 = await call("report_move", { stepId: "step_2", move: "repair", note: "again" }, dir, s);
  assert.match(r3.output, /Repair cap reached/);
  assert.equal(s.plan!.steps[1].attemptCount, REPAIR_CAP, "third repair refused, not counted");

  assert.equal(s.moves.filter((m) => m.move === "repair").length, 2);
  const reloaded = loadSession(s.id, dir)!;
  assert.equal(reloaded.plan!.steps[1].attemptCount, REPAIR_CAP);
});

test("report_move block marks the step and records a gap", async () => {
  const dir = tmpDir();
  const s = teachSession(dir);

  const r = await call("report_move", { stepId: "step_2", move: "block", note: "missing prerequisite X" }, dir, s);
  assert.equal(r.ok, true);
  assert.ok(s.plan!.steps[1].blockedAt, "blockedAt set");
  assert.ok(s.assessment!.gaps.includes("Mechanism"), "gap recorded by title");
  assert.equal(s.moves[s.moves.length - 1].move, "block");
});

test("plan revision refuses to drop or reorder completed steps", async () => {
  const dir = tmpDir();
  const s = teachSession(dir, 2); // step_1 and step_2 done, current step_3

  const drop = await call(
    "update_plan",
    {
      steps: [
        { id: "step_2", title: "Mechanism", description: "mid" },
        { id: "step_3", title: "Application", description: "top" },
      ],
      reason: "drop the done step",
    },
    dir,
    s,
  );
  assert.match(drop.output, /completed steps are frozen/);

  const reorder = await call(
    "update_plan",
    {
      steps: [
        { id: "step_2", title: "Mechanism", description: "mid" },
        { id: "step_1", title: "Foundations", description: "base" },
        { id: "step_3", title: "Application", description: "top" },
      ],
      reason: "swap done order",
    },
    dir,
    s,
  );
  assert.match(reorder.output, /completed steps are frozen/);

  assert.equal(s.plan!.steps.length, 3, "plan unchanged after refusals");
  assert.equal(s.moves.length, 0, "refusals are not logged as moves");
});

test("revision keeps done steps verbatim, resets counters on edit, mints fresh ids", async () => {
  const dir = tmpDir();
  const s = teachSession(dir); // step_1 done; step_2 current; step_3 open
  s.plan!.steps[1].attemptCount = REPAIR_CAP; // step_2 burned its repairs
  s.plan!.steps[2].attemptCount = 1; // step_3 has one repair used
  saveSession(s, dir);

  const r = await call(
    "update_plan",
    {
      steps: [
        { id: "step_1", title: "HACKED", description: "should be ignored" },
        { id: "step_2", title: "Mechanism, first half", description: "smaller scope" },
        { title: "Trace one rotation by hand", description: "concrete sub-step" },
        { id: "step_3", title: "Application", description: "top" },
      ],
      reason: "step_2 was too big",
    },
    dir,
    s,
  );
  assert.equal(r.ok, true);

  const steps = s.plan!.steps;
  assert.equal(steps.length, 4);
  assert.equal(steps[0].title, "Foundations", "frozen step kept verbatim");
  assert.ok(steps[0].doneAt, "frozen step still done");
  assert.equal(steps[1].attemptCount, 0, "edited open step resets its repair count");
  assert.equal(steps[1].blockedAt, null);
  assert.equal(steps[2].id, "step_4", "new step gets a non-colliding id");
  assert.equal(steps[3].attemptCount, 1, "carried unchanged step keeps its count");
  assert.equal(s.currentStepId, "step_2", "current is the first open step");
  assert.equal(s.moves[s.moves.length - 1].move, "refill");
  assert.equal(s.moves[s.moves.length - 1].note, "step_2 was too big");
});

test("revision with unknown or duplicate ids is rejected", async () => {
  const dir = tmpDir();
  const s = teachSession(dir);

  const unknown = await call(
    "update_plan",
    { steps: [{ id: "step_9", title: "X", description: "x" }, { id: "step_2", title: "Mechanism", description: "mid" }] },
    dir,
    s,
  );
  assert.match(unknown.output, /Unknown step id/);

  const dup = await call(
    "update_plan",
    {
      steps: [
        { id: "step_2", title: "Mechanism", description: "mid" },
        { id: "step_2", title: "Mechanism", description: "mid" },
      ],
    },
    dir,
    s,
  );
  assert.match(dup.output, /appears twice/);
});

test("mark_step_done logs a promote move and advances", async () => {
  const dir = tmpDir();
  const s = teachSession(dir);

  const r = await call("mark_step_done", { stepId: "step_2" }, dir, s);
  assert.equal(r.ok, true);
  assert.equal(s.moves[s.moves.length - 1].move, "promote");
  assert.equal(s.currentStepId, "step_3");
});

test("measure-phase update_plan still creates a fresh plan and flips to teach", async () => {
  const dir = tmpDir();
  const s = createSession({ mode: "learn", topicName: "Fresh", goal: "g" });
  saveSession(s, dir);

  const r = await call(
    "update_plan",
    { steps: [{ title: "A", description: "a" }, { title: "B", description: "b" }] },
    dir,
    s,
  );
  assert.equal(r.ok, true);
  assert.equal(s.phase, "teach");
  assert.deepEqual(
    s.plan!.steps.map((x) => x.id),
    ["step_1", "step_2"],
  );
  assert.equal(s.plan!.steps[0].attemptCount, 0);
});

test("legacy session files without move fields hydrate with defaults", () => {
  const dir = tmpDir();
  const s = teachSession(dir);

  const legacy = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  delete legacy.moves;
  for (const st of (legacy.plan as { steps: Array<Record<string, unknown>> }).steps) {
    delete st.attemptCount;
    delete st.blockedAt;
  }
  fs.writeFileSync(path.join(dir, "sessions", `${s.id}.json`), JSON.stringify(legacy));

  const loaded = loadSession(s.id, dir)!;
  assert.deepEqual(loaded.moves, []);
  assert.equal(loaded.plan!.steps[1].attemptCount, 0);
  assert.equal(loaded.plan!.steps[1].blockedAt, null);
});
