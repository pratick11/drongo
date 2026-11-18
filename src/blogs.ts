import fs from "node:fs";
import path from "node:path";
import { slugify } from "./fsutil.ts";

// Saved blogs live as one markdown file per post: memory/blogs/<slug>.md.
// A small frontmatter block carries the metadata the library needs; the body
// is the cleaned article itself, so the whole store stays readable and
// editable outside the app.

export interface Blog {
  slug: string;
  title: string;
  url: string | null;
  addedAt: string;
  markdown: string;
}

export interface BlogSummary {
  slug: string;
  title: string;
  url: string | null;
  addedAt: string;
  words: number;
  minutes: number;
  excerpt: string;
}

export interface BlogInput {
  title?: string;
  markdown: string;
  url?: string | null;
  /** Write over this slug instead of deriving a new one. */
  slug?: string;
}

const MAX_FETCH_CHARS = 5_000_000;

export function blogsDir(dataDir: string): string {
  return path.join(dataDir, "blogs");
}

export function blogPath(slug: string, dataDir: string): string {
  return path.join(blogsDir(dataDir), `${slug}.md`);
}

// Slugs end up in file paths and URLs; keep them boring.
function assertSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Invalid blog slug: ${slug}`);
  return slug;
}

export function cleanTitle(title: string): string {
  return String(title ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMarkdown(markdown: string): string {
  return String(markdown ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+|\n+$/g, "");
}

export function inferTitle(markdown: string): string {
  for (const line of normalizeMarkdown(markdown).split("\n")) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return cleanTitle(heading[1].replace(/[*_`[\]]/g, ""));
  }
  return "";
}

export function wordCount(markdown: string): number {
  const words = normalizeMarkdown(markdown).replace(/```[\s\S]*?```/g, " ").match(/\S+/g);
  return words ? words.length : 0;
}

export function minutesToRead(markdown: string): number {
  return Math.max(1, Math.round(wordCount(markdown) / 220));
}

