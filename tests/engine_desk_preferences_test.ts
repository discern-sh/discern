/** Repository-local Desk convenience preferences never become task truth. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  deskPreferencesPath,
  freshDeskPreferences,
  inspectDeskPreferences,
  readDeskPreferences,
  writeDeskPreferences,
} from "../src/engine/desk/preferences.ts";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import {
  initializeGitAdminRecordFixture,
  writeNewerOnDiskJsonFixture,
} from "./on_disk_format_fixtures.ts";

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
    assertEquals(await writeDeskPreferences(dir, preferences), {
      status: "saved",
    });
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

Deno.test("Desk preferences: torn and authority-shaped records reset", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const path = await deskPreferencesPath(dir);
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });

    for (
      const foreign of [
        "{ torn",
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

Deno.test("Desk preferences: a newer record is diagnosed and never replaced", async () => {
  await withTempDir(async (dir) => {
    const path = await initializeGitAdminRecordFixture(
      dir,
      "deskPreferences",
    );
    const future = await writeNewerOnDiskJsonFixture(
      path,
      "deskPreferences",
      {
        last_agent: "codex",
        future_field: true,
      },
    );

    const inspected = await inspectDeskPreferences(dir);
    assert(inspected.status === "newer");
    assertStringIncludes(inspected.reason, "written by a newer discern");
    assertEquals(await readDeskPreferences(dir), freshDeskPreferences());
    const written = await writeDeskPreferences(dir, {
      schema_version: 1,
      creation_path: "expanded",
    });
    assert(written.status === "newer");
    assertStringIncludes(written.reason, "Update discern");
    assertEquals(await Deno.readTextFile(path), future);
  });
});

Deno.test("Desk preferences: outside Git, reads reset and writes report unavailability", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await deskPreferencesPath(dir), undefined);
    assertEquals(await readDeskPreferences(dir), freshDeskPreferences());
    const result = await writeDeskPreferences(dir, {
      schema_version: 1,
      creation_path: "compact",
    });
    assertEquals(result.status, "unavailable");
    if (result.status === "unavailable") {
      assertStringIncludes(result.reason, "shared state directory");
    }
  });
});
