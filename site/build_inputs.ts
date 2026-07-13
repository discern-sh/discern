/** Authored inputs whose changes require the generated public site to rebuild. */
import { fromFileUrl, join, SEPARATOR } from "@std/path";
import { DESIGN_SYSTEM_BUILD_OUTPUTS } from "./design-system/scripts/build.ts";

export const SITE_BUILD_INPUTS = [
  "deno.json",
  "deno.lock",
  "site/build.ts",
  "site/design-system/deno.json",
  "site/design-system/assets",
  "site/design-system/scripts",
  "site/design-system/src",
  "site/design-system/styleguide",
  "site/page-src",
] as const;

export const SITE_BUILD_EVENT_IGNORES = Object.values(
  DESIGN_SYSTEM_BUILD_OUTPUTS,
).map((path) => `site/design-system/${path}`);

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Absolute paths consumed directly by `Deno.watchFs`. */
export function siteBuildInputPaths(): string[] {
  return SITE_BUILD_INPUTS.map((path) => join(REPO_ROOT, path));
}

/** Whether a filesystem event contains at least one authored-input change. */
export function siteBuildEventNeedsRebuild(paths: readonly string[]): boolean {
  const ignored = SITE_BUILD_EVENT_IGNORES.map((path) => {
    const absolute = join(REPO_ROOT, path);
    return absolute.endsWith(SEPARATOR) ? absolute.slice(0, -1) : absolute;
  });
  return paths.some((path) =>
    !ignored.some((root) =>
      path === root || path.startsWith(`${root}${SEPARATOR}`)
    )
  );
}
