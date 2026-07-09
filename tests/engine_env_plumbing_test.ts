/**
 * Env plumbing that actually works — the class where a declared `inherit_env`
 * value never reached a fresh worktree (the old code required the worktree to
 * already have a `.env`, which a fresh worktree never does, and read only
 * `<main>/.env`). Now: `[worktree].env_files` (default [".env", ".env.local"])
 * names what to read and write, inheritance CREATES the worktree's env file,
 * `.env.local` participates with the dotenv override convention, fleet rows
 * derive id/port when nothing is recorded, and the freshly-minted port re-rolls
 * away from a live sibling's.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  lifecycleContext,
  livePortsInUse,
  mintFreeWorktree,
} from "../src/engine/worktree/lifecycle.ts";
import {
  loadIdentitySettings,
  portForId,
} from "../src/engine/worktree/identity.ts";
import type { MintedWorktreeId } from "../src/engine/worktree/identity.ts";
import { Logger } from "../src/lib/log.ts";

const INHERIT_CONFIG =
  '[project]\nslug = "engine-test"\nmain_branch = "main"\n\n' +
  '[worktree]\ninherit_env = ["APP_KEY"]\n';

Deno.test("inherit_env: a declared value arrives in a FRESH worktree with no env file (end to end)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    // The secret lives only in main's untracked .env — a fresh worktree never
    // carries it via git.
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=s3cret\n");

    const wt = await addWorktree(dir, "env-fresh");
    assertEquals(await exists(join(wt, ".env")), false, "fresh = no env file");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    const env = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(
      env,
      "APP_KEY=s3cret",
      "the declared value must ARRIVE — created file and all",
    );
  });
});

Deno.test("inherit_env: .env.local overrides .env when reading main's values", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=base\n");
    await Deno.writeTextFile(join(dir, ".env.local"), "APP_KEY=local-wins\n");

    const wt = await addWorktree(dir, "env-local");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "APP_KEY=local-wins",
      ".env.local is the dominant convention — it must win",
    );
  });
});

Deno.test("inherit_env: a worktree-specific value is never clobbered", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, INHERIT_CONFIG);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=mains\n");

    const wt = await addWorktree(dir, "env-custom");
    await Deno.writeTextFile(join(wt, ".env"), "APP_KEY=my-own\n");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    assertStringIncludes(
      await Deno.readTextFile(join(wt, ".env")),
      "APP_KEY=my-own",
    );
  });
});

Deno.test("fleet rows derive id and port when the project has no env file", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\nmain_branch = "main"\n\n[worktree]\nport = true\n',
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "no-env-here");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as {
      data: {
        fleet?: Array<{ path: string; id?: string; port?: number }>;
      };
    };
    const row = result.data.fleet?.find((e) => e.path.endsWith("no-env-here"));
    assert(row !== undefined, JSON.stringify(result.data.fleet));
    assertEquals(row.id, basename(wt), "id derives without any env file");
    assertEquals(
      typeof row.port,
      "number",
      "port derives without any env file",
    );
  });
});

Deno.test("the shipped settings template carries no deny rule", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const settings = JSON.parse(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    ) as Record<string, unknown>;
    assertEquals(
      settings.permissions,
      undefined,
      "discern never restricts what an agent can read — permissions are the user's own decision",
    );
  });
});

Deno.test("inherit_env: values survive a one-shot `cp .env.example .env` setup step", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The canonical bootstrap step rewrites the env file WHOLESALE after the
    // env writers ran — the inherited secret and the recorded port must land in
    // the FINAL file, not the pre-step one the scaffold replaced.
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\nmain_branch = "main"\n\n' +
        '[worktree]\ninherit_env = ["APP_KEY"]\nport = true\n\n' +
        '[worktree.setup]\nsteps = ["cp .env.example .env"]\n',
    );
    // The example ships in git (the worktree checkout needs it for the cp);
    // main's real secret lives only in its untracked .env.
    await Deno.writeTextFile(
      join(dir, ".env.example"),
      "APP_KEY=placeholder\n",
    );
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ".env"), "APP_KEY=s3cret\n");

    const wt = await addWorktree(dir, "env-clobber");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    const env = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(
      env,
      "APP_KEY=s3cret",
      `the inherited value must survive the scaffold step\n${env}`,
    );
    assert(
      !env.includes("APP_KEY=placeholder"),
      `the placeholder must not win\n${env}`,
    );
    assertStringIncludes(
      env,
      "DISCERN_WORKTREE_PORT=",
      `the recorded port must survive the scaffold step\n${env}`,
    );
  });
});

// ── the port re-roll (D7): a freshly-minted id avoids a live sibling's port ──────

function stubGenerator(ids: string[]): (name?: string) => MintedWorktreeId {
  let call = 0;
  return () => {
    const id = ids[call % ids.length] as string;
    call++;
    return { id, source: "codename" };
  };
}

Deno.test("mint re-rolls an id whose derived port collides with a live worktree's", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const settings = await loadIdentitySettings(dir);

    const colliding = "brisk-otter-a3f9c1";
    const free = "merry-heron-0b12cd";
    const minted = await mintFreeWorktree(
      ctx,
      settings,
      `${dir}.worktrees`,
      undefined,
      {
        usedPorts: new Set([portForId(colliding)]),
        generate: stubGenerator([colliding, free]),
      },
    );
    assertEquals(minted.id, free, "the colliding first roll must be re-rolled");
  });
});

Deno.test("livePortsInUse enumerates real sibling ports — one per worktree's own identity", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const sibling = await addWorktree(dir, "brisk-otter-a3f9c1");
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const settings = await loadIdentitySettings(dir);
    const ports = await livePortsInUse(ctx, settings);
    assert(
      ports.has(portForId(basename(sibling))),
      `the sibling's derived port must be enumerated: ${[...ports].join(",")}`,
    );
    // One port per sibling: the enumeration reads each row's OWN identity, so
    // it can never collapse the fleet onto a single id (the env-override
    // poisoning defect) — a second sibling must add a second port.
    const other = await addWorktree(dir, "merry-heron-0b12cd");
    const both = await livePortsInUse(ctx, settings);
    assert(both.has(portForId(basename(other))));
    assertEquals(both.size, 2, [...both].join(","));
  });
});

Deno.test("mint accepts a port collision rather than failing when the band is exhausted", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const settings = await loadIdentitySettings(dir);

    const a = "brisk-otter-a3f9c1";
    const b = "merry-heron-0b12cd";
    const minted = await mintFreeWorktree(
      ctx,
      settings,
      `${dir}.worktrees`,
      undefined,
      {
        usedPorts: new Set([portForId(a), portForId(b)]),
        generate: stubGenerator([a, b]),
      },
    );
    assert(
      minted.id === a || minted.id === b,
      "port uniqueness is best-effort — a crowded band must never fail the start",
    );
  });
});
