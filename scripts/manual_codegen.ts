/** Manual-specific destinations for canonical reference generators. */

import * as posix from "@std/path/posix";
import type { ManualPage, ManualProjection } from "../src/lib/manual.ts";
import { numberedDocRoute, publicMapExhibitRoute } from "../src/lib/paths.ts";
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

/** Resolve a legacy Map route through the destination-owned manual claims. */
function manualTargetForMapPath(
  rel: string,
  manual: ManualProjection,
): ManualPage | undefined {
  const route = mapRoute(rel);
  if (route === undefined) return undefined;
  return manual.byRoute.get(route) ??
    manual.pages.find((page) => page.entry.redirectFrom.includes(route));
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
        posix.relative(posix.dirname(outputManualRel), target.entry.relToDocs)
      }${fragment}`;
    }
    if (mapRel.startsWith("_adr/")) {
      const slug = posix.basename(mapRel).replace(/\.md$/iu, "");
      return `https://discern.sh/docs/decisions/${slug}${fragment}`;
    }
    for (const candidate of candidates) {
      const exhibitRoute = publicMapExhibitRoute(candidate);
      if (exhibitRoute === undefined) continue;
      return `https://discern.sh${exhibitRoute}${fragment}`;
    }
  }
  const kind = /\.[A-Za-z0-9]+$/u.test(resolved) ? "blob" : "tree";
  return `https://github.com/jackwh/discern/${kind}/main/${resolved}${fragment}`;
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
