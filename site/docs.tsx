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

import { DOCUMENT_ROUTES, DOCUMENT_SEARCH_ROUTES } from "./routes.ts";
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
import { DISCERN_FAVICON_PATH } from "./brand.ts";
import { repositoryBlobUrl, repositoryTreeUrl } from "../src/shared/brand.ts";
import { designSystemAssetPath } from "./design_system.ts";
import { siteAppearanceRootAttributes } from "./appearance.ts";
import { decorateDocumentHtml } from "./document_html.tsx";
import {
  authoredHeadingNumberClass,
  tableOfContentsHtml,
  type TocItem,
} from "./document_toc.tsx";
import { buildSearchIndex } from "./search.ts";
import { THEME_BOOTSTRAP, themeRootAttributes } from "./theme.ts";
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
const DISCERN_BRAND_FRAGMENT = new URL(
  "pages/fragments/brand.html",
  import.meta.url,
);

/** The build emits the document shell's theme control beside the lockup. */
export const DOCS_THEME_TOGGLE_FRAGMENT: URL = new URL(
  "pages/fragments/theme-toggle.html",
  import.meta.url,
);

/** Read the build-emitted lockup on demand so watch rebuilds stay visible. */
function discernBrandHtml(): string {
  return Deno.readTextFileSync(DISCERN_BRAND_FRAGMENT);
}

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

// ── The shell ──────────────────────────────────────────────────────────────

/** Encode untrusted document text for safe HTML content and attributes. */
function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Reading-order tier number of a section (`20-quality-gate` → `20`). */
export function sectionIndexOf(dir: string): string {
  return /^(\d+)-/.exec(dir)?.[1] ?? "§";
}

/** The isolated document corpus that owns a page's navigation and search. */
export type DocumentCorpus = "manual" | "map";

/** Human label for a page's editorial purpose or Map audience. */
export function pageKindLabel(page: NavigablePage): string {
  const value = page.routeKind === "manual" ? page.manualKind : page.audience;
  return value.replace(/^./, (character) => character.toUpperCase());
}

/** One destination in a breadcrumb trail, pager, or foot link run. */
export interface DocumentLink {
  readonly label: string;
  readonly href: string;
}

