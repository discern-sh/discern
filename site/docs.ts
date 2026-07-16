/**
 * The /docs section: the same documentation tree `discern help` serves,
 * rendered for a browser.
 *
 * There is no second content tree and no site-side curation list. Discovery is
 * the engine's own `discoverDocs`, and the guidance boundary is the engine's
 * own `BUNDLED_PUBLIC_DOC_DIRS` — the allowlist that decides which `map/`
 * subtrees ship inside every customer binary. What `discern help` shows in a
 * terminal, this module shows at discern.sh/docs; numbered ADRs use the same
 * model in a separately labelled project-history route family.
 *
 * Reader parity carries through: every page negotiates. A browser gets the
 * rendered shell; a text client (or a `.md` suffix) gets the pristine Markdown
 * bytes — the same bytes `discern help <leaf> --raw` prints.
 */

import { fromFileUrl, join, relative } from "@std/path";
import {
  adrRecords,
  discoverDocs,
  type DocEntry,
  isPublicDoc,
  publicDocs,
} from "../src/lib/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS, resolveMapDir } from "../src/lib/paths.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { stripAdrCitations } from "../src/lib/adr_citations.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { designSystemAssetPath } from "./design_system.ts";

const GITHUB = "https://github.com/jackwh/discern";
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const MAP_DIR = resolveMapDir(REPO_ROOT, await loadConfig(REPO_ROOT)).abs;
const ADR_DIR = join(MAP_DIR, "_adr");
const MAP_REPO_REL = relative(REPO_ROOT, MAP_DIR);
const DECISIONS_ROUTE = "/docs/decisions";

/** One published docs page. */
export interface DocsPage {
  kind: "guide";
  /** Site route, e.g. `/docs/quality-gate/the-receipt`. */
  route: string;
  entry: DocEntry;
  /** Map-relative source path used to resolve local links. */
  mapPath: string;
  /** URL segment for the section, numeric prefix stripped. */
  sectionSlug: string;
  /** True for a section's README — the section landing page. */
  isIndex: boolean;
}

/** One rendered project-history record outside the product-guidance nav. */
export interface DecisionPage {
  kind: "decision";
  route: string;
  entry: DocEntry;
  /** Map-relative source path used to resolve local links. */
  mapPath: string;
  number: string;
  superseded: boolean;
}

export type RoutedDocPage = DocsPage | DecisionPage;

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
  byRoute: Map<string, RoutedDocPage>;
  /** Map-relative source path (`20-quality-gate/the-receipt.md`) → page. */
  byMapPath: Map<string, RoutedDocPage>;
  sections: DocsSection[];
  decisions: {
    route: typeof DECISIONS_ROUTE;
    pages: DecisionPage[];
    byNumber: Map<string, DecisionPage>;
  };
  /** Canonical HTML route source consumed by the sitemap implementation. */
  sitemapRoutes: string[];
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

  const adrTree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: ADR_DIR,
    includeInternal: true,
  });
  if (!adrTree) throw new Error("docs: no ADR tree found");

  const projection = projectDocsPages(tree.entries, BUNDLED_PUBLIC_DOC_DIRS);
  const decisionPages: DecisionPage[] = adrRecords(publicDocs(adrTree.entries))
    .map(({ entry, number, superseded }) => ({
      kind: "decision",
      route: `${DECISIONS_ROUTE}/${entry.slug}`,
      entry,
      mapPath: `_adr/${entry.relToDocs}`,
      number,
      superseded,
    }));
  const byNumber = new Map<string, DecisionPage>();
  for (const page of decisionPages) {
    const prior = byNumber.get(page.number);
    if (prior !== undefined) {
      throw new Error(
        `docs: decision number ${page.number} belongs to both ` +
          `${prior.entry.path} and ${page.entry.path}`,
      );
    }
    byNumber.set(page.number, page);
  }

  const byRoute = new Map<string, RoutedDocPage>();
  const byMapPath = new Map<string, RoutedDocPage>();
  for (const page of [...projection.pages, ...decisionPages]) {
    if (byRoute.has(page.route)) {
      throw new Error(`docs: duplicate route ${page.route}`);
    }
    byRoute.set(page.route, page);
    byMapPath.set(page.mapPath, page);
  }
  for (const page of projection.pages) {
    for (const citation of page.entry.citedAdrs) {
      const decision = byNumber.get(citation.number);
      if (
        decision === undefined ||
        decision.entry.slug !== `${citation.number}-${citation.slug}`
      ) {
        throw new Error(
          `docs: ${page.entry.path} cites missing decision ` +
            `${citation.number}-${citation.slug}`,
        );
      }
    }
  }

  return {
    ...projection,
    byRoute,
    byMapPath,
    decisions: { route: DECISIONS_ROUTE, pages: decisionPages, byNumber },
    sitemapRoutes: [
      "/docs",
      ...projection.pages.map((page) => page.route),
      DECISIONS_ROUTE,
      ...decisionPages.map((page) => page.route),
    ],
  };
}

