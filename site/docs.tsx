/**
 * The /docs section: the same documentation tree `discern docs` serves,
 * rendered for a browser.
 *
 * Discovery is the engine's neutral `discoverDocs`; corpus admission, routes,
 * publication, kinds, and section order come from the shared validated manual
 * projection. What `discern docs` shows in a terminal, this module shows at
 * discern.sh/docs. Numbered ADRs remain a separately labelled Map-backed
 * project-history route family.
 *
 * Reader parity carries through: every page negotiates. A browser gets the
 * rendered shell; a text client (or a `.md` suffix) gets the pristine Markdown
 * bytes — the same bytes `discern docs <leaf> --raw` prints.
 */

import { DOCUMENT_ROUTES } from "./routes.ts";
import { fromFileUrl, join, relative } from "@std/path";
import {
  adrRecords,
  discoverDocs,
  type DocEntry,
  isPublicDoc,
  publicDocs,
} from "../src/lib/docs.ts";
import {
  MAP_SECTION_REGISTRY,
  type MapSectionAudience,
  resolveMapDir,
  resolveRepositoryManualDir,
} from "../src/lib/paths.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  buildManualProjection,
  type ManualProjection,
} from "../src/lib/manual.ts";
import type { ManualKind } from "../src/shared/manual.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import {
  type AdrCitation,
  stripAdrCitations,
} from "../src/lib/adr_citations.ts";
import {
  escapeHtml as escapeMarkdownHtml,
  renderMarkdownHtml,
  renderMarkdownInlineHtml,
} from "../src/lib/markdown.ts";
import {
  GLOSSARY,
  type GlossaryEntry,
  glossarySummary,
} from "../scripts/glossary_registry.ts";
import { repositoryBlobUrl, repositoryTreeUrl } from "../src/shared/brand.ts";
import type { TocItem } from "./document_toc.tsx";
import { renderWorkflowMarkdown } from "./workflow.tsx";

export { decorateDocumentHtml } from "./document_html.tsx";
export type { TocItem } from "./document_toc.tsx";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const MANUAL_DIR = resolveRepositoryManualDir(REPO_ROOT).abs;
const MAP_DIR = resolveMapDir(REPO_ROOT, await loadConfig(REPO_ROOT)).abs;
const ADR_DIR = join(MAP_DIR, "_adr");
const MANUAL_REPO_REL = relative(REPO_ROOT, MANUAL_DIR);
const MAP_REPO_REL = relative(REPO_ROOT, MAP_DIR);
const DECISIONS_ROUTE = DOCUMENT_ROUTES.decisions;
export const PUBLIC_MAP_ROUTE = DOCUMENT_ROUTES.map;
const GLOSSARY_SOURCE_PATH = "30-reference/glossary.md";
/** One published docs page. */
export interface DocsPage {
  routeKind: "manual";
  /** Site route, e.g. `/docs/understand/proof`. */
  route: string;
  entry: DocEntry;
  /** Manual-relative source path that resolves local links. */
  sourcePath: string;
  /** Purpose-specific authoring and presentation metadata. */
  manualKind: ManualKind;
  /** URL segment for the section, numeric prefix stripped. */
  sectionSlug: string;
  /** True for a section's README — the section landing page. */
  isIndex: boolean;
}

/** One safely admitted page in discern's separately framed live Map. */
export interface MapPage {
  routeKind: "map";
  /** Overview route for the root, repository Markdown URL for an entry. */
  route: string;
  entry: DocEntry;
  /** Map-relative source path that resolves local links. */
  sourcePath: string;
  /** URL segment for the registered numbered Map section. */
  sectionSlug: string;
  /** True for a section's README. */
  isIndex: boolean;
  /** Canonical reader tier from MAP_SECTION_REGISTRY. */
  audience: MapSectionAudience;
}

/** One rendered project-history record outside the product-documentation nav. */
export interface DecisionPage {
  routeKind: "decision";
  route: string;
  entry: DocEntry;
  /** Map-relative source path that resolves local links. */
  sourcePath: string;
  number: string;
  superseded: boolean;
}

export type RoutedDocPage = DocsPage | MapPage | DecisionPage;
export type NavigablePage = DocsPage | MapPage;

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

/** The manual's public front door, backed by its dedicated root README. */
export interface DocsLanding extends DocsPage {
  route: "/docs";
  sectionSlug: "";
  isIndex: false;
}

