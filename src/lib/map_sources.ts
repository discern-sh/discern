/** Source evidence shared by map freshness and affected-page review. */
import { dirname, isAbsolute, relative, resolve, SEPARATOR } from "@std/path";
import { extractDocLinks } from "./docs_integrity.ts";
import { mapPageKind } from "./map_policy.ts";

/** A current Markdown explanation under the configured map directory. */
export function isCurrentMapPage(path: string, mapDir: string): boolean {
  const prefix = mapDir.replace(/\/$/, "") + "/";
  return path.startsWith(prefix) && /\.md$/i.test(path) &&
    mapPageKind(path.slice(prefix.length)) === "current";
}

/** Real local links to specific paths outside the map, relative to the project.
 * Callers establish file existence from their own Git or changed-file evidence.
 * Directory links never expand into ownership or freshness coverage. */
export function mapSourcePaths(
  root: string,
  mapDir: string,
  pagePath: string,
  markdown: string,
): string[] {
  const paths = new Set<string>();
  const map = resolve(root, mapDir);
  for (const { target } of extractDocLinks(markdown)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) continue;
    let link: string;
    try {
      link = decodeURIComponent(target.split(/[?#]/, 1)[0] ?? "");
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      continue;
    }
    if (!link || link.endsWith("/")) continue;
    const absolute = resolve(dirname(resolve(root, pagePath)), link);
    const path = relative(root, absolute);
    const inMap = relative(map, absolute);
    if (
      path === "" || path === ".." || path.startsWith(`..${SEPARATOR}`) ||
      isAbsolute(path) ||
      (inMap !== ".." && !inMap.startsWith(`..${SEPARATOR}`) &&
        !isAbsolute(inMap))
    ) continue;
    paths.add(path.replaceAll(SEPARATOR, "/"));
  }
  return [...paths].sort();
}
