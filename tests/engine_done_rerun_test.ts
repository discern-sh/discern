/**
 * The exact-state `done` contract. Canonical current green Proof is reusable
 * without executing any Gate effect; red or incomplete evidence never becomes
 * green through repetition. `--rerun` is the precise deliberate-execution
 * spelling and `--confirmed` remains a tested compatibility alias. Any change
 * to the tree runs normally, and `--dry-run` remains a read-only preview.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { UNCHANGED_TREE_RERUN_SLUG } from "../src/engine/gate/proof.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** Decode successive done envelopes so rerun and proof effects can be compared. */
// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

const GREEN_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'test = "echo rerun-gate-ok"',
  "",
].join("\n");

const CHECKED_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'test = "sh check.sh"',
  "",
].join("\n");

const CHECK_FAILS = ["#!/usr/bin/env sh", "exit 1", ""].join("\n");

/** Scaffold main + a worktree carrying one committed change, gate per `config`. */
async function worktreeWithWork(
  dir: string,
  config: string,
  check?: string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  if (check !== undefined) {
    await writeExecutable(join(dir, "check.sh"), check);
  }
  await gitInit(dir);
  const wt = await addWorktree(dir, "rerun");
  await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");
  return wt;
}

Deno.test("done: an unchanged tree the gate judged RED refuses a bare rerun, and --rerun executes it", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, CHECKED_CONFIG, CHECK_FAILS);

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 1, first.output);
    const firstEnv = parseJson(first.stdout);
    assertEquals(firstEnv.data.failed_stage, "check/test");

    // The bare rerun refuses: same exit code, but a refusal envelope — no
    // steps ran, the slug names the class, and the red-verdict hint carries
    // the recovery (fix it, or probe deliberately).
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 1, rerun.output);
    const env = parseJson(rerun.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.error, UNCHANGED_TREE_RERUN_SLUG);
    assertEquals(env.steps, undefined, "a refusal must run nothing");
    assertStringIncludes(env.message, "--rerun");
    assertHasHint(env, HINTS["done-unchanged-tree-red"]);

    // The attestation re-runs the real gate: the verdict is red again with the
    // job's own diagnostics, not a refusal.
    const probed = await runAgent(wt, ["done", "--rerun", "--json"]);
    assertEquals(probed.code, 1, probed.output);
    const probedEnv = parseJson(probed.stdout);
    assertEquals(probedEnv.error, undefined);
    assertEquals(probedEnv.data.failed_stage, "check/test");
  });
});

Deno.test("done: current green Proof is reused on JSON, Markdown, human, and in-process surfaces", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstEnv = parseJson(first.stdout);
    assertEquals(firstEnv.data.gate_ran, true);

    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    const env = parseJson(rerun.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.steps, undefined, "Proof reuse executes zero Gate steps");
    assertEquals(env.data.gate_ran, false);
    assertEquals(env.data.proof, firstEnv.data.proof);
    assertStringIncludes(env.message, "no Gate job ran");

    const markdown = await runAgent(wt, ["done", "--markdown"]);
    assertEquals(markdown.code, 0, markdown.output);
    assertTerminalTextIncludes(markdown.output, "no Gate job ran");
    assertStringIncludes(markdown.output, "Proof");

    const human = await runAgent(wt, ["done"]);
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.output, "no Gate job ran");

    const inProcess = await finishResult(wt, {
      surface: { kind: "quiet" },
    });
    assertEquals(inProcess.ok, true);
    assertEquals(inProcess.data?.gate_ran, false);
    assertEquals(inProcess.steps, undefined);
  });
});

Deno.test("done: Proof reuse executes zero configured fix, check, test, or Standard jobs", async () => {
  await withTempDir(async (dir) => {
    const config = [
      "[project]",
      'slug = "engine-test"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[jobs]",
      'format = "sh format-count.sh"',
      'test = "sh test-count.sh"',
      "",
      "[jobs.custom-check]",
      'stage = "check"',
      'run = "sh check-count.sh"',
      "",
      "[standards.size]",
      'direction = "down"',
      "limit = 1",
      'run = "sh standard-count.sh"',
      "",
    ].join("\n");
    await scaffoldEngine(dir);
    await writeConfig(dir, config);
    for (const name of ["format", "check", "test"]) {
      await writeExecutable(
        join(dir, `${name}-count.sh`),
        `#!/usr/bin/env sh\nprintf x >> ../${name}-count\n`,
      );
    }
    await writeExecutable(
      join(dir, "standard-count.sh"),
      "#!/usr/bin/env sh\nprintf x >> ../standard-count\nprintf 'DISCERN_METRIC size 1\\n'\n",
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "rerun-effects");
    await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const counts = ["format", "check", "test", "standard"];
    const before = await Promise.all(
      counts.map((name) => Deno.readTextFile(join(wt, "..", `${name}-count`))),
    );

    const reused = await runAgent(wt, ["done", "--json"]);
    assertEquals(reused.code, 0, reused.output);
    assertEquals(parseJson(reused.stdout).data.gate_ran, false);
    const after = await Promise.all(
      counts.map((name) => Deno.readTextFile(join(wt, "..", `${name}-count`))),
    );
    assertEquals(after, before, "reuse must execute no configured effect");
  });
});

