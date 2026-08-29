/**
 * Corpus policy for discern's repository-owned product manual.
 *
 * The document engine discovers Markdown without knowing which corpus it is
 * reading. This module applies the manual's closed section, identity, kind,
 * publication, route, and front-door contracts once for every delivery
 * surface.
 */

import { dirname, join, relative, SEPARATOR } from "@std/path";
import * as posix from "@std/path/posix";
import { buildRedirectRegistry, type DocEntry, isPublicDoc } from "./docs.ts";
import { extractDocLinks, headingAnchors } from "./docs_integrity.ts";
import {
  parseFrontmatter,
  parseFrontmatterMapping,
  readFrontmatterBlock,
  validateFrontmatter,
} from "./frontmatter.ts";
import {
  isManualMarkdownPath,
  MANUAL_ALIAS_OWNER_OVERRIDES,
  MANUAL_SECTION_REGISTRY,
  type ManualKind,
} from "../shared/manual.ts";

/** Authored markers enclosing the manual's promoted starting journeys. */
export const MANUAL_FRONT_DOORS_START = "<!-- BEGIN MANUAL FRONT DOORS -->";
export const MANUAL_FRONT_DOORS_END = "<!-- END MANUAL FRONT DOORS -->";

/** Bounded source read shared with the checkpoint matcher and build staging. */
export const MANUAL_PAGE_MAX_BYTES = 1024 * 1024;

/** Metadata every manual page authors explicitly. */
export const REQUIRED_MANUAL_META_KEYS = [
  "id",
  "title",
  "description",
  "order",
  "publish",
  "aliases",
  "kind",
] as const;

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** One published manual page after the canonical policy is applied. */
export interface ManualPage {
  readonly id: string;
  readonly kind: ManualKind;
  readonly route: string;
  readonly entry: DocEntry;
  readonly sectionDir: string;
  readonly sectionSlug: string;
  readonly isIndex: boolean;
}

/** One registered section and its complete published page list. */
export interface ManualSection {
  readonly dir: string;
  readonly slug: string;
  readonly index: ManualPage;
  readonly pages: readonly ManualPage[];
}

/** The validated manual model every published surface consumes. */
export interface ManualProjection {
  readonly landing: ManualPage;
  readonly pages: readonly ManualPage[];
  readonly sections: readonly ManualSection[];
  readonly byId: ReadonlyMap<string, ManualPage>;
  readonly byRoute: ReadonlyMap<string, ManualPage>;
  readonly bySourcePath: ReadonlyMap<string, ManualPage>;
  /** Scarce promoted journeys, in the authored root-README order. */
  readonly frontDoors: readonly ManualPage[];
}

/** A corpus-policy refusal with every actionable source issue. */
export class ManualProjectionError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`manual projection is invalid:\n- ${issues.join("\n- ")}`);
    this.name = "ManualProjectionError";
    this.issues = issues;
  }
}

/** Resolve a manual entry's canonical route from the section registry. */
export function manualRoute(entry: DocEntry): string | undefined {
  if (entry.relToDocs === "README.md") return "/docs";
  const section = MANUAL_SECTION_REGISTRY.find((candidate) =>
    candidate.dir === entry.section
  );
  if (section === undefined) return undefined;
  return entry.slug.toLowerCase() === "readme"
    ? `/docs/${section.slug}`
    : `/docs/${section.slug}/${entry.slug}`;
}

