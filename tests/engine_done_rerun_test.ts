/**
 * The exact-state `done` contract. Canonical current green Proof is reusable
 * without executing any Gate effect; red or incomplete evidence never becomes
 * green through repetition. `--rerun` is the precise deliberate-execution
 * spelling. Any change to the tree runs normally, and `--dry-run` remains a
 * read-only preview.
 *
 * Every green journey starts from one worktree carrying one committed change
 * and one real Gate run (~10s each), so the read-only reuse checks share one
 * such fixture as steps — each restoring the evidence it perturbs — and the
 * tree-changing checks chain on another. Each step carries the name of the
 * case it replaced, so a failure still names the behaviour.
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
import { refreshScaffold } from "./engine_done_fixture.ts";
import {
  gateProofHonored,
  UNCHANGED_TREE_RERUN_SLUG,
} from "../src/engine/gate/proof.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import type { GateWireData } from "../src/shared/result_schemas.ts";
import { z } from "@zod/zod";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

type DoneEnvelope = CliResultForCommand<"done">;

type DoneDataEnvelope = DoneEnvelope & {
  data: GateWireData;
};

const LAST_GATE_RUN_SCHEMA = z.object({
  head: z.string(),
  passed: z.boolean(),
  tree: z.string().optional(),
  evidence: z.string().optional(),
  mode: z.string().optional(),
});

const GATE_PROOF_VERSION_SCHEMA = z.object({
  version: z.number(),
}).passthrough();

/** Decode one done envelope without requiring a gate payload on refusals or previews. */
function parseJson(stdout: string): DoneEnvelope {
  return decodeCliResult(stdout, "done");
}

/** Decode a done result whose assertions consume the gate-owned payload. */
function parseGateJson(stdout: string): DoneDataEnvelope {
  const result = parseJson(stdout);
  assertResultDataKey(result, "failed_stage");
  return result;
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

/** One configured job per gate stage plus a Standard, each counting its runs. */
const COUNTED_CONFIG = [
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

const COUNTED_EFFECTS = ["format", "check", "test", "standard"] as const;

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
  await refreshScaffold(dir);
  const wt = await addWorktree(dir, "rerun");
  await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");
  return wt;
}

/** Like {@link worktreeWithWork}, gated by {@link COUNTED_CONFIG}'s counting scripts. */
async function countedWorktreeWithWork(dir: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, COUNTED_CONFIG);
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
  await refreshScaffold(dir);
  const wt = await addWorktree(dir, "rerun-effects");
  await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");
  return wt;
}

/** Read every configured effect's run count beside the worktree. */
async function effectCounts(wt: string): Promise<string[]> {
  return await Promise.all(
    COUNTED_EFFECTS.map((name) =>
      Deno.readTextFile(join(wt, "..", `${name}-count`))
    ),
  );
}

/** The exact evidence bytes one green Gate run left behind. */
interface GreenEvidence {
  readonly proofPath: string;
  readonly markerPath: string;
  readonly proof: string;
  readonly marker: string;
}

/** Capture the canonical Proof and last-run marker of a worktree just judged green. */
async function captureGreenEvidence(wt: string): Promise<GreenEvidence> {
  const proofPath = await gitAdminStatePath(wt, "gateProof");
  assert(proofPath !== undefined);
  const markerPath = await gitAdminStatePath(wt, "lastGateRun");
  assert(markerPath !== undefined, "the marker path must resolve");
  return {
    proofPath,
    markerPath,
    proof: await Deno.readTextFile(proofPath),
    marker: await Deno.readTextFile(markerPath),
  };
}

/** Put the captured green evidence back so the next step starts from the judged state. */
async function restoreGreenEvidence(
  wt: string,
  evidence: GreenEvidence,
): Promise<void> {
  if (await targetExists(evidence.proofPath)) {
    await Deno.remove(evidence.proofPath, { recursive: true });
  }
  await Deno.writeTextFile(evidence.proofPath, evidence.proof);
  await Deno.writeTextFile(evidence.markerPath, evidence.marker);
  assertEquals(
    await gateProofHonored(wt),
    true,
    "the restored Proof must be current again before the next step",
  );
}