/** One registered section in the public Map exhibit. */
export interface PublicMapSection {
  dir: string;
  slug: string;
  title: string;
  description: string;
  audience: MapSectionAudience;
  index: MapPage;
  pages: MapPage[];
}

/** The safely admitted Map projection, kept separate from the manual model. */
export interface PublicMapSite {
  landing: MapPage;
  pages: MapPage[];
  bySourcePath: Map<string, MapPage>;
  sections: PublicMapSection[];
  /** Every discovered page rejected by the canonical tier/publish policy. */
  rejected: DocEntry[];
}

/** The published docs site, derived once per process. */
export interface DocsSite {
  /** The public root README, first in every documentation projection. */
  landing: DocsLanding;
  /** Every page in linear reading order (section indexes included). */
  pages: DocsPage[];
  byRoute: Map<string, DocsPage | DecisionPage>;
  /** Corpus-relative source path → page. Decision paths start with `_adr/`. */
  bySourcePath: Map<string, RoutedDocPage>;
  sections: DocsSection[];
  /** Scarce journeys promoted by the authored root-README authority. */
  frontDoors: DocsPage[];
  decisions: {
    route: typeof DECISIONS_ROUTE;
    /** The authored project-history front door. */
    index: DocEntry;
    pages: DecisionPage[];
    byNumber: Map<string, DecisionPage>;
  };
  /** discern's separately framed, safely admitted project Map. */
  publicMap: PublicMapSite;
}

let sitePromise: Promise<DocsSite> | undefined;

/** Discover and index the published tree. Cached for the process lifetime. */
export function loadDocsSite(): Promise<DocsSite> {
  sitePromise ??= buildDocsSite();
  return sitePromise;
}

