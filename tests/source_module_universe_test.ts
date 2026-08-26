/** The coverage module universe follows the structural-scope Git census. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { sourceModuleUniverse } from "../scripts/source_module_universe.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("source modules auto-enrol in a future src/ subtree and classify non-runtime files", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "generated/\n");
    await gitInit(dir);
    for (
      const [path, source] of [
        ["src/future/runtime.ts", "export const answer = 42;\n"],
        ["src/future/types.ts", "export interface Answer { value: number }\n"],
        ["src/future/empty.ts", "/** Intentionally empty. */\nexport {};\n"],
        ["site/not-covered.ts", "export const page = true;\n"],
        ["generated/ignored.ts", "export const ignored = true;\n"],
      ] as const
    ) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), source);
    }

    assertEquals(await sourceModuleUniverse(dir), [
      { path: "src/future/empty.ts", kind: "no-executable-lines" },
      { path: "src/future/runtime.ts", kind: "executable" },
      { path: "src/future/types.ts", kind: "type-only" },
    ]);
  });
});
