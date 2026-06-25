/**
 * Engine coverage for `discern status` — the read-only situation/orientation verb
 * (ADR 0033). Drives the real verb via `deno task dev status` in scaffolded temp
 * repos and asserts on the `--json` DiscernResult envelope. Covers the
 * location-aware default (fleet-led from the main checkout, local from a worktree),
 * the `--all`/`--local` overrides, the not-initialized degradation, the advisory
 * hints, and — load-bearing — that `status` never mutates anything (pure
 * observation).
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  engineEnv,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { FLEET_OWNERSHIP_HINT } from "../src/engine/status/status.ts";

/** A config with a project slug and one gated scope (so changed-scopes/gate have
 * something to classify), written before gitInit so a worktree inherits it. */
const SCOPE_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  'main_branch = "main"',
  "",
  "[scopes.web]",
  'paths = ["web/**"]',
  'gate = "true"',
  "",
].join("\n");

/** Parse a `status --json` run, asserting it succeeded and carries the verb. */
// deno-lint-ignore no-explicit-any
function parseStatus(stdout: string): any {
  const obj = JSON.parse(stdout.trim());
  assertEquals(obj.verb, "status");
  return obj;
}

Deno.test("status: from the main checkout, the default leads with the fleet (and a main row)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.location, "main");
    assertEquals(obj.data.worktree, null);
    assert(Array.isArray(obj.data.fleet), `expected a fleet: ${r.stdout}`);
    // The main checkout is always a row, so nothing is hidden…
    assert(
      obj.data.fleet.some((e: { is_main: boolean }) => e.is_main),
      `fleet must include the main row: ${JSON.stringify(obj.data.fleet)}`,
    );
    // …alongside the linked worktree.
    assert(
      obj.data.fleet.some((e: { is_main: boolean; branch: string }) =>
        !e.is_main && e.branch === "agent/alpha"
      ),
      `fleet must include the worktree row: ${JSON.stringify(obj.data.fleet)}`,
    );
    // Every row carries a recent last_activity (an ISO timestamp).
    for (const e of obj.data.fleet) {
      assert(
        typeof e.last_activity === "string",
        `fleet row should carry last_activity: ${JSON.stringify(e)}`,
      );
      const ageMs = Date.now() - Date.parse(e.last_activity);
      assert(
        ageMs >= 0 && ageMs < 5 * 60 * 1000,
        `last_activity should be recent, got ${e.last_activity}`,
      );
    }
    // Leading with the fleet omits the heavy local-only blocks.
    assertEquals(obj.data.gate, undefined);
    assertEquals(obj.data.changed_scopes, undefined);

    // --local suppresses the fleet and restores the local blocks.
    const local = await runAgent(dir, ["status", "--local", "--json"]);
    assertEquals(local.code, 0, local.output);
    const lobj = parseStatus(local.stdout);
    assertEquals(lobj.data.fleet, undefined);
    assert(
      lobj.data.gate,
      `--local must restore the gate block: ${local.stdout}`,
    );
    assert(Array.isArray(lobj.data.changed_scopes));
  });
});

Deno.test("status fleet: exactly the main row is is_current from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");
    await addWorktree(dir, "beta");

    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    const fleet = obj.data.fleet as Array<
      { is_main: boolean; is_current: boolean; branch: string }
    >;
    // Every row carries the (required) boolean — never undefined.
    for (const e of fleet) {
      assertEquals(typeof e.is_current, "boolean", JSON.stringify(e));
    }
    // Exactly one row is current, and from the main checkout it is the main row;
    // every worktree row is explicitly not-current (not absent, not "available").
    const current = fleet.filter((e) => e.is_current);
    assertEquals(
      current.length,
      1,
      `exactly one current row: ${JSON.stringify(fleet)}`,
    );
    assert(current[0]?.is_main, "the current row from main is the main row");
    for (const e of fleet) {
      if (!e.is_main) {
        assertEquals(
          e.is_current,
          false,
          `worktree row not current: ${JSON.stringify(e)}`,
        );
      }
    }
  });
});

Deno.test("status fleet: under --all from a worktree, that worktree's row is is_current", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await addWorktree(dir, "beta");

    const obj = parseStatus(
      (await runAgent(wt, ["status", "--all", "--json"])).stdout,
    );
    const fleet = obj.data.fleet as Array<
      { is_main: boolean; is_current: boolean; branch: string }
    >;
    const current = fleet.filter((e) => e.is_current);
    assertEquals(
      current.length,
      1,
      `exactly one current row: ${JSON.stringify(fleet)}`,
    );
    assertEquals(
      current[0]?.branch,
      "agent/alpha",
      "the current row is this worktree",
    );
    assertEquals(current[0]?.is_main, false);
    // The sibling worktree and the main row are present but not current.
    assertEquals(
      fleet.find((e) => e.is_main)?.is_current,
      false,
      "the main row is not current from a worktree",
    );
    assertEquals(
      fleet.find((e) => e.branch === "agent/beta")?.is_current,
      false,
      "a sibling worktree is not current",
    );
  });
});

