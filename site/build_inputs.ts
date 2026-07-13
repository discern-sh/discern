/** Authored inputs whose changes require the generated public site to rebuild. */
import { fromFileUrl, join } from "@std/path";

export const SITE_BUILD_INPUTS = [
  "deno.json",
  "deno.lock",
  "site/build.ts",
  "site/design-system/deno.json",
  "site/design-system/assets",
  "site/design-system/scripts",
  "site/design-system/src",
  "site/page-src",
] as const;

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Absolute paths consumed directly by `Deno.watchFs`. */
export function siteBuildInputPaths(): string[] {
  return SITE_BUILD_INPUTS.map((path) => join(REPO_ROOT, path));
}
