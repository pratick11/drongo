"use strict";

/* ============================================================================
   Drongo — harness UI logic
   Vanilla JS, no build step. Component patterns from affectUI (app shell,
   tool call cards, message actions) and AICSS (thinking shimmer, streaming
   caret, orb — MIT).
   ========================================================================== */

const $ = (sel, el = document) => el.querySelector(sel);

/* ---------------------------------------------------------------- utilities */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function md(text) {
  return DOMPurify.sanitize(marked.parse(text ?? "", { breaks: true, gfm: true }));
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60e3) return "just now";
  if (ms < 3600e3) return `${Math.floor(ms / 60e3)}m ago`;
  if (ms < 86400e3) return `${Math.floor(ms / 3600e3)}h ago`;
  if (ms < 7 * 86400e3) return `${Math.floor(ms / 86400e3)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clockFmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return true;
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/* ---------------------------------------------------------------- icons */

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.8"/>',
  graph: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  panelLeft: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  panelRight: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  plan: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  stepDone: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  sparkles: '<path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>',
};

function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
}

const TOOL_META = {
  read_memory: { label: "Reading memory", icon: "search" },
  record_assessment: { label: "Recording assessment", icon: "clipboard" },
  update_plan: { label: "Building plan", icon: "plan" },
  save_propositions: { label: "Saving propositions", icon: "database" },
  mark_step_done: { label: "Marking step done", icon: "stepDone" },
  report_move: { label: "Adjusting approach", icon: "zap" },
  schedule_review: { label: "Scheduling reviews", icon: "clock" },
};

const PHASE_INFO = {
  measure: ["Measure", "The tutor is probing where your understanding ends — answer in your own words.", "Answer in your own words…"],
  teach: ["Teach", "Predict → explain → verify. Failed checks get repaired differently, refilled, or blocked — never skipped.", "Make your prediction first…"],
  practice: ["Practice", "Recall workout — produce the answers unprompted, no peeking.", "Produce the answer unprompted…"],
  done: ["Complete", "Plan finished. Your knowledge graph has been updated.", "Anything unclear? Ask, or start a new topic…"],
};

/* ---------------------------------------------------------------- theme */

function initTheme() {
  const saved = localStorage.getItem("ll-theme");
  const t = saved === "light" || saved === "dark" ? saved : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(t);
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("ll-theme", t);
  const btn = $("#theme-toggle");
  if (btn) btn.innerHTML = icon(t === "dark" ? "sun" : "moon");
}

/* ---------------------------------------------------------------- state */

const S = {
  view: "dashboard",
  state: null, // /api/state payload
  sessions: [], // /api/sessions payload
  session: null, // active full session
  streaming: false,
  openWs: new Set(JSON.parse(localStorage.getItem("ll-ws-open") || "[]")),
};

/* ---------------------------------------------------------------- shell */

function wireShell() {
  $("#sb-new .i").innerHTML = icon("plus");
  $("#sb-practice .i").innerHTML = icon("zap");
  document.querySelectorAll(".sb-nav a").forEach((a) => (a.querySelector(".i").innerHTML = icon(a.dataset.view === "graph" ? "graph" : "home")));
  $("#sb-collapse").innerHTML = icon("panelLeft");
  $("#sb-menu").innerHTML = icon("menu");
  document.querySelector('.sb-foot a[href="#/settings"]').innerHTML = icon("settings");

  $("#theme-toggle").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  $("#sb-collapse").onclick = () => {
    const rail = document.body.classList.toggle("rail");
    localStorage.setItem("ll-rail", rail ? "1" : "0");
  };
  if (localStorage.getItem("ll-rail") === "1") document.body.classList.add("rail");

  $("#sb-menu").onclick = () => document.body.classList.add("sb-open");
  $("#sb-backdrop").onclick = () => document.body.classList.remove("sb-open");

  $("#cg-scrim").onclick = closeConceptDrawer;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeConceptDrawer();
  });

  $("#sb-new").onclick = () => {
    document.body.classList.remove("sb-open");
    if (S.view === "dashboard") $("#ns-topic")?.focus();
    else location.hash = "#/";
    if (S.view === "dashboard") setTimeout(() => $("#ns-topic")?.focus(), 0);
  };

  $("#sb-practice").onclick = async () => {
    try {
      const s = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode: "practice" }) });
      document.body.classList.remove("sb-open");
      if (s.resumed) toast("Resuming today's workout.");
      location.hash = `#/session/${s.id}`;
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function refreshShell() {
  try {
    const [st, sessions] = await Promise.all([api("/api/state"), api("/api/sessions")]);
    S.state = st;
    S.sessions = sessions;
  } catch (e) {
    $("#sb-stats").textContent = "";
    return;
  }
  renderSidebar();
}

