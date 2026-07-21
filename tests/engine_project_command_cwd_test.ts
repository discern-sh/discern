/**
 * Project-command cwd invariant: every command read from discern.toml executes
 * relative to the resolved project root, never the caller/server process cwd.
 *
 * Root discovery deliberately accepts a nested CLI cwd, and MCP deliberately
 * keeps a logical working root distinct from its long-lived process cwd. Those
 * are two instances of the same contract: once discern has resolved `root`, the
 * physical cwd is no longer authoritative for project commands.
 *
 * The gate case iterates the canonical STAGES set so every current/future stage
 * auto-enrols, plus the separately modelled scope-gate group. Standards and
 * doctor's command probe use their own execution paths and get one behavioural
 * case each. Worktree setup/resources already require an explicit cwd at their
 * runner boundary; project scripts and `with-gotchas` intentionally retain the
 * caller's cwd and are outside this invariant.
 */

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { doctorResult } from "../src/commands/doctor.ts";
import { STAGES } from "../src/shared/capabilities.ts";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

const BASE = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
];

Deno.test("all gate command groups execute at the resolved root from a nested CLI cwd", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src/changed.ts"), "export {};\n");
    await writeConfig(
      dir,
      [
        ...BASE,
        ...STAGES.flatMap((stage) => [
          `[jobs.cwd_${stage}]`,
          `stage = "${stage}"`,
          `run = "pwd > cwd-${stage}.txt"`,
          "",
        ]),
        "[scopes.changed]",
        'paths = ["src/**"]',
        'gate = "pwd > cwd-scope.txt"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    // Make the scope gate fire, then invoke from a nested directory. findRoot()
    // resolves `dir`; project commands must follow that root rather than this cwd.
    await Deno.writeTextFile(
      join(dir, "src/changed.ts"),
      "export const x = 1;\n",
    );
    const nested = join(dir, "src/deep");
    await Deno.mkdir(nested, { recursive: true });

    const result = await runAgent(dir, ["done", "--json"], { cwd: nested });
    assertEquals(result.code, 0, result.output);
    const canonicalRoot = await Deno.realPath(dir);

    for (const label of [...STAGES, "scope"]) {
      const marker = join(dir, `cwd-${label}.txt`);
      assert(
        await exists(marker),
        `${label} command ran outside the resolved root\n${result.output}`,
      );
      assertEquals((await Deno.readTextFile(marker)).trim(), canonicalRoot);
    }
  });
});

Deno.test("standard measurement executes at the resolved root from a nested CLI cwd", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        ...BASE,
        "[standards.cwd]",
        'direction = "up"',
        "limit = 1",
        'run = "pwd > standard.cwd && echo DISCERN_METRIC cwd 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const nested = join(dir, "nested");
    await Deno.mkdir(nested);

    const result = await runAgent(dir, ["standards", "--json"], {
      cwd: nested,
    });
    assertEquals(result.code, 0, result.output);
    assertEquals(
      (await Deno.readTextFile(join(dir, "standard.cwd"))).trim(),
      await Deno.realPath(dir),
    );
  });
});

Deno.test("doctor validates relative project commands at its explicit root", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(join(dir, "root-tool"), "#!/bin/sh\nexit 0\n");
    await writeConfig(
      dir,
      [
        ...BASE,
        "[jobs]",
        'lint = "./root-tool"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // Call the explicit-root core from this test process, whose cwd is the discern
    // source checkout. This is the same split an MCP `path` override creates.
    const result = await doctorResult(dir);
    const capabilityCommands = result.data?.checks.find((check) =>
      check.name === "job commands"
    );
    assertEquals(capabilityCommands?.ok, true);
  });
});
