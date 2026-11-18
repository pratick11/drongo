"use strict";

/* ============================================================================
   Drongo — harness UI logic
   Vanilla JS, no build step: Library, Reader, Settings, and the add-blog flow.
   Blogs are plain markdown files under memory/blogs/; this file never owns
   their content, it only renders what the server reads back.
   ========================================================================== */

const $ = (sel, el = document) => el.querySelector(sel);

/* ---------------------------------------------------------------- utilities */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

function hostOf(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function countWords(markdown) {
  const words = String(markdown ?? "").replace(/```[\s\S]*?```/g, " ").match(/\S+/g);
  return words ? words.length : 0;
}

/* ---------------------------------------------------------------- icons */

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h2a4 4 0 0 0 4-4 10 10 0 0 0-10-10z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  panelLeft: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
};

function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
}

/* ---------------------------------------------------------------- theme */

/* One CSS file of tokens per theme lives in /themes. Add a theme by dropping
   a file there and adding its id + label here. */
const THEMES = [
  { id: "tokyo-night", name: "Tokyo Night" },
  { id: "paper", name: "Paper" },
  { id: "catppuccin", name: "Catppuccin" },
  { id: "dracula", name: "Dracula" },
  { id: "github-dark", name: "GitHub Dark" },
  { id: "gruvbox", name: "Gruvbox" },
  { id: "monokai", name: "Monokai" },
  { id: "nord", name: "Nord" },
  { id: "one-dark", name: "One Dark" },
  { id: "rose-pine", name: "Rosé Pine" },
  { id: "solarized", name: "Solarized" },
];

const DEFAULT_THEME = "tokyo-night";
const themeById = new Map(THEMES.map((t) => [t.id, t]));

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return themeById.has(t) ? t : DEFAULT_THEME;
}

function themeSwatch(id) {
  return `<span class="theme-swatch" data-theme="${id}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("drongo-theme");
  } catch {
    /* storage may be unavailable */
  }
  applyTheme(themeById.has(saved) ? saved : DEFAULT_THEME, false);
}

function applyTheme(id, persist = true) {
  const theme = themeById.has(id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem("drongo-theme", theme);
    } catch {
      /* storage may be unavailable */
    }
  }
  syncThemeUI();
}

function syncThemeUI() {
  const cur = currentTheme();
  document.querySelectorAll("[data-theme-choice]").forEach((el) => {
    const on = el.dataset.themeChoice === cur;
    el.classList.toggle("on", on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  });
  const btn = $("#theme-toggle");
  if (btn) {
    const label = `Theme: ${themeById.get(cur).name}`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

function closeThemeMenu() {
  const menu = $("#theme-menu");
  const btn = $("#theme-toggle");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function buildThemeMenu() {
  const menu = $("#theme-menu");
  const btn = $("#theme-toggle");
  if (!menu || !btn) return;

  btn.innerHTML = icon("palette");
  menu.innerHTML = THEMES.map(
    (t) => `
    <button class="theme-item" type="button" role="menuitemradio" data-theme-choice="${t.id}">
      ${themeSwatch(t.id)}
      <span class="theme-name">${esc(t.name)}</span>
      <span class="theme-check">${icon("check", 14)}</span>
    </button>`
  ).join("");

  menu.querySelectorAll("[data-theme-choice]").forEach((el) => {
    el.onclick = () => {
      applyTheme(el.dataset.themeChoice);
      closeThemeMenu();
      btn.focus();
    };
  });

  btn.onclick = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-picker")) closeThemeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeThemeMenu();
  });

  syncThemeUI();
}

function themeCard(t) {
  return `
    <button class="theme-card" type="button" role="radio" data-theme="${t.id}" data-theme-choice="${t.id}" title="${esc(t.name)}">
      ${themeSwatch(t.id)}
      <span class="theme-card-name">${esc(t.name)}</span>
      <span class="theme-check">${icon("check", 14)}</span>
    </button>`;
}

/* ---------------------------------------------------------------- markdown */

/* A deliberately small renderer: escape first, then apply a fixed set of
   markdown shapes. Article text comes from the open web, so nothing in it is
   ever trusted as HTML. */
function safeHref(url) {
  const value = String(url ?? "").trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(value) ? value : "";
}

function inlineMd(escaped) {
  const code = [];
  let s = escaped.replace(/`([^`]+)`/g, (_m, inner) => {
    code.push(`<code>${inner}</code>`);
    return `\u0001${code.length - 1}\u0001`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = safeHref(href);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => code[Number(i)] ?? "");
  return s;
}

function renderMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inlineMd(esc(para.join(" ")))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (!list) return;
    out.push(`</${list}>`);
    list = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    const fence = /^```([\w+#.-]*)\s*$/.exec(trimmed);
    if (fence) {
      flushPara();
      closeList();
      const lang = fence[1];
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushPara();
      closeList();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(esc(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      closeList();
      out.push("<hr />");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inlineMd(esc((bullet || numbered)[1]))}</li>`);
      i++;
      continue;
    }

    closeList();
    para.push(trimmed);
    i++;
  }

  flushPara();
  closeList();
  return out.join("\n");
}