function sessionRow(s, active) {
  const a = document.createElement("a");
  a.className = "srow" + (active ? " on" : "");
  a.href = `#/session/${s.id}`;
  const live = active && S.streaming ? " live" : "";
  a.innerHTML = `
    <span class="i">${icon(s.mode === "practice" ? "sparkles" : "book", 14)}</span>
    <span class="srow-name">${esc(s.mode === "practice" ? "Recall workout" : s.topicName)}</span>
    <span class="srow-dot ${esc(s.phase)}${live}"></span>
    <span class="ws-meta">${relTime(s.updatedAt)}</span>`;
  a.onclick = () => document.body.classList.remove("sb-open");
  return a;
}

function renderSidebar() {
  const st = S.state;
  if (!st) return;

  // nav + footer stats
  const propsPill = $("#nav-props");
  propsPill.hidden = !st.totalPropositions;
  propsPill.textContent = st.totalPropositions;
  const duePill = $("#sb-due-pill");
  duePill.hidden = !st.dueCount;
  duePill.textContent = `${st.dueCount} due`;
  $("#sb-stats").innerHTML = `
    <span class="stat"><b>${st.streak}</b>${icon("flame", 13)}streak</span>
    <span class="stat ${st.dueCount ? "hot" : ""}"><b>${st.dueCount}</b>${icon("clock", 13)}due</span>`;
  $("#model-chip").textContent = st.config?.model || "";

  // workspaces: active topics with their sessions
  const activeId = S.session?.id ?? null;
  const activeTopicId = S.session?.topicId ?? null;
  const byTopic = new Map();
  for (const s of S.sessions) {
    if (!byTopic.has(s.topicId)) byTopic.set(s.topicId, []);
    byTopic.get(s.topicId).push(s);
  }

  const wsBox = $("#sb-workspaces");
  const wsList = $("#ws-list");
  wsList.innerHTML = "";
  const topics = st.activeTopics ?? [];
  wsBox.hidden = !topics.length;
  for (const t of topics) {
    const group = document.createElement("div");
    const isOpen = S.openWs.has(t.topicId) || t.topicId === activeTopicId;
    group.className = "ws" + (isOpen ? " open" : "") + (t.total && t.done >= t.total ? " done" : "");
    const pct = t.total ? Math.round((100 * t.done) / t.total) : 0;
    const sessions = (byTopic.get(t.topicId) ?? []).slice(0, 6);
    group.innerHTML = `
      <button class="ws-head" title="${esc(t.name)}">
        <span class="ws-toggle">${icon("chevron", 12)}</span>
        <span class="ws-info">
          <span class="ws-name">${esc(t.name)}</span>
          <span class="ws-prog"><div style="width:${pct}%"></div></span>
          <span class="ws-meta">${t.total ? `${t.done}/${t.total} steps${t.currentStepTitle ? ` · ${esc(t.currentStepTitle)}` : ""}` : "plan pending"}</span>
        </span>
      </button>
      <div class="ws-sessions"></div>`;
    group.querySelector(".ws-head").onclick = () => {
      if (S.openWs.has(t.topicId)) S.openWs.delete(t.topicId);
      else S.openWs.add(t.topicId);
      localStorage.setItem("ll-ws-open", JSON.stringify([...S.openWs]));
      group.classList.toggle("open");
    };
    const holder = group.querySelector(".ws-sessions");
    for (const s of sessions) holder.append(sessionRow(s, s.id === activeId));
    wsList.append(group);
    byTopic.delete(t.topicId);
  }

  // recent: everything else (practice sessions, finished topics)
  const rest = [...byTopic.values()].flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const recentBox = $("#sb-recent");
  const recentList = $("#recent-list");
  recentList.innerHTML = "";
  recentBox.hidden = !rest.length;
  for (const s of rest) recentList.append(sessionRow(s, s.id === activeId));

  if (!topics.length && !rest.length) {
    wsBox.hidden = false;
    wsList.innerHTML = `<p class="sb-empty">No workspaces yet — start a learning session and it will live here.</p>`;
  }
}