/** Resolve one relative README link without allowing it to leave the corpus. */
export function resolveManualLink(
  from: string,
  destination: string,
): string | undefined {
  if (
    destination.startsWith("/") || destination.startsWith("#") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(destination) || /[?#]/u.test(destination)
  ) {
    return undefined;
  }
  const normalized = join(dirname(from), destination).replaceAll(
    SEPARATOR,
    "/",
  );
  if (normalized.startsWith("../") || normalized === "..") return undefined;
  if (normalized.toLowerCase().endsWith(".md")) return normalized;
  return `${normalized.replace(/\/+$/u, "")}/README.md`;
}

/** Resolve the common manual root from one discovered entry. */
function manualDirFor(entry: DocEntry): string {
  let current = entry.absPath;
  for (const _part of entry.relToDocs.split("/")) current = dirname(current);
  return current;
}

/** Scan physical entries so discovery cannot hide a symlink or stray file. */
async function scanManualDirectory(
  root: string,
  current: string,
  files: string[],
  issues: string[],
): Promise<void> {
  for await (const entry of Deno.readDir(current)) {
    const absolute = join(current, entry.name);
    const rel = relative(root, absolute).replaceAll(SEPARATOR, "/");
    const info = await Deno.lstat(absolute);
    if (info.isSymlink) {
      issues.push(`${rel}: manual sources must not be symbolic links`);
      continue;
    }
    if (info.isDirectory) {
      const top = rel.split("/")[0] ?? "";
      if (!MANUAL_SECTION_REGISTRY.some((section) => section.dir === top)) {
        issues.push(
          `${rel}: directory is outside the registered manual sections`,
        );
        continue;
      }
      await scanManualDirectory(root, absolute, files, issues);
      continue;
    }
    if (!info.isFile) {
      issues.push(`${rel}: manual sources must be regular files`);
      continue;
    }
    if (!isManualMarkdownPath(rel)) {
      issues.push(`${rel}: file is outside the registered Markdown corpus`);
      continue;
    }
    files.push(rel);
  }
}

/** Decode one regular manual page without replacement characters or overreads. */
async function readManualPage(
  entry: DocEntry,
  issues: string[],
): Promise<string | undefined> {
  const info = await Deno.lstat(entry.absPath);
  if (!info.isFile || info.isSymlink) {
    issues.push(`${entry.relToDocs}: manual sources must be regular files`);
    return undefined;
  }
  if (info.size > MANUAL_PAGE_MAX_BYTES) {
    issues.push(
      `${entry.relToDocs}: exceeds the ${MANUAL_PAGE_MAX_BYTES}-byte page limit`,
    );
    return undefined;
  }
  const bytes = await Deno.readFile(entry.absPath);
  if (bytes.byteLength > MANUAL_PAGE_MAX_BYTES) {
    issues.push(
      `${entry.relToDocs}: exceeded the ${MANUAL_PAGE_MAX_BYTES}-byte page limit while reading`,
    );
    return undefined;
  }
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    issues.push(`${entry.relToDocs}: is not valid UTF-8`);
    return undefined;
  }
}

/** Validate the repository-manual metadata required above the neutral reader. */
function strictManualMetadata(
  entry: DocEntry,
  markdown: string,
  issues: string[],
): void {
  for (const problem of validateFrontmatter(markdown)) {
    issues.push(`${entry.relToDocs}: ${problem}`);
  }
  const block = readFrontmatterBlock(markdown);
  if (block === undefined) {
    issues.push(
      `${entry.relToDocs}: must open with a complete frontmatter block`,
    );
    return;
  }
  const parsed = parseFrontmatterMapping(block.raw);
  if ("issue" in parsed) return;
  for (const key of REQUIRED_MANUAL_META_KEYS) {
    if (!Object.hasOwn(parsed.attrs, key)) {
      issues.push(`${entry.relToDocs}: frontmatter must declare ${key}`);
    }
  }
}

/** Normalize one authored search name for ownership checks. */
export function normalizeManualSearchName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

/** Resolve a source-relative Markdown target without leaving the manual. */
function linkedManualPath(
  source: string,
  destination: string,
): string | undefined {
  const normalized = posix.normalize(
    posix.join(posix.dirname(source), destination),
  );
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  if (normalized.toLowerCase().endsWith(".md")) return normalized;
  return `${normalized.replace(/\/+$/u, "")}/README.md`;
}

