import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { cgEscapeLabel, cgLabel, cgNodeId, topicMermaid } from "../src/mermaid.ts";
import { addPropositions, emptyGraph, upsertTopic, type Proposition } from "../src/graph.ts";

// Fixture built through the real graph API so ids and prereq edges are realistic.
function fixture(): { props: Proposition[]; byText: (t: string) => Proposition } {
  const g = emptyGraph();
  upsertTopic(g, "Kubernetes", "deploy a service");
  const { added } = addPropositions(g, "kubernetes", "s_1", [
    { text: "Kubernetes orchestrates containers across a cluster of machines." },
    { text: "A pod is the smallest deployable unit and can hold several containers." },
    { text: "kubectl talks to the API server", prereqTexts: ["Kubernetes orchestrates containers across a cluster of machines."] },
    {
      text: "A deployment keeps a stable number of replica pods running.",
      prereqTexts: ["A pod is the smallest deployable unit and can hold several containers.", "kubectl talks to the API server"],
    },
  ]);
  return { props: added, byText: (t) => added.find((p) => p.text === t)! };
}

test("cgNodeId strips non-alphanumerics and never empties", () => {
  assert.equal(cgNodeId("p_ab12cd34"), "pab12cd34");
  assert.equal(cgNodeId("___"), "n");
});

test("cgEscapeLabel neutralizes entity and quote syntax", () => {
  assert.equal(cgEscapeLabel('R&D "quotes" and #quot; traps'), 'R&D #quot;quotes#quot; and #35;quot; traps');
});

test("cgLabel truncates at a word boundary", () => {
  assert.equal(cgLabel("short claim"), "short claim");
  assert.equal(cgLabel("  spaced   out   text  "), "spaced out text");
  const long = cgLabel("one two three four five six seven eight nine ten eleven twelve thirteen");
  assert.ok(long.endsWith("…"));
  assert.ok(long.length <= 49, `length ${long.length}`);
  assert.ok(!long.slice(0, -1).endsWith(" "), "no trailing space before ellipsis");
});

test("topicMermaid emits nodes, prereq edges and a due class", () => {
  const { props, byText } = fixture();
  const root = byText("Kubernetes orchestrates containers across a cluster of machines.");
  const kubectl = byText("kubectl talks to the API server");
  const text = topicMermaid(props, new Set([kubectl.id]));
  const lines = text.split("\n");
  assert.equal(lines[0], "flowchart TD");
  assert.ok(lines.some((l) => l === `  ${cgNodeId(root.id)}["Kubernetes orchestrates containers across a…"]`), lines.join("\n"));
  assert.ok(
    lines.includes(`  ${cgNodeId(root.id)} --> ${cgNodeId(kubectl.id)}`),
    "prereq -> dependent edge",
  );
  assert.ok(lines.includes(`  class ${cgNodeId(kubectl.id)} due`));
});

test("topicMermaid drops dangling prereq references", () => {
  const { props } = fixture();
  const orphan = { ...props[0], id: "p_aaa111", prereqs: ["p_nonexistent1"] };
  const text = topicMermaid([orphan]);
  assert.ok(!text.includes("pnonexistent1"));
  assert.ok(!text.includes("-->"));
});

test("topicMermaid supports LR direction and empty topics", () => {
  const { props } = fixture();
  assert.equal(topicMermaid([]).length, 0);
  assert.equal(topicMermaid(props, new Set(), "LR").split("\n")[0], "flowchart LR");
});

// Differential check: everything we generate must parse and render through the
// vendored Pele build — including hostile labels.
test("generated mermaid renders through the vendored Pele build", () => {
  const file = new URL("../web/vendor/pele.global.js", import.meta.url);
  const code = fs.readFileSync(file, "utf8");
  vm.runInThisContext(code, { filename: file.pathname });
  const pele = (globalThis as unknown as { pele: { render: (text: string) => { svg: string } } }).pele;

  const { props, byText } = fixture();
  const nasty = addPropositions(emptyGraph(), "t", "s_2", [
    { text: 'He said "hi" #quot; and C:\\paths [work] {a:1} <b>raw</b> R&D — émoji 🌋 end' },
  ]).added;
  for (const batch of [props, nasty, []]) {
    for (const direction of ["TD", "LR"] as const) {
      const text = topicMermaid(batch, new Set([byText("kubectl talks to the API server").id]), direction);
      if (!text) continue;
      const r = pele.render(text);
      assert.ok(r.svg.startsWith("<svg"), `renders: ${text}`);
      assert.ok(!r.svg.includes("<script"), "no script injection");
    }
  }
});
