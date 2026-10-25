import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runTurn, type AgentEvent } from "../src/agent.ts";
import { addPropositions, loadGraph, saveGraph } from "../src/graph.ts";
import { createSession, saveSession } from "../src/session.ts";
import { loadConfig, saveConfig } from "../src/config.ts";

// The agent loop is exercised end-to-end against the scripted mock provider
// (DRONGO_MOCK=1): measure -> plan -> teach (3 steps) -> done, no network.

test("learn session runs the full measure/plan/teach loop under the mock provider", async () => {
  process.env.DRONGO_MOCK = "1";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drongo-agent-"));
  saveConfig({ baseUrl: "http://mock", apiKey: "mock", model: "mock" }, dir);

  const session = createSession({ mode: "learn", topicName: "Mock Topic", goal: "understand it" });
  saveSession(session, dir);

  const events: AgentEvent[] = [];
  await runTurn(session, { dataDir: dir, cfg: loadConfig(dir) }, (e) => events.push(e));

  // phase transitions surfaced
  assert.ok(events.some((e) => e.type === "phase" && e.phase === "teach"));
  assert.ok(events.some((e) => e.type === "phase" && e.phase === "done"));

  // final state persisted
  const graph = loadGraph(dir);
  assert.equal(graph.topics.length, 1);
  assert.equal(graph.topics[0].id, "mock-topic");
  assert.ok(graph.propositions.length >= 2);
  assert.ok(session.plan, "plan was created");
  assert.equal(session.plan.steps.length, 3);
  assert.ok(session.plan.steps.every((s) => s.doneAt), "all steps completed");
  assert.equal(session.phase, "done");
  assert.ok(session.assessment, "assessment was recorded");
  // history contains assistant + tool messages
  assert.ok(session.messages.some((m) => m.role === "tool"));
  assert.ok(events.some((e) => e.type === "tool_result" && e.name === "save_propositions" && e.ok));
  delete process.env.DRONGO_MOCK;
});

test("practice turn schedules reviews against the graph", async () => {
  process.env.DRONGO_MOCK = "1";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drongo-agent-"));
  saveConfig({ baseUrl: "http://mock", apiKey: "mock", model: "mock" }, dir);

  // seed two propositions
  const g = loadGraph(dir);
  const { added } = addPropositions(g, "mock-topic", "s_seed", [{ text: "Seed claim one" }, { text: "Seed claim two" }]);
  saveGraph(g, dir);

  const session = createSession({
    mode: "practice",
    topicName: "Practice",
    goal: "",
    practiceIds: added.map((p) => p.id),
  });
  saveSession(session, dir);

  await runTurn(session, { dataDir: dir, cfg: loadConfig(dir) }, () => {});

  const after = loadGraph(dir);
  const reviewed = after.propositions.filter((p) => p.timesSeen > 0);
  assert.ok(reviewed.length >= 1, "at least one proposition was reviewed");
  assert.ok(reviewed.every((p) => p.lastReviewedAt), "reviews are stamped");
  delete process.env.DRONGO_MOCK;
});
