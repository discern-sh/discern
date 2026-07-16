/**
 * The /docs section: the same documentation tree `discern help` serves,
 * rendered for a browser.
 *
 * There is no second content tree and no site-side curation list. Discovery is
 * the engine's own `discoverDocs`, and the publish boundary is the engine's own
 * `BUNDLED_PUBLIC_DOC_DIRS` — the allowlist that decides which `map/` subtrees
 * ship inside every customer binary. What `discern help` shows in a terminal,
 * this module shows at discern.sh/docs; a leaf added to the map appears in the
 * nav, the search index, and the test suite without touching this file.
 *
 * Reader parity carries through: every page negotiates. A browser gets the
 * rendered shell; a text client (or a `.md` suffix) gets the pristine Markdown
 * bytes — the same bytes `discern help <leaf> --raw` prints.
 */

import { fromFileUrl, relative } from "@std/path";
import { discoverDocs, type DocEntry, isPublicDoc } from "../src/lib/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS, resolveMapDir } from "../src/lib/paths.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { stripAdrCitations } from "../src/lib/adr_citations.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { designSystemAssetPath } from "./design_system.ts";

const GITHUB = "https://github.com/jackwh/discern";
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const MAP_DIR = resolveMapDir(REPO_ROOT, await loadConfig(REPO_ROOT)).abs;
const MAP_REPO_REL = relative(REPO_ROOT, MAP_DIR);

/** One published docs page. */
export interface DocsPage {
  /** Site route, e.g. `/docs/quality-gate/the-receipt`. */
  route: string;
  entry: DocEntry;
  /** URL segment for the section, numeric prefix stripped. */
  sectionSlug: string;
  /** True for a section's README — the section landing page. */
  isIndex: boolean;
}

/** One published section, in reading order. */
export interface DocsSection {
  /** The on-disk directory name, e.g. `20-quality-gate`. */
  dir: string;
  slug: string;
  title: string;
  description: string;
  index: DocsPage;
  /** Every page in the section, README first. */
  pages: DocsPage[];
}

/** The published docs site, derived once per process. */
export interface DocsSite {
  /** Every page in linear reading order (section indexes included). */
  pages: DocsPage[];
  byRoute: Map<string, DocsPage>;
  /** Map-relative source path (`20-quality-gate/the-receipt.md`) → page. */
  byMapPath: Map<string, DocsPage>;
  sections: DocsSection[];
}

let sitePromise: Promise<DocsSite> | undefined;

/** Discover and index the published tree. Cached for the process lifetime. */
export function loadDocsSite(): Promise<DocsSite> {
  sitePromise ??= buildDocsSite();
  return sitePromise;
}

/** Strip the reading-order prefix from a section directory name. */
export function sectionSlugOf(dir: string): string {
  return dir.replace(/^\d+-/, "");
}

async function buildDocsSite(): Promise<DocsSite> {
  const tree = await discoverDocs({ cwd: REPO_ROOT, dir: MAP_DIR });
  if (!tree) throw new Error("docs: no map tree found");

  // Tier-level curation (which subtrees ship) composes with the model's ONE
  // page-level predicate (publish: false is the sole page withhold).
  const published = tree.entries.filter((e) =>
    BUNDLED_PUBLIC_DOC_DIRS.includes(e.section) && isPublicDoc(e)
  );

  const slugs = new Map<string, string>();
  for (const dir of BUNDLED_PUBLIC_DOC_DIRS) {
    const slug = sectionSlugOf(dir);
    const clash = slugs.get(slug);
    if (clash !== undefined && clash !== dir) {
      throw new Error(`docs: sections ${clash} and ${dir} both map to ${slug}`);
    }
    slugs.set(slug, dir);
  }

  const pages: DocsPage[] = published.map((entry) => {
    const sectionSlug = sectionSlugOf(entry.section);
    const isIndex = entry.slug.toLowerCase() === "readme";
    return {
      route: isIndex
        ? `/docs/${sectionSlug}`
        : `/docs/${sectionSlug}/${entry.slug}`,
      entry,
      sectionSlug,
      isIndex,
    };
  });

  const byRoute = new Map(pages.map((p) => [p.route, p]));
  const byMapPath = new Map(pages.map((p) => [p.entry.relToDocs, p]));

  const sections: DocsSection[] = [];
  for (const dir of BUNDLED_PUBLIC_DOC_DIRS) {
    const sectionPages = pages.filter((p) => p.entry.section === dir);
    const index = sectionPages.find((p) => p.isIndex);
    if (index === undefined) continue;
    sections.push({
      dir,
      slug: sectionSlugOf(dir),
      title: index.entry.title,
      description: index.entry.description,
      index,
      pages: sectionPages,
    });
  }

  return { pages, byRoute, byMapPath, sections };
}