interface DocsProjection {
  pages: DocsPage[];
  sections: DocsSection[];
}

/**
 * Project public guidance pages into curated sections. This is also the build
 * guard: configured public sections must have a README, and every public page
 * must belong to exactly one rendered section. The function is exported so a
 * synthetic orphan can exercise the same failure path as the production build.
 */
export function projectDocsPages(
  entries: readonly DocEntry[],
  sectionDirs: readonly string[],
): DocsProjection {
  const publicEntries = entries.filter(isPublicDoc);
  const sectionless = publicEntries.filter((entry) =>
    entry.section === "" && entry.slug.toLowerCase() !== "readme"
  );
  if (sectionless.length > 0) {
    throw new Error(
      `docs: published page ${sectionless[0]?.relToDocs} has no section`,
    );
  }

  // Tier-level curation (which subtrees ship) composes with the model's ONE
  // page-level predicate (publish: false is the sole page withhold).
  const published = publicEntries.filter((entry) =>
    sectionDirs.includes(entry.section)
  );

  const slugs = new Map<string, string>();
  for (const dir of sectionDirs) {
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
      kind: "guide",
      route: isIndex
        ? `/docs/${sectionSlug}`
        : `/docs/${sectionSlug}/${entry.slug}`,
      entry,
      mapPath: entry.relToDocs,
      sectionSlug,
      isIndex,
    };
  });

  const sections: DocsSection[] = [];
  for (const dir of sectionDirs) {
    const sectionPages = pages.filter((p) => p.entry.section === dir);
    const indexes = sectionPages.filter((p) => p.isIndex);
    const index = indexes[0];
    if (index === undefined) {
      throw new Error(`docs: published section ${dir} has no public README`);
    }
    if (indexes.length > 1) {
      throw new Error(`docs: published section ${dir} has multiple READMEs`);
    }
    sections.push({
      dir,
      slug: sectionSlugOf(dir),
      title: index.entry.title,
      description: index.entry.description,
      index,
      pages: sectionPages,
    });
  }

  const reachable = sections.flatMap((section) => section.pages);
  if (
    reachable.length !== pages.length ||
    reachable.some((page, index) => page !== pages[index])
  ) {
    throw new Error("docs: published page is not reachable from navigation");
  }

  return { pages, sections };
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
 * Remove an authored README table/list whose local Markdown links all point to
 * direct sibling leaves. The site replaces that maintenance surface with the
 * model-derived section index; mixed reference/see-also blocks stay as prose.
 */