Deno.test("done: an unchanged tree the gate judged RED refuses a bare rerun, and --rerun executes it", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, CHECKED_CONFIG, CHECK_FAILS);

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 1, first.output);
    const firstEnv = parseGateJson(first.stdout);
    assertEquals(firstEnv.data.failed_stage, "test");

    // The bare rerun refuses: same exit code, but a refusal envelope — no
    // steps ran, the slug names the class, and the red-verdict hint carries
    // the recovery (fix it, or probe deliberately).
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 1, rerun.output);
    const env = parseJson(rerun.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.error, "incomplete");
    assertEquals(env.steps ?? [], [], "a refusal must run nothing");
    assert(
      parseGateJson(rerun.stdout).data.completion?.pending?.some((item) =>
        item.kind === "validation-failed"
      ),
    );
    assert(typeof env.message === "string");
    assertStringIncludes((env.hints ?? []).join("\n"), "--rerun");

    // The attestation re-runs the real gate: the verdict is red again with the
    // job's own diagnostics, not a refusal.
    const probed = await runAgent(wt, ["done", "--rerun", "--json"]);
    assertEquals(probed.code, 1, probed.output);
    const probedEnv = parseGateJson(probed.stdout);
    assertEquals(probedEnv.error, "gate_failed");
    assertEquals(probedEnv.data.failed_stage, "test");
  });
});

/** The evidence states that must never be mistaken for current green Proof. */
const EVIDENCE_CASES = [
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
      const record = decodeWith(GATE_PROOF_VERSION_SCHEMA, raw);
      await Deno.writeTextFile(
        path,
        `${JSON.stringify({ version: record.version })}\n`,
      );
    },
  },
] as const;

Deno.test("done: current green Proof is reused on every surface without any Gate effect, and no other evidence enters the reuse path", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await countedWorktreeWithWork(dir);

    const first = await runAgent(wt, ["done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstEnv = parseGateJson(first.stdout);
    assertEquals(firstEnv.data.gate_ran, true);
    const before = await effectCounts(wt);
    const evidence = await captureGreenEvidence(wt);

    await t.step(
      "done: current green Proof is reused on JSON, Markdown, human, and in-process surfaces",
      async () => {
        const rerun = await runAgent(wt, ["done", "--json"]);
        assertEquals(rerun.code, 0, rerun.output);
        const env = parseGateJson(rerun.stdout);
        assertEquals(env.ok, true);
        assertEquals(
          env.steps,
          undefined,
          "Proof reuse executes zero Gate steps",
        );
        assertEquals(env.data.gate_ran, false);
        assertEquals(env.data.proof, firstEnv.data.proof);
        assert(typeof env.message === "string");
        assertStringIncludes(env.message, "no gate job ran");

        const markdown = await runAgent(wt, ["done", "--markdown"]);
        assertEquals(markdown.code, 0, markdown.output);
        assertTerminalTextIncludes(markdown.output, "no gate job ran");
        assertStringIncludes(markdown.output, "Proof");

        const human = await runAgent(wt, ["done"]);
        assertEquals(human.code, 0, human.output);
        assertTerminalTextIncludes(human.output, "no gate job ran");

        const inProcess = await finishResult(wt, {
          surface: { kind: "quiet" },
          cliModel: TEST_CLI_MODEL,
        });
        assertEquals(inProcess.ok, true);
        assertEquals(inProcess.data?.gate_ran, false);
        assertEquals(inProcess.steps, undefined);
      },
    );

    await t.step(
      "done: Proof reuse executes zero configured fix, check, test, or Standard jobs",
      async () => {
        const reused = await runAgent(wt, ["done", "--json"]);
        assertEquals(reused.code, 0, reused.output);
        assertEquals(parseGateJson(reused.stdout).data.gate_ran, false);
        // Every reuse so far — JSON, Markdown, human, in-process — ran nothing.
        assertEquals(
          await effectCounts(wt),
          before,
          "reuse must execute no configured effect",
        );
      },
    );

    await t.step(
      "done: --dry-run never refuses, and never counts as the previous run",
      async () => {
        // Previewing the plan on the judged tree is read-only and always allowed…
        const preview = await runAgent(wt, ["done", "--dry-run", "--json"]);
        assertEquals(preview.code, 0, preview.output);
        assertEquals(parseJson(preview.stdout).error, undefined);

        // …and does not overwrite what the last REAL run judged: current Proof is
        // still reused afterward, rather than evidence being invented by preview.
        const rerun = await runAgent(wt, ["done", "--json"]);
        assertEquals(parseGateJson(rerun.stdout).data.gate_ran, false);
      },
    );

    await t.step(
      "done: the last-run marker lives in the worktree's git admin dir and a broken marker fails open",
      async () => {
        const marker = decodeWith(
          LAST_GATE_RUN_SCHEMA,
          await Deno.readTextFile(evidence.markerPath),
        );
        assertEquals(marker.passed, true);
        assertEquals(
          marker.head,
          (await gitOut(wt, "rev-parse", "HEAD")).trim(),
        );

        // Canonical Proof, not the last-run marker, is the reuse authority.
        await Deno.writeTextFile(evidence.markerPath, "not json\n");
        const rerun = await runAgent(wt, ["done", "--json"]);
        assertEquals(rerun.code, 0, rerun.output);
        assertEquals(parseGateJson(rerun.stdout).data.gate_ran, false);
        await restoreGreenEvidence(wt, evidence);
      },
    );

    for (const evidenceCase of EVIDENCE_CASES) {
      await t.step(
        `done: ${evidenceCase.name} Proof never enters the green reuse path`,
        async () => {
          await evidenceCase.mutate(evidence.proofPath);

          const result = await runAgent(wt, ["done", "--json"]);
          assertEquals(result.code, 1, result.output);
          const envelope = parseJson(result.stdout);
          if (evidenceCase.name === "unreadable") {
            assertEquals(envelope.error, "gate_failed", result.output);
            assertEquals(
              parseGateJson(result.stdout).data.failed_stage,
              "write_denied",
              result.output,
            );
            assertEquals(parseGateJson(result.stdout).data.proof, undefined);
            assert(
              !(envelope.steps ?? []).some((step) => step.outcome === "ok"),
            );
          } else {
            assertEquals(envelope.error, UNCHANGED_TREE_RERUN_SLUG);
            assertEquals(envelope.steps, undefined);
          }
          await restoreGreenEvidence(wt, evidence);
        },
      );
    }
  });
});