/** Validate links against the same published projection every surface serves. */
function manualLinkIssues(
  pages: readonly ManualPage[],
  markdownByPath: ReadonlyMap<string, string>,
): string[] {
  const issues: string[] = [];
  const byPath = new Map(pages.map((page) => [page.entry.relToDocs, page]));
  const liveRoutes = new Set(pages.map((page) => page.route));
  const redirects = buildRedirectRegistry(pages.map((page) => ({
    route: page.route,
    redirectFrom: page.entry.redirectFrom,
  }))).redirects;
  const anchors = new Map(
    [...markdownByPath].map((
      [path, markdown],
    ) => [path, headingAnchors(markdown)]),
  );
  for (const page of pages) {
    const markdown = markdownByPath.get(page.entry.relToDocs);
    if (markdown === undefined) continue;
    for (const link of extractDocLinks(markdown)) {
      if (
        /^[A-Za-z][A-Za-z\d+.-]*:/u.test(link.target) ||
        link.target.startsWith("//")
      ) {
        continue;
      }
      const hash = link.target.indexOf("#");
      const rawPath = hash < 0 ? link.target : link.target.slice(0, hash);
      const rawFragment = hash < 0 ? "" : link.target.slice(hash + 1);
      let fragment: string;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        issues.push(
          `${page.entry.relToDocs}:${link.line}: link ${
            JSON.stringify(link.target)
          } has an invalid fragment escape`,
        );
        continue;
      }
      if (rawPath.startsWith("/")) {
        const route = rawPath.replace(/\.md$/u, "");
        if (
          !liveRoutes.has(route) && !redirects.has(route) &&
          route !== "/docs/decisions" && !route.startsWith("/docs/decisions/")
        ) {
          issues.push(
            `${page.entry.relToDocs}:${link.line}: ${rawPath} is not a live manual or decision route`,
          );
        }
        continue;
      }
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch {
        issues.push(
          `${page.entry.relToDocs}:${link.line}: link ${
            JSON.stringify(link.target)
          } has an invalid path escape`,
        );
        continue;
      }
      const targetPath = decodedPath === ""
        ? page.entry.relToDocs
        : linkedManualPath(page.entry.relToDocs, decodedPath);
      const target = targetPath === undefined
        ? undefined
        : byPath.get(targetPath);
      if (target === undefined) {
        issues.push(
          `${page.entry.relToDocs}:${link.line}: ${
            JSON.stringify(link.target)
          } does not resolve to a published manual page`,
        );
        continue;
      }
      if (
        fragment !== "" && !anchors.get(target.entry.relToDocs)?.has(fragment)
      ) {
        issues.push(
          `${page.entry.relToDocs}:${link.line}: ${
            JSON.stringify(link.target)
          } names no heading on ${target.entry.relToDocs}`,
        );
      }
    }
  }
  return issues;
}

/** Read the marked direct-link authority from the root README body. */
export function manualFrontDoorDestinations(markdown: string): string[] {
  const { body } = parseFrontmatter(markdown);
  const start = body.indexOf(MANUAL_FRONT_DOORS_START);
  const end = body.indexOf(
    MANUAL_FRONT_DOORS_END,
    start + MANUAL_FRONT_DOORS_START.length,
  );
  if (start < 0 || end < start) return [];
  const region = body.slice(start + MANUAL_FRONT_DOORS_START.length, end);
  return [...region.matchAll(/^\s*-\s+\[[^\]]+\]\(([^()\s]+)\)\s*$/gmu)]
    .map((match) => match[1] ?? "");
}

/** Resolve the marked root links against one already-admitted page set. */
function resolveManualFrontDoorPaths(
  markdown: string,
  available: ReadonlySet<string>,
  issues: string[],
): string[] {
  const destinations = manualFrontDoorDestinations(markdown);
  if (destinations.length === 0) {
    issues.push(
      `README.md: ${MANUAL_FRONT_DOORS_START} must contain promoted direct links`,
    );
  }
  const seen = new Set<string>();
  return destinations.flatMap((destination) => {
    const rel = resolveManualLink("README.md", destination);
    if (rel === undefined || !available.has(rel)) {
      issues.push(
        `README.md: promoted destination ${destination} is not a published manual page`,
      );
      return [];
    }
    if (seen.has(rel)) {
      issues.push(`README.md: promoted page ${rel} is listed twice`);
      return [];
    }
    seen.add(rel);
    return [rel];
  });
}

/**
 * Read the promoted entries from a manual tree whose complete projection was
 * already validated. Interactive presentation uses this narrow adapter after
 * withheld pages have been removed; it does not re-run corpus admission over
 * that intentionally incomplete tree.
 */
