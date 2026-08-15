/**
 * End-to-end coverage for the per-worktree resource lifecycle, driven through the
 * CLI exactly as a real install runs it: `discern worktree setup` creates the
 * declared resources and records their handles; `discern worktree prune` reclaims
 * the resources of a worktree that vanished without a clean teardown. The
 * fine-grained GC guards are unit-tested in `worktree_resources_test.ts`; this
 * pins the wiring — that the verbs, the ledger, and runtime discovery line up.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { writeDiscernToml } from "../src/lib/tidy_format.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Commit all fixture state, allowing an empty commit at a resource lifecycle boundary. */
async function commitCurrentWorktree(
  wt: string,
  message = "commit worktree state",
): Promise<void> {
  await git(wt, "add", "-A");
  await git(
    wt,
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
    "--no-gpg-sign",
  );
}

/** Append a `[worktree.resources.<name>]` table to a worktree's scaffolded config
 * (keeping every other section intact, so setup's guidance refresh still works).
 * create/destroy touch markers under an absolute dir OUTSIDE the worktree, so a
 * destroy works even after the worktree is gone. */
async function declareResource(
  wt: string,
  markers: string,
  body: string,
): Promise<void> {
  const path = join(wt, "discern.toml");
  const cfg = await Deno.readTextFile(path);
  await writeDiscernToml(
    path,
    `${cfg}\n[worktree.resources.thing]\n${
      body.replaceAll("@MARKERS@", markers)
    }\n`,
  );
}

Deno.test("worktree setup creates a resource and records its handle for runtime discovery", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "disc");
    const markers = join(dir, "markers");
    // A .env must exist for the handle to be recorded into it (matching the port).
    await Deno.writeTextFile(join(wt, ".env"), "EXISTING=1\n");
    await declareResource(
      wt,
      markers,
      [
        'create  = "mkdir -p @MARKERS@ && touch @MARKERS@/@resource@.live"',
        'destroy = "rm -f @MARKERS@/@resource@.live"',
      ].join("\n"),
    );

    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    // The handle the query resolves…
    const q = await runAgent(wt, ["identity", "--resource", "thing"]);
    assertEquals(q.code, 0, q.output);
    const handle = q.stdout.trim();
    assert(handle.length > 0, "no handle resolved");

    // …equals what create used (the marker is named by it)…
    assert(
      await exists(join(markers, `${handle}.live`)),
      `create did not run for handle ${handle}\n${setup.output}`,
    );
    // …and what .env carries (DISCERN_RESOURCE_THING), the runtime-discovery channel.
    const env = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(env, `DISCERN_RESOURCE_THING=${handle}`);
    assertStringIncludes(env, "DISCERN_WORKTREE=");
  });
});

Deno.test("a required create failure aborts setup; required = false does not", async () => {
  await withTempDir(async (dir) => {
    // Default required = true → a failing create is fatal.
    const wt = await mainWithWorktree(dir, "req");
    await declareResource(wt, join(dir, "m"), 'create = "false"');
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 1, setup.output);
    assertStringIncludes(setup.output, "thing");
  });
  await withTempDir(async (dir) => {
    // required = false → the failure warns and setup continues.
    const wt = await mainWithWorktree(dir, "opt");
    await declareResource(
      wt,
      join(dir, "m"),
      ['create   = "false"', "required = false"].join("\n"),
    );
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
  });
});

Deno.test("accept destroys the worktree's resources before removing it", async () => {
  await withTempDir(async (dir) => {
    // Markers go in a SEPARATE temp dir OUTSIDE the repo, so they survive the
    // worktree's removal and never dirty the main checkout (accept refuses a
    // dirty main). discern is agent-agnostic, so a test must NEVER reach for an
    // agent-specific path (e.g. `.claude/`) to find "somewhere ignored" — use a
    // real external temp dir.
    await withTempDir(async (markers) => {
      const wt = await mainWithWorktree(dir, "grad");
      await declareResource(
        wt,
        markers,
        [
          'create  = "mkdir -p @MARKERS@ && touch @MARKERS@/@resource@.live"',
          'destroy = "mkdir -p @MARKERS@ && rm -f @MARKERS@/@resource@.live && touch @MARKERS@/@resource@.gone"',
        ].join("\n"),
      );
      assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);
      await commitCurrentWorktree(wt);
      const handle = (await runAgent(wt, ["identity", "--resource", "thing"]))
        .stdout
        .trim();

      // accept tears resources down at step 4 (while @dir@ still resolves),
      // then removes the worktree — so a landed worktree leaves no orphan.
      const grad = await runAgent(wt, ["accept", "--confirmed"]);
      assertEquals(grad.code, 0, grad.output);
      assert(
        await exists(join(markers, `${handle}.gone`)),
        `accept did not destroy the resource\n${grad.output}`,
      );
    });
  });
});

