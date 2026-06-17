/**
 * Unit tests for the self-referential command renderer — the single seam that
 * decides whether a "re-run the tool" hint speaks the product vocabulary
 * (`icculus upgrade`) or this repo's self-host Deno-task aliases
 * (`deno task selfsync`). The marker is the project's own `deno.json`.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { selfCmd } from "../src/lib/invocation.ts";
import { withTempDir } from "./helpers.ts";

/** Write a `deno.json` with the given body into `dir`. */
async function withDenoJson(
  dir: string,
  body: Record<string, unknown>,
): Promise<void> {
  await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify(body));
}

Deno.test("selfCmd speaks product vocabulary with no deno.json", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await selfCmd("sync", dir), "icculus upgrade");
    assertEquals(await selfCmd("check", dir), "icculus upgrade --check");
  });
});

Deno.test("selfCmd speaks the Deno-task vocabulary when a selfsync task is declared", async () => {
  await withTempDir(async (dir) => {
    await withDenoJson(dir, { tasks: { selfsync: "run", selfcheck: "run" } });
    assertEquals(await selfCmd("sync", dir), "deno task selfsync");
    assertEquals(await selfCmd("check", dir), "deno task selfcheck");
  });
});

Deno.test("selfCmd ignores a deno.json without a selfsync task", async () => {
  await withTempDir(async (dir) => {
    await withDenoJson(dir, { tasks: { test: "deno test" } });
    assertEquals(await selfCmd("sync", dir), "icculus upgrade");
  });
});

Deno.test("selfCmd fails safe to product vocabulary on a malformed deno.json", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "deno.json"), "{ not json");
    assertEquals(await selfCmd("sync", dir), "icculus upgrade");
  });
});
