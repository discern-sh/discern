/** Manual-specific destinations for canonical reference generators. */

import * as posix from "@std/path/posix";
import type { ManualPage, ManualProjection } from "../src/lib/manual.ts";
import { numberedDocRoute } from "../src/lib/paths.ts";
import { MANUAL_ALIAS_OWNER_OVERRIDES } from "../src/shared/manual.ts";
import {
  parseFrontmatter,
  readFrontmatterBlock,
} from "../src/lib/frontmatter.ts";

export interface GeneratedManualMetadata {
  readonly id: string;
  readonly order: number;
  readonly redirects?: readonly string[];
}

/** Project the legacy `/docs` route represented by one Map source path. */
function mapRoute(rel: string): string | undefined {
  return numberedDocRoute(rel, "/docs");
}

/** Human reading destinations for concepts shared with the contributor Map.
 * These are editorial choices, keyed by stable manual identity; definitions
 * stay shared while the manual's links keep readers in its offline corpus.
 * A value names a manual page id, optionally followed by `#` and the heading
 * anchor of the section that holds the concept. Each destination is the
 * manual's search home for one of the Map page's names, or at least mentions
 * its title (tests/manual_policy_test.ts). */
export const MANUAL_CONCEPT_LINK_TARGETS: Readonly<Record<string, string>> = {
  "00-orientation/concepts.md": "explanation-practice-and-roles",
  "00-orientation/design-principles.md": "explanation-practice-and-roles",
  "00-orientation/the-practice.md": "explanation-practice-and-roles",
  "10-getting-started/README.md": "start-index",
  "10-getting-started/upgrade-discern.md": "guide-maintain-or-remove-discern",
  "20-quality-gate/README.md": "explanation-proof",
  "20-quality-gate/the-proof.md": "explanation-proof",
  "20-quality-gate/proof-notes.md": "reference-proof-and-checkpoint-formats",
  "20-quality-gate/checkpoints.md": "explanation-checkpoints",
  "20-quality-gate/standards.md": "explanation-standards",
  "20-quality-gate/coupling.md": "guide-improve-the-practice",
  "20-quality-gate/patterns.md": "explanation-evidence-and-improvement",
  "20-quality-gate/improvement.md": "guide-improve-the-practice",
  "20-quality-gate/tidy.md": "guide-maintain-or-remove-discern",
  "30-worktrees/README.md": "explanation-worktrees-and-trunk",
  "30-worktrees/landing-authority.md": "explanation-proof",
  "30-worktrees/the-desk.md": "guide-coordinate-parallel-tasks",
  "30-worktrees/desk-tips.md": "guide-coordinate-parallel-tasks",
  "30-worktrees/the-resources.md": "guide-coordinate-parallel-tasks",
  "40-agent-instructions/README.md": "guide-write-project-instructions",
  "45-skills/README.md": "guide-create-and-manage-skills",
  "70-reference/artifact-ownership.md": "reference-files-and-ownership",
  "70-reference/checkpoint-state.md": "reference-proof-and-checkpoint-formats",
  "70-reference/progress-and-reconnect.md":
    "reference-results-and-mcp#progress-handles-and-reconnect",
  "70-reference/the-logbook.md": "reference-logbook",
  "80-development/install-surface.md":
    "reference-files-and-ownership#registered-project-paths",
};

/** One link-table value: a manual page and, optionally, a section on it. */
export interface ManualReadingTarget {
  readonly pageId: string;
  /** The section's heading anchor, without `#`. */
  readonly section?: string;
}

/** Split a {@link MANUAL_CONCEPT_LINK_TARGETS} value into page and section. */
export function manualReadingTarget(value: string): ManualReadingTarget {
  const hash = value.indexOf("#");
  return hash < 0
    ? { pageId: value }
    : { pageId: value.slice(0, hash), section: value.slice(hash + 1) };
}

/** A resolved manual destination and the fragment the table adds to it. */
interface ManualLinkTarget {
  readonly page: ManualPage;
  readonly fragment: string;
}

/** Prefer human concept destinations, then destination-owned legacy routes. */
function manualTargetForMapPath(
  rel: string,
  manual: ManualProjection,
): ManualLinkTarget | undefined {
  const value = MANUAL_CONCEPT_LINK_TARGETS[rel];
  if (value !== undefined) {
    const { pageId, section } = manualReadingTarget(value);
    const page = manual.byId.get(pageId);
    if (page === undefined) {
      throw new Error(`${rel}: missing manual reading destination ${pageId}`);
    }
    return { page, fragment: section === undefined ? "" : `#${section}` };
  }
  const route = mapRoute(rel);
  if (route === undefined) return undefined;
  const page = manual.byRoute.get(route) ??
    manual.pages.find((candidate) =>
      candidate.entry.redirectFrom.includes(route)
    );
  return page === undefined ? undefined : { page, fragment: "" };
}

