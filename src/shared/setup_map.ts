/** Structural completion of the selected map; factual accuracy remains a review. */
import { dirname, join, resolve } from "@std/path";
import { discoverDocs } from "../lib/docs.ts";
import { extractDocLinks } from "../lib/docs_integrity.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";

/** A heading or navigation list alone is not an explanation. */
export function hasMapExplanation(markdown: string): boolean {
  const { body } = parseFrontmatter(markdown);
  const visible = body.replaceAll(/<!--[\s\S]*?-->/g, "");
  return visible.split("\n").some((line) => {
    const text = line.trim();
    return text.length > 0 && !/^(?:#|[-*|>`]|\d+\.|_\(|\[)/.test(text);
  });
}

/** Check current authored pages, without treating historical records as live prose. */
export async function setupMapIssues(
  root: string,
  mapDir: string,
): Promise<string[]> {
  const tree = await discoverDocs({
    cwd: root,
    dir: mapDir,
    includeInternal: true,
  });
  const entries =
    tree?.entries.filter((entry) =>
      !entry.relToDocs.split("/").some((part) =>
        part === "_adr" || part === "_private"
      )
    ) ?? [];
  const pages = new Map(
    entries.map((entry) => [entry.absPath, entry]),
  );
  const front = resolve(root, mapDir, "README.md");
  const issues: string[] = [];
  if (!pages.has(front)) issues.push("The map needs a root README.md.");
  const links = new Map<string, string[]>();
  for (const [path, entry] of pages) {
    const body = await Deno.readTextFile(path);
    if (!hasMapExplanation(body)) {
      issues.push(`${entry.path} needs an explanation.`);
    }
    const targets = extractDocLinks(body).flatMap(({ target }) => {
      const local = target.split(/[?#]/)[0] ?? "";
      if (!local || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(local)) return [];
      let decoded: string;
      try {
        decoded = decodeURIComponent(local);
      } catch {
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
      issues.push(`${entry.path} is not reachable from the map root.`);
    }
    if (
      entry.section && !entry.section.startsWith("_") &&
      !pages.has(resolve(root, mapDir, entry.section, "README.md"))
    ) {
      issues.push(`${entry.section} needs a region README.md.`);
    }
  }
  return [...new Set(issues)];
}