/* ---------------------------------------------------------------- state */

const S = {
  view: "library",
  state: null, // /api/state payload
};

/* ---------------------------------------------------------------- shell */

function wireShell() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    const target = el.classList.contains("icon-btn") ? el : el.querySelector(".i");
    if (target) target.innerHTML = icon(el.dataset.icon);
  });
  $("#sb-collapse").innerHTML = icon("panelLeft");
  $("#sb-menu").innerHTML = icon("menu");

  buildThemeMenu();

  $("#sb-collapse").onclick = () => {
    const rail = document.body.classList.toggle("rail");
    localStorage.setItem("drongo-rail", rail ? "1" : "0");
  };
  if (localStorage.getItem("drongo-rail") === "1") document.body.classList.add("rail");

  $("#sb-menu").onclick = () => document.body.classList.add("sb-open");
  $("#sb-backdrop").onclick = () => document.body.classList.remove("sb-open");

  $("#sb-add").onclick = () => {
    document.body.classList.remove("sb-open");
    openAddBlog();
  };
}

function setNav(view) {
  S.view = view;
  document.querySelectorAll(".sb-nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
}

function setMainbar(title) {
  $("#mainbar-title").textContent = title;
}

async function refreshShell() {
  try {
    S.state = await api("/api/state");
  } catch {
    $("#model-chip").textContent = "";
    return;
  }
  $("#model-chip").textContent = S.state.config.model;
  renderBlogList();
}

function renderBlogList() {
  const list = $("#blog-list");
  const blogs = S.state?.blogs ?? [];
  if (!blogs.length) {
    list.innerHTML = `<p class="sb-empty">Nothing saved yet.</p>`;
    return;
  }
  list.innerHTML = blogs
    .map(
      (b) => `
      <a class="sb-blog" href="#/blog/${encodeURIComponent(b.slug)}" title="${esc(b.title)}">
        <span class="sb-blog-title">${esc(b.title)}</span>
        <span class="sb-blog-meta">${esc(hostOf(b.url) || "Pasted")} · ${b.minutes} min</span>
      </a>`
    )
    .join("");
}

/* ---------------------------------------------------------------- router */

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("settings")) return showSettings();
  const blog = /^blog\/([^/]+)$/.exec(hash);
  if (blog) return showReader(decodeURIComponent(blog[1]));
  return showLibrary();
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* ---------------------------------------------------------------- library */

function blogCard(b) {
  const source = b.url ? hostOf(b.url) : "Pasted";
  return `
  <article class="blog-card">
    <a class="blog-card-body" href="#/blog/${encodeURIComponent(b.slug)}">
      <span class="blog-card-meta"><span class="pill">${esc(source)}</span><span class="dot">·</span><span>${b.minutes} min</span></span>
      <h2>${esc(b.title)}</h2>
      <p>${esc(b.excerpt || "No excerpt.")}</p>
      <span class="blog-card-open">Open reader <span aria-hidden="true">→</span></span>
    </a>
    <button class="icon-btn blog-card-del" data-delete-blog="${esc(b.slug)}" data-title="${esc(b.title)}" title="Delete" aria-label="Delete ${esc(b.title)}">${icon("trash")}</button>
  </article>`;
}

