# Drongo

A minimalist agentic harness for learning hard things, built as a small
local web app. Local-first, plain-file memory, bring your own API key.

Named for the [greater racket-tailed drongo](https://reluctantbookworm.com/2026/01/19/the-greater-racket-tailed-drongo-a-guide-to-organized-mimicry/) —
the glossy-black bird that earns its keep by learning other species' calls
perfectly, watching the forest while everyone else feeds. We are all mimics;
some masters, some apprentices. Drongo runs a tutor whose only job is to build
*durable, first-principles understanding* — mimicry with the understanding
behind it — and to remember what you've learned across sessions.

## Quick start

```bash
npm install
npm start        # → http://localhost:5188 (opens your browser)
```

First run lands you in **Settings**: pick any OpenAI-compatible provider, paste
your key, hit *Test connection*, save. That's the whole setup.

## How it works

Every learning session runs the same loop:

1. **Measure** — before teaching anything, the tutor probes 3–5 prerequisites,
   one question at a time, and you answer in your own words. It records where
   your understanding verifiably starts.
2. **Plan** — the tutor builds a dependency-ordered step map from *your* edge
   to your goal. You see it as a checklist; later sessions adapt it if your
   answers diverge.
3. **Teach** — per step: you **predict first**, then get an explanation built
   on what you've already verified, then one application question verifies it.
   Every verification ends in an explicit move: **promote** (verified — the
   idea enters your knowledge graph and the next step builds on it), **repair**
   (re-teach, differently and *more concretely* — the harness allows two per
   step), **refill** (revise the remaining plan; completed steps are frozen),
   or **block** (stop honestly; the gap is recorded). Repairs only ever
   descend to simpler ground, never up into more abstraction.
4. **Practice** — separate recall workouts. Problems are drawn from your graph
   (spaced repetition decides what's due); you must produce answers unprompted.
   Formats include rebuilds — construct the minimal working example from a
   blank page. Passes climb the interval ladder `1 → 3 → 7 → 14 → 30 → 60`
   days; fails reset to 1 day.

The daily ritual: open the dashboard, continue an active topic (or start one),
then clear what's due for review. Streak and due counts are on the dashboard.

## Your memory is plain files

Everything lives in `memory/` next to the app — open it, edit it, back it up:

```
memory/
├── config.json          # provider base URL, model, API key
├── graph.json           # the knowledge graph: topics + propositions + prereq edges
├── graph.md             # human-readable export (also downloadable in the UI)
├── plans/<topic>.json   # (via sessions) dependency maps
└── sessions/*.json      # full transcript + state of every session
```

A **proposition** is a single claim you have demonstrated you hold, e.g.
*"A rotation is a local relinking that preserves the BST ordering invariant."*
Each one links to the propositions it builds on and carries its own review
schedule. New sessions read this graph, so you never start from zero.

## Concept graph

The **Graph** view renders each topic's propositions as a clickable diagram —
not a force-directed hairball, but a read-only prerequisite map: arrows point
from foundational claims to the ideas built on them, claims due for review are
highlighted, and clicking a node opens its full text, review stats, and the
session it came from.

Diagrams are generated server-side (`src/mermaid.ts` emits Mermaid flowchart
text from the graph) and rendered by a vendored copy of
[Pele](https://github.com/obsidianmd/pele) — Obsidian's zero-dependency
Mermaid→SVG renderer — themed entirely with the app's CSS variables. Toggle
**Diagram/List** and **Top-down/Left-right** in the header; both preferences
persist.

## Bring your own key

Any endpoint that speaks the OpenAI chat-completions API (streaming + tool
calling) works:

| Provider | Base URL |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| Enterprise gateway | whatever your team's OpenAI-compatible proxy is |

The LLM never touches your files directly — it can only mutate memory through a
small tool registry (`save_propositions`, `update_plan`, `mark_step_done`,
`report_move`, `schedule_review`, `read_memory`, `record_assessment`), so every
change is inspectable in `graph.json`. Teaching decisions (repairs, plan
refills, blocks, promotions) are logged in the session file.

## Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5188` | HTTP port |
| `DRONGO_HOME` | `<project>/memory` | data directory (`LEARNLITE_HOME` still honored) |
| `NO_OPEN` | unset | set to skip auto-opening the browser |
| `DRONGO_MOCK` | unset | set to `1` for scripted no-network demo mode (`LEARNLITE_MOCK` still honored) |

## Development

```bash
npm run dev        # server with watch/restart
npm test           # 33 tests, deterministic: no LLM, no network
npm run typecheck  # tsc --noEmit
```

The agent loop, prompts, tools, and memory store are UI-agnostic
(`src/agent.ts`, `src/prompts.ts`, `src/tools.ts`, `src/graph.ts`) — the web
view is one server-rendered page of vanilla JS (`web/`). Phase prompts live in
`src/prompts.ts` and are meant to be edited: that's the teaching brain.

## Deliberately out of scope (for now)

Web research during lessons, native Anthropic/Gemini clients, multi-user,
Electron packaging. The server core keeps the dependency count at two
(`hono`, `@hono/node-server`).

## License

MIT. All code here is original.