function setNav(view, sessionId) {
  S.view = view;
  document.querySelectorAll(".sb-nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === view && !sessionId));
  document.title = "Drongo";
}

function setMainbar(titleHtml, actions = "") {
  $("#mainbar-title").innerHTML = titleHtml;
  $("#mainbar-actions").innerHTML = actions;
}

/* ---------------------------------------------------------------- router */

window.addEventListener("hashchange", route);

function route() {
  closeConceptDrawer();
  const [view, arg] = (location.hash || "#/").slice(2).split("/");
  if (view === "session" && arg) showSession(arg);
  else if (view === "graph") showGraph();
  else if (view === "settings") showSettings();
  else showDashboard();
}

/* ---------------------------------------------------------------- dashboard */

function countUp(el, target) {
  if (!target) {
    el.textContent = "0";
    return;
  }
  const t0 = performance.now();
  const dur = 450;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function showDashboard() {
  S.session = null;
  setNav("dashboard");
  setMainbar(`Today <span class="crumb">· ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>`);
  const app = $("#app");
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let st;
  try {
    st = await api("/api/state");
    S.state = st;
  } catch (e) {
    app.innerHTML = `<div class="page"><div class="errbox">${esc(e.message)}</div></div>`;
    return;
  }
  renderSidebar();
  const due = st.dueCount;
  app.innerHTML = `
  <div class="page">
    <div class="page-head"><h1>Today</h1><span class="sub">We are all mimics — some masters, some apprentices.</span></div>
    ${st.hasKey ? "" : `<div class="warnbox">${icon("zap", 15)} No API key configured yet. <a href="#/settings">Open Settings →</a></div>`}
    <div class="statgrid">
      <div class="stat accent"><div class="k">${icon("flame", 13)} Streak</div><div class="v" data-n="${st.streak}">0</div><div class="k">days in a row</div></div>
      <div class="stat ${due ? "hot" : ""}"><div class="k">${icon("clock", 13)} Due for review</div><div class="v" data-n="${due}">0</div><div class="k">spaced repetition</div></div>
      <div class="stat"><div class="k">${icon("zap", 13)} Learned today</div><div class="v" data-n="${st.learnedToday}">0</div><div class="k">new propositions</div></div>
      <div class="stat"><div class="k">${icon("database", 13)} Knowledge</div><div class="v" data-n="${st.totalPropositions}">0</div><div class="k">propositions held</div></div>
    </div>
    <div class="cols2">
      <div class="card">
        <h2>New learning session</h2>
        <p class="hint">The tutor measures where your understanding starts, plans from there, then teaches step by step.</p>
        <div class="field" style="margin-top:14px"><span>Topic</span><input type="text" id="ns-topic" placeholder="e.g. B-trees from first principles" /></div>
        <div class="field"><span>Goal <i style="font-style:normal;color:var(--muted);font-weight:400">(optional)</i></span><textarea id="ns-goal" rows="2" placeholder="e.g. implement one and explain when it beats a red-black tree"></textarea></div>
        <button id="ns-start" class="btn primary">${icon("plus", 15)} Start session</button>
      </div>
      <div class="card">
        <h2>Practice recall</h2>
        <p class="hint">Varied problems drawn from your knowledge graph. Spaced repetition decides what's due — produce answers unprompted.</p>
        <button id="ns-practice" class="btn secondary" style="margin-top:14px" ${st.totalPropositions ? "" : "disabled"}>${icon("sparkles", 15)} Practice${due ? ` · ${due} due` : ""}</button>
        ${st.totalPropositions ? "" : `<p class="hint">Nothing learned yet — finish a learning session first.</p>`}
      </div>
    </div>
    ${st.activeTopics.length ? `
    <div class="card">
      <h2>Active workspaces</h2>
      <div class="rowlist">${st.activeTopics.map((t) => `
        <div class="trow">
          <div class="trow-main">
            <div class="trow-title">${esc(t.name)}</div>
            ${t.goal ? `<div class="trow-sub">${esc(t.goal)}</div>` : ""}
            <div class="prog"><div style="width:${t.total ? (100 * t.done) / t.total : 0}%"></div></div>
            <div class="trow-sub" style="margin-top:5px">${t.total ? `${t.done}/${t.total} steps${t.currentStepTitle ? ` · next: ${esc(t.currentStepTitle)}` : ""}` : "plan pending"}</div>
          </div>
          ${t.resumeSessionId ? `<a class="btn secondary" href="#/session/${t.resumeSessionId}">Continue</a>` : ""}
        </div>`).join("")}</div>
    </div>` : ""}
    ${st.recentSessions.length ? `
    <div class="card">
      <h2>Recent sessions</h2>
      <div class="rowlist">${st.recentSessions.map((s) => `
        <div class="trow">
          <div class="trow-main">
            <div class="trow-title">${esc(s.topicName)} <span class="pill phase ${esc(s.phase)}">${esc(PHASE_INFO[s.phase]?.[0] ?? s.phase)}</span></div>
            <div class="trow-sub">${s.mode} · ${relTime(s.updatedAt)}</div>
          </div>
          <a class="btn ghost" href="#/session/${s.id}">Open</a>
        </div>`).join("")}</div>
    </div>` : ""}
  </div>`;

  app.querySelectorAll(".stat .v").forEach((el) => countUp(el, Number(el.dataset.n || 0)));

  $("#ns-start").onclick = async () => {
    const topic = $("#ns-topic").value.trim();
    const goal = $("#ns-goal").value.trim();
    if (!topic) return toast("Give the session a topic.", true);
    try {
      const s = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode: "learn", topic, goal }) });
      location.hash = `#/session/${s.id}`;
    } catch (e) {
      toast(e.message, true);
    }
  };
  $("#ns-practice").onclick = async () => {
    try {
      const s = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode: "practice" }) });
      if (s.resumed) toast("Resuming today's workout.");
      location.hash = `#/session/${s.id}`;
    } catch (e) {
      toast(e.message, true);
    }
  };
}

/* ---------------------------------------------------------------- session view */

