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

import { fromFileUrl } from "@std/path";
import { discoverDocs, type DocEntry } from "../src/lib/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";

const GITHUB = "https://github.com/jackwh/discern";
const MAP_DIR = fromFileUrl(new URL("../map/", import.meta.url));
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

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

  const published = tree.entries.filter((e) =>
    BUNDLED_PUBLIC_DOC_DIRS.includes(e.section) && e.publish
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
  const repoRel = normalizeRel(`map/${fromDir}/${pathPart}`);
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
 * Render one page (cached): frontmatter stripped, links rewritten, then the
 * engine's own HTML emitter — the same parse `discern help` renders from, so
 * the site and the terminal can never disagree about a doc's content. No
 * rendering dependency exists to bloat the compiled binary.
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
    rewriteLinks(body, page, site),
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

function navHtml(site: DocsSite, current: DocsPage): string {
  return site.sections.map((section) => {
    const leaves = section.pages.filter((p) => !p.isIndex).map((p) => {
      const here = p.route === current.route;
      return `<li><a href="${p.route}"${here ? ' aria-current="page"' : ""}>${
        esc(p.entry.title)
      }</a></li>`;
    }).join("");
    const here = section.index.route === current.route;
    return `<section class="nav-section">
      <a class="nav-label" href="${section.index.route}"${
      here ? ' aria-current="page"' : ""
    }>${esc(section.title)}</a>
      <ul>${leaves}</ul>
    </section>`;
  }).join("\n");
}

function tocHtml(toc: TocItem[]): string {
  if (toc.length === 0) return "";
  const items = toc.map((item) =>
    `<li class="toc-d${item.depth}"><a href="#${esc(item.id)}">${
      esc(item.text)
    }</a></li>`
  ).join("");
  return `<nav class="toc" aria-label="On this page">
    <div class="toc-label">Contents</div>
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
      ? `<a class="pager-${rel}" rel="${rel}" href="${p.route}">
          <span class="pager-dir">${rel === "prev" ? "← previous" : "next →"}
          </span><span class="pager-title">${esc(p.entry.title)}</span></a>`
      : `<span></span>`;
  return `<nav class="pager" aria-label="Pagination">${cell(prev, "prev")}${
    cell(next, "next")
  }</nav>`;
}

const FAVICON =
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%231A1814'/%3E%3Cpath d='M28 53l17 16 27-36' stroke='%234CC088' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

/** The full document around one rendered page. */
export function docsShell(
  site: DocsSite,
  page: DocsPage,
  rendered: RenderedDoc,
): string {
  const title = page.entry.title;
  const description = page.entry.description;
  const sectionTitle =
    site.sections.find((s) => s.slug === page.sectionSlug)?.title ?? "";
  const crumbs = [
    `<a href="/docs">docs</a>`,
    page.isIndex
      ? `<span aria-current="page">${esc(sectionTitle)}</span>`
      : `<a href="/docs/${page.sectionSlug}">${esc(sectionTitle)}</a>`,
    ...(page.isIndex ? [] : [`<span aria-current="page">${esc(title)}</span>`]),
  ].join(`<span class="crumb-sep">/</span>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · discern docs</title>
<meta name="description" content="${esc(description)}" />
<meta name="theme-color" content="#FBFAF7" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#16171A" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="${FAVICON}" />
<script>
(function () {
  let stored = null;
  try { stored = localStorage.getItem("discern-theme"); } catch (_) { /* file:// quirks */ }
  const preferDark = matchMedia("(prefers-color-scheme: dark)").matches;
  if (stored === "dark" || (!stored && preferDark)) {
    document.documentElement.classList.add("dark");
  }
})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/docs.css" />
<script defer src="/assets/docs.js"></script>
</head>
<body>
<a class="skip" href="#doc">Skip to content</a>
<header class="top">
  <button class="nav-burger" aria-label="Open navigation" data-drawer>☰</button>
  <a class="brand" href="/"><span class="brand-mark">✓</span> discern</a>
  <a class="brand-docs" href="/docs">docs</a>
  <div class="top-spacer"></div>
  <button class="search-btn" data-search-open>
    <span>search</span><kbd>⌘K</kbd>
  </button>
  <button class="theme-btn" aria-label="Toggle theme" data-theme-toggle>◐</button>
</header>
<div class="layout">
  <aside class="sidenav" id="sidenav">
    <nav aria-label="Documentation">${navHtml(site, page)}</nav>
    <div class="sidenav-foot">
      <a href="/agents">the man page</a>
      <a href="/llms.txt">llms.txt</a>
    </div>
  </aside>
  <main id="doc">
    <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
    <article class="doc-body">
${rendered.html}
    </article>
    ${pagerHtml(site, page)}
    <footer class="doc-foot">
      <span>This page is also plain Markdown:
        <a href="${page.route}.md">curl&nbsp;discern.sh${page.route}.md</a>
        — the same bytes <code>discern help ${
    esc(page.entry.slug)
  } --raw</code> prints.</span>
      <a href="${GITHUB}/blob/main/${
    esc(page.entry.path)
  }">View source on GitHub</a>
    </footer>
  </main>
  <div class="toc-rail">${tocHtml(rendered.toc)}</div>
</div>
<div class="search-veil" data-search-veil hidden>
  <div class="search-panel" role="dialog" aria-label="Search documentation">
    <input class="search-input" type="search"
      placeholder="Search the docs…" data-search-input
      autocomplete="off" spellcheck="false" />
    <ul class="search-results" data-search-results></ul>
    <div class="search-hint">↑↓ to choose · ↵ to open · esc to close</div>
  </div>
</div>
</body>
</html>
`;
}

/** The /docs landing page: sections and their leaves, with descriptions. */
export function docsIndexShell(site: DocsSite): string {
  const first = site.pages[0];
  const cards = site.sections.map((section) => {
    const leaves = section.pages.filter((p) => !p.isIndex).map((p) =>
      `<li><a href="${p.route}">${esc(p.entry.title)}</a>
        <span class="leaf-desc">${esc(p.entry.description)}</span></li>`
    ).join("");
    return `<section class="index-section">
      <h2><a href="${section.index.route}">${esc(section.title)}</a></h2>
      <p>${esc(section.description)}</p>
      <ul>${leaves}</ul>
    </section>`;
  }).join("\n");

  const indexPage: DocsPage = first ?? {
    route: "/docs",
    entry: {
      path: "map/README.md",
      absPath: "",
      relToDocs: "README.md",
      section: "",
      slug: "docs",
      title: "Documentation",
      description: "",
      publish: true,
    },
    sectionSlug: "",
    isIndex: true,
  };

  const body = `<header class="index-head">
    <h1>The manual</h1>
    <p>The same documentation <code>discern help</code> serves in your
    terminal, kept current by the agents that work on discern. Text clients are
    first-class here: <code>curl</code> any page, or append
    <code>.md</code>, for the raw Markdown.</p>
  </header>
  ${cards}`;

  const shell = docsShell(site, indexPage, { html: body, toc: [] });
  return shell
    .replace(/<title>[^<]*<\/title>/, "<title>Documentation · discern</title>")
    .replace(
      /<nav class="crumbs"[^>]*>[\s\S]*?<\/nav>/,
      `<nav class="crumbs" aria-label="Breadcrumb"><span aria-current="page">docs</span></nav>`,
    );
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
