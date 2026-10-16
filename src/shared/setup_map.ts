import { mapPageKind } from "../lib/map_policy.ts";
/** Structural completion of the selected map; factual accuracy remains a review. */
import { dirname, join, resolve } from "@std/path";
import { discoverDocs, type DocEntry } from "../lib/docs.ts";
import { normalizeMapDir } from "./map_path.ts";
import { extractDocLinks, fencedBlocks } from "../lib/docs_integrity.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";

/** What {@link hasMapExplanation} accepts, stated for a page that fails it. */
export const MAP_EXPLANATION_RULE =
  "add at least one line of prose; a heading, list item, table row, quote, " +
  "placeholder, link line, comment, or code block alone isn't an explanation";

/** The completion reason for a page that fails {@link hasMapExplanation}. */
export function mapExplanationIssue(path: string): string {
  return `${path} needs an explanation: ${MAP_EXPLANATION_RULE}.`;
}

/** A heading or navigation list alone is not an explanation. */
export function hasMapExplanation(markdown: string): boolean {
  const { body } = parseFrontmatter(markdown);
  const visible = body.replaceAll(/<!--[\s\S]*?-->/g, "");
  const code = new Set<number>();
  for (const block of fencedBlocks(visible)) {
    for (
      let line = block.startLine - 2;
      line < block.startLine + block.lines.length;
      line++
    ) code.add(line);
  }
  return visible.split("\n").some((line, index) => {
    if (code.has(index)) return false;
    const text = line.trim();
    return text.length > 0 && !/^(?:#|[-*|>`]|\d+\.|_\(|\[)/.test(text);
  });
}

/**
 * Check current authored pages, without treating ADR bodies as live prose.
 * Each issue names the page or region by its project-relative path and states
 * the rule it misses.
 */
export async function setupMapIssues(
  root: string,
  mapDir: string,
): Promise<string[]> {
  const mapRel = normalizeMapDir(mapDir);
  const rootRel = `${mapRel}README.md`;
  const pagePath = (entry: DocEntry): string => join(mapRel, entry.relToDocs);
  const tree = await discoverDocs({
    cwd: root,
    dir: mapDir,
    includeInternal: true,
  });
  const entries =
    tree?.entries.filter((entry) =>
      mapPageKind(entry.relToDocs) === "current"
    ) ?? [];
  const pages = new Map(
    entries.map((entry) => [entry.absPath, entry]),
  );
  const front = resolve(root, mapDir, "README.md");
  const issues: string[] = [];
  if (!pages.has(front)) {
    issues.push(
      `${rootRel} is missing: the map needs a root page that explains the ` +
        "project and links to its regions.",
    );
  }
  const links = new Map<string, string[]>();
  for (const [path, entry] of pages) {
    const body = await Deno.readTextFile(path);
    if (!hasMapExplanation(body)) {
      issues.push(mapExplanationIssue(pagePath(entry)));
    }
    const targets = extractDocLinks(body).flatMap(({ target }) => {
      const local = target.split(/[?#]/)[0] ?? "";
      if (!local || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(local)) return [];
      let decoded: string;
      try {
        decoded = decodeURIComponent(local);
      } catch (error) {
        if (!(error instanceof URIError)) throw error;
        return [];
      }
      const absolute = resolve(dirname(path), decoded);
      return [absolute, join(absolute, "README.md")].filter((candidate) =>
        pages.has(candidate)
      );
    });
    links.set(path, targets);
  }
  const reached = new Set<string>();
  const pending = [front];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || reached.has(path)) continue;
    reached.add(path);
    pending.push(...(links.get(path) ?? []));
  }
  for (const [path, entry] of pages) {
    if (!reached.has(path)) {
      issues.push(
        `${pagePath(entry)} is not reachable from the map root: link it ` +
          `from ${rootRel}, or from a page that ${rootRel} already reaches.`,
      );
    }
    if (
      entry.section && !entry.section.startsWith("_") &&
      !pages.has(resolve(root, mapDir, entry.section, "README.md"))
    ) {
      issues.push(
        `${mapRel}${entry.section}/ needs a README.md that explains the ` +
          "region and links to its pages.",
      );
    }
  }
  const adoption = tree?.entries.find((entry) =>
    entry.relToDocs === "_adr/0001-adopt-discern.md"
  );
  if (adoption !== undefined) {
    const body = await Deno.readTextFile(adoption.absPath);
    for (const heading of ["Context", "Decision", "Consequences"]) {
      const section =
        body.split(new RegExp(`^## ${heading}\\s*$`, "mi"))[1]?.split(
          /^## /m,
        )[0] ?? "";
      if (!hasMapExplanation(section)) {
        issues.push(
          `${pagePath(adoption)} needs completed ` +
            `${heading.toLowerCase()}: under "## ${heading}", ` +
            `${MAP_EXPLANATION_RULE}.`,
        );
      }
    }
  }
  return [...new Set(issues)];
}