async function showSession(id) {
  const app = $("#app");
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let s;
  try {
    s = await api(`/api/sessions/${id}`);
  } catch (e) {
    setNav(null);
    setMainbar("Session");
    app.innerHTML = `<div class="page"><div class="errbox">${esc(e.message)}</div></div>`;
    return;
  }
  S.session = s;
  setNav(null, id);
  setMainbar(
    `${icon(s.mode === "practice" ? "sparkles" : "book", 15)}<span>${esc(s.topicName)}</span><span class="pill phase ${esc(s.phase)}">${esc(PHASE_INFO[s.phase]?.[0] ?? s.phase)}</span>`,
    `<button class="icon-btn" id="ctx-toggle" title="Toggle context panel" aria-label="Toggle context panel">${icon("panelRight")}</button>`,
  );
  document.title = `${s.topicName} — Drongo`;
  renderSidebar();

  app.innerHTML = `
  <div class="session">
    <div class="chat-col">
      <div class="chat" id="chat"><div class="chat-inner" id="chat-inner"></div></div>
      <div class="composer-wrap">
        <div class="composer">
          <textarea id="input" rows="1" placeholder="${esc(PHASE_INFO[s.phase]?.[2] ?? "Type a reply…")} (Enter to send)"></textarea>
          <div class="composer-bar">
            <span class="composer-hint">${esc(PHASE_INFO[s.phase]?.[1] ?? "")}</span>
            <span class="spacer"></span>
            <button class="btn-continue" id="continue" title="Let the tutor proceed without new input">Continue</button>
            <button class="btn-send" id="send" aria-label="Send">${icon("arrowUp", 16)}</button>
          </div>
        </div>
      </div>
    </div>
    <aside class="ctx" id="ctx"></aside>
  </div>`;

  const inner = $("#chat-inner");
  for (const m of s.messages) {
    if (m.role === "user") addMsg("user", m.content);
    else if (m.role === "assistant" && m.content) addMsg("assistant", m.content);
  }
  scrollChat(true);
  renderCtx(s);
  wireComposer();

  $("#ctx-toggle").onclick = () => {
    if (window.matchMedia("(max-width: 1180px)").matches) document.body.classList.toggle("ctx-open");
    else document.body.classList.toggle("no-ctx");
  };

  // A fresh (or interrupted) session ends on a user message — pick up the turn.
  const last = s.messages[s.messages.length - 1];
  if (last && last.role === "user") kick("");
}

function nearBottom() {
  const chat = $("#chat");
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
}

function scrollChat(force = false) {
  const chat = $("#chat");
  if (!chat) return;
  if (force || nearBottom()) chat.scrollTop = chat.scrollHeight;
}

function addMsg(kind, text) {
  const inner = $("#chat-inner");
  const el = document.createElement("div");
  if (kind === "user") {
    el.className = "msg-user";
    el.innerHTML = md(text);
  } else if (kind === "assistant") {
    el.className = "msg-ai";
    el.innerHTML = `<div class="msg-ai-body">${md(text)}</div>`;
    addActions(el, text);
  } else {
    el.className = "errbox";
    el.textContent = text;
  }
  inner.append(el);
  scrollChat();
  return el;
}

/* quiet message-actions bar (affectUI): copy flips to a check */
function addActions(msgEl, text) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = "Copy";
  btn.setAttribute("aria-label", "Copy message");
  btn.innerHTML = icon("copy", 13);
  btn.onclick = async () => {
    if (await copyText(text)) {
      btn.innerHTML = icon("check", 13);
      btn.classList.add("copied");
      btn.title = "Copied";
      setTimeout(() => {
        btn.innerHTML = icon("copy", 13);
        btn.classList.remove("copied");
        btn.title = "Copy";
      }, 1600);
    } else toast("Copy failed", true);
  };
  bar.append(btn);
  msgEl.append(bar);
}

/* ------------------------------------------------ context panel */

function renderCtx(s) {
  const ctx = $("#ctx");
  if (!ctx) return;
  const [title, blurb] = PHASE_INFO[s.phase] ?? [s.phase, ""];
  const steps = s.plan?.steps ?? [];
  const done = steps.filter((x) => x.doneAt).length;
  const pct = steps.length ? Math.round((100 * done) / steps.length) : 0;
  ctx.innerHTML = `
    <div class="ctx-head"><span class="pill phase ${esc(s.phase)}">${esc(title)}</span></div>
    <p class="goal" style="margin-top:6px">${esc(blurb)}</p>
    <h3>Topic</h3>
    <p class="topic-name">${esc(s.topicName)}</p>
    ${s.goal ? `<p class="goal">${esc(s.goal)}</p>` : ""}
    ${steps.length ? `
    <h3>Plan</h3>
    <div class="ctx-bar"><div style="width:${pct}%"></div></div>
    <div class="ctx-count">${done}/${steps.length} steps</div>
    <ul class="plan">${steps.map((st) => `
      <li class="${st.doneAt ? "done" : ""}${!st.doneAt && st.blockedAt ? " blocked" : ""}${st.id === s.currentStepId && !st.doneAt ? " current" : ""}">
        <span class="tick">${st.blockedAt && !st.doneAt ? icon("x", 10) : icon("check", 10)}</span>
        <span>${esc(st.title)}${st.blockedAt && !st.doneAt ? " — blocked" : ""}${st.id === s.currentStepId && !st.doneAt && st.description ? `<div class="step-desc">${esc(st.description)}</div>` : ""}</span>
      </li>`).join("")}</ul>` : ""}
    ${s.mode === "practice" && s.practiceIds.length ? `
    <h3>Recall targets</h3>
    <div class="targets">${s.practiceIds.map((id) => `<code>${esc(id.slice(0, 16))}</code>`).join("")}</div>` : ""}`;
}

