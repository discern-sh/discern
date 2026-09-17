/**
 * discern runs on itself. This repository is a discern project whose Gate,
 * Standards, Map, worktree practice, and Logbook come from the tracked root
 * configuration, and the hosted gate lane runs that same Gate. The claim is
 * structural because each fact is read from the file that makes it true.
 *
 * Guards: claim:runs-on-itself
 */

import { assert, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { fileExists } from "../src/shared/fs_presence.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));

Deno.test("this repository declares its own Gate, Standards, Map, worktrees, and Logbook", async () => {
  const config = await loadConfig(REPO);
  for (const job of ["format", "lint", "typecheck", "test"]) {
    assert(job in config.jobs, `discern.toml declares no ${job} job`);
  }
  const standards = Object.keys(config.standards ?? {});
  assert(standards.length > 0, "discern.toml holds no Standards");
  const mapDir = config.map?.dir;
  assert(mapDir !== undefined, "discern.toml configures no Map");
  assert(
    await fileExists(join(REPO, mapDir, "README.md")),
    `the configured Map has no README at ${mapDir}`,
  );
  assert(config.project.record_logbook, "discern.toml turns the Logbook off");
  assert(
    config.repository.branch_prefix.length > 0,
    "discern.toml declares no worktree branch prefix",
  );
});

Deno.test("the hosted gate lane runs the same Gate and refuses a tree the fixers changed", async () => {
  const workflow = await Deno.readTextFile(
    join(REPO, ".github/workflows/gate.yml"),
  );
  assert(
    /\bdone --ci\b/.test(workflow),
    "the gate workflow does not run `discern done --ci`",
  );
  assertStringIncludes(workflow, "git diff --exit-code");
});
