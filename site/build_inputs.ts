/** Authored inputs whose changes require the generated public site to rebuild. */
import { fromFileUrl, join } from "@std/path";

export const SITE_BUILD_INPUTS = [
  "deno.json",
  "deno.lock",
  "site/build.ts",
  "site/releases",
  "src/shared/product_identity.ts",
  "src/shared/semver.ts",
  "site/brand.ts",
  "site/design_system.ts",
  "site/workflow_registry.ts",
  "site/page-src",
  "site/ui",
  "site/routes.ts",
  "site/renderers.ts",
  "site/marketing_pages.ts",
  "project/manual",
  "project/map",
  "src/lib/docs.ts",
  "src/lib/frontmatter.ts",
  "src/lib/manual.ts",
  "src/lib/markdown.ts",
  "src/shared/manual.ts",
  "src/lib/providers.ts",
  "src/shared/agent_catalogue.ts",
  "src/shared/brand.ts",
] as const;

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Absolute paths consumed directly by `Deno.watchFs`. */
export function siteBuildInputPaths(): string[] {
  return SITE_BUILD_INPUTS.map((path) => join(REPO_ROOT, path));
}

/** Whether a filesystem event contains at least one authored-input change. */
export function siteBuildEventNeedsRebuild(paths: readonly string[]): boolean {
  return paths.length > 0;
}