// ── Markdown rendering ─────────────────────────────────────────────────────

/** One rendered heading, for the on-page contents rail. */
export interface TocItem {
  depth: 2 | 3;
  id: string;
  text: string;
}

interface RenderedDoc {
  html: string;
  toc: TocItem[];
}

const renderCache = new Map<string, RenderedDoc>();

/** Normalize a `/`-joined path, resolving `.` and `..`. Null when it escapes. */
function normalizeRel(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * Rewrite one relative link destination for the site. Published leaves become
 * routes; everything else that stays inside the repo becomes a GitHub link, so
 * a reference to an unpublished tier (or the ADRs) never 404s.
 */
function rewriteDest(dest: string, page: DocsPage, site: DocsSite): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("#")) return dest;
  if (dest.startsWith("/")) return dest;

  const hash = dest.indexOf("#");
  const pathPart = hash === -1 ? dest : dest.slice(0, hash);
  const frag = hash === -1 ? "" : dest.slice(hash);
  if (pathPart === "") return dest;

  const fromDir = page.entry.relToDocs.includes("/")
    ? page.entry.relToDocs.slice(0, page.entry.relToDocs.lastIndexOf("/"))
    : "";

  // Inside the map? A published leaf (or a directory with a published README)
  // rewrites to its route.
  const mapRel = normalizeRel(`${fromDir}/${pathPart}`);
  if (mapRel !== null) {
    for (
      const candidate of [mapRel, `${mapRel}/README.md`.replace(/^\//, "")]
    ) {
      const target = site.byMapPath.get(candidate);
      if (target) return target.route + frag;
    }
  }

  // Anything else living in the repo — an unpublished tier, an ADR, a source
  // file — points at GitHub.
  const repoRel = normalizeRel(`${MAP_REPO_REL}/${fromDir}/${pathPart}`);
  if (repoRel === null) return dest;
  const isDir = !/\.[A-Za-z0-9]+$/.test(repoRel);
  return `${GITHUB}/${isDir ? "tree" : "blob"}/main/${repoRel}${frag}`;
}

/** Rewrite Markdown link destinations outside fenced code blocks. */
export function rewriteLinks(
  md: string,
  page: DocsPage,
  site: DocsSite,
): string {
  let inFence = false;
  return md.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(
      /\]\(([^()\s]+)\)/g,
      (_m, dest: string) => `](${rewriteDest(dest, page, site)})`,
    );
  }).join("\n");
}

/**
 * Render one page (cached): frontmatter stripped, inline ADR citations
 * stripped (human-rendered prose; the raw `.md` edition keeps both), links
 * rewritten, then the engine's own HTML emitter — the same parse
 * `discern help` renders from, so the site and the terminal can never
 * disagree about a doc's content. No rendering dependency exists to bloat
 * the compiled binary.
 */
export async function renderDoc(
  page: DocsPage,
  site: DocsSite,
): Promise<RenderedDoc> {
  const cached = renderCache.get(page.route);
  if (cached) return cached;

  const raw = await Deno.readTextFile(page.entry.absPath);
  const { body } = parseFrontmatter(raw);
  const { html, headings } = renderMarkdownHtml(
    rewriteLinks(stripAdrCitations(body), page, site),
  );
  const toc: TocItem[] = headings
    .filter((h) => h.depth === 2 || h.depth === 3)
    .map((h) => ({ depth: h.depth === 2 ? 2 : 3, id: h.id, text: h.text }));
  const rendered: RenderedDoc = { html, toc };
  renderCache.set(page.route, rendered);
  return rendered;
}

// ── The shell ──────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Reading-order tier number of a section (`20-quality-gate` → `20`). */
function sectionIndexOf(dir: string): string {
  return /^(\d+)-/.exec(dir)?.[1] ?? "§";
}

function navHtml(site: DocsSite, current: DocsPage | null): string {
  return site.sections.map((section) => {
    const leaves = section.pages.filter((p) => !p.isIndex).map((p) => {
      const here = current !== null && p.route === current.route;
      return `<li><a href="${p.route}"${here ? ' aria-current="page"' : ""}>${
        esc(p.entry.title)
      }</a></li>`;
    }).join("");
    const here = current !== null && section.index.route === current.route;
    return `<section class="docs-nav-chapter">
      <a class="discern-kicker docs-nav-label" href="${section.index.route}"${
      here ? ' aria-current="page"' : ""
    }><span class="discern-kicker__index">${
      sectionIndexOf(section.dir)
    }</span>${esc(section.title)}</a>
      <ul>${leaves}</ul>
    </section>`;
  }).join("\n");
}