export async function manualFrontDoorEntries(
  entries: readonly DocEntry[],
): Promise<readonly DocEntry[]> {
  const issues: string[] = [];
  const landing = entries.find((entry) => entry.relToDocs === "README.md");
  if (landing === undefined) {
    throw new ManualProjectionError(["manual root has no published README"]);
  }
  const markdown = await readManualPage(landing, issues);
  const byPath = new Map(entries.map((entry) => [entry.relToDocs, entry]));
  const paths = markdown === undefined
    ? []
    : resolveManualFrontDoorPaths(markdown, new Set(byPath.keys()), issues);
  if (issues.length > 0) throw new ManualProjectionError(issues);
  return paths.flatMap((path) => {
    const entry = byPath.get(path);
    return entry === undefined ? [] : [entry];
  });
}

/** Group each normalized search name by every published page claiming it. */
function manualSearchClaims(
  pages: readonly ManualPage[],
): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const name of [page.entry.title, ...page.entry.aliases]) {
      const normalized = normalizeManualSearchName(name);
      const owners = claims.get(normalized) ?? new Set<string>();
      owners.add(page.id);
      claims.set(normalized, owners);
    }
  }
  return claims;
}

/**
 * Alias-owner override keys no published page claims any longer. The
 * projection consults an override only while its collision is live, so a dead
 * entry would otherwise linger silently. Repository policy holds this at
 * empty; it stays outside {@link buildManualProjection} because synthetic
 * corpora legitimately project under the repository's own override registry.
 */
export function staleManualAliasOwnerOverrides(
  pages: readonly ManualPage[],
  overrides: Readonly<Record<string, string>> = MANUAL_ALIAS_OWNER_OVERRIDES,
): string[] {
  const claims = manualSearchClaims(pages);
  return Object.keys(overrides).filter((name) => !claims.has(name));
}

/**
 * Validate and project every discovered manual document. Reading remains
 * lenient in the neutral document engine; this repository boundary is strict.
 */