Deno.test("status fleet: the ownership rule rides in hints[] for an agent (main checkout)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    assert(
      (obj.hints ?? []).includes(FLEET_OWNERSHIP_HINT),
      `hints must carry the fleet ownership rule: ${JSON.stringify(obj.hints)}`,
    );
  });
});

Deno.test("status fleet: the ownership rule rides in hints[] under --all from a worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await addWorktree(dir, "beta"); // a sibling → a line of work other than this one

    const obj = parseStatus(
      (await runAgent(wt, ["status", "--all", "--json"])).stdout,
    );
    assert(
      (obj.hints ?? []).includes(FLEET_OWNERSHIP_HINT),
      `--all hints must carry the ownership rule: ${JSON.stringify(obj.hints)}`,
    );
  });
});

Deno.test("status fleet: the ownership rule is agent-only — humans get the caption, not the hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const r = await runAgent(dir, ["status"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    // The agent-channel hint text never appears in interactive output…
    assert(
      !r.output.includes(FLEET_OWNERSHIP_HINT),
      `the ownership hint must not appear as a human line: ${r.output}`,
    );
    // …but the dim caption beneath the fleet table does.
    assert(
      r.output.includes("Other worktrees are separate lines of work"),
      `expected the fleet caption in human output: ${r.output}`,
    );
  });
});

Deno.test("status: from a worktree, the default is local; --all adds the fleet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.location, "worktree");
    assertEquals(obj.data.fleet, undefined);
    // The local view carries the worktree identity + the heavy blocks.
    assert(obj.data.worktree, `expected a worktree block: ${r.stdout}`);
    assertEquals(obj.data.worktree.id, "alpha");
    assertEquals(obj.data.git.branch, "agent/alpha");
    assert(obj.data.gate);
    assert(Array.isArray(obj.data.changed_scopes));

    // --all from a worktree keeps the local blocks AND adds the fleet survey.
    const all = await runAgent(wt, ["status", "--all", "--json"]);
    assertEquals(all.code, 0, all.output);
    const aobj = parseStatus(all.stdout);
    assert(
      Array.isArray(aobj.data.fleet),
      `--all must add a fleet: ${all.stdout}`,
    );
    assert(aobj.data.gate, "--all from a worktree keeps the local gate block");
    assert(aobj.data.worktree);
  });
});

Deno.test("status: --all and --local together is a refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["status", "--all", "--local", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = JSON.parse(r.stdout.trim());
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "status");
    assertEquals(obj.error, "conflicting_flags");

    // Human mode refuses with the same non-zero exit.
    const human = await runAgent(dir, ["status", "--all", "--local"]);
    assertEquals(human.code, 1, human.output);
  });
});

Deno.test("status: outside a discern project, the envelope is not_initialized", async () => {
  await withTempDir(async (dir) => {
    // No scaffold — there is no discern.toml in this dir or any parent.
    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = JSON.parse(r.stdout.trim());
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "status");
    assertEquals(obj.error, "not_initialized");
  });
});

Deno.test("status: a dirty worktree hints to run the gate before finishing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // An uncommitted change in the `web` scope.
    await writeExecutable(join(wt, "web/x.txt"), "x");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.git.clean, false);
    assert(
      obj.data.changed_scopes.includes("web"),
      `expected 'web' among changed scopes: ${JSON.stringify(obj.data)}`,
    );
    assert(
      (obj.hints ?? []).some((h: string) => h.includes("discern finish")),
      `expected a 'run discern finish' hint: ${JSON.stringify(obj.hints)}`,
    );
  });
});

Deno.test("status: a clean worktree ahead of main hints it is ready to graduate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // A committed change: clean working tree, one commit ahead of main, contains main.
    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.git.clean, true);
    assertEquals(obj.data.git.ahead_integration, 1);
    assertEquals(obj.data.git.behind_integration, 0);
    assert(
      (obj.hints ?? []).some((h: string) => h.includes("graduate")),
      `expected a 'ready to graduate' hint: ${JSON.stringify(obj.hints)}`,
    );
  });
});

/** Run git in `dir` with the hermetic engine env plus any extra env (e.g. backdated
 * commit dates), throwing on failure. Lets a test forge an old branch point. */
