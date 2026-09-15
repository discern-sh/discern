import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { deriveSetupProjectContext } from "../src/shared/setup_project_context.ts";
import { withTempDir } from "./helpers.ts";

for (const region of ["runtime", "10-runtime", "05-runtime", "95-runtime"]) {
  Deno.test(`setup derives project context without assigning meaning to numbering: ${region}`, async () => {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, "map", region), { recursive: true });
      await Deno.mkdir(join(root, "map", "orientation"));
      await Deno.writeTextFile(
        join(root, "map", region, "README.md"),
        "# Runtime\n\n## Start here\n\nRead the entry point.\n\n## Boundary\n\nOwns execution.\n\n## Important constraint\n\nPreserves child exit status.\n",
      );
      await Deno.writeTextFile(
        join(root, "map", "orientation", "design-principles.md"),
        "# Principles\n\n## Preserve status\n\nCallers rely on failure signals.\n",
      );
      const context = await deriveSetupProjectContext(root, "map", []);
      assertEquals(context.primary_subsystem?.region, region);
      assertEquals(
        context.primary_subsystem?.non_obvious_invariant,
        "Preserves child exit status.",
      );
      assertEquals(context.principles.items, ["Preserve status"]);
    });
  });
}