function showLibrary() {
  setNav("library");
  setMainbar("Library");
  document.title = "Drongo — Library";
  const app = $("#app");
  const blogs = S.state?.blogs ?? [];
  const noKey = S.state && !S.state.hasKey;

  const empty = `
  <div class="card">
    <h2>Nothing saved yet</h2>
    <p class="hint">You save engineering blogs faster than you read them. Keep the ones you actually care about: paste a URL and Drongo fetches a cleaned markdown copy into <code>memory/blogs/</code> — or paste the text itself.</p>
    <div class="empty">
      ${icon("book", 26)}
      <div>Saved blogs appear here, ready to read and study.</div>
      <button class="btn primary" data-add-blog style="margin-top:16px">${icon("plus")}<span>Add your first blog</span></button>
    </div>
  </div>`;

  app.innerHTML = `
  <div class="page">
    <div class="page-head">
      <h1>Library</h1>
      <span class="sub">${blogs.length} saved blog${blogs.length === 1 ? "" : "s"}</span>
      ${blogs.length ? `<button class="btn primary page-action" data-add-blog>${icon("plus")}<span>Add blog</span></button>` : ""}
    </div>
    ${noKey ? `<div class="warnbox">No model configured yet. <a href="#/settings">Open Settings</a> to add your API key.</div>` : ""}
    ${blogs.length ? `<div class="blog-grid">${blogs.map(blogCard).join("")}</div>` : empty}
    ${blogs.length ? `<p class="lib-foot">Every post is a plain markdown file in <code>memory/blogs/</code> — edit, back up, or delete it outside the app.</p>` : ""}
  </div>`;

  app.querySelectorAll("[data-add-blog]").forEach((el) => (el.onclick = openAddBlog));
  app.querySelectorAll("[data-delete-blog]").forEach((el) => {
    el.onclick = () => deleteSavedBlog(el.dataset.deleteBlog, el.dataset.title || "", showLibrary);
  });
  app.scrollTop = 0;
}

/* ---------------------------------------------------------------- reader */

async function showReader(slug) {
  setNav("library");
  setMainbar("Reader");
  document.title = "Reader — Drongo";
  const app = $("#app");
  app.innerHTML = `<p class="loading">Loading…</p>`;

  let blog;
  try {
    blog = await api(`/api/blogs/${encodeURIComponent(slug)}`);
  } catch (e) {
    app.innerHTML = `
    <div class="page narrow">
      <div class="errbox">${esc(e.message)}</div>
      <p><a href="#/">← Back to the library</a></p>
    </div>`;
    return;
  }

  document.title = `${blog.title} — Drongo`;
  const words = countWords(blog.markdown);
  const minutes = Math.max(1, Math.round(words / 220));
  const source = hostOf(blog.url);

  app.innerHTML = `
  <div class="reader">
    <a class="reader-back" href="#/">${icon("arrowLeft")}<span>Library</span></a>
    <header class="reader-head">
      <h1>${esc(blog.title)}</h1>
      <div class="reader-meta">
        ${blog.url ? `<a href="${esc(blog.url)}" target="_blank" rel="noopener noreferrer">${esc(source)} ${icon("external", 13)}</a>` : `<span>Pasted text</span>`}
        <span class="dot">·</span>
        <span>${esc(relTime(blog.addedAt))}</span>
        <span class="dot">·</span>
        <span>${words.toLocaleString()} words · ${minutes} min</span>
      </div>
      <div class="reader-actions">
        <button class="btn secondary" data-add-blog>${icon("plus")}<span>Add blog</span></button>
        <button class="btn ghost danger" id="reader-del">${icon("trash")}<span>Delete</span></button>
      </div>
    </header>
    <article class="prose">${renderMarkdown(blog.markdown)}</article>
  </div>`;

  app.querySelectorAll("[data-add-blog]").forEach((el) => (el.onclick = openAddBlog));
  $("#reader-del").onclick = () => deleteSavedBlog(blog.slug, blog.title, () => navigate("#/"));
  app.scrollTop = 0;
}

