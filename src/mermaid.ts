import type { Proposition } from "./graph.ts";

// Serializes one topic's propositions into Mermaid flowchart text for the
// concept graph view (rendered client-side by the vendored Pele library).
// Node ids are proposition ids stripped to alphanumerics, so the rendered
// SVG's data-id maps straight back to a proposition for click handling.

export const CG_LABEL_MAX = 48;

export function cgNodeId(propId: string): string {
  return propId.replace(/[^A-Za-z0-9]/g, "") || "n";
}

// Mermaid reads # as the start of an entity (e.g. #quot;), and a bare "
// terminates the quoted label. Everything else used in claim text — brackets,
// braces, backslashes, <, >, newlines — either passes through inside quotes
// or is escaped by Pele itself.
export function cgEscapeLabel(text: string): string {
  return text.replace(/#/g, "#35;").replace(/"/g, "#quot;");
}

export function cgLabel(text: string, max: number = CG_LABEL_MAX): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp >= max / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function depthOf(byId: Map<string, Proposition>, p: Proposition, seen: Set<string> = new Set()): number {
  if (!p.prereqs.length || seen.has(p.id)) return 0;
  seen.add(p.id);
  let max = 0;
  for (const pid of p.prereqs) {
    const pre = byId.get(pid);
    if (pre) max = Math.max(max, depthOf(byId, pre, seen) + 1);
  }
  return max;
}

export function topicMermaid(
  props: Proposition[],
  dueIds: ReadonlySet<string> = new Set(),
  direction: "TD" | "LR" = "TD",
): string {
  if (!props.length) return "";
  const byId = new Map(props.map((p) => [p.id, p] as const));
  const ordered = props
    .slice()
    .sort((a, b) => depthOf(byId, a) - depthOf(byId, b) || a.createdAt.localeCompare(b.createdAt));

  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const p of ordered) {
    let id = cgNodeId(p.id);
    for (let n = 1; used.has(id); n++) id = `${cgNodeId(p.id)}${n}`;
    used.add(id);
    ids.set(p.id, id);
  }

  const lines: string[] = [`flowchart ${direction}`];
  for (const p of ordered) lines.push(`  ${ids.get(p.id)}["${cgEscapeLabel(cgLabel(p.text))}"]`);
  for (const p of ordered) {
    for (const pid of p.prereqs) {
      const pre = byId.get(pid);
      if (!pre) continue; // dangling or cross-topic reference
      lines.push(`  ${ids.get(pre.id)} --> ${ids.get(p.id)}`);
    }
  }
  const dueNodes = ordered.filter((p) => dueIds.has(p.id)).map((p) => ids.get(p.id) as string);
  if (dueNodes.length) lines.push(`  class ${dueNodes.join(",")} due`);
  return lines.join("\n");
}