function stripAuthoredLeafIndexes(
  md: string,
  page: DocsPage,
  site: DocsSite,
): string {
  if (!page.isIndex) return md;
  const siblings = new Set(
    site.sections.find((section) => section.index.route === page.route)?.pages
      .filter((candidate) => !candidate.isIndex)
      .map((candidate) => candidate.mapPath) ?? [],
  );
  const fromDir = page.mapPath.slice(0, page.mapPath.lastIndexOf("/"));
  const isLeafIndex = (block: string): boolean => {
    let siblingLinks = 0;
    for (const match of block.matchAll(/\]\(([^()\s]+)\)/g)) {
      const dest = match[1] ?? "";
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("/") ||
        dest.startsWith("#")
      ) {
        continue;
      }
      const pathPart = dest.replace(/#.*$/, "");
      if (!pathPart.toLowerCase().endsWith(".md")) continue;
      const mapRel = normalizeRel(`${fromDir}/${pathPart}`);
      if (mapRel === null) continue;
      if (siblings.has(mapRel)) {
        siblingLinks += 1;
        continue;
      }
      if (!mapRel.startsWith("_adr/")) return false;
    }
    return siblingLinks > 0;
  };

  const lines = md.split("\n");
  const output: string[] = [];
  const dropHeading = (): void => {
    let index = output.length - 1;
    while (index >= 0 && output[index]?.trim() === "") index -= 1;
    if (index >= 0 && /^##\s+/.test(output[index] ?? "")) {
      output.splice(index);
    }
  };
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const table = /^\s*\|/.test(line);
    const list = /^\s*-\s+/.test(line);
    if (!table && !list) {
      output.push(line);
      index += 1;
      continue;
    }
    let end = index + 1;
    if (table) {
      while (end < lines.length && /^\s*\|/.test(lines[end] ?? "")) end += 1;
    } else {
      while (
        end < lines.length && (lines[end] ?? "").trim() !== "" &&
        !/^##\s+/.test(lines[end] ?? "")
      ) {
        end += 1;
      }
    }
    const block = lines.slice(index, end).join("\n");
    if (isLeafIndex(block)) {
      dropHeading();
    } else {
      output.push(...lines.slice(index, end));
    }
    index = end;
  }
  return output.join("\n");
}

/**
 * Rewrite one relative link destination for the site. Published leaves become
 * routes; ADR records become decision routes; everything else that stays
 * inside the repo becomes a GitHub link, so an internal reference never 404s.
 */