async function rawGit(
  dir: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const c = new Deno.Command("git", {
    args,
    cwd: dir,
    env: await engineEnv(extraEnv),
    stdout: "null",
    stderr: "piped",
  });
  const { success, stderr } = await c.output();
  if (!success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

Deno.test("status fleet: a freshly spawned worktree reads as recent, not as old as its branch point", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    // A repo whose only commit is years old — so HEAD's commit time is stale.
    const OLD = "2021-06-01T12:00:00";
    await rawGit(dir, ["init", "-q"]);
    await rawGit(dir, ["config", "user.email", "t@example.com"]);
    await rawGit(dir, ["config", "user.name", "Test"]);
    await rawGit(dir, ["config", "commit.gpgsign", "false"]);
    await rawGit(dir, ["add", "-A"]);
    await rawGit(dir, ["commit", "-q", "-m", "old", "--no-gpg-sign"], {
      GIT_AUTHOR_DATE: OLD,
      GIT_COMMITTER_DATE: OLD,
    });
    await rawGit(dir, ["branch", "-M", "main"]);
    // Spawn a worktree NOW — no commits of its own, HEAD is the 2021 branch point.
    await addWorktree(dir, "fresh");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    const row = obj.data.fleet.find((e: { is_main: boolean }) => !e.is_main);
    assert(
      row?.last_activity,
      `worktree row should carry last_activity: ${r.stdout}`,
    );
    // Its creation (the reflog), not the 2021 HEAD commit, drives last_activity.
    const ageMs = Date.now() - Date.parse(row.last_activity);
    assert(
      ageMs < 5 * 60 * 1000,
      `a just-spawned worktree must read as recent, not 2021 — got ${row.last_activity}`,
    );
  });
});

/** A content-hash snapshot of every file under `dir` (excluding the `.git`
 * gitlink/dir), so a byte-level mutation anywhere shows up as an inequality. */
async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const entry of walk(dir, { includeDirs: false })) {
    const rel = relative(dir, entry.path);
    if (rel === ".git" || rel.startsWith(".git/")) {
      continue;
    }
    const bytes = await Deno.readFile(entry.path);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    out[rel] = Array.from(digest).map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return out;
}

Deno.test("status is pure observation: it mutates nothing and provisions no resources", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A resource whose create would touch a sentinel — status must never run it.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[worktree.resources.thing]",
        `create = "touch CREATED_SENTINEL"`,
        `destroy = "rm -f CREATED_SENTINEL"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // Dirty the worktree, so status has real state to observe.
    await writeExecutable(join(wt, "scratch.txt"), "dirty");

    const before = await snapshotTree(wt);
    // Run both renderings; neither may touch the tree.
    assertEquals((await runAgent(wt, ["status"])).code, 0);
    assertEquals((await runAgent(wt, ["status", "--all", "--json"])).code, 0);
    const after = await snapshotTree(wt);

    assertEquals(
      after,
      before,
      "status must leave the worktree byte-for-byte unchanged",
    );
    // The resource create command must NOT have run (status reads .env, never creates).
    let sentinelExists = true;
    try {
      await Deno.stat(join(wt, "CREATED_SENTINEL"));
    } catch {
      sentinelExists = false;
    }
    assertEquals(
      sentinelExists,
      false,
      "status must not create (or destroy) any resource",
    );
  });
});

Deno.test("status: a drifted generated agent file is listed and hinted to refresh", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]); // compile CLAUDE.md so it exists and is current

    // Hand-edit the generated file → it no longer matches what `refresh` would write.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\n<!-- a stray hand edit -->\n`,
    );

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assert(
      (obj.data.stale_generated ?? []).includes("CLAUDE.md"),
      `expected CLAUDE.md in stale_generated: ${r.stdout}`,
    );
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("out of date") && h.includes("discern refresh")
      ),
      `expected an out-of-date refresh hint: ${JSON.stringify(obj.hints)}`,
    );
    // status is read-only — it must NOT silently regenerate the drifted file.
    assert(
      (await Deno.readTextFile(claudePath)).includes("a stray hand edit"),
      "status must not rewrite the generated file",
    );
  });
});

Deno.test("status: a missing generated agent file hints it isn't built yet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    // An untracked artifact can go absent (deleted, or a fresh checkout).
    await Deno.remove(join(dir, "CLAUDE.md"));

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assert((obj.data.stale_generated ?? []).includes("CLAUDE.md"), r.stdout);
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("aren't built yet") && h.includes("discern refresh")
      ),
      `expected a not-built-yet hint: ${JSON.stringify(obj.hints)}`,
    );
  });
});