export async function buildManualProjection(
  entries: readonly DocEntry[],
): Promise<ManualProjection> {
  const issues: string[] = [];
  const pages: ManualPage[] = [];
  const allIds = new Map<string, string>();
  const allRoutes = new Map<string, string>();
  const markdownByPath = new Map<string, string>();

  const first = entries[0];
  if (first !== undefined) {
    const manualDir = manualDirFor(first);
    const physicalFiles: string[] = [];
    await scanManualDirectory(manualDir, manualDir, physicalFiles, issues);
    const discovered = new Set(entries.map((entry) => entry.relToDocs));
    for (const rel of physicalFiles) {
      if (!discovered.has(rel)) {
        issues.push(
          `${rel}: manual discovery did not admit this Markdown file`,
        );
      }
    }
    for (const rel of discovered) {
      if (!physicalFiles.includes(rel)) {
        issues.push(
          `${rel}: discovered manual entry is not a regular source file`,
        );
      }
    }
  }

  for (const entry of entries) {
    const markdown = await readManualPage(entry, issues);
    if (markdown !== undefined) {
      markdownByPath.set(entry.relToDocs, markdown);
      strictManualMetadata(entry, markdown, issues);
    }
    if (!isManualMarkdownPath(entry.relToDocs)) {
      issues.push(
        `${entry.relToDocs}: path is outside the registered manual corpus`,
      );
      continue;
    }
    if (entry.pageId === undefined) {
      issues.push(`${entry.relToDocs}: frontmatter must declare one id`);
    } else {
      const prior = allIds.get(entry.pageId);
      if (prior !== undefined) {
        issues.push(
          `${entry.relToDocs}: id ${entry.pageId} is already declared by ${prior}`,
        );
      } else {
        allIds.set(entry.pageId, entry.relToDocs);
      }
    }
    if (entry.manualKind === undefined) {
      issues.push(
        `${entry.relToDocs}: frontmatter must declare one valid kind`,
      );
    }
    if (!isPublicDoc(entry)) continue;

    const route = manualRoute(entry);
    if (route === undefined) {
      issues.push(`${entry.relToDocs}: no registered manual route exists`);
      continue;
    }
    const priorRoute = allRoutes.get(route);
    if (priorRoute !== undefined) {
      issues.push(
        `${entry.relToDocs}: route ${route} is already owned by ${priorRoute}`,
      );
      continue;
    }
    allRoutes.set(route, entry.relToDocs);
    if (entry.pageId === undefined || entry.manualKind === undefined) continue;
    const section = MANUAL_SECTION_REGISTRY.find((candidate) =>
      candidate.dir === entry.section
    );
    pages.push({
      id: entry.pageId,
      kind: entry.manualKind,
      route,
      entry,
      sectionDir: section?.dir ?? "",
      sectionSlug: section?.slug ?? "",
      isIndex: entry.slug.toLowerCase() === "readme",
    });
  }

  const landingPages = pages.filter((page) => page.route === "/docs");
  if (landingPages.length !== 1) {
    issues.push(
      `manual root must contain one published README (found ${landingPages.length})`,
    );
  }

  const sections: ManualSection[] = [];
  for (const registration of MANUAL_SECTION_REGISTRY) {
    const sectionPages = pages.filter((page) =>
      page.sectionDir === registration.dir
    );
    const indexes = sectionPages.filter((page) => page.isIndex);
    const index = indexes[0];
    if (index === undefined || indexes.length !== 1) {
      issues.push(
        `${registration.dir}: must contain one published README (found ${indexes.length})`,
      );
      continue;
    }
    sections.push({
      dir: registration.dir,
      slug: registration.slug,
      index,
      pages: sectionPages,
    });
  }

  const orders = new Map<string, Map<number, string>>();
  for (const page of pages) {
    if (page.entry.order === undefined) continue;
    const directory = posix.dirname(page.entry.relToDocs);
    const byOrder = orders.get(directory) ?? new Map<number, string>();
    const prior = byOrder.get(page.entry.order);
    if (prior !== undefined) {
      issues.push(
        `${page.entry.relToDocs}: order ${page.entry.order} is already used by ${prior}`,
      );
    } else {
      byOrder.set(page.entry.order, page.entry.relToDocs);
    }
    orders.set(directory, byOrder);
  }

  const redirectRegistry = buildRedirectRegistry(pages.map((page) => ({
    route: page.route,
    redirectFrom: page.entry.redirectFrom,
  })));
  issues.push(...redirectRegistry.issues);
  for (const entry of entries) {
    if (!entry.publish && entry.redirectFrom.length > 0) {
      issues.push(`${entry.relToDocs}: a withheld page cannot own redirects`);
    }
  }

  const searchClaims = manualSearchClaims(pages);
  for (const [name, owners] of searchClaims) {
    if (owners.size < 2) continue;
    const chosen = MANUAL_ALIAS_OWNER_OVERRIDES[name];
    if (chosen === undefined || !owners.has(chosen)) {
      issues.push(
        `${JSON.stringify(name)} is claimed by ${
          [...owners].join(", ")
        }; record one owner in MANUAL_ALIAS_OWNER_OVERRIDES`,
      );
      continue;
    }
    issues.push(
      `${JSON.stringify(name)} remains on ${
        [...owners].filter((id) => id !== chosen).join(", ")
      }; only ${chosen} may own it`,
    );
  }
  issues.push(...manualLinkIssues(pages, markdownByPath));

  const landing = landingPages[0];
  let frontDoors: ManualPage[] = [];
  if (landing !== undefined) {
    const raw = markdownByPath.get(landing.entry.relToDocs) ?? "";
    const byRel = new Map(pages.map((page) => [page.entry.relToDocs, page]));
    frontDoors = resolveManualFrontDoorPaths(
      raw,
      new Set(byRel.keys()),
      issues,
    ).flatMap((rel) => {
      const target = byRel.get(rel);
      return target === undefined ? [] : [target];
    });
  }

  if (issues.length > 0 || landing === undefined) {
    throw new ManualProjectionError(issues);
  }

  return {
    landing,
    pages,
    sections,
    byId: new Map(pages.map((page) => [page.id, page])),
    byRoute: new Map(pages.map((page) => [page.route, page])),
    bySourcePath: new Map(
      pages.map((page) => [page.entry.relToDocs, page]),
    ),
    frontDoors,
  };
}
