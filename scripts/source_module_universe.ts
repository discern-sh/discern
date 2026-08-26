/** Elect the product source-module universe from the canonical Git census. */

import { join } from "@std/path";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import { classifyModuleSource, type SourceModule } from "./coverage_lib.ts";

/** Return every authored module under the product runtime's src/ boundary. */
export async function sourceModuleUniverse(
  root: string = REPO_ROOT,
): Promise<SourceModule[]> {
  const paths = await structuralGuardScope({
    guard: "scripts/source_module_universe.ts#product-modules",
    universe: "authored-deno",
    narrow: {
      reason:
        "Product-module coverage owns the shipped runtime boundary under src/.",
      include: (path) => path.startsWith("src/"),
    },
  }, root);
  const modules = await Promise.all(paths.map(async (path) => ({
    path,
    kind: classifyModuleSource(path, await Deno.readTextFile(join(root, path))),
  })));
  return modules.sort((a, b) => a.path.localeCompare(b.path));
}
