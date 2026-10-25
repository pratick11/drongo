import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  addPropositions,
  duePropositions,
  emptyGraph,
  exportMarkdown,
  loadGraph,
  saveGraph,
  upsertTopic,
} from "../src/graph.ts";
import { applyReview } from "../src/schedule.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drongo-graph-"));
}

test("addPropositions dedupes by normalized text", () => {
  const g = emptyGraph();
  const { added } = addPropositions(g, "b-trees", "s_1", [
    { text: "A B-tree keeps keys sorted in nodes." },
    { text: "a   B-tree keeps keys  sorted in nodes. " },
    { text: "Different claim entirely" },
  ]);
  assert.equal(added.length, 2);
  assert.equal(g.propositions.length, 2);
});

test("prereq texts resolve to ids; cycle edges are dropped", () => {
  const g = emptyGraph();
  const root = addPropositions(g, "t", "s_1", [{ text: "Root claim" }]).added[0];
  const child = addPropositions(g, "t", "s_1", [{ text: "Child claim", prereqTexts: ["root claim"] }]).added[0];
  assert.deepEqual(child.prereqs, [root.id]);

  // contradictory dependencies inside one batch: only one direction survives
  const { added } = addPropositions(g, "t", "s_1", [
    { text: "Claim A", prereqTexts: ["Claim B"] },
    { text: "Claim B", prereqTexts: ["Claim A"] },
  ]);
  const a = added.find((p) => p.text === "Claim A")!;
  const b = added.find((p) => p.text === "Claim B")!;
  assert.ok(a.prereqs.includes(b.id) !== b.prereqs.includes(a.id), "exactly one direction survives");
});

test("graph round-trips through disk", () => {
  const dir = tmpDir();
  const g = emptyGraph();
  upsertTopic(g, "B-Trees", "implement one");
  addPropositions(g, "b-trees", "s_1", [{ text: "Claim one" }]);
  saveGraph(g, dir);
  const loaded = loadGraph(dir);
  assert.equal(loaded.topics[0].name, "B-Trees");
  assert.equal(loaded.propositions[0].text, "Claim one");
});

test("duePropositions respects dueAt", () => {
  const g = emptyGraph();
  const now = new Date();
  const { added } = addPropositions(g, "t", "s_1", [{ text: "Future claim" }, { text: "Past claim" }]);
  applyReview(added[0], false, now); // fail -> due tomorrow
  added[1].dueAt = new Date(now.getTime() - 1000).toISOString();
  const due = duePropositions(g, now);
  assert.deepEqual(due.map((p) => p.text), ["Past claim"]);
});

test("exportMarkdown lists topics and propositions", () => {
  const g = emptyGraph();
  upsertTopic(g, "B-Trees", "implement one");
  addPropositions(g, "b-trees", "s_1", [{ text: "Claim one" }, { text: "Claim two", prereqTexts: ["Claim one"] }]);
  const md = exportMarkdown(g);
  assert.match(md, /# Knowledge Graph/);
  assert.match(md, /## B-Trees/);
  assert.match(md, /Claim one/);
  assert.match(md, /builds on/);
});