Deno.test("done: any change to the tree runs the gate normally — commit, edit, or a dirty-tree edit", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // An uncommitted edit is a different tree: no refusal.
    await Deno.writeTextFile(join(wt, "feature.txt"), "revised work\n");
    const dirty = await runAgent(wt, ["done", "--json"]);
    assertEquals(dirty.code, 0, dirty.output);
    assertEquals(parseJson(dirty.stdout).error, undefined);

    // The same dirty tree unchanged IS a rerun: dirty identity counts too.
    const dirtyRerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(parseJson(dirtyRerun.stdout).error, UNCHANGED_TREE_RERUN_SLUG);

    // Committing moves the identity again: no refusal.
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feat: revise", "--no-gpg-sign");
    const committed = await runAgent(wt, ["done", "--json"]);
    assertEquals(committed.code, 0, committed.output);
    assertEquals(parseJson(committed.stdout).error, undefined);
  });
});

Deno.test("done: --dry-run never refuses, and never counts as the previous run", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // Previewing the plan on the judged tree is read-only and always allowed…
    const preview = await runAgent(wt, ["done", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(parseJson(preview.stdout).error, undefined);

    // …and does not overwrite what the last REAL run judged: current Proof is
    // still reused afterward, rather than evidence being invented by preview.
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(parseJson(rerun.stdout).data.gate_ran, false);
  });
});

Deno.test("done: --rerun and the --confirmed compatibility alias both execute the in-process Gate", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    const reused = await finishResult(wt, {
      surface: { kind: "quiet" },
    });
    assertEquals(reused.ok, true);
    assertEquals(reused.data?.gate_ran, false);

    const rerun = await finishResult(wt, {
      surface: { kind: "quiet" },
      rerun: true,
    });
    assertEquals(rerun.ok, true, JSON.stringify(rerun));
    assertEquals(rerun.data?.gate_ran, true);

    const confirmed = await finishResult(wt, {
      surface: { kind: "quiet" },
      confirmed: true,
    });
    assertEquals(confirmed.ok, true, JSON.stringify(confirmed));
    assertEquals(confirmed.data?.gate_ran, true);
  });
});

Deno.test("done: the last-run marker lives in the worktree's git admin dir and a broken marker fails open", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    const markerPath = await gitAdminStatePath(wt, "lastGateRun");
    assert(markerPath !== undefined, "the marker path must resolve");
    const marker = JSON.parse(await Deno.readTextFile(markerPath));
    assertEquals(marker.passed, true);
    assertEquals(marker.head, (await gitOut(wt, "rev-parse", "HEAD")).trim());

    // Canonical Proof, not the last-run marker, is the reuse authority.
    await Deno.writeTextFile(markerPath, "not json\n");
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    assertEquals(parseJson(rerun.stdout).data.gate_ran, false);
  });
});

for (
  const evidenceCase of [
    {
      name: "missing",
      mutate: async (path: string): Promise<void> => await Deno.remove(path),
    },
    {
      name: "stale",
      mutate: async (path: string): Promise<void> => {
        const raw = await Deno.readTextFile(path);
        await Deno.writeTextFile(path, raw.replace(/^[^\n]+/, "0".repeat(40)));
      },
    },
    {
      name: "unreadable",
      mutate: async (path: string): Promise<void> => {
        await Deno.remove(path);
        await Deno.mkdir(path);
      },
    },
    {
      name: "incomplete",
      mutate: async (path: string): Promise<void> => {
        const raw = await Deno.readTextFile(path);
        await Deno.writeTextFile(path, `${raw.split("\n")[0]}\n`);
      },
    },
  ] as const
) {
  Deno.test(`done: ${evidenceCase.name} Proof never enters the green reuse path`, async () => {
    await withTempDir(async (dir) => {
      const wt = await worktreeWithWork(dir, GREEN_CONFIG);
      assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
      const proofPath = await gitAdminStatePath(wt, "gateProof");
      assert(proofPath !== undefined);
      await evidenceCase.mutate(proofPath);

      const result = await runAgent(wt, ["done", "--json"]);
      assertEquals(result.code, 1, result.output);
      const envelope = parseJson(result.stdout);
      assertEquals(envelope.error, UNCHANGED_TREE_RERUN_SLUG);
      assertEquals(envelope.data?.gate_ran, undefined);
    });
  });
}