/** Rewrite one generated Map-relative link for its manual materialization. */
function manualDestination(
  sourceMapRel: string,
  destination: string,
  outputManualRel: string,
  manual: ManualProjection,
): string {
  if (
    destination.startsWith("/") || destination.startsWith("#") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(destination)
  ) return destination;
  const hash = destination.indexOf("#");
  const pathPart = hash < 0 ? destination : destination.slice(0, hash);
  const fragment = hash < 0 ? "" : destination.slice(hash);
  const sourceRepoRel = posix.join("project/map", sourceMapRel);
  const resolved = posix.normalize(
    posix.join(posix.dirname(sourceRepoRel), pathPart),
  );
  if (resolved.startsWith("project/map/")) {
    const mapRel = resolved.slice("project/map/".length).replace(/\/$/u, "");
    const candidates = [mapRel];
    if (!mapRel.toLowerCase().endsWith(".md")) {
      candidates.push(`${mapRel}/README.md`, `${mapRel}.md`);
    }
    for (const candidate of candidates) {
      const target = manualTargetForMapPath(candidate, manual);
      if (target === undefined) continue;
      return `${
        posix.relative(
          posix.dirname(outputManualRel),
          target.page.entry.relToDocs,
        )
      }${fragment !== "" ? fragment : target.fragment}`;
    }
    if (mapRel.startsWith("_adr/")) {
      const slug = posix.basename(mapRel).replace(/\.md$/iu, "");
      return `https://discern.sh/docs/decisions/${slug}${fragment}`;
    }
    throw new Error(
      `${sourceMapRel}: ${destination} names the Map page ${mapRel}, which ` +
        "has no manual destination; add it to MANUAL_CONCEPT_LINK_TARGETS " +
        "in scripts/manual_codegen.ts, or drop the link",
    );
  }
  throw new Error(
    `${sourceMapRel}: ${destination} leaves the manual for the repository ` +
      `file ${resolved}; link a manual page instead, or drop the link`,
  );
}

/** Rewrite links outside code fences without changing any other body byte. */
function rewriteManualLinks(
  markdown: string,
  sourceMapRel: string,
  outputManualRel: string,
  manual: ManualProjection,
): string {
  let inFence = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(
      /\]\(([^()\s]+)\)/gu,
      (_match, destination: string) =>
        `](${
          manualDestination(
            sourceMapRel,
            destination,
            outputManualRel,
            manual,
          )
        })`,
    );
  }).join("\n");
}

/**
 * Give a registry-generated Map reference its manual identity and link base.
 * The canonical renderer still owns the title, description, publication flag,
 * aliases, and body; this adapter adds only corpus policy.
 */
export function renderGeneratedManualDocument(
  renderedMapDocument: string,
  sourceMapRel: string,
  outputManualRel: string,
  metadata: GeneratedManualMetadata,
  manual: ManualProjection,
): string {
  const block = readFrontmatterBlock(renderedMapDocument);
  if (block === undefined) {
    throw new Error(`${sourceMapRel}: generated document has no frontmatter`);
  }
  const { meta } = parseFrontmatter(renderedMapDocument);
  if (meta.title === undefined || meta.description === undefined) {
    throw new Error(
      `${sourceMapRel}: generated manual reference needs title and description`,
    );
  }
  const target = manual.byId.get(metadata.id);
  const claimedElsewhere = new Set(
    manual.pages.flatMap((page) =>
      page.id === metadata.id
        ? []
        : [page.entry.title, ...page.entry.aliases].map((value) =>
          value.trim().toLowerCase()
        )
    ),
  );
  const aliases = [metadata.id, ...(meta.aliases ?? [])].filter(
    (alias, index, all) => {
      const key = alias.trim().toLowerCase();
      const override = MANUAL_ALIAS_OWNER_OVERRIDES[key];
      if (override !== undefined && override !== metadata.id) return false;
      if (
        claimedElsewhere.has(key) && override === undefined &&
        !target?.entry.aliases.some((existing) =>
          existing.trim().toLowerCase() === key
        )
      ) {
        throw new Error(
          `${metadata.id}: alias ${
            JSON.stringify(alias)
          } collides with another manual page; assign its owner in MANUAL_ALIAS_OWNER_OVERRIDES`,
        );
      }
      return key !== meta.title?.trim().toLowerCase() &&
        all.findIndex((candidate) => candidate.trim().toLowerCase() === key) ===
          index;
    },
  );
  const frontmatter = [
    "---",
    `id: ${metadata.id}`,
    `title: ${JSON.stringify(meta.title)}`,
    `description: ${JSON.stringify(meta.description)}`,
    `order: ${metadata.order}`,
    "publish: true",
    "kind: reference",
    "aliases:",
    ...aliases.map((alias) => `  - ${JSON.stringify(alias)}`),
    ...(metadata.redirects === undefined || metadata.redirects.length === 0
      ? []
      : [
        "redirect_from:",
        ...metadata.redirects.map((route) => `  - ${JSON.stringify(route)}`),
      ]),
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${
    rewriteManualLinks(block.body, sourceMapRel, outputManualRel, manual)
  }`;
}