async function refreshCtx() {
  if (!S.session) return;
  try {
    S.session = await api(`/api/sessions/${S.session.id}`);
    renderCtx(S.session);
    renderSidebar();
    const [title, blurb, placeholder] = PHASE_INFO[S.session.phase] ?? [S.session.phase, ""];
    setMainbar(
      `${icon(S.session.mode === "practice" ? "sparkles" : "book", 15)}<span>${esc(S.session.topicName)}</span><span class="pill phase ${esc(S.session.phase)}">${esc(title)}</span>`,
      $("#mainbar-actions").innerHTML,
    );
    const input = $("#input");
    if (input && !S.streaming) input.placeholder = `${placeholder ?? "Type a reply…"} (Enter to send)`;
    const hint = $(".composer-hint");
    if (hint) hint.textContent = blurb ?? "";
  } catch {
    /* context refresh is best-effort */
  }
}

/* ------------------------------------------------ composer */

function wireComposer() {
  const input = $("#input");
  const doSend = () => {
    const v = input.value.trim();
    input.value = "";
    input.style.height = "auto";
    kick(v);
  };
  $("#send").onclick = doSend;
  $("#continue").onclick = () => kick("");
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };
  input.oninput = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
  };
  input.focus();
}

function setComposer(enabled) {
  const input = $("#input");
  if (input) input.disabled = !enabled;
  const send = $("#send");
  if (send) send.disabled = !enabled;
  const cont = $("#continue");
  if (cont) cont.disabled = !enabled;
  if (enabled) input?.focus();
}

/* ------------------------------------------------ tool call cards (affectUI) */

function makeToolCard(name, args) {
  const meta = TOOL_META[name] ?? { label: name, icon: "stepDone" };
  const el = document.createElement("div");
  el.className = "toolcard running";
  let argsText = "";
  try {
    argsText = args && typeof args === "object" && Object.keys(args).length ? JSON.stringify(args, null, 2) : "";
  } catch {
    argsText = "";
  }
  el.innerHTML = `
    <button class="toolcard-head" title="Show detail">
      <span class="i">${icon(meta.icon, 14)}</span>
      <span class="toolcard-label">${esc(meta.label)}</span>
      <span class="toolcard-timer">0:00</span>
      <span class="toolcard-status"><span class="orb" style="width:7px;height:7px"></span></span>
    </button>
    <div class="toolcard-body"><pre></pre></div>`;
  const pre = el.querySelector("pre");
  if (argsText) pre.textContent = argsText + "\n";
  el._detail = pre;
  el._t0 = performance.now();
  el._timer = setInterval(() => {
    el.querySelector(".toolcard-timer").textContent = clockFmt(performance.now() - el._t0);
  }, 500);
  el.querySelector(".toolcard-head").onclick = () => el.classList.toggle("open");
  return el;
}

function settleToolCard(el, ok, output) {
  if (!el || el._settled) return;
  el._settled = true;
  clearInterval(el._timer);
  el.querySelector(".toolcard-timer").textContent = clockFmt(performance.now() - el._t0);
  el.classList.remove("running");
  el.classList.add(ok ? "ok" : "err");
  el.querySelector(".toolcard-status").innerHTML = icon(ok ? "check" : "x", 13);
  if (output) el._detail.textContent += `\n→ ${output}`;
  if (!ok) el.classList.add("open");
}

/* ------------------------------------------------ streaming turn */