function rewriteDest(
  dest: string,
  page: RoutedDocPage,
  site: DocsSite,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("#")) return dest;
  if (dest.startsWith("/")) return dest;

  const hash = dest.indexOf("#");
  const pathPart = hash === -1 ? dest : dest.slice(0, hash);
  const frag = hash === -1 ? "" : dest.slice(hash);
  if (pathPart === "") return dest;

  const fromDir = page.mapPath.includes("/")
    ? page.mapPath.slice(0, page.mapPath.lastIndexOf("/"))
    : "";

  // Inside the map? A published leaf (or a directory with a published README)
  // rewrites to its route.
  const mapRel = normalizeRel(`${fromDir}/${pathPart}`);
  if (mapRel !== null) {
    if (mapRel === "_adr" || mapRel === "_adr/README.md") {
      return site.decisions.route + frag;
    }
    for (
      const candidate of [mapRel, `${mapRel}/README.md`.replace(/^\//, "")]
    ) {
      const target = site.byMapPath.get(candidate);
      if (target) return target.route + frag;
    }
  }

  // Anything else living in the repo — an unpublished tier or source file —
  // points at GitHub.
  const repoRel = normalizeRel(`${MAP_REPO_REL}/${fromDir}/${pathPart}`);
  if (repoRel === null) return dest;
  const isDir = !/\.[A-Za-z0-9]+$/.test(repoRel);
  return `${GITHUB}/${isDir ? "tree" : "blob"}/main/${repoRel}${frag}`;
}

/** Rewrite Markdown link destinations outside fenced code blocks. */
export function rewriteLinks(
  md: string,
  page: RoutedDocPage,
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
  page: RoutedDocPage,
  site: DocsSite,
): Promise<RenderedDoc> {
  const cached = renderCache.get(page.route);
  if (cached) return cached;

  const raw = await Deno.readTextFile(page.entry.absPath);
  const { body } = parseFrontmatter(raw);
  const humanBody = stripAdrCitations(body);
  const projectedBody = page.kind === "guide"
    ? stripAuthoredLeafIndexes(humanBody, page, site)
    : humanBody;
  const { html, headings } = renderMarkdownHtml(
    rewriteLinks(projectedBody, page, site),
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
    const leaves = section.pages.map((p) => {
      const here = current !== null && p.route === current.route;
      return `<li><a href="${p.route}"${here ? ' aria-current="page"' : ""}>${
        p.isIndex ? "Overview" : esc(p.entry.title)
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

type BreadcrumbTarget = RoutedDocPage | "decisions" | null;

/** The breadcrumb trail as a mono path — the docs' terminal ancestry. */
function crumbsHtml(target: BreadcrumbTarget): string {
  const sep = `<span class="docs-crumb-sep">/</span>`;
  const parts = [`<a href="/docs">docs</a>`];
  if (target === "decisions") {
    parts.push(`<span aria-current="page">decisions</span>`);
  } else if (target !== null) {
    if (target.kind === "decision") {
      parts.push(
        `<a href="${DECISIONS_ROUTE}">decisions</a>`,
        `<span aria-current="page">${esc(target.entry.slug)}</span>`,
      );
    } else if (target.isIndex) {
      parts.push(`<span aria-current="page">${esc(target.sectionSlug)}</span>`);
    } else {
      parts.push(
        `<a href="/docs/${target.sectionSlug}">${esc(target.sectionSlug)}</a>`,
        `<span aria-current="page">${esc(target.entry.slug)}</span>`,
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
  /** The page family represented in the breadcrumb trail. */
  breadcrumb: BreadcrumbTarget;
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
    ${crumbsHtml(frame.breadcrumb)}
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

/** The colophon under every page: the plain-text edition, source, and history. */
function colophonHtml(
  page: RoutedDocPage | null,
  index: "docs" | "decisions" = "docs",
): string {
  const route = page?.route ??
    (index === "decisions" ? DECISIONS_ROUTE : "/docs");
  const raw = page?.kind === "guide"
    ? ` — the same bytes <code>discern help ${
      esc(page.entry.slug)
    } --raw</code> prints`
    : "";
  const source = page === null
    ? index === "decisions"
      ? `${GITHUB}/tree/main/${MAP_REPO_REL}/_adr`
      : `${GITHUB}/tree/main/${MAP_REPO_REL}`
    : `${GITHUB}/blob/main/${MAP_REPO_REL}/${esc(page.mapPath)}`;
  return `<footer class="docs-colophon">
      <span>This page is plain text too:
        <a class="discern-mono" href="${route}.md">curl&nbsp;discern.sh${route}.md</a>${raw}.</span>
      <span class="docs-colophon-links">
        <a href="${DECISIONS_ROUTE}">Project decisions</a>
        <a href="${source}">View source&nbsp;↗</a>
      </span>
    </footer>`;
}

/** The section landing's canonical leaf list, derived from DocEntry metadata. */
function sectionLeafIndexHtml(site: DocsSite, page: DocsPage): string {
  if (!page.isIndex) return "";
  const section = site.sections.find((candidate) =>
    candidate.index.route === page.route
  );
  if (section === undefined) {
    throw new Error(`docs: no section owns landing page ${page.route}`);
  }
  const leaves = section.pages.filter((candidate) => !candidate.isIndex);
  if (leaves.length === 0) return "";
  const items = leaves.map((leaf) =>
    `<li><a href="${leaf.route}">${esc(leaf.entry.title)}</a>` +
    `<span class="docs-leaf-desc">${esc(leaf.entry.description)}</span></li>`
  ).join("");
  return `<section class="docs-section-index" aria-labelledby="section-pages">
      <h2 id="section-pages">In this section</h2>
      <ol>${items}</ol>
    </section>`;
}

/** A public page's collected citations, linked to their on-site records. */
function relatedDecisionsHtml(site: DocsSite, page: DocsPage): string {
  if (page.entry.citedAdrs.length === 0) return "";
  const items = page.entry.citedAdrs.map((citation) => {
    const decision = site.decisions.byNumber.get(citation.number);
    if (decision === undefined) {
      throw new Error(
        `docs: ${page.entry.path} cites missing decision ${citation.number}`,
      );
    }
    return `<li><a class="docs-related-decision" href="${decision.route}">${
      esc(decision.entry.title)
    }</a></li>`;
  }).join("");
  return `<aside class="docs-related-decisions" aria-labelledby="related-decisions">
      <h2 id="related-decisions">Related decisions</h2>
      <ul>${items}</ul>
    </aside>`;
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
    breadcrumb: page,
    mainHtml: `<article class="doc-body">
${rendered.html}
${sectionLeafIndexHtml(site, page)}
    </article>
    ${relatedDecisionsHtml(site, page)}
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
    breadcrumb: null,
    mainHtml: cover,
    tocHtml: "",
  });
}

function historyLabelHtml(superseded: boolean): string {
  const status = superseded
    ? `<strong class="docs-history-status">Superseded record.</strong> `
    : "";
  return `<aside class="docs-history-label">
    <span class="discern-kicker">Project history</span>
    <p>${status}These records explain why discern was built this way. They are
    project history, not current product guidance; use the
    <a href="/docs">manual</a> for guidance.</p>
  </aside>`;
}

function decisionListHtml(pages: readonly DecisionPage[]): string {
  return `<ol class="docs-decision-list">${
    pages.map((page) =>
      `<li><a href="${page.route}">${esc(page.entry.title)}</a>` +
      `${
        page.superseded
          ? '<span class="docs-decision-status">Superseded</span>'
          : ""
      }</li>`
    ).join("")
  }</ol>`;
}

/** The project-history index, deliberately outside the product-guidance nav. */
export function decisionsIndexShell(site: DocsSite): string {
  const active = site.decisions.pages.filter((page) => !page.superseded);
  const superseded = site.decisions.pages.filter((page) => page.superseded);
  const main = `${historyLabelHtml(false)}
  <article class="doc-body docs-decisions-index">
    <h1>Project decisions</h1>
    <p>The numbered records preserve the context and trade-offs behind discern's architecture.</p>
    <h2>Current records</h2>
    ${decisionListHtml(active)}
    <h2>Superseded records</h2>
    <p>These records remain available because the path to today's design is part of the history.</p>
    ${decisionListHtml(superseded)}
  </article>
  ${colophonHtml(null, "decisions")}`;
  return shellFrame(site, {
    htmlTitle: "Project decisions · discern.sh docs",
    description:
      "Project-history records explaining the decisions behind discern.",
    current: null,
    breadcrumb: "decisions",
    mainHtml: main,
    tocHtml: "",
  });
}

/** One rendered ADR, labeled as history rather than product guidance. */
export function decisionShell(
  site: DocsSite,
  page: DecisionPage,
  rendered: RenderedDoc,
): string {
  return shellFrame(site, {
    htmlTitle: `${page.entry.title} · discern.sh docs`,
    description: page.entry.description,
    current: null,
    breadcrumb: page,
    mainHtml: `${historyLabelHtml(page.superseded)}
    <article class="doc-body docs-decision-record">
${rendered.html}
    </article>
    ${colophonHtml(page)}`,
    tocHtml: tocHtml(rendered.toc),
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

/** The Markdown edition of the project-history index. */
export function decisionsIndexMarkdown(site: DocsSite): string {
  const lines = [
    "# Project decisions",
    "",
    "Project history, not product guidance. Use /docs for current guidance.",
    "",
  ];
  for (const page of site.decisions.pages) {
    const status = page.superseded ? " — superseded" : "";
    lines.push(
      `- https://discern.sh${page.route}.md — ${page.entry.title}${status}`,
    );
  }
  lines.push("");
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

  if (routePath === site.decisions.route) {
    if (wantsMd || asText) {
      return respond(
        decisionsIndexMarkdown(site),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    return respond(
      decisionsIndexShell(site),
      "text/html; charset=utf-8",
      true,
    );
  }

  const page = site.byRoute.get(routePath);
  if (page === undefined) return docsNotFound(asText);

  if (wantsMd || asText) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    return respond(raw, "text/markdown; charset=utf-8", !wantsMd);
  }
  const rendered = await renderDoc(page, site);
  return respond(
    page.kind === "decision"
      ? decisionShell(site, page, rendered)
      : docsShell(site, page, rendered),
    "text/html; charset=utf-8",
    true,
  );
}