Deno.test("done: any change to the tree runs the gate normally, and --rerun is the sole explicit Gate rerun input", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithWork(dir, GREEN_CONFIG);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    await t.step(
      "done: any change to the tree runs the gate normally — commit, edit, or a dirty-tree edit",
      async () => {
        // Uncommitted feedback requires the explicit diagnostic route.
        await Deno.writeTextFile(join(wt, "feature.txt"), "revised work\n");
        const dirty = await runAgent(wt, ["done", "--standalone", "--json"]);
        assertEquals(dirty.code, 0, dirty.output);
        assertEquals(parseJson(dirty.stdout).error, undefined);

        // Dirty diagnostics remain available; they never reuse or publish queue Proof.
        const dirtyRerun = await runAgent(wt, [
          "done",
          "--standalone",
          "--json",
        ]);
        assertEquals(dirtyRerun.code, 0, dirtyRerun.output);
        assertEquals(parseGateJson(dirtyRerun.stdout).data.proof, undefined);

        // Committing moves the identity again: no refusal.
        await git(wt, "add", "-A");
        await git(wt, "commit", "-q", "-m", "feat: revise", "--no-gpg-sign");
        const committed = await runAgent(wt, ["done", "--json"]);
        assertEquals(committed.code, 0, committed.output);
        assertEquals(parseJson(committed.stdout).error, undefined);
      },
    );

    await t.step(
      "done: --rerun is the sole explicit Gate rerun input",
      async () => {
        // The committed tree was just judged green, so the bare run reuses it…
        const reused = await finishResult(wt, {
          surface: { kind: "quiet" },
          cliModel: TEST_CLI_MODEL,
        });
        assertEquals(reused.ok, true);
        assertEquals(reused.data?.gate_ran, false);

        // …and only the explicit spelling executes the Gate again.
        const rerun = await finishResult(wt, {
          surface: { kind: "quiet" },
          cliModel: TEST_CLI_MODEL,
          rerun: true,
        });
        assertEquals(rerun.ok, true, JSON.stringify(rerun));
        assertEquals(rerun.data?.gate_ran, true);

        const retired = await runAgent(wt, ["done", "--confirmed", "--json"]);
        assertEquals(retired.code, 2, retired.output);
        assertTerminalTextIncludes(retired.stdout, "Unknown option");
      },
    );
  });
});