function tocHtml(toc: TocItem[]): string {
  if (toc.length === 0) return "";
  const items = toc.map((item) =>
    `<li class="docs-toc-d${item.depth}"><a href="#${esc(item.id)}">${
      esc(item.text)
    }</a></li>`
  ).join("");
  return `<nav class="docs-toc" aria-label="On this page">
    <span class="discern-kicker">On this page</span>
    <ul>${items}</ul>
  </nav>`;
}

function pagerHtml(site: DocsSite, page: DocsPage): string {
  const i = site.pages.findIndex((p) => p.route === page.route);
  const prev = i > 0 ? site.pages[i - 1] : undefined;
  const next = i >= 0 && i < site.pages.length - 1
    ? site.pages[i + 1]
    : undefined;
  if (!prev && !next) return "";
  const cell = (p: DocsPage | undefined, rel: "prev" | "next"): string =>
    p
      ? `<a class="docs-pager-cell docs-pager-${rel}" rel="${rel}" href="${p.route}">
          <span class="docs-pager-dir">${
        rel === "prev" ? "&larr; previous" : "next &rarr;"
      }</span><span class="docs-pager-title">${esc(p.entry.title)}</span></a>`
      : `<span class="docs-pager-cell docs-pager-empty"></span>`;
  return `<nav class="docs-pager" aria-label="Pagination">${
    cell(prev, "prev")
  }${cell(next, "next")}</nav>`;
}

/** The breadcrumb trail as a mono path — the docs' terminal ancestry. */
function crumbsHtml(page: DocsPage | null): string {
  const sep = `<span class="docs-crumb-sep">/</span>`;
  const parts = [`<a href="/docs">docs</a>`];
  if (page !== null) {
    if (page.isIndex) {
      parts.push(`<span aria-current="page">${esc(page.sectionSlug)}</span>`);
    } else {
      parts.push(
        `<a href="/docs/${page.sectionSlug}">${esc(page.sectionSlug)}</a>`,
        `<span aria-current="page">${esc(page.entry.slug)}</span>`,
      );
    }
  } else {
    parts[0] = `<span aria-current="page">docs</span>`;
  }
  return `<nav class="docs-crumbs discern-mono" aria-label="Breadcrumb">${
    parts.join(sep)
  }</nav>`;
}

const FAVICON =
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%231C1E27'/%3E%3Cpath d='M28 53l17 16 27-36' stroke='%237C89F2' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

const ICONS = {
  menu:
    `<svg viewBox="0 0 16 16" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>`,
  search:
    `<svg viewBox="0 0 16 16" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/></svg>`,
  sun:
    `<svg viewBox="0 0 16 16" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3"/></svg>`,
  moon:
    `<svg viewBox="0 0 16 16" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 9.8A5.6 5.6 0 1 1 6.2 2.8a4.4 4.4 0 0 0 7 7z"/></svg>`,
} as const;

interface ShellFrame {
  /** Contents of the `<title>` element. */
  htmlTitle: string;
  description: string;
  /** The page the nav and breadcrumbs highlight; null on the index. */
  current: DocsPage | null;
  /** Everything inside `<main>`, breadcrumbs excluded. */
  mainHtml: string;
  /** The right contents rail; empty when the page has no headings. */
  tocHtml: string;
}

/**
 * The document frame every /docs page shares: design-system foundations on the
 * root, the manual's chrome (top bar, chapter nav, contents rail, search
 * palette) around one `<main>`. Pages differ only in what they put inside it.
 */
