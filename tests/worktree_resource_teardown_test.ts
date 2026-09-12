import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { Logger } from "../src/lib/log.ts";
import {
  destroyResources,
  entriesForWorktree,
  type ResourceEntry,
  writeEntry,
} from "../src/engine/worktree/resources.ts";
import { pinnedTerminal, withTempDir } from "./helpers.ts";

/** Ledger cleanup is the sole resource-retirement boundary; names are immaterial. */
Deno.test("worktree resource teardown retains ownership replaced before or during destruction", async () => {
  for (const timing of ["before", "during"] as const) {
    await withTempDir(async (root) => {
      const common = join(root, "admin");
      const replacement = join(root, "replacement.json");
      const marker = join(root, "destroyed");
      const entry: ResourceEntry = {
        schema: ON_DISK_FORMATS.resourceLedger.version,
        phase: "ready",
        seq: 0,
        project_slug: "sample",
        git_key: "independent",
        worktree_id: "independent",
        worktree_handle: "sample-independent",
        worktree_path: root,
        resource_name: "device",
        resource_identity: "owned-device",
        destroy_command: ":",
        token_map: {},
        retries: 0,
        gc: true,
        created_at: "2026-09-05T00:00:00Z",
      };
      await writeEntry(common, entry);
      const item = (await entriesForWorktree(common, entry.git_key))[0];
      assertExists(item);
      const quote = (value: string): string =>
        `'${value.replaceAll("'", "'\\''")}'`;
      const command = `touch ${quote(marker)}${
        timing === "during"
          ? ` && cp ${quote(replacement)} ${quote(item.path)}`
          : ""
      }`;
      await writeEntry(common, { ...entry, destroy_command: command });
      const planned = await entriesForWorktree(common, entry.git_key);
      const newer = JSON.stringify({
        schema: ON_DISK_FORMATS.resourceLedger.version + 1,
        future_owner: "a different tenant",
      });
      await Deno.writeTextFile(
        timing === "before" ? item.path : replacement,
        newer,
      );
      const outcome = await destroyResources({
        config: parseConfigOrThrow(""),
        cwd: root,
        log: new Logger({
          json: true,
          noColor: true,
          terminal: pinnedTerminal(),
        }),
      }, planned);
      assertEquals(outcome, { destroyed: [], failed: ["device"] });
      assertEquals(await Deno.readTextFile(item.path), newer);
      if (timing === "before") {
        let ran = false;
        try {
          await Deno.stat(marker);
          ran = true;
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        assertEquals(ran, false);
      }
    });
  }
});
