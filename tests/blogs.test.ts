import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  blogsDir,
  deleteBlog,
  excerptOf,
  htmlToMarkdown,
  importFromUrl,
  inferTitle,
  listBlogs,
  loadBlog,
  saveBlog,
  summarize,
} from "../src/blogs.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "drongo-blogs-"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a saved blog round-trips through a frontmatter markdown file", () => {
  const dir = tmpDir();
  const blog = saveBlog(
    {
      title: "Stripe Idempotency Keys",
      url: "https://stripe.com/blog/idempotency",
      markdown: "# Stripe Idempotency Keys\n\nRetries are safe when the key is stable.",
    },
    dir,
  );

  assert.equal(blog.slug, "stripe-idempotency-keys");
  const file = path.join(blogsDir(dir), `${blog.slug}.md`);
  const raw = fs.readFileSync(file, "utf8");
  assert.match(raw, /^---\ntitle: "Stripe Idempotency Keys"/);
  assert.match(raw, /url: "https:\/\/stripe\.com\/blog\/idempotency"/);

  const loaded = loadBlog(blog.slug, dir)!;
  assert.equal(loaded.title, blog.title);
  assert.equal(loaded.url, blog.url);
  assert.equal(loaded.addedAt, blog.addedAt);
  assert.equal(loaded.markdown, blog.markdown);
});

test("listBlogs returns summaries newest first", async () => {
  const dir = tmpDir();
  saveBlog({ title: "Older Post", markdown: "First post body." }, dir);
  await sleep(3);
  saveBlog({ title: "Newer Post", markdown: "Second post body." }, dir);

  const list = listBlogs(dir);
  assert.deepEqual(
    list.map((b) => b.title),
    ["Newer Post", "Older Post"],
  );
  const summary = summarize(list[0]);
  assert.equal(summary.words, 3);
  assert.equal(summary.minutes, 1);
  assert.equal(summary.excerpt, "Second post body.");
});

test("titles that slug the same get distinct files", () => {
  const dir = tmpDir();
  const a = saveBlog({ title: "The Same Title", markdown: "One." }, dir);
  const b = saveBlog({ title: "The Same Title", markdown: "Two." }, dir);
  assert.equal(a.slug, "the-same-title");
  assert.equal(b.slug, "the-same-title-2");
  assert.equal(listBlogs(dir).length, 2);
});

test("title falls back to the first heading, then Untitled", () => {
  const dir = tmpDir();
  const inferred = saveBlog({ markdown: "## A Heading From The Body\n\nText." }, dir);
  assert.equal(inferred.title, "A Heading From The Body");
  const untitled = saveBlog({ markdown: "Just a paragraph with no heading." }, dir);
  assert.equal(untitled.title, "Untitled");
});

test("hand-written markdown without frontmatter is still readable", () => {
  const dir = tmpDir();
  fs.mkdirSync(blogsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(blogsDir(dir), "manual-note.md"), "# Notes I wrote myself\n\nBody.\n");

  const blog = loadBlog("manual-note", dir)!;
  assert.equal(blog.title, "Notes I wrote myself");
  assert.equal(blog.url, null);
  assert.ok(blog.addedAt);
});

test("a thematic break at the top is not mistaken for frontmatter", () => {
  const dir = tmpDir();
  fs.mkdirSync(blogsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(blogsDir(dir), "breaks.md"), "---\n\nIntro paragraph.\n\n---\n\nMore text.\n");
  const blog = loadBlog("breaks", dir)!;
  assert.match(blog.markdown, /Intro paragraph\./);
  assert.match(blog.markdown, /More text\./);
});

test("deleteBlog removes the file and rejects unsafe slugs", () => {
  const dir = tmpDir();
  const blog = saveBlog({ title: "Disposable", markdown: "Text." }, dir);
  assert.equal(deleteBlog(blog.slug, dir), true);
  assert.equal(loadBlog(blog.slug, dir), null);
  assert.equal(deleteBlog("../config", dir), false);
});

test("empty text and unsafe slugs are refused", () => {
  const dir = tmpDir();
  assert.throws(() => saveBlog({ title: "Empty", markdown: "   \n\n" }, dir), /no text/i);
  assert.throws(() => saveBlog({ markdown: "Text.", slug: "../escape" }, dir), /invalid blog slug/i);
});

test("excerpts strip markdown syntax", () => {
  assert.equal(excerptOf("## Title\n\n**Bold** and [a link](https://x.test)."), "Title Bold and a link.");
});

test("importFromUrl extracts an article, keeps code, and resolves links", async () => {
  const html = `<!doctype html><html><head>
    <title>Idempotency keys | Stripe</title>
  </head><body>
    <nav>Some navigation</nav>
    <article>
      <h1>Idempotency keys</h1>
      <p>An <strong>idempotency key</strong> lets a client retry safely.
         See <a href="/docs/keys">the docs</a>.</p>
      <pre><code class="language-js">if (x &lt; 2) {
  console.log("safe");
}</code></pre>
      <script>alert("never")</script>
    </article>
  </body></html>`;

  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;

  const blog = await importFromUrl("https://stripe.com/blog/idempotency", { fetchImpl });
  assert.deepEqual(seen, ["https://stripe.com/blog/idempotency"]);
  assert.equal(blog.title, "Idempotency keys");
  assert.equal(blog.url, "https://stripe.com/blog/idempotency");
  assert.match(blog.markdown, /\*\*idempotency key\*\*/);
  assert.match(blog.markdown, /\[the docs\]\(https:\/\/stripe\.com\/docs\/keys\)/);
  assert.match(blog.markdown, /```js\nif \(x < 2\) \{\n  console\.log\("safe"\);\n\}/);
  assert.doesNotMatch(blog.markdown, /alert|Some navigation/);
  assert.doesNotMatch(blog.markdown, /^# Idempotency keys$/m, "the duplicate title heading is dropped");
});

test("a URL without a scheme is treated as https", async () => {
  const fetchImpl = (async () =>
    new Response("# A plain text post\n\nBody.", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })) as typeof fetch;
  const blog = await importFromUrl("example.com/post", { fetchImpl });
  assert.equal(blog.url, "https://example.com/post");
  assert.equal(blog.title, "A plain text post");
});

test("importFromUrl refuses non-http URLs before fetching", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;

  await assert.rejects(() => importFromUrl("file:///etc/passwd", { fetchImpl }), /http/i);
  assert.equal(called, false);
  await assert.rejects(() => importFromUrl("   ", { fetchImpl }), /URL/i);
});

test("a failed fetch surfaces the host and status", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  await assert.rejects(() => importFromUrl("https://example.com/missing", { fetchImpl }), /HTTP 404/);
});

test("htmlToMarkdown handles lists, blockquotes, and headings", () => {
  const markdown = htmlToMarkdown(
    `<article><h2>Steps</h2><ul><li>First</li><li>Second</li></ul>
     <blockquote><p>Keep retries cheap.</p></blockquote><hr><p>Done.</p></article>`,
  );
  assert.match(markdown, /^## Steps$/m);
  assert.match(markdown, /^- First$/m);
  assert.match(markdown, /^- Second$/m);
  assert.match(markdown, /^> Keep retries cheap\.$/m);
  assert.match(markdown, /^---$/m);
});

test("inferTitle ignores non-heading text and trims emphasis", () => {
  assert.equal(inferTitle("some text\n\n### **Real** title ###"), "Real title");
  assert.equal(inferTitle("plain text only"), "");
});