function shellFrame(site: DocsSite, frame: ShellFrame): string {
  return `<!doctype html>
<html lang="en" data-discern-root data-discern-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(frame.htmlTitle)}</title>
<meta name="description" content="${esc(frame.description)}" />
<meta name="theme-color" content="#F6F5F8" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#22252C" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="${FAVICON}" />
<script>
(function () {
  var stored = null;
  try { stored = localStorage.getItem("discern-theme"); } catch (_) { /* file:// quirks */ }
  var dark = stored === "dark" ||
    (stored === null && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.setAttribute("data-discern-theme", "dark");
})();
</script>
<link rel="stylesheet" href="${designSystemAssetPath("docs", "fonts.css")}" />
<link rel="stylesheet" href="${designSystemAssetPath("docs", "discern.css")}" />
<link rel="stylesheet" href="/assets/docs.css" />
<script defer src="/assets/docs.js"></script>
</head>
<body>
<a class="docs-skip" href="#doc">Skip to content</a>
<header class="docs-top">
  <button class="discern-icon-button docs-burger" type="button"
    aria-label="Open navigation" aria-expanded="false" data-drawer-toggle>
    <span class="discern-icon">${ICONS.menu}</span>
  </button>
  <a class="docs-brand" href="/">
    <span class="docs-brand-mark" aria-hidden="true">✓</span>
    <span class="docs-brand-word">discern</span></a><a
    class="docs-brand-docs discern-mono" href="/docs">/docs</a>
  <span class="docs-top-spacer"></span>
  <button class="docs-search-btn" type="button" data-search-open>
    <span class="discern-icon docs-search-icon">${ICONS.search}</span>
    <span class="docs-search-btn-word">Search the manual</span>
    <kbd class="discern-mono">⌘K</kbd>
  </button>
  <button class="discern-icon-button docs-theme" type="button"
    aria-label="Toggle color theme" data-theme-toggle>
    <span class="discern-icon docs-theme-icon docs-theme-sun">${ICONS.sun}</span>
    <span class="discern-icon docs-theme-icon docs-theme-moon">${ICONS.moon}</span>
  </button>
</header>
<div class="docs-shell">
  <div class="docs-veil" data-drawer-close hidden></div>
  <aside class="docs-nav" id="docs-nav">
    <nav class="docs-nav-scroll" aria-label="Documentation">
${navHtml(site, frame.current)}
    </nav>
    <div class="docs-nav-foot discern-mono">
      <a href="/agents">agents</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="${GITHUB}">github&nbsp;↗</a>
    </div>
  </aside>
  <main id="doc" class="docs-main">
    ${crumbsHtml(frame.current)}
    ${frame.mainHtml}
  </main>
  <div class="docs-rail">${frame.tocHtml}</div>
</div>
<div class="docs-search" data-search hidden>
  <div class="docs-search-veil" data-search-close></div>
  <div class="discern-window docs-search-panel" role="dialog" aria-modal="true"
    aria-label="Search documentation">
    <div class="discern-window__bar">
      <span class="discern-window__dot"></span><span class="discern-window__dot"></span><span class="discern-window__dot"></span>
      <span class="discern-window__title">search · discern.sh/docs</span>
    </div>
    <div class="discern-window__body docs-search-body">
      <input class="docs-search-input discern-mono" type="search"
        placeholder="Search the manual…" data-search-input
        autocomplete="off" spellcheck="false" />
      <ul class="docs-search-results" data-search-results></ul>
      <div class="docs-search-hint discern-mono">↑↓ choose · ↵ open · esc close</div>
    </div>
  </div>
</div>
</body>
</html>
`;
}

/** The colophon under every page: the plain-text edition, then the source. */
function colophonHtml(page: DocsPage | null): string {
  const route = page?.route ?? "/docs";
  const raw = page === null
    ? ""
    : ` — the same bytes <code>discern help ${
      esc(page.entry.slug)
    } --raw</code> prints`;
  const source = page === null
    ? `${GITHUB}/tree/main/map`
    : `${GITHUB}/blob/main/${esc(page.entry.path)}`;
  return `<footer class="docs-colophon">
      <span>This page is plain text too:
        <a class="discern-mono" href="${route}.md">curl&nbsp;discern.sh${route}.md</a>${raw}.</span>
      <a href="${source}">View source&nbsp;↗</a>
    </footer>`;
}

/** The full document around one rendered page. */
export function docsShell(
  site: DocsSite,
  page: DocsPage,
  rendered: RenderedDoc,
): string {
  return shellFrame(site, {
    htmlTitle: `${page.entry.title} · discern.sh docs`,
    description: page.entry.description,
    current: page,
    mainHtml: `<article class="doc-body">
${rendered.html}
    </article>
    ${pagerHtml(site, page)}
    ${colophonHtml(page)}`,
    tocHtml: tocHtml(rendered.toc),
  });
}