export function excerptOf(markdown: string, max = 180): string {
  const text = normalizeMarkdown(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 40 ? space : max).trimEnd()}…`;
}

export function summarize(blog: Blog): BlogSummary {
  return {
    slug: blog.slug,
    title: blog.title,
    url: blog.url,
    addedAt: blog.addedAt,
    words: wordCount(blog.markdown),
    minutes: minutesToRead(blog.markdown),
    excerpt: excerptOf(blog.markdown),
  };
}

// ---------------------------------------------------------------- frontmatter

interface ParsedFile {
  meta: Record<string, string>;
  markdown: string;
}

function parseFile(raw: string): ParsedFile {
  const text = raw.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, markdown: normalizeMarkdown(text) };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        /* keep the raw value if it is not valid JSON */
      }
    }
    meta[key] = value;
  }

  // A hand-written post may open with a thematic break (`---`). Only treat
  // the block as metadata when it carries at least one field we understand.
  const known = ["title", "url", "addedAt"].some((key) => key in meta);
  if (!known) return { meta: {}, markdown: normalizeMarkdown(text) };
  return { meta, markdown: normalizeMarkdown(text.slice(match[0].length)) };
}

function serialize(blog: Blog): string {
  const lines = ["---", `title: ${JSON.stringify(blog.title)}`];
  if (blog.url) lines.push(`url: ${JSON.stringify(blog.url)}`);
  lines.push(`addedAt: ${JSON.stringify(blog.addedAt)}`, "---", "", blog.markdown, "");
  return lines.join("\n");
}

function uniqueSlug(base: string, dir: string): string {
  const stem = assertSlug(base || "blog");
  let slug = stem;
  for (let n = 2; fs.existsSync(path.join(dir, `${slug}.md`)); n++) {
    slug = `${stem}-${n}`;
  }
  return slug;
}

export function saveBlog(input: BlogInput, dataDir: string): Blog {
  const markdown = normalizeMarkdown(input.markdown);
  if (!markdown.trim()) throw new Error("The blog has no text to save.");

  const title = cleanTitle(input.title ?? "") || inferTitle(markdown) || "Untitled";
  const dir = blogsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });

  const slug = input.slug
    ? assertSlug(input.slug)
    : uniqueSlug(slugify(title), dir);

  const blog: Blog = {
    slug,
    title,
    url: input.url?.trim() ? input.url.trim() : null,
    addedAt: new Date().toISOString(),
    markdown,
  };
  fs.writeFileSync(blogPath(slug, dataDir), serialize(blog));
  return blog;
}

function readBlogFile(file: string, slug: string): Blog {
  const stat = fs.statSync(file);
  const { meta, markdown } = parseFile(fs.readFileSync(file, "utf8"));
  return {
    slug,
    title: cleanTitle(meta.title ?? "") || inferTitle(markdown) || slug.replace(/-/g, " "),
    url: meta.url && meta.url !== "null" ? meta.url : null,
    addedAt: meta.addedAt || stat.mtime.toISOString(),
    markdown,
  };
}

export function loadBlog(slug: string, dataDir: string): Blog | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const file = blogPath(slug, dataDir);
  try {
    return readBlogFile(file, slug);
  } catch {
    return null;
  }
}

export function listBlogs(dataDir: string): Blog[] {
  const dir = blogsDir(dataDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const blogs: Blog[] = [];
  for (const name of names) {
    const slug = name.slice(0, -3);
    if (!name.endsWith(".md") || name.startsWith(".") || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue;
    try {
      blogs.push(readBlogFile(path.join(dir, name), slug));
    } catch {
      /* an unreadable file should not hide the rest of the library */
    }
  }
  return blogs.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.slug.localeCompare(b.slug));
}

export function deleteBlog(slug: string, dataDir: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return false;
  try {
    fs.unlinkSync(blogPath(slug, dataDir));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- URL ingestion

export interface ImportOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ImportedBlog {
  title: string;
  url: string;
  markdown: string;
}

function normalizeUrl(raw: string): URL {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Paste a URL first.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`That does not look like a URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs can be imported.");
  }
  return url;
}