async function deleteSavedBlog(slug, title, done) {
  const ok = window.confirm(`Delete “${title || slug}” from the library?\n\nThe markdown file will be removed.`);
  if (!ok) return;
  try {
    await api(`/api/blogs/${encodeURIComponent(slug)}`, { method: "DELETE" });
    await refreshShell();
    toast("Deleted.");
    done();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------------------------------------------------------- add blog */

function openAddBlog() {
  if ($("#add-modal")) return;

  const wrap = document.createElement("div");
  wrap.id = "add-modal";
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
    <div class="modal-head">
      <h2 id="add-title">Add a blog</h2>
      <button type="button" class="icon-btn" id="add-close" aria-label="Close">${icon("x")}</button>
    </div>
    <div class="tabs" role="tablist" aria-label="Source">
      <button type="button" class="tab on" data-tab="url" role="tab" aria-selected="true">From URL</button>
      <button type="button" class="tab" data-tab="paste" role="tab" aria-selected="false">Paste text</button>
    </div>
    <form id="add-form" novalidate>
      <div data-pane="url">
        <div class="field"><span>Post URL</span>
          <input id="add-url" type="text" placeholder="https://example.com/blog/post" autocomplete="off" spellcheck="false" />
        </div>
        <p class="hint">Drongo fetches the page once and keeps a cleaned markdown copy. Nothing stays connected afterwards.</p>
      </div>
      <div data-pane="paste" hidden>
        <div class="field"><span>Title <i>(optional)</i></span>
          <input id="add-paste-title" type="text" placeholder="Inferred from the first heading" />
        </div>
        <div class="field"><span>Article</span>
          <textarea id="add-markdown" rows="12" placeholder="Paste the post here — markdown or plain text both work."></textarea>
        </div>
      </div>
      <p class="form-error" id="add-error" hidden></p>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="add-cancel">Cancel</button>
        <button type="submit" class="btn primary" id="add-save">Save blog</button>
      </div>
    </form>
  </div>`;
  document.body.appendChild(wrap);

  let mode = "url";
  let onKey = null;
  const close = () => {
    wrap.remove();
    if (onKey) document.removeEventListener("keydown", onKey);
    onKey = null;
  };
  const setMode = (next) => {
    mode = next;
    wrap.querySelectorAll("[data-tab]").forEach((tab) => {
      const on = tab.dataset.tab === next;
      tab.classList.toggle("on", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    wrap.querySelectorAll("[data-pane]").forEach((pane) => (pane.hidden = pane.dataset.pane !== next));
    setTimeout(() => $(next === "url" ? "#add-url" : "#add-markdown")?.focus(), 0);
  };

  wrap.querySelectorAll("[data-tab]").forEach((tab) => (tab.onclick = () => setMode(tab.dataset.tab)));
  $("#add-close").onclick = close;
  $("#add-cancel").onclick = close;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  $("#add-form").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#add-error");
    const save = $("#add-save");
    const showError = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    err.hidden = true;

    const payload =
      mode === "url"
        ? { url: $("#add-url").value.trim() }
        : { title: $("#add-paste-title").value.trim(), markdown: $("#add-markdown").value };
    if (mode === "url" && !payload.url) return showError("Paste the post's URL first.");
    if (mode === "paste" && !payload.markdown.trim()) return showError("Paste the article text first.");

    save.disabled = true;
    const label = save.textContent;
    save.textContent = mode === "url" ? "Fetching…" : "Saving…";
    try {
      const blog = await api("/api/blogs", { method: "POST", body: JSON.stringify(payload) });
      close();
      await refreshShell();
      toast("Saved under memory/blogs/.");
      navigate(`#/blog/${encodeURIComponent(blog.slug)}`);
    } catch (ex) {
      save.disabled = false;
      save.textContent = label;
      showError(ex.message);
    }
  };

  setTimeout(() => $("#add-url")?.focus(), 30);
}

/* ---------------------------------------------------------------- settings */

async function showSettings() {
  setNav("");
  setMainbar("Settings");
  document.title = "Settings — Drongo";
  const app = $("#app");
  app.innerHTML = `<p class="loading">Loading…</p>`;
  let cfg;
  try {
    cfg = await api("/api/config");
  } catch (e) {
    app.innerHTML = `<div class="page narrow"><div class="errbox">${esc(e.message)}</div></div>`;
    return;
  }
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
      <h2>Appearance</h2>
      <p class="hint">Each theme is a single CSS file of design tokens in <code>web/themes/</code>. Tokyo Night is the default; your choice is remembered on this device.</p>
      <div class="theme-grid" role="radiogroup" aria-label="Theme">
        ${THEMES.map(themeCard).join("")}
      </div>
    </div>
    <div class="card">
      <h2>Where your data lives</h2>
      <p class="hint">Blogs, digests, example workspaces, and this key live under <code>memory/</code> next to the app — plain files you can open, edit, back up, or delete. Nothing is sent anywhere except model calls to the provider you configure above.</p>
    </div>
  </div>`;

  app.querySelectorAll("[data-theme-choice]").forEach((el) => {
    el.onclick = () => applyTheme(el.dataset.themeChoice);
  });
  syncThemeUI();

  const formVals = () => ({
    baseUrl: $("#cfg-base").value.trim(),
    model: $("#cfg-model").value.trim(),
    apiKey: $("#cfg-key").value.trim(),
  });
  $("#cfg-save").onclick = async () => {
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify(formVals()) });
      toast("Saved.");
      await refreshShell();
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
window.addEventListener("hashchange", route);
refreshShell().then(route).catch(route);