/** The /docs landing page: the manual's cover and table of contents. */
export function docsIndexShell(site: DocsSite): string {
  const chapters = site.sections.map((section) => {
    const leaves = section.pages.filter((p) => !p.isIndex).map((p) =>
      `<li><a href="${p.route}">${esc(p.entry.title)}</a>
        <span class="docs-leaf-desc">${esc(p.entry.description)}</span></li>`
    ).join("");
    return `<section class="docs-chapter">
      <span class="docs-chapter-index" aria-hidden="true">${
      sectionIndexOf(section.dir)
    }</span>
      <div class="docs-chapter-body">
        <h2><a href="${section.index.route}">${esc(section.title)}</a></h2>
        <p class="docs-chapter-desc">${esc(section.description)}</p>
        <ul class="docs-chapter-leaves">${leaves}</ul>
      </div>
    </section>`;
  }).join("\n");

  const cover = `<header class="docs-cover">
    <span class="discern-kicker"><span class="discern-kicker__index">man(1)</span>The discern manual</span>
    <h1>Read what your <em class="discern-heading__accent">agents</em> read.</h1>
    <p class="docs-cover-lead">The same documentation <code>discern help</code>
    serves in a terminal, kept current by the agents that work on discern.
    Text readers are first-class: <code>curl</code> any page — or append
    <code>.md</code> — for the pristine Markdown.</p>
  </header>
  <div class="docs-chapters">
  ${chapters}
  </div>
  ${colophonHtml(null)}`;

  return shellFrame(site, {
    htmlTitle: "Documentation · discern.sh docs",
    description:
      "The discern manual — the same documentation `discern help` serves.",
    current: null,
    mainHtml: cover,
    tocHtml: "",
  });
}

// ── Plain-text surfaces ────────────────────────────────────────────────────

/** The Markdown edition of the /docs index, for text clients. */
export function docsIndexMarkdown(site: DocsSite): string {
  const lines: string[] = [
    "# discern documentation",
    "",
    "The same tree `discern help` serves. Append .md to any page for raw",
    "Markdown, or fetch it with a text client.",
    "",
  ];
  for (const section of site.sections) {
    lines.push(`## ${section.title}`, "");
    for (const p of section.pages) {
      const desc = p.entry.description ? ` — ${p.entry.description}` : "";
      lines.push(`- https://discern.sh${p.route}.md${desc}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** The DOCUMENTATION section appended to /llms.txt, man-page styled. */
export function docsLlmsSection(site: DocsSite): string {
  const lines: string[] = [
    "DOCUMENTATION",
    "    The full manual, one URL per page. Every page returns raw Markdown",
    "    to a text client, or with .md appended; browsers get the rendered",
    "    edition at the same address.",
    "",
  ];
  for (const section of site.sections) {
    lines.push(`    ${section.title}`);
    for (const p of section.pages) {
      const pad = " ".repeat(Math.max(1, 42 - p.route.length));
      lines.push(
        `        https://discern.sh${p.route}${pad}${p.entry.title}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── The request handler ────────────────────────────────────────────────────

let searchIndexCache: string | undefined;

async function searchIndexJson(site: DocsSite): Promise<string> {
  if (searchIndexCache !== undefined) return searchIndexCache;
  const pages = [];
  for (const page of site.pages) {
    const { toc } = await renderDoc(page, site);
    pages.push({
      route: page.route,
      title: page.entry.title,
      section: site.sections.find((s) => s.slug === page.sectionSlug)?.title ??
        "",
      description: page.entry.description,
      headings: toc.map((t) => ({ id: t.id, text: t.text })),
    });
  }
  searchIndexCache = JSON.stringify({ pages });
  return searchIndexCache;
}

function respond(body: string, contentType: string, vary = false): Response {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=300",
  });
  if (vary) headers.set("vary", "Accept, User-Agent");
  return new Response(body, { status: 200, headers });
}

function docsNotFound(asText: boolean): Response {
  if (asText) {
    return new Response(
      "404 — no such doc. The index lives at /docs (raw Markdown for text clients).\n",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>404 · discern docs</title>` +
      `<body style="font-family:ui-monospace,monospace;padding:4rem 1.5rem;color:#1A1814;background:#FBFAF7">` +
      `<p style="max-width:34rem;line-height:1.7">404 — no such doc.<br>` +
      `The index: <a href="/docs">discern.sh/docs</a></p>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Serve one /docs request. `asText` is the caller's reader-negotiation
 * verdict; the `.md` suffix forces Markdown for any reader.
 */
export async function serveDocs(
  path: string,
  asText: boolean,
): Promise<Response> {
  const site = await loadDocsSite();

  if (path === "/docs/index.json") {
    return respond(await searchIndexJson(site), "application/json");
  }

  const wantsMd = path.endsWith(".md");
  const routePath = wantsMd ? path.slice(0, -".md".length) : path;

  if (routePath === "/docs") {
    if (wantsMd || asText) {
      return respond(
        docsIndexMarkdown(site),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    return respond(docsIndexShell(site), "text/html; charset=utf-8", true);
  }

  const page = site.byRoute.get(routePath);
  if (page === undefined) return docsNotFound(asText);

  if (wantsMd || asText) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    return respond(raw, "text/markdown; charset=utf-8", !wantsMd);
  }
  const rendered = await renderDoc(page, site);
  return respond(
    docsShell(site, page, rendered),
    "text/html; charset=utf-8",
    true,
  );
}
