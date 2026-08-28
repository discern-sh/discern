/** Repository-local Desk convenience preferences never become task truth. */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  deskPreferencesPath,
  freshDeskPreferences,
  readDeskPreferences,
  writeDeskPreferences,
} from "../src/engine/desk/preferences.ts";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";

Deno.test("Desk preferences: a missing record has no remembered defaults", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    assertEquals(await readDeskPreferences(dir), freshDeskPreferences());
  });
});

Deno.test("Desk preferences: linked worktrees share safe repository defaults", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const preferences = {
      schema_version: 1 as const,
      last_agent: "codex" as const,
      creation_path: "expanded" as const,
    };
    await writeDeskPreferences(dir, preferences);
    assertEquals(await readDeskPreferences(dir), preferences);

    const linked = await addWorktree(dir, "desk-preferences-shared");
    assertEquals(await readDeskPreferences(linked), preferences);

    const path = await deskPreferencesPath(dir);
    assert(path !== undefined);
    const mode = (await Deno.stat(path)).mode;
    assert(mode !== null);
    assertEquals(mode & 0o777, 0o600);
  });
});

Deno.test("Desk preferences: stale, torn, and authority-shaped records reset", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const path = await deskPreferencesPath(dir);
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });

    for (
      const foreign of [
        "{ torn",
        JSON.stringify({ schema_version: 99, last_agent: "codex" }),
        JSON.stringify({ schema_version: 1, last_agent: "missing-provider" }),
        JSON.stringify({
          schema_version: 1,
          creation_path: "compact",
          landing_authority: "granted",
        }),
      ]
    ) {
      await Deno.writeTextFile(path, foreign);
      assertEquals(await readDeskPreferences(dir), freshDeskPreferences());
    }
  });
});

Deno.test("Desk preferences: outside Git, reads reset and writes are silent", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await deskPreferencesPath(dir), undefined);
    assertEquals(await readDeskPreferences(dir), freshDeskPreferences());
    await writeDeskPreferences(dir, {
      schema_version: 1,
      creation_path: "compact",
    });
  });
});