async function kick(content) {
  if (S.streaming || !S.session) return;
  const inner = $("#chat-inner");
  if (!inner) return;
  if (content) addMsg("user", content);
  S.streaming = true;
  setComposer(false);
  $("#send").classList.add("busy");
  renderSidebar();

  let thinking = null; // AICSS shimmer while waiting for the first token
  let textEl = null; // current assistant text block
  let bodyEl = null;
  let raw = "";
  let card = null; // current tool card
  let scheduled = false;

  const ensureThinking = () => {
    if (!thinking) {
      thinking = document.createElement("div");
      thinking.className = "thinking";
      thinking.innerHTML = `<span class="orb"></span><span class="shimmer">Thinking</span>`;
      inner.append(thinking);
      scrollChat();
    }
  };
  const dropThinking = () => {
    thinking?.remove();
    thinking = null;
  };
  const ensureText = () => {
    if (!textEl) {
      textEl = document.createElement("div");
      textEl.className = "msg-ai";
      bodyEl = document.createElement("div");
      bodyEl.className = "msg-ai-body";
      textEl.append(bodyEl);
      inner.append(textEl);
    }
  };
  const finalizeText = () => {
    if (!textEl) return;
    const el = bodyEl.querySelector(".caret");
    if (el) el.remove();
    addActions(textEl, raw);
    textEl = null;
    bodyEl = null;
    raw = "";
  };
  const paint = () => {
    scheduled = false;
    if (!bodyEl) return;
    bodyEl.innerHTML = md(raw);
    // caret rides at the end of the last rendered block (AICSS streaming text)
    const host = bodyEl.lastElementChild && bodyEl.lastElementChild.tagName !== "PRE" ? bodyEl.lastElementChild : bodyEl;
    const caret = document.createElement("span");
    caret.className = "caret";
    host.append(caret);
    scrollChat();
  };
  const queuePaint = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(paint);
    }
  };

  ensureThinking();

  try {
    await streamTurn(S.session.id, content, (ev) => {
      if (ev.type === "delta") {
        dropThinking();
        ensureText();
        raw += ev.text;
        queuePaint();
      } else if (ev.type === "tool_start") {
        dropThinking();
        finalizeText();
        card = makeToolCard(ev.name, ev.args);
        inner.append(card);
        scrollChat();
      } else if (ev.type === "tool_result") {
        settleToolCard(card ?? inner.querySelector(".toolcard:last-child"), ev.ok, ev.output);
        card = null;
      } else if (ev.type === "phase" || ev.type === "step") {
        refreshCtx();
      } else if (ev.type === "error") {
        addMsg("error", ev.message);
      }
    });
  } catch (e) {
    addMsg("error", e.message);
  }

  dropThinking();
  finalizeText();
  inner.querySelectorAll(".toolcard.running").forEach((el) => settleToolCard(el, true, ""));
  S.streaming = false;
  $("#send")?.classList.remove("busy");
  setComposer(true);
  refreshCtx();
}