Deno.test("worktree ensure runs a resource's ensure on an already-configured worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "ens");
    const markers = join(dir, "markers");
    await declareResource(
      wt,
      markers,
      [
        'create  = "true"',
        'destroy = "true"',
        'ensure  = "mkdir -p @MARKERS@ && touch @MARKERS@/@resource@.ensured"',
      ].join("\n"),
    );
    // Setup marks the worktree configured (create runs, no ensure yet).
    assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);
    const handle = (await runAgent(wt, ["identity", "--resource", "thing"]))
      .stdout
      .trim();
    assert(
      !(await exists(join(markers, `${handle}.ensured`))),
      "ensure ran during setup",
    );

    // Session-start ensure on an already-configured worktree reconciles drift.
    const ens = await runAgent(wt, ["worktree", "ensure"]);
    assertEquals(ens.code, 0, ens.output);
    assert(
      await exists(join(markers, `${handle}.ensured`)),
      `ensure did not run\n${ens.output}`,
    );
  });
});

Deno.test("worktree setup is idempotent: a re-run re-readies but never re-creates or re-runs steps", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "idem");
    const markers = join(dir, "markers");
    // A setup step that APPENDS (so a re-run is detectable), filled into the
    // scaffolded empty steps array.
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      cfg.replace(
        "steps = []",
        `steps = ["mkdir -p ${markers} && echo s >> ${markers}/step.log"]`,
      ),
    );
    // A resource whose create likewise APPENDS — a re-create would be visible.
    await declareResource(
      wt,
      markers,
      [
        'create  = "mkdir -p @MARKERS@ && echo c >> @MARKERS@/@resource@.create"',
        'destroy = "rm -f @MARKERS@/@resource@.create"',
      ].join("\n"),
    );

    const first = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(first.code, 0, first.output);
    const handle = (await runAgent(wt, ["identity", "--resource", "thing"]))
      .stdout
      .trim();

    // Re-enter setup (as a re-fired create hook or an explicit `discern worktree setup`
    // would): it must re-ready, not re-create or re-run steps.
    const second = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(second.code, 0, second.output);
    assertTerminalTextIncludes(second.output, "already configured");

    assertEquals(
      await Deno.readTextFile(join(markers, `${handle}.create`)),
      "c\n",
      "resource create must not re-run on a configured worktree",
    );
    assertEquals(
      await Deno.readTextFile(join(markers, "step.log")),
      "s\n",
      "setup steps must not re-run on a configured worktree",
    );
  });
});

Deno.test("worktree prune reclaims a vanished worktree's resource (GC), and --dry-run does not", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "orph");
    const markers = join(dir, "markers");
    await declareResource(
      wt,
      markers,
      [
        'create  = "mkdir -p @MARKERS@ && touch @MARKERS@/@resource@.live"',
        'destroy = "mkdir -p @MARKERS@ && rm -f @MARKERS@/@resource@.live && touch @MARKERS@/@resource@.gone"',
      ].join("\n"),
    );
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    const handle = (await runAgent(wt, ["identity", "--resource", "thing"]))
      .stdout.trim();
    assert(
      await exists(join(markers, `${handle}.live`)),
      "setup did not create",
    );

    // The worktree vanishes WITHOUT a clean teardown.
    await Deno.remove(wt, { recursive: true });

    // Dry run: the prune plan lists the orphan as a reclaim, but acts on nothing
    // (ADR 0027 folded prune's dry-run into the shared plan listing).
    const dry = await runAgent(dir, ["worktree", "prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.output, handle);
    assertTerminalTextIncludes(dry.output, "reclaim orphaned resource");
    assert(
      !(await exists(join(markers, `${handle}.gone`))),
      "dry-run ran the destroy",
    );

    // Real run: reclaims it.
    const prune = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(prune.code, 0, prune.output);
    assert(
      await exists(join(markers, `${handle}.gone`)),
      `prune did not reclaim the orphan\n${prune.output}`,
    );
  });
});
