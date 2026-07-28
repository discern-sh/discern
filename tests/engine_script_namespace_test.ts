/**
 * Namespace forcing function: every built-in verb is also a legal project script
 * name under `discern script`. Deriving the matrix from KNOWN_VERBS means a new
 * built-in auto-enrols instead of silently recreating a collision rule.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { KNOWN_VERBS } from "../src/main.ts";
import { withTempDir } from "./helpers.ts";
import {
  mapPool,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

Deno.test("every built-in verb remains runnable as a namespaced project script", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, ["[project]", 'slug = "namespace"', ""].join("\n"));

    for (const verb of KNOWN_VERBS) {
      await writeExecutable(
        join(dir, "discern", "scripts", verb),
        `#!/usr/bin/env sh\necho SCRIPT-RAN-${verb}\n`,
      );
    }

    // Each case only spawns its own echo script, so the sweep fans out
    // against the shared scaffold.
    await mapPool([...KNOWN_VERBS], 8, async (verb) => {
      const r = await runAgent(dir, ["script", verb]);
      assertEquals(r.code, 0, `${verb}: ${r.output}`);
      assertStringIncludes(r.stdout, `SCRIPT-RAN-${verb}`);
    });
  });
});