// Fetch a post and reduce it to readable markdown. No DOM, no dependencies:
// the HTML is cleaned with a small, predictable set of tag rewrites.
export async function importFromUrl(rawUrl: string, opts: ImportOptions = {}): Promise<ImportedBlog> {
  const url = normalizeUrl(rawUrl);
  const doFetch = opts.fetchImpl ?? fetch;
  const host = url.hostname.replace(/^www\./, "");

  let res: Response;
  try {
    res = await doFetch(url.href, {
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      headers: {
        "user-agent": "Drongo/0.1 (local-first blog reader)",
        accept: "text/html, text/plain, text/markdown;q=0.9, */*;q=0.5",
      },
    });
  } catch (err) {
    throw new Error(`Could not reach ${host}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`${host} answered HTTP ${res.status}.`);

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/pdf")) {
    throw new Error("PDFs are not supported — save the text as markdown instead.");
  }

  let body = await res.text();
  if (body.length > MAX_FETCH_CHARS) body = body.slice(0, MAX_FETCH_CHARS);

  const looksLikeHtml = type.includes("html") || type.includes("xml") || /^\s*</.test(body);
  if (!looksLikeHtml) {
    const markdown = normalizeMarkdown(body);
    if (!markdown.trim()) throw new Error(`${host} returned an empty document.`);
    return { title: inferTitle(markdown) || host, url: url.href, markdown };
  }

  const title = extractHtmlTitle(body) || host;
  const markdown = dropLeadingTitle(htmlToMarkdown(body, url), title);
  if (!markdown.trim()) throw new Error(`Fetched ${host} but found no readable article text.`);
  return { title, url: url.href, markdown };
}

// ---------------------------------------------------------------- HTML → markdown

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  divide: "÷",
  euro: "€",
  pound: "£",
  yen: "¥",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

// In code blocks a stripped tag must not leave a space behind — that space
// would read as indentation.
function stripTagsCompact(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function plain(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? decodeEntities(match[2] ?? match[3] ?? "") : "";
}

function absoluteUrl(raw: string, base?: URL): string {
  const value = raw.trim();
  if (!value || /^(data|javascript|vbscript):/i.test(value)) return "";
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function inline(html: string, base?: URL): string {
  let s = html;

  s = s.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
    const inner = plain(anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
    const href = absoluteUrl(attr(anchor, "href"), base);
    return href && inner ? `[${inner}](${href})` : inner;
  });

  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = absoluteUrl(attr(tag, "src"), base);
    const alt = attr(tag, "alt").replace(/[[\]]/g, "");
    return src ? `![${alt}](${src})` : "";
  });

  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
    const code = decodeEntities(stripTags(inner)).replace(/\s+/g, " ").trim();
    return code ? `\`${code}\`` : "";
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, inner: string) => `**${plain(inner)}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, inner: string) => `*${plain(inner)}*`);
  s = s.replace(/<br\b[^>]*>/gi, "\n");

  // Collapse runs of spaces, but keep the line structure the block rewrites
  // just produced — the reader relies on blank lines between blocks.
  return decodeEntities(stripTags(s))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function extractHtmlTitle(html: string): string {
  const candidates = [
    /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    /<meta\b[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i,
    /<meta\b[^>]*name=["']twitter:title["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i,
  ];
  for (const re of candidates) {
    const match = re.exec(html);
    const title = match ? cleanTitle(decodeEntities(stripTags(match[1]))) : "";
    if (title) return title;
  }
  return "";
}

export function htmlToMarkdown(html: string, base?: URL): string {
  const codeBlocks: string[] = [];

  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(
    /<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " ",
  );

  // Pull code out before whitespace gets normalised, so indentation survives.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const lang = /language-([\w+#-]+)/i.exec(inner)?.[1] ?? "";
    const code = dedent(decodeEntities(stripTagsCompact(inner)));
    codeBlocks.push(`\`\`\`${lang}\n${code}\n\`\`\``);
    return `\n\n\u0000CODE${codeBlocks.length - 1}\u0000\n\n`;
  });

  // Prefer the article, then main, then the whole body.
  const region =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(s) ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(s) ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(s);
  if (region) s = region[1];

  for (let level = 1; level <= 6; level++) {
    const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
    s = s.replace(re, (_m, inner: string) => `\n\n${"#".repeat(level)} ${inline(inner, base)}\n\n`);
  }

  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const quoted = inline(inner, base)
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join("\n");
    return quoted ? `\n\n${quoted}\n\n` : "\n\n";
  });

  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inline(inner, base)}\n`);
  s = s.replace(/<hr\b[^>]*\/?>/gi, "\n\n---\n\n");
  s = s.replace(/<(p|div|section|figure|figcaption|table|thead|tbody|tr|ul|ol)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<\/(p|div|section|figure|figcaption|table|thead|tbody|tr|ul|ol|li)>/gi, "\n\n");
  s = s.replace(/<t[dh]\b[^>]*>/gi, " ");
  s = s.replace(/<\/t[dh]>/gi, " | ");
  s = s.replace(/<br\b[^>]*>/gi, "\n");

  s = inline(s, base);

  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => codeBlocks[Number(i)] ?? "").trim();
}

// Remove only the common indent shared by every line, so nested code keeps
// its shape while the outer HTML indentation disappears.
function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^[ \t]*/.exec(line)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(min)).join("\n");
}

function dropLeadingTitle(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const index = lines.findIndex((line) => line.trim());
  if (index < 0) return markdown;
  const heading = /^#\s+(.+)$/.exec(lines[index].trim());
  if (!heading) return markdown;
  const same = cleanTitle(heading[1].replace(/[*_`]/g, "")).toLowerCase() === title.toLowerCase();
  if (!same) return markdown;
  lines.splice(index, 1);
  return lines.join("\n").replace(/^\n+/, "").trim();
}