/** The pages either side of one page in its corpus's global reading order. */
export function adjacentPages(
  site: DocsSite,
  page: NavigablePage,
): { readonly previous?: NavigablePage; readonly next?: NavigablePage } {
  const pages = page.routeKind === "map" ? site.publicMap.pages : site.pages;
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

/** The page family a breadcrumb trail represents. */
export type BreadcrumbTarget = RoutedDocPage | "decisions" | null;

/** The active corpus's titled ancestry above one page, then the page itself. */
export function breadcrumbTrail(
  site: DocsSite,
  corpus: DocumentCorpus,
  target: BreadcrumbTarget,
): { readonly ancestors: readonly DocumentLink[]; readonly current: string } {
  const sections = corpus === "map" ? site.publicMap.sections : site.sections;
  const root: DocumentLink = corpus === "map"
    ? { label: "Live Map", href: PUBLIC_MAP_ROUTE }
    : { label: "Docs", href: "/docs" };
  const sectionTitle = (slug: string): string =>
    sections.find((section) => section.slug === slug)?.title ?? slug;
  const ancestors: readonly DocumentLink[] = target === "decisions"
    ? [{ label: "Docs", href: "/docs" }]
    : target === null
    ? []
    : target.routeKind === "decision"
    ? [
      { label: "Docs", href: "/docs" },
      { label: "Decisions", href: DECISIONS_ROUTE },
    ]
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

/** The durable destinations beneath a corpus's navigation. */
export function navigationFootLinks(
  corpus: DocumentCorpus,
): readonly DocumentLink[] {
  return corpus === "map"
    ? [
      { label: "Product manual", href: "/docs" },
      { label: "Project decisions", href: DECISIONS_ROUTE },
      { label: "Repository Map\u00a0↗", href: repositoryTreeUrl(MAP_REPO_REL) },
    ]
    : [
      { label: "Glossary", href: "/docs/reference/glossary" },
      { label: "Commands", href: "/docs/reference/cli-reference" },
      { label: "Configuration", href: "/docs/reference/config-reference" },
    ];
}

/** The index a colophon describes when it stands under no single page. */
export type ColophonIndex = "docs" | "decisions" | "map";

/** Where a page's plain-text edition, terminal command, and source live. */
export interface ColophonFacts {
  /** The route whose `.md` suffix serves the pristine Markdown. */
  readonly route: string;
  /** The `discern <reader> <target> --raw` reader verb. */
  readonly reader: "docs" | "map";
  /** The leaf the terminal command names; a placeholder on an index. */
  readonly target: string;
  /** The repository URL of the authored source. */
  readonly source: string;
  readonly related: readonly DocumentLink[];
}

/** Resolve the plain-text edition, terminal command, and source for one page or index. */
export function colophonFacts(
  page: RoutedDocPage | null,
  index: ColophonIndex = "docs",
): ColophonFacts {
  const route = page?.route ??
    (index === "decisions"
      ? DECISIONS_ROUTE
      : index === "map"
      ? PUBLIC_MAP_ROUTE
      : "/docs");
  const reader = page?.routeKind === "map" || index === "map" ? "map" : "docs";
  const pageSourceRoot = page?.routeKind === "manual"
    ? MANUAL_REPO_REL
    : MAP_REPO_REL;
  const source = page === null
    ? index === "decisions"
      ? repositoryTreeUrl(`${MAP_REPO_REL}/_adr`)
      : index === "map"
      ? repositoryTreeUrl(MAP_REPO_REL)
      : repositoryTreeUrl(MANUAL_REPO_REL)
    : repositoryBlobUrl(`${pageSourceRoot}/${page.sourcePath}`);
  const related: readonly DocumentLink[] = reader === "map"
    ? [
      { label: "Product manual", href: "/docs" },
      { label: "Project decisions", href: DECISIONS_ROUTE },
    ]
    : [
      { label: "llms.txt", href: "/llms.txt" },
      { label: "Project decisions", href: DECISIONS_ROUTE },
    ];
  return {
    route,
    reader,
    target: page === null ? "<page>" : page.entry.slug,
    source,
    related,
  };
}

/** The leaves a section landing lists, derived from the canonical model. */
export function sectionLeaves(
  site: DocsSite,
  page: NavigablePage,
): readonly NavigablePage[] {
  if (!page.isIndex) return [];
  const sections = page.routeKind === "map"
    ? site.publicMap.sections
    : site.sections;
  const section = sections.find((candidate) =>
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

/** Render rooted corpus navigation and mark the current page for assistive technology. */
function navHtml(
  site: DocsSite,
  corpus: DocumentCorpus,
  current: NavigablePage | null,
  compact: boolean,
): string {
  const source = corpus === "map" ? site.publicMap.sections : site.sections;
  const sections = source.map((section) => {
    const pages = compact ? [section.index] : section.pages;
    const leaves = pages.map((page) => {
      const here = page.route === current?.route;
      const accessibleLabel = page.isIndex
        ? ` aria-label="${esc(`${section.title} overview`)}"`
        : "";
      return `<li data-nav-page><a href="${page.route}"${
        here ? ' aria-current="page"' : ""
      }${accessibleLabel}><span class="docs-nav-page-title">${
        page.isIndex ? "Overview" : esc(page.entry.title)
      }</span></a></li>`;
    }).join("");
    // Emitted flat: this fragment repeats on every docs page, so template
    // pretty-printing would spend page-size budget on invisible whitespace.
    return `<div class="discern-docs-nav__section docs-nav-chapter" data-nav-section><div class="docs-nav-chapter-heading"><strong class="discern-docs-nav__title docs-nav-label"><span class="docs-nav-section-index">${
      sectionIndexOf(section.dir)
    }</span>${esc(section.title)}</strong></div><ul>${leaves}</ul></div>`;
  }).join("");
  return `<div id="docs-nav-sections" data-nav-sections>${sections}</div>`;
}

/** Link the previous and next guides in global reading order. */
function pagerHtml(site: DocsSite, page: NavigablePage): string {
  const { previous: prev, next } = adjacentPages(site, page);
  if (!prev && !next) return "";
  const cell = (
    p: NavigablePage | undefined,
    rel: "prev" | "next",
  ): string =>
    p
      ? `<a class="discern-pager__link discern-pager__link--${
        rel === "prev" ? "previous" : "next"
      }" rel="${rel}" href="${p.route}">
          <span class="discern-pager__direction">${
        rel === "prev" ? "Previous" : "Next"
      } · ${esc(pageKindLabel(p))}</span><span class="discern-pager__title">${
        esc(p.entry.title)
      }</span></a>`
      : `<span class="docs-pager-empty" aria-hidden="true"></span>`;
  return `<nav class="discern-pager docs-pager" aria-label="Pagination">${
    cell(prev, "prev")
  }${cell(next, "next")}</nav>`;
}

/** The breadcrumb trail — the active corpus's titled ancestry. */
function crumbsHtml(
  site: DocsSite,
  corpus: DocumentCorpus,
  target: BreadcrumbTarget,
): string {
  const { ancestors, current } = breadcrumbTrail(site, corpus, target);
  const items = ancestors.map(({ label, href }) =>
    `<li><a href="${href}">${
      esc(label)
    }</a><span class="discern-breadcrumbs__separator" aria-hidden="true">/</span></li>`
  ).join("");
  return `<nav class="discern-breadcrumbs docs-crumbs" aria-label="Breadcrumb"><ol>${items}<li class="discern-breadcrumbs__current"><span aria-current="page">${
    esc(current)
  }</span></li></ol></nav>`;
}

/**
 * The document shell's drawn icons. Each is a stroked line graphic, so it must
 * declare `fill="none"` and take its colour from the text around it; an SVG
 * with neither attribute paints solid black and disappears on a dark canvas.
 * The theme glyphs also carry their own size, because they render outside the
 * `discern-icon` allocation that bounds the others.
 */
export const DOCS_ICONS = {
  menu:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>`,
  search:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/></svg>`,
  sun:
    `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3"/></svg>`,
  moon:
    `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 9.8A5.6 5.6 0 1 1 6.2 2.8a4.4 4.4 0 0 0 7 7z"/></svg>`,
} as const;

/** The two the build renders into the shell's theme control. */
export const DOCS_THEME_GLYPHS = {
  light: DOCS_ICONS.sun,
  dark: DOCS_ICONS.moon,
} as const;

/** Read the build-emitted control on demand so watch rebuilds stay visible. */
function docsThemeToggleHtml(): string {
  return Deno.readTextFileSync(DOCS_THEME_TOGGLE_FRAGMENT);
}

interface ShellFrame {
  /** Contents of the `<title>` element. */
  htmlTitle: string;
  description: string;
  /** The page the nav and breadcrumbs highlight; null on the index. */
  current: NavigablePage | null;
  /** The isolated document corpus that owns navigation and search. */
  corpus: DocumentCorpus;
  /** Keep the manual cover's default wayfinding deliberately small. */
  compactNavigation?: boolean;
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
  const map = frame.corpus === "map";
  const rootRoute = map ? PUBLIC_MAP_ROUTE : "/docs";
  const contextLabel = map ? "/map" : "/docs";
  const corpusLabel = map ? "Live Map" : "Manual";
  const searchLabel = map ? "the live Map" : "the manual";
  const searchEndpoint = DOCUMENT_SEARCH_ROUTES.manual;
  const navFoot = navigationFootLinks(frame.corpus).map(({ label, href }) =>
    `<a href="${href}">${esc(label).replace("\u00a0", "&nbsp;")}</a>`
  ).join("\n      ");
  return `<!doctype html>
<html lang="en" ${siteAppearanceRootAttributes()} ${themeRootAttributes()}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(frame.htmlTitle)}</title>
<meta name="description" content="${esc(frame.description)}" />
<meta name="theme-color" content="#F6F5F8" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#22252C" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="${DISCERN_FAVICON_PATH}" />
<script>${THEME_BOOTSTRAP}</script>
<script>document.documentElement.classList.add("docs-js");</script>
<link rel="stylesheet" href="${designSystemAssetPath("docs", "fonts.css")}" />
<link rel="stylesheet" href="${designSystemAssetPath("docs", "discern.css")}" />
<link rel="stylesheet" href="/assets/docs.css" />
<script defer src="${designSystemAssetPath("docs", "discern.js")}"></script>
<script type="module" src="/assets/docs.js"></script>
</head>
<body data-document-corpus="${frame.corpus}">
<a class="discern-skip-link docs-skip" href="#doc">Skip to content</a>
<header class="discern-docs-header docs-top">
  <div class="discern-docs-header__inner docs-top-inner">
    <div class="discern-docs-header__brand docs-brand-group">
      <button class="discern-icon-button docs-burger" type="button"
        data-drawer-toggle aria-controls="docs-nav"
        aria-label="Open navigation" aria-expanded="false">
        <span class="discern-icon">${DOCS_ICONS.menu}</span>
      </button>
      <span class="docs-brand-lockup"><a class="docs-brand" href="/">
        ${discernBrandHtml()}</a><a
        class="docs-brand-docs discern-mono" href="${rootRoute}">${contextLabel}</a></span>
    </div>
    <div class="discern-docs-header__middle">
      <button class="docs-search-btn" type="button" data-search-open
        aria-label="Search ${searchLabel}">
        <span class="discern-icon docs-search-icon">${DOCS_ICONS.search}</span>
        <span class="docs-search-btn-word">Search ${searchLabel}</span>
        <kbd class="discern-kbd">⌘K</kbd>
      </button>
    </div>
    <div class="discern-docs-header__actions">
      ${docsThemeToggleHtml()}
    </div>
  </div>
</header>
<div class="docs-shell">
  <div class="docs-veil" data-drawer-close hidden></div>
  <aside class="docs-nav" id="docs-nav">
    <nav class="discern-docs-nav docs-nav-scroll" aria-label="${corpusLabel}">
${navHtml(site, frame.corpus, frame.current, frame.compactNavigation === true)}
    </nav>
    <div class="docs-nav-foot discern-mono">
      ${navFoot}
    </div>
  </aside>
  <main id="doc" class="docs-main">
    ${crumbsHtml(site, frame.corpus, frame.breadcrumb)}
    ${frame.mainHtml}
  </main>
  <div class="docs-rail">${frame.tocHtml}</div>
</div>
<div class="docs-search-backdrop" data-search-backdrop hidden></div>
<dialog class="discern-search-palette docs-search" data-search
  data-search-endpoint="${searchEndpoint}" aria-label="Search ${searchLabel}">
  <div class="discern-search-palette__field">
    <span class="discern-search-palette__icon" aria-hidden="true">
      <span class="discern-icon docs-search-icon">${DOCS_ICONS.search}</span>
    </span>
    <input class="discern-search-palette__input" type="search"
      placeholder="Search ${searchLabel}…" data-search-input role="combobox"
      aria-label="Search ${searchLabel}" aria-autocomplete="list"
      aria-expanded="false" aria-controls="docs-search-results"
      autocomplete="off" spellcheck="false" />
    <button class="discern-icon-button docs-search-close" type="button"
      data-search-close aria-label="Close search"><span aria-hidden="true">×</span></button>
  </div>
  <div class="discern-search-palette__results">
    <ul class="discern-search-palette__list docs-search-results"
      id="docs-search-results" role="listbox"
      aria-label="Search results" data-search-results></ul>
    <button class="docs-search-all" type="button" data-search-all hidden></button>
    <p class="discern-search-palette__empty" data-search-empty hidden></p>
  </div>
  <div class="docs-visually-hidden" role="status" aria-live="polite"
    aria-atomic="true" data-search-status></div>
  <div class="discern-search-palette__hint">
    <span><kbd class="discern-kbd">↑</kbd> <kbd class="discern-kbd">↓</kbd> choose</span>
    <span><kbd class="discern-kbd">↵</kbd> open</span>
    <span><kbd class="discern-kbd">Esc</kbd> close</span>
  </div>
</dialog>
</body>
</html>
`;
}

/** The colophon under every page: the plain-text edition, source, and history. */
function colophonHtml(
  page: RoutedDocPage | null,
  index: ColophonIndex = "docs",
): string {
  const facts = colophonFacts(page, index);
  const related = facts.related.map(({ label, href }) =>
    `<a href="${href}">${esc(label)}</a>`
  ).join("\n        ");
  return `<footer class="docs-colophon">
      <span>Plain text for agents:
        <a class="discern-mono" href="${facts.route}.md">curl&nbsp;discern.sh${facts.route}.md</a>
        or <code>discern ${facts.reader} ${
    esc(facts.target)
  } --raw</code></span>
      <span class="docs-colophon-links">
        ${related}
        <a href="${facts.source}">View source&nbsp;↗</a>
      </span>
    </footer>`;
}

/** The section landing's canonical leaf list, derived from DocEntry metadata. */
function sectionLeafIndexHtml(site: DocsSite, page: NavigablePage): string {
  const leaves = sectionLeaves(site, page);
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

/** Citations eligible for a page's browser-only related-decisions surface. */
export function relatedDecisionCitations(
  page: DocsPage,
): readonly AdrCitation[] {
  return page.sourcePath === GLOSSARY_SOURCE_PATH ? [] : page.entry.citedAdrs;
}

/** A public page's eligible citations, linked to their on-site records. */
function relatedDecisionsHtml(site: DocsSite, page: DocsPage): string {
  const decisions = relatedDecisions(site, page);
  if (decisions.length === 0) return "";
  const items = decisions.map(({ reference, detail, href }) =>
    `<li><a class="docs-related-decision" href="${href}">${
      esc(reference)
    }</a><span class="docs-related-decision-detail">: ${
      esc(detail)
    }</span></li>`
  ).join("");
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
  const article = decorateDocumentHtml(`${rendered.html}
${sectionLeafIndexHtml(site, page)}`);
  return shellFrame(site, {
    htmlTitle: `${page.entry.title} · discern.sh docs`,
    description: page.entry.description,
    current: page,
    corpus: "manual",
    breadcrumb: page,
    mainHtml: `<p class="docs-page-kind">${esc(pageKindLabel(page))}</p>
    <article class="doc-body${authoredHeadingNumberClass(rendered.toc)}">
${article}
    </article>
    ${relatedDecisionsHtml(site, page)}
    ${pagerHtml(site, page)}
    ${colophonHtml(page)}`,
    tocHtml: tableOfContentsHtml(rendered.toc),
  });
}

/** Derive one complete browse tree from the active corpus's published model. */
function completeBrowseHtml(
  sections: readonly (DocsSection | PublicMapSection)[],
): string {
  return sections.map((section) => {
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
}

/** Render the scarce authored front-door selection with model descriptions. */
function frontDoorsHtml(site: DocsSite): string {
  const items = site.frontDoors.map((page) =>
    `<li><a href="${page.route}">${esc(page.entry.title)}</a>
      <span class="docs-leaf-desc">${esc(page.entry.description)}</span></li>`
  ).join("");
  return `<section class="docs-front-doors" aria-labelledby="start-here">
    <h2 id="start-here">Start here</h2>
    <ul class="docs-chapter-leaves">${items}</ul>
  </section>`;
}

/** Split the authored introduction from its remaining non-index guidance. */
function manualLandingParts(html: string): readonly [string, string] {
  const firstSection = html.indexOf("<h2 ");
  return firstSection < 0
    ? [html, ""]
    : [html.slice(0, firstSection), html.slice(firstSection)];
}

/** The /docs landing renders the authored manual root plus derived full browse. */
export function docsIndexShell(
  site: DocsSite,
  rendered: RenderedDoc,
): string {
  const [introduction, details] = manualLandingParts(rendered.html);
  const article = decorateDocumentHtml(`${introduction}
  ${frontDoorsHtml(site)}
  <div class="docs-manual-details">
${details}
  </div>
  <section class="docs-complete-browse docs-complete-browse--expanded" aria-label="Complete manual">
    <div class="docs-chapters">
      ${completeBrowseHtml(site.sections)}
    </div>
  </section>
`);
  const main = `<article class="doc-body docs-cover docs-manual-index${
    authoredHeadingNumberClass(rendered.toc)
  }">
${article}
  </article>
  ${colophonHtml(null)}`;

  return shellFrame(site, {
    htmlTitle: `${site.landing.entry.title} · discern.sh docs`,
    description: site.landing.entry.description,
    current: null,
    corpus: "manual",
    compactNavigation: true,
    breadcrumb: null,
    mainHtml: main,
    tocHtml: "",
  });
}

/** Explain decision status and route readers to current product documentation. */
function historyLabelHtml(superseded: boolean): string {
  const status = superseded
    ? `<strong class="docs-history-status">Superseded record.</strong> `
    : "";
  return `<aside class="docs-history-label">
    <span class="discern-kicker">Project history</span>
    <p>${status}These records explain why discern was built this way. They are
    project history, not current product documentation; use the
    <a href="/docs">manual</a> for current instructions.</p>
  </aside>`;
}

/** Render linked decision titles with visible superseded status. */
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

/** The project-history index, deliberately outside the product-documentation nav. */
export function decisionsIndexShell(site: DocsSite): string {
  const active = site.decisions.pages.filter((page) => !page.superseded);
  const superseded = site.decisions.pages.filter((page) => page.superseded);
  const article = decorateDocumentHtml(`
    <h1>Project decisions</h1>
    <p>The numbered records preserve the context and trade-offs behind discern's architecture.</p>
    <h2>Current records</h2>
    ${decisionListHtml(active)}
    <h2>Superseded records</h2>
    <p>These records remain available because the path to today's design is part of the history.</p>
    ${decisionListHtml(superseded)}
  `);
  const main = `${historyLabelHtml(false)}
  <article class="doc-body docs-decisions-index">
${article}
  </article>
  ${colophonHtml(null, "decisions")}`;
  return shellFrame(site, {
    htmlTitle: "Project decisions · discern.sh docs",
    description:
      "Project-history records explaining the decisions behind discern.",
    current: null,
    corpus: "manual",
    breadcrumb: "decisions",
    mainHtml: main,
    tocHtml: "",
  });
}

/** One rendered ADR, labeled as history rather than product documentation. */
export function decisionShell(
  site: DocsSite,
  page: DecisionPage,
  rendered: RenderedDoc,
): string {
  return shellFrame(site, {
    htmlTitle: `${page.entry.title} · discern.sh docs`,
    description: page.entry.description,
    current: null,
    corpus: "manual",
    breadcrumb: page,
    mainHtml: `${historyLabelHtml(page.superseded)}
    <article class="doc-body docs-decision-record${
      authoredHeadingNumberClass(rendered.toc)
    }">
${decorateDocumentHtml(rendered.html)}
    </article>
    ${colophonHtml(page)}`,
    tocHtml: tableOfContentsHtml(rendered.toc),
  });
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

// ── The request handler ────────────────────────────────────────────────────

let searchIndexCache: string | undefined;

/** Build and cache the published manual's browser search index. */
async function searchIndexJson(site: DocsSite): Promise<string> {
  if (searchIndexCache !== undefined) return searchIndexCache;
  const index = await buildSearchIndex([
    { route: site.landing.route, section: "Manual", entry: site.landing.entry },
    ...site.pages.map((page) => ({
      route: page.route,
      section: site.sections.find((section) =>
        section.slug === page.sectionSlug
      )?.title ?? "",
      entry: page.entry,
    })),
  ]);
  searchIndexCache = JSON.stringify(index);
  return searchIndexCache;
}

/** Serve a cacheable successful body with its media type and optional negotiation variance. */
function respond(body: string, contentType: string, vary = false): Response {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=300",
  });
  if (vary) headers.set("vary", "Accept, User-Agent");
  return new Response(body, { status: 200, headers });
}

/** Serve equivalent 404 help as plain text or minimal HTML according to reader negotiation. */
function docsNotFound(asText: boolean, corpus: DocumentCorpus): Response {
  const root = corpus === "map" ? PUBLIC_MAP_ROUTE : "/docs";
  const noun = corpus === "map" ? "Map page" : "manual page";
  if (asText) {
    return new Response(
      `404 — no such ${noun}. The index lives at ${root} (raw Markdown for text clients).\n`,
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>404 · discern docs</title>` +
      `<body style="font-family:ui-monospace,monospace;padding:4rem 1.5rem;color:#1A1814;background:#FBFAF7">` +
      `<p style="max-width:34rem;line-height:1.7">404 — no such ${noun}.<br>` +
      `The index: <a href="${root}">discern.sh${root}</a></p>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Serve one manual, decision, or public-Map request. `asText` is the caller's reader-negotiation
 * verdict; the `.md` suffix forces Markdown for any reader.
 */
export async function serveDocuments(
  path: string,
  asText: boolean,
): Promise<Response> {
  const site = await loadDocsSite();

  if (path === DOCUMENT_SEARCH_ROUTES.manual) {
    return respond(await searchIndexJson(site), "application/json");
  }

  const wantsMd = path.endsWith(".md");
  const routePath = wantsMd ? path.slice(0, -".md".length) : path;

  if (routePath === "/docs") {
    if (wantsMd || asText) {
      return respond(
        await Deno.readTextFile(site.landing.entry.absPath),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    const rendered = await renderDoc(site.landing, site);
    return respond(
      docsIndexShell(site, rendered),
      "text/html; charset=utf-8",
      true,
    );
  }

  if (routePath === PUBLIC_MAP_ROUTE) {
    if (wantsMd || asText) {
      return respond(
        await Deno.readTextFile(site.publicMap.landing.entry.absPath),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    return respond(
      (await import("./ui/pages/MapPage.tsx")).renderMapPage(site.publicMap),
      "text/html; charset=utf-8",
      true,
    );
  }

  if (routePath === site.decisions.route) {
    if (wantsMd || asText) {
      return respond(
        await Deno.readTextFile(site.decisions.index.absPath),
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
  if (page === undefined) {
    return docsNotFound(
      asText,
      routePath.startsWith(PUBLIC_MAP_ROUTE) ? "map" : "manual",
    );
  }

  if (wantsMd || asText) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    return respond(raw, "text/markdown; charset=utf-8", !wantsMd);
  }
  const rendered = await renderDoc(page, site);
  return respond(
    page.routeKind === "decision"
      ? decisionShell(site, page, rendered)
      : docsShell(site, page, rendered),
    "text/html; charset=utf-8",
    true,
  );
}