async function streamTurn(sessionId, content, onEvent) {
  const res = await fetch(`/api/sessions/${sessionId}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* skip malformed line */
      }
    }
  }
}

/* ---------------------------------------------------------------- graph view */

const graphMounts = []; // { handle, text } — live Pele mounts for the current graph view

function destroyGraphMounts() {
  for (const m of graphMounts) {
    try {
      m.handle.destroy();
    } catch {
      /* already gone */
    }
  }
  graphMounts.length = 0;
}

// Mirrors cgNodeId() in src/mermaid.ts — the SVG data-id ↔ proposition link.
function cgDomId(propId) {
  return propId.replace(/[^A-Za-z0-9]/g, "") || "n";
}

function withDirection(text, dir) {
  return text.replace(/^flowchart \S+/, `flowchart ${dir}`);
}

function cgShort(text, max = 44) {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max).trimEnd()}…`;
}

function closeConceptDrawer() {
  const drawer = $("#cg-drawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  $("#cg-scrim").hidden = true;
  document.querySelectorAll(".cg .pele-node.cg-selected").forEach((n) => n.classList.remove("cg-selected"));
}

function openConceptDrawer(p, allProps, sectionTopicId) {
  const drawer = $("#cg-drawer");
  document.querySelectorAll(".cg .pele-node.cg-selected").forEach((n) => n.classList.remove("cg-selected"));
  $(`.topic-block[data-topic="${CSS.escape(sectionTopicId)}"] .pele-node[data-id="${cgDomId(p.id)}"]`)?.classList.add("cg-selected");

  const byId = new Map(allProps.map((x) => [x.id, x]));
  const prereqs = p.prereqs.map((id) => byId.get(id)).filter(Boolean);
  drawer.innerHTML = `
    <div class="cg-drawer-head">
      <span class="label">${sectionTopicId === "__other" ? "Unfiled concept" : "Concept"}</span>
      <button class="icon-btn" id="cg-close" aria-label="Close">${icon("x")}</button>
    </div>
    <p class="cg-claim">${esc(p.text)}</p>
    <div class="cg-meta">
      ${new Date(p.dueAt).getTime() <= Date.now() ? `<span class="pill due">due</span>` : ""}
      <span class="pill">level ${p.reviewLevel}</span>
      <span class="pill">seen ${p.passes}/${p.timesSeen}</span>
    </div>
    <p class="hint">Due ${esc((p.dueAt || "").slice(0, 10))} · ${p.lastReviewedAt ? `last reviewed ${relTime(p.lastReviewedAt)}` : "never reviewed"} · learned ${relTime(p.createdAt)}</p>
    ${prereqs.length ? `<div class="cg-prereqs"><h3 class="label">Builds on</h3><div class="cg-chips">${prereqs.map((x) => `<button class="chip" data-cg="${esc(x.id)}" title="${esc(x.text)}">${esc(cgShort(x.text))}</button>`).join("")}</div></div>` : ""}
    ${p.sourceSessionId ? `<a class="btn secondary block" href="#/session/${esc(p.sourceSessionId)}">${icon("book", 14)} Open source session</a>` : ""}`;
  $("#cg-close").onclick = closeConceptDrawer;
  drawer.querySelectorAll("[data-cg]").forEach((btn) => {
    btn.onclick = () => {
      const next = byId.get(btn.dataset.cg);
      if (next) openConceptDrawer(next, allProps, next.topicId);
    };
  });
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#cg-scrim").hidden = false;
}

async function showGraph() {
  S.session = null;
  destroyGraphMounts();
  closeConceptDrawer();
  setNav("graph");
  const app = $("#app");
  app.onclick = null;
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let g;
  try {
    g = await api("/api/graph");
  } catch (e) {
    app.innerHTML = `<div class="page"><div class="errbox">${esc(e.message)}</div></div>`;
    return;
  }
  renderSidebar();

  const view = localStorage.getItem("ll-graph-view") === "list" ? "list" : "diagram";
  const dir = localStorage.getItem("ll-graph-dir") === "LR" ? "LR" : "TD";
  const hasPele = typeof window.pele?.mount === "function";

  setMainbar(
    `Concept graph`,
    `<div class="seg" id="cg-view">
      <button class="seg-btn${view === "diagram" ? " on" : ""}" data-v="diagram">${icon("graph", 13)}Diagram</button>
      <button class="seg-btn${view === "list" ? " on" : ""}" data-v="list">${icon("plan", 13)}List</button>
    </div>
    <div class="seg" id="cg-dir"${view === "list" || !hasPele ? " hidden" : ""}>
      <button class="seg-btn${dir === "TD" ? " on" : ""}" data-d="TD">Top-down</button>
      <button class="seg-btn${dir === "LR" ? " on" : ""}" data-d="LR">Left-right</button>
    </div>
    <a class="btn secondary" style="height:30px" href="/api/graph/export" download>${icon("download", 14)} Export graph.md</a>`,
  );

  const byTopic = new Map();
  for (const t of g.topics) byTopic.set(t.id, { topic: t, props: [] });
  const orphans = [];
  for (const p of g.propositions) {
    const bucket = byTopic.get(p.topicId);
    if (bucket) bucket.props.push(p);
    else orphans.push(p);
  }
  const sections = [...byTopic.values()];
  if (orphans.length) sections.push({ topic: { id: "__other", name: "Other", goal: "" }, props: orphans });

  const dueSet = new Set(g.dueIds);
  const depth = (p, seen = new Set()) => {
    if (!p.prereqs.length || seen.has(p.id)) return 0;
    seen.add(p.id);
    let max = 0;
    for (const pid of p.prereqs) {
      const all = g.propositions.find((x) => x.id === pid);
      if (all) max = Math.max(max, depth(all, seen) + 1);
    }
    return max;
  };
  const rows = (props) =>
    props
      .slice()
      .sort((a, b) => depth(a) - depth(b) || a.createdAt.localeCompare(b.createdAt))
      .map(
        (p) => `
      <div class="prop" style="margin-left:${Math.min(depth(p), 5) * 20}px">
        <code class="pid">${esc(p.id.slice(0, 10))}</code>
        <span class="text">${esc(p.text)}</span>
        ${dueSet.has(p.id) ? `<span class="pill due">due</span>` : ""}
        ${p.prereqs.length ? `<span class="deps">← ${p.prereqs.map((x) => esc(x.slice(0, 8))).join(", ")}</span>` : ""}
        <span class="seen">seen ${p.passes}/${p.timesSeen}</span>
      </div>`,
      )
      .join("");

  if (!g.propositions.length) {
    app.innerHTML = `<div class="page"><div class="card"><div class="empty"><span class="i">${icon("graph", 28)}</span><br>Your graph is empty.<br>Finish a learning session and verified propositions will appear here.</div></div></div>`;
    return;
  }

  app.innerHTML = `
    <div class="page">
      <div class="page-head"><h1>Concept graph</h1><span class="sub">${g.propositions.length} propositions · ${g.topics.length} topics</span></div>
      <div id="cg-sections">
        ${sections
          .map(
            ({ topic, props }) => `
        <div class="card topic-block" data-topic="${esc(topic.id)}">
          <h2>${esc(topic.name)} ${topic.id !== "__other" && topic.active ? `<span class="pill hot">active</span>` : topic.id !== "__other" ? `<span class="pill phase done">complete</span>` : ""}</h2>
          ${topic.id !== "__other" ? `<p class="hint">Goal: ${esc(topic.goal || "—")}</p>` : ""}
          <div class="cg-body" style="margin-top:10px"></div>
        </div>`,
          )
          .join("")}
      </div>
    </div>`;

  const bodyFor = (topicId) => $(`.topic-block[data-topic="${CSS.escape(topicId)}"] .cg-body`);

  const fillList = () => {
    for (const { topic, props } of sections) {
      bodyFor(topic.id).innerHTML = props.length ? rows(props) : `<p class="hint">No concepts yet.</p>`;
    }
  };

  const fillDiagrams = () => {
    let mounted = 0;
    for (const { topic, props } of sections) {
      const body = bodyFor(topic.id);
      const text = topic.id === "__other" ? g.mermaidOther : (g.mermaidByTopic ?? {})[topic.id];
      if (!props.length || !text) {
        body.innerHTML = `<p class="hint">No concepts yet.</p>`;
        continue;
      }
      const holder = document.createElement("div");
      holder.className = "cg";
      body.innerHTML = "";
      body.append(holder);
      try {
        const handle = window.pele.mount(holder, withDirection(text, dir));
        graphMounts.push({ handle, text });
        mounted++;
      } catch (e) {
        body.innerHTML = `<p class="hint">Diagram failed: ${esc(e.message)}</p>`;
      }
    }
    if (!mounted) fillList(); // e.g. Pele failed to load — fall back to the list
  };

  if (view === "diagram" && hasPele) fillDiagrams();
  else fillList();

  $("#cg-view").onclick = (e) => {
    const btn = e.target.closest("[data-v]");
    if (!btn || btn.classList.contains("on")) return;
    localStorage.setItem("ll-graph-view", btn.dataset.v);
    showGraph();
  };

  $("#cg-dir").onclick = (e) => {
    const btn = e.target.closest("[data-d]");
    if (!btn || btn.classList.contains("on")) return;
    const d = btn.dataset.d === "LR" ? "LR" : "TD";
    localStorage.setItem("ll-graph-dir", d);
    $("#cg-dir").querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("on", b.dataset.d === d));
    for (const m of graphMounts) m.handle.update(withDirection(m.text, d));
  };

  app.onclick = (e) => {
    const node = e.target.closest?.(".pele-node");
    if (!node || !node.dataset.id) return;
    const block = node.closest(".topic-block");
    if (!block) return;
    const sec = sections.find((s) => s.topic.id === block.dataset.topic);
    const prop = sec?.props.find((x) => cgDomId(x.id) === node.dataset.id);
    if (prop) openConceptDrawer(prop, g.propositions, sec.topic.id);
  };
}

/* ---------------------------------------------------------------- settings */

async function showSettings() {
  S.session = null;
  setNav("settings");
  setMainbar("Settings");
  const app = $("#app");
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let cfg;
  try {
    cfg = await api("/api/config");
  } catch (e) {
    app.innerHTML = `<div class="page narrow"><div class="errbox">${esc(e.message)}</div></div>`;
    return;
  }
  renderSidebar();
  app.innerHTML = `
  <div class="page narrow">
    <div class="card">
      <h2>Model provider — bring your own key</h2>
      <p class="hint">Any OpenAI-compatible endpoint works. Include the <code>/v1</code>.</p>
      <div class="field" style="margin-top:14px"><span>Base URL</span>
        <input type="text" id="cfg-base" list="bases" value="${esc(cfg.baseUrl)}" />
        <datalist id="bases">
          <option value="https://api.openai.com/v1"></option>
          <option value="https://openrouter.ai/api/v1"></option>
          <option value="https://api.deepseek.com/v1"></option>
          <option value="https://api.groq.com/openai/v1"></option>
          <option value="http://localhost:11434/v1"></option>
          <option value="http://localhost:1234/v1"></option>
        </datalist>
      </div>
      <div class="field"><span>Model</span><input type="text" id="cfg-model" value="${esc(cfg.model)}" placeholder="e.g. gpt-4.1-mini, deepseek-chat, llama3.3-70b" /></div>
      <div class="field"><span>API key ${cfg.hasKey ? `<i style="font-style:normal;color:var(--muted);font-weight:400">(saved: ${esc(cfg.apiKeyMasked)} — leave blank to keep)</i>` : ""}</span>
        <input type="password" id="cfg-key" placeholder="${cfg.hasKey ? "••••••••" : "sk-…"}" />
      </div>
      <div style="display:flex;gap:8px">
        <button id="cfg-test" class="btn secondary">Test connection</button>
        <button id="cfg-save" class="btn primary">Save</button>
      </div>
      <p id="cfg-result" class="hint" style="white-space:pre-wrap;margin-top:12px"></p>
    </div>
    <div class="card">
      <h2>Where your data lives</h2>
      <p class="hint">Sessions, the knowledge graph, and this key are stored under <code>memory/</code> next to the app — plain JSON you can open, edit, back up, or delete. Nothing is sent anywhere except model calls to the provider you configure above.</p>
    </div>
  </div>`;

  const formVals = () => ({
    baseUrl: $("#cfg-base").value.trim(),
    model: $("#cfg-model").value.trim(),
    apiKey: $("#cfg-key").value.trim(),
  });
  $("#cfg-save").onclick = async () => {
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify(formVals()) });
      toast("Saved.");
      refreshShell();
      showSettings();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $("#cfg-test").onclick = async () => {
    const r = $("#cfg-result");
    r.textContent = "Testing…";
    try {
      const res = await api("/api/config/test", { method: "POST", body: JSON.stringify(formVals()) });
      r.textContent = res.ok ? `✓ Provider responded: ${res.sample}` : `✗ ${res.error}`;
    } catch (e) {
      r.textContent = `✗ ${e.message}`;
    }
  };
}

/* ---------------------------------------------------------------- boot */

initTheme();
wireShell();
refreshShell();
route();