/** Discover public guides and decisions, then assemble their route and nav indexes. */
async function buildDocsSite(): Promise<DocsSite> {
  const tree = await discoverDocs({ cwd: REPO_ROOT, dir: MANUAL_DIR });
  if (!tree) throw new Error("docs: no manual tree found");

  const mapTree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: MAP_DIR,
    includeInternal: true,
  });
  if (!mapTree) throw new Error("docs: no configured Map tree found");

  const adrTree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: ADR_DIR,
    includeInternal: true,
  });
  if (!adrTree) throw new Error("docs: no ADR tree found");

  const manual = await buildManualProjection(tree.entries);
  const projection = projectManualPages(manual);
  const publicMap = projectPublicMapPages(mapTree.entries);
  const landingEntry = manual.landing.entry;
  const landing: DocsLanding = {
    routeKind: "manual",
    route: "/docs",
    entry: landingEntry,
    sourcePath: landingEntry.relToDocs,
    manualKind: manual.landing.kind,
    sectionSlug: "",
    isIndex: false,
  };
  const publicDecisionEntries = publicDocs(adrTree.entries);
  const decisionIndexEntries = publicDecisionEntries.filter((entry) =>
    entry.section === "" && entry.slug.toLowerCase() === "readme"
  );
  const decisionIndex = decisionIndexEntries[0];
  if (decisionIndex === undefined || decisionIndexEntries.length !== 1) {
    throw new Error("docs: project history must have one public root README");
  }
  const decisionPages: DecisionPage[] = adrRecords(publicDecisionEntries)
    .map(({ entry, number, superseded }) => ({
      routeKind: "decision",
      route: `${DECISIONS_ROUTE}/${entry.slug}`,
      entry,
      sourcePath: `_adr/${entry.relToDocs}`,
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

  const byRoute = new Map<string, DocsPage | DecisionPage>();
  const bySourcePath = new Map<string, RoutedDocPage>();
  for (
    const page of [
      ...projection.pages,
      ...decisionPages,
    ]
  ) {
    if (byRoute.has(page.route)) {
      throw new Error(`docs: duplicate route ${page.route}`);
    }
    byRoute.set(page.route, page);
    bySourcePath.set(page.sourcePath, page);
  }
  bySourcePath.set(landing.sourcePath, landing);
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
    landing,
    byRoute,
    bySourcePath,
    frontDoors: manual.frontDoors.flatMap((frontDoor) => {
      if (frontDoor.route === "/docs") return [];
      const page = projection.pages.find((candidate) =>
        candidate.route === frontDoor.route
      );
      return page === undefined ? [] : [page];
    }),
    decisions: {
      route: DECISIONS_ROUTE,
      index: decisionIndex,
      pages: decisionPages,
      byNumber,
    },
    publicMap,
  };
}

interface DocsProjection {
  pages: DocsPage[];
  sections: DocsSection[];
}

/** Adapt the canonical manual projection to the site's presentation model. */
export function projectManualPages(
  manual: ManualProjection,
): DocsProjection {
  const pages: DocsPage[] = manual.pages.flatMap((page) =>
    page.route === "/docs" ? [] : [{
      routeKind: "manual" as const,
      route: page.route,
      entry: page.entry,
      sourcePath: page.entry.relToDocs,
      manualKind: page.kind,
      sectionSlug: page.sectionSlug,
      isIndex: page.isIndex,
    }]
  );

  const sections: DocsSection[] = manual.sections.map((section) => {
    const sectionPages = pages.filter((page) =>
      page.entry.section === section.dir
    );
    const index = sectionPages.find((page) => page.isIndex);
    if (index === undefined) {
      throw new Error(`docs: projected section ${section.dir} has no README`);
    }
    return {
      dir: section.dir,
      slug: section.slug,
      title: index.entry.title,
      description: index.entry.description,
      index,
      pages: sectionPages,
    };
  });

  const reachable = sections.flatMap((section) => section.pages);
  if (
    reachable.length !== pages.length ||
    reachable.some((page, index) => page !== pages[index])
  ) {
    throw new Error("docs: published page is not reachable from navigation");
  }

  return { pages, sections };
}

/** Whether a discovered Map entry belongs to the canonical public exhibit. */
export function isPublicMapEntry(entry: DocEntry): boolean {
  if (!isPublicDoc(entry)) return false;
  const parts = entry.relToDocs.split("/");
  if (
    parts.some((part, index) =>
      index < parts.length - 1 && part.startsWith("_")
    )
  ) {
    return false;
  }
  if (entry.relToDocs === "README.md") return true;
  const section = parts[0] ?? "";
  return parts.length >= 2 &&
    MAP_SECTION_REGISTRY.some((registration) => registration.dir === section);
}

/** Remove the numeric ordering prefix from one registered Map section. */
function publicMapSectionSlug(dir: string): string {
  return dir.replace(/^\d+-/, "");
}

/**
 * Project the complete discovered Map through its canonical tier and publish
 * policy. Discovery is intentionally widened first so protected directories
 * are observable rejections rather than files the site never checked.
 */
export function projectPublicMapPages(
  entries: readonly DocEntry[],
): PublicMapSite {
  const admitted = entries.filter(isPublicMapEntry);
  const rejected = entries.filter((entry) => !isPublicMapEntry(entry));
  const landingEntries = admitted.filter((entry) =>
    entry.relToDocs === "README.md"
  );
  const landingEntry = landingEntries[0];
  if (landingEntry === undefined || landingEntries.length !== 1) {
    throw new Error(
      `map: public exhibit must have one root README (found ${landingEntries.length})`,
    );
  }
  const landing: MapPage = {
    routeKind: "map",
    route: PUBLIC_MAP_ROUTE,
    entry: landingEntry,
    sourcePath: landingEntry.relToDocs,
    sectionSlug: "",
    isIndex: false,
    audience: "project",
  };
  const pages = admitted.flatMap((entry): MapPage[] => {
    if (entry === landingEntry) return [];
    const registration = MAP_SECTION_REGISTRY.find((section) =>
      section.dir === entry.section
    );
    if (registration === undefined) return [];
    return [{
      routeKind: "map",
      route: repositoryBlobUrl(`${MAP_REPO_REL}/${entry.relToDocs}`),
      entry,
      sourcePath: entry.relToDocs,
      sectionSlug: publicMapSectionSlug(registration.dir),
      isIndex: entry.slug.toLowerCase() === "readme",
      audience: registration.audience,
    }];
  });
  const sections: PublicMapSection[] = MAP_SECTION_REGISTRY.map(
    (registration) => {
      const sectionPages = pages.filter((page) =>
        page.entry.section === registration.dir
      );
      const indexes = sectionPages.filter((page) => page.isIndex);
      const index = indexes[0];
      if (index === undefined || indexes.length !== 1) {
        throw new Error(
          `map: ${registration.dir} must have one public README (found ${indexes.length})`,
        );
      }
      return {
        dir: registration.dir,
        slug: publicMapSectionSlug(registration.dir),
        title: index.entry.title,
        description: index.entry.description,
        audience: registration.audience,
        index,
        pages: sectionPages,
      };
    },
  );
  const bySourcePath = new Map<string, MapPage>([[
    landing.sourcePath,
    landing,
  ]]);
  for (const page of pages) {
    if (bySourcePath.has(page.sourcePath)) {
      throw new Error(`map: duplicate source ${page.sourcePath}`);
    }
    bySourcePath.set(page.sourcePath, page);
  }
  const reachable = sections.flatMap((section) => section.pages);
  if (
    reachable.length !== pages.length ||
    reachable.some((page, index) => page !== pages[index])
  ) {
    throw new Error(
      "map: public page is not reachable from registered navigation",
    );
  }
  return {
    landing,
    pages,
    bySourcePath,
    sections,
    rejected,
  };
}

// ── Markdown rendering ─────────────────────────────────────────────────────

/** One page's rendered body and the headings its contents rail lists. */
export interface RenderedDoc {
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
  page: NavigablePage,
  site: DocsSite,
): string {
  const manualLanding = page.routeKind === "manual" &&
    page.route === site.landing.route;
  if (!page.isIndex && !manualLanding) return md;
  const sections = page.routeKind === "map"
    ? site.publicMap.sections
    : site.sections;
  const listedPages = manualLanding
    ? [
      ...site.frontDoors,
      ...site.sections.map((section) => section.index),
    ]
    : sections.find((section) => section.index.route === page.route)?.pages
      .filter((candidate) => !candidate.isIndex) ?? [];
  const siblings = new Set(
    listedPages.map((candidate) => candidate.sourcePath),
  );
  const slash = page.sourcePath.lastIndexOf("/");
  const fromDir = slash === -1 ? "" : page.sourcePath.slice(0, slash);
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
    while (index >= 0 && !/^#{1,2}\s+/.test(output[index] ?? "")) {
      index -= 1;
    }
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

  const fromDir = page.sourcePath.includes("/")
    ? page.sourcePath.slice(0, page.sourcePath.lastIndexOf("/"))
    : "";

  // Inside the page's source corpus, a published leaf or section README
  // rewrites to its canonical route.
  const sourceRel = normalizeRel(`${fromDir}/${pathPart}`);
  if (sourceRel !== null) {
    if (sourceRel === "_adr" || sourceRel === "_adr/README.md") {
      return site.decisions.route + frag;
    }
    for (
      const candidate of [
        sourceRel,
        `${sourceRel}/README.md`.replace(/^\//, ""),
      ]
    ) {
      const target = page.routeKind === "manual"
        ? site.bySourcePath.get(candidate)
        : candidate.startsWith("_adr/")
        ? site.bySourcePath.get(candidate)
        : site.publicMap.bySourcePath.get(candidate);
      if (target) return target.route + frag;
    }
  }

  // Anything else living in the repo — an unpublished tier or source file —
  // points at GitHub.
  const sourceRoot = page.routeKind === "manual"
    ? MANUAL_REPO_REL
    : MAP_REPO_REL;
  const repoRel = normalizeRel(`${sourceRoot}/${fromDir}/${pathPart}`);
  if (repoRel === null) return dest;
  const isDir = !/\.[A-Za-z0-9]+$/.test(repoRel);
  return isDir
    ? repositoryTreeUrl(repoRel, frag)
    : repositoryBlobUrl(repoRel, frag);
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

export interface GlossaryMention {
  entry: GlossaryEntry;
  text: string;
}

/** Quote glossary mention text before building ownership and linking patterns. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve and validate the prose phrases owned by glossary entries. */
export function glossaryMentions(
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): GlossaryMention[] {
  const mentions: GlossaryMention[] = [];
  const owners = new Map<string, string>();
  for (const entry of glossary) {
    for (const text of entry.matches ?? [entry.term]) {
      if (text.trim().length === 0) {
        throw new Error(`docs: glossary mention is empty for ${entry.term}`);
      }
      const key = text.toLowerCase();
      const prior = owners.get(key);
      if (prior !== undefined && prior !== entry.term) {
        throw new Error(
          `docs: glossary mention ${text} belongs to both ${prior} and ${entry.term}`,
        );
      }
      if (prior === entry.term) continue;
      owners.set(key, entry.term);
      mentions.push({ entry, text });
    }
  }
  return mentions.toSorted((a, b) =>
    b.text.length - a.text.length || a.text.localeCompare(b.text)
  );
}

const GLOSSARY_MENTIONS = glossaryMentions();
const GLOSSARY_BY_MENTION = new Map(
  GLOSSARY_MENTIONS.map((mention) => [
    mention.text.toLowerCase(),
    mention.entry,
  ]),
);
const GLOSSARY_MENTION_PATTERN = GLOSSARY_MENTIONS
  .map((mention) => escapeRegExp(mention.text))
  .join("|");
const GLOSSARY_PANEL_IDS = new Map(
  GLOSSARY.map((entry, index) => [
    entry.term,
    `docs-glossary-definition-${index + 1}`,
  ]),
);
const glossarySummariesCache = new WeakMap<
  DocsSite,
  ReadonlyMap<string, string>
>();

/** Render and cache link-rewritten glossary summaries for hover cards. */
function glossarySummaries(site: DocsSite): ReadonlyMap<string, string> {
  const cached = glossarySummariesCache.get(site);
  if (cached !== undefined) return cached;

  const glossaryPage = site.bySourcePath.get(GLOSSARY_SOURCE_PATH);
  if (glossaryPage === undefined || glossaryPage.routeKind !== "manual") {
    throw new Error(
      `docs: published glossary missing at ${GLOSSARY_SOURCE_PATH}`,
    );
  }
  const summaries = new Map<string, string>();
  for (const entry of GLOSSARY) {
    const citationsStripped = stripAdrCitations(glossarySummary(entry));
    const rootedAnchors = citationsStripped.replace(
      /\]\((#[^()\s]+)\)/g,
      `](${glossaryPage.route}$1)`,
    );
    const rewritten = rewriteLinks(rootedAnchors, glossaryPage, site);
    summaries.set(entry.term, renderMarkdownInlineHtml(rewritten));
  }
  glossarySummariesCache.set(site, summaries);
  return summaries;
}

/** Wrap the first term mention in an accessible summary linked to the glossary. */
function glossaryTermHtml(
  visible: string,
  entry: GlossaryEntry,
  summaryHtml: string,
): string {
  const panelId = GLOSSARY_PANEL_IDS.get(entry.term);
  if (panelId === undefined) {
    throw new Error(`docs: glossary term has no panel id: ${entry.term}`);
  }
  const trigger = escapeMarkdownHtml(visible);
  const term = escapeMarkdownHtml(entry.term);
  const label = escapeMarkdownHtml(`${entry.term} summary`);
  const heading = renderMarkdownHtml(`### ${entry.term}`).headings[0];
  if (heading === undefined) {
    throw new Error(
      `docs: glossary term has no rendered heading: ${entry.term}`,
    );
  }
  const glossaryHref = `/docs/reference/glossary#${heading.id}`;
  const glossaryLabel = escapeMarkdownHtml(
    `Open ${entry.term} in the glossary`,
  );
  return `<span class="discern-hover-card discern-hover-card--top discern-hover-card--align-center discern-hover-card--width-md discern-hover-card--inline discern-glossary-term" data-discern-floating-root="" data-discern-floating-placement="top" data-discern-floating-align="center"><dfn class="discern-glossary-term__trigger discern-dotted-underline discern-hover-card__trigger" tabindex="0" aria-details="${panelId}" data-discern-floating-trigger="">${trigger}</dfn><span id="${panelId}" role="group" aria-label="${label}" class="discern-hover-card__panel" data-discern-floating-panel=""><span class="discern-glossary-term__card"><span class="docs-glossary-heading"><strong class="discern-glossary-term__term">${term}</strong><a class="docs-glossary-link" href="${glossaryHref}" aria-label="${glossaryLabel}"><span aria-hidden="true">↗</span></a></span><span class="discern-glossary-term__definition">${summaryHtml}</span></span></span></span>`;
}

/**
 * Build one page-scoped prose renderer. Each entry's first eligible matching
 * phrase becomes the design system's Glossary term semantic HTML with the
 * entry's summary; later matches for that entry remain plain text.
 */
export function createGlossaryProseRenderer(
  site: DocsSite,
): (text: string) => string {
  const summaries = glossarySummaries(site);
  const seen = new Set<string>();
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${GLOSSARY_MENTION_PATTERN})(?![\\p{L}\\p{N}_])`,
    "giu",
  );

  return (text: string): string => {
    let html = "";
    let cursor = 0;
    for (const match of text.matchAll(matcher)) {
      const visible = match[0];
      const index = match.index;
      const entry = GLOSSARY_BY_MENTION.get(visible.toLowerCase());
      if (index === undefined || entry === undefined) continue;
      html += escapeMarkdownHtml(text.slice(cursor, index));
      const summary = summaries.get(entry.term);
      if (!seen.has(entry.term) && summary !== undefined) {
        seen.add(entry.term);
        html += glossaryTermHtml(visible, entry, summary);
      } else {
        html += escapeMarkdownHtml(visible);
      }
      cursor = index + visible.length;
    }
    html += escapeMarkdownHtml(text.slice(cursor));
    return html;
  };
}

/**
 * Render one page (cached): frontmatter stripped, inline ADR citations
 * stripped (human-rendered prose; the raw `.md` edition keeps both), links
 * rewritten, then the request-time React-free HTML emitter with the site's
 * Workflow and glossary hooks. Terminal readers use the package Markdown
 * Component instead; this browser boundary stays out of the compiled binary.
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
  const projectedBody = page.routeKind !== "decision"
    ? stripAuthoredLeafIndexes(humanBody, page, site)
    : humanBody;
  const renderProseText = page.routeKind === "manual"
    ? createGlossaryProseRenderer(site)
    : undefined;
  const { html, headings } = renderWorkflowMarkdown(
    rewriteLinks(projectedBody, page, site),
    { ...(renderProseText === undefined ? {} : { renderProseText }) },
    page.sourcePath,
  );
  const toc: TocItem[] = headings
    .filter((h) => h.depth === 2 || h.depth === 3)
    .map((h) => ({ depth: h.depth === 2 ? 2 : 3, id: h.id, text: h.text }));
  const rendered: RenderedDoc = { html, toc };
  renderCache.set(page.route, rendered);
  return rendered;
}

// ── Wayfinding facts ───────────────────────────────────────────────────────

/** Reading-order tier number of a section (`20-quality-gate` → `20`). */
export function sectionIndexOf(dir: string): string {
  return /^(\d+)-/.exec(dir)?.[1] ?? "§";
}

/** Human label for a page's editorial purpose. */
export function pageKindLabel(page: DocsPage): string {
  return page.manualKind.replace(/^./, (character) => character.toUpperCase());
}

/** One destination in a breadcrumb trail, pager, or foot link run. */
export interface DocumentLink {
  readonly label: string;
  readonly href: string;
}

/** The pages either side of one page in the manual's global reading order. */
export function adjacentPages(
  site: DocsSite,
  page: DocsPage,
): { readonly previous?: DocsPage; readonly next?: DocsPage } {
  const pages = site.pages;
  const index = pages.findIndex((candidate) => candidate.route === page.route);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index >= 0 && index < pages.length - 1
    ? pages[index + 1]
    : undefined;
  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  };
}

/** The page family a breadcrumb trail represents; null on the manual cover. */
export type BreadcrumbTarget = DocsPage | DecisionPage | "decisions" | null;

/** The manual's titled ancestry above one page, then the page itself. */
export function breadcrumbTrail(
  site: DocsSite,
  target: BreadcrumbTarget,
): { readonly ancestors: readonly DocumentLink[]; readonly current: string } {
  const root: DocumentLink = { label: "Docs", href: "/docs" };
  const sectionTitle = (slug: string): string =>
    site.sections.find((section) => section.slug === slug)?.title ?? slug;
  const ancestors: readonly DocumentLink[] = target === "decisions"
    ? [root]
    : target === null
    ? []
    : target.routeKind === "decision"
    ? [root, { label: "Decisions", href: DECISIONS_ROUTE }]
    : target.isIndex
    ? [root]
    : [
      root,
      {
        label: sectionTitle(target.sectionSlug),
        href: `${root.href}/${target.sectionSlug}`,
      },
    ];
  const current = target === "decisions"
    ? "Decisions"
    : target === null
    ? root.label
    : target.routeKind === "decision"
    ? target.entry.title
    : target.isIndex
    ? sectionTitle(target.sectionSlug)
    : target.entry.title;
  return { ancestors, current };
}

/** The durable reference destinations beneath the manual navigation. */
export const NAVIGATION_FOOT_LINKS: readonly DocumentLink[] = [
  { label: "Glossary", href: "/docs/reference/glossary" },
  { label: "Commands", href: "/docs/reference/cli-reference" },
  { label: "Configuration", href: "/docs/reference/config-reference" },
];

/** The index a colophon describes when it stands under no single page. */
export type ColophonIndex = "docs" | "decisions";

/** Where a page's plain-text edition, terminal command, and source live. */
export interface ColophonFacts {
  /** The route whose `.md` suffix serves the pristine Markdown. */
  readonly route: string;
  /** The leaf `discern docs <target> --raw` names; a placeholder on an index. */
  readonly target: string;
  /** The repository URL of the authored source. */
  readonly source: string;
  readonly related: readonly DocumentLink[];
}

/** Resolve the plain-text edition, terminal command, and source for one page or index. */
export function colophonFacts(
  page: DocsPage | DecisionPage | null,
  index: ColophonIndex = "docs",
): ColophonFacts {
  const route = page?.route ??
    (index === "decisions" ? DECISIONS_ROUTE : "/docs");
  const source = page === null
    ? index === "decisions"
      ? repositoryTreeUrl(`${MAP_REPO_REL}/_adr`)
      : repositoryTreeUrl(MANUAL_REPO_REL)
    : page.routeKind === "manual"
    ? repositoryBlobUrl(`${MANUAL_REPO_REL}/${page.sourcePath}`)
    : repositoryBlobUrl(`${MAP_REPO_REL}/${page.sourcePath}`);
  return {
    route,
    target: page === null ? "<page>" : page.entry.slug,
    source,
    related: [
      { label: "llms.txt", href: "/llms.txt" },
      { label: "Project decisions", href: DECISIONS_ROUTE },
    ],
  };
}

/** The leaves a section landing lists, derived from the canonical model. */
export function sectionLeaves(
  site: DocsSite,
  page: DocsPage,
): readonly DocsPage[] {
  if (!page.isIndex) return [];
  const section = site.sections.find((candidate) =>
    candidate.index.route === page.route
  );
  if (section === undefined) {
    throw new Error(`docs: no section owns landing page ${page.route}`);
  }
  return section.pages.filter((candidate) => !candidate.isIndex);
}

/** One cited decision, resolved to its on-site record and display title. */
export interface RelatedDecision {
  readonly reference: string;
  readonly detail: string;
  readonly href: string;
}

/** A public page's eligible citations, resolved to their on-site records. */
export function relatedDecisions(
  site: DocsSite,
  page: DocsPage,
): readonly RelatedDecision[] {
  return relatedDecisionCitations(page).map((citation) => {
    const decision = site.decisions.byNumber.get(citation.number);
    if (decision === undefined) {
      throw new Error(
        `docs: ${page.entry.path} cites missing decision ${citation.number}`,
      );
    }
    const reference = `ADR ${citation.number}`;
    const prefix = `${reference}: `;
    const detail = decision.entry.title.startsWith(prefix)
      ? decision.entry.title.slice(prefix.length)
      : decision.entry.title;
    return { reference, detail, href: decision.route };
  });
}

/** Citations eligible for a page's browser-only related-decisions surface. */
export function relatedDecisionCitations(
  page: DocsPage,
): readonly AdrCitation[] {
  return page.sourcePath === GLOSSARY_SOURCE_PATH ? [] : page.entry.citedAdrs;
}

/** Split the authored introduction from its remaining non-index guidance. */
export function manualLandingParts(html: string): readonly [string, string] {
  const firstSection = html.indexOf("<h2 ");
  return firstSection < 0
    ? [html, ""]
    : [html.slice(0, firstSection), html.slice(firstSection)];
}

// ── Plain-text surfaces ────────────────────────────────────────────────────

/** One llms.txt file-list row: the required link, then the page's description. */
function llmsFileRow(
  route: string,
  title: string,
  description: string,
): string {
  return `- [${title}](https://discern.sh${route}): ${description}`;
}

/** The documentation file lists appended to /llms.txt — one H2 section per
 * manual section, in the llms.txt convention's link-list form (llmstxt.org),
 * from the same tree the /docs section renders. */
export function docsLlmsSection(site: DocsSite): string {
  const lines: string[] = [
    "## Documentation",
    "",
    llmsFileRow(
      site.landing.route,
      site.landing.entry.title,
      site.landing.entry.description,
    ),
    "",
  ];
  for (const section of site.sections) {
    lines.push(`## ${section.title}`, "");
    for (const p of section.pages) {
      lines.push(llmsFileRow(p.route, p.entry.title, p.entry.description));
    }
    lines.push("");
  }
  return lines.join("\n");
}
