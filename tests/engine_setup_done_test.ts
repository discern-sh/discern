/**
 * Engine tests for the `setup done` flow and its follow-through: the gate
 * proof, the worktree probe, the completion-marker commits, pre-existing
 * agent-file migration, agent detection, the laid map, branch isolation, and
 * the setup brief's teaching. Split from `engine_setup_test.ts` so
 * `deno test --parallel` (which distributes per FILE) can spread these serial
 * setup runs across workers.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, relative } from "@std/path";
import { walk } from "@std/fs";
import { targetExists } from "../src/shared/fs_presence.ts";
import {
  assertTerminalTextIncludes,
  REAL_TEMPLATES,
  withTempDir,
} from "./helpers.ts";
import {
  defaultMapPath,
  git,
  gitInit,
  gitOut,
  parsedCommitTrailers,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  AGENT_NAMES,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { allInstructionFilePaths, providerFor } from "../src/lib/providers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { INSTRUCTIONS_H1 } from "./engine_setup_shared.ts";
import { SETUP_BRANCH } from "../src/shared/setup_state.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { SETUP_RESULT_MAX_CHARS } from "../src/shared/setup_pages.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { readyForSetupDone } from "./fixtures/setup_completion_harness.ts";
import { realPtyTest } from "./real_pty.ts";

const CSI = `${String.fromCharCode(27)}[`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const REPAINT = `${CSI}1G`;

/** Replace setup skeletons with substantive fixtures and configure the gate command under test. */
async function readyForDone(
  dir: string,
  cmd: string,
  env: Record<string, string> = {},
): Promise<void> {
  await readyForSetupDone(dir, cmd, env);
}

/** A failed completion reports setup incomplete and leaves no current Proof. */
async function assertIncompleteWithoutProof(
  dir: string,
  context: string,
): Promise<void> {
  const config = parseConfigOrThrow(
    await Deno.readTextFile(join(dir, "discern.toml")),
  );
  assertEquals(config.meta.bootstrapped, false, context);
  assert(
    (await inspectGateProof(dir)).status !== "honored",
    `${context}: a failed completion must not leave current Proof`,
  );
}

Deno.test("setup done runs the gate and records bootstrapped only when green (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // a passing gate
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "bootstrapped");
    assertEquals(res.ok, true);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(
      res.data.gate_proven,
      true,
      "the gate was the completion proof",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("setup done refuses denied planned writes before refresh, commit, worktree probe, or Gate", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "touch ../done-gate-ran");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const configPath = join(dir, "discern.toml");
    const configBefore = await Deno.readTextFile(configPath);
    const headBefore = await gitOut(dir, "rev-parse", "HEAD");
    const gitDir = join(dir, ".git");
    const originalMode = (await Deno.stat(gitDir)).mode;
    assert(originalMode !== null);
    await Deno.chmod(gitDir, 0o555);
    try {
      const denied = await runAgent(dir, ["setup", "done", "--json"]);
      assertEquals(denied.code, 1, denied.output);
      const envelope = decodeCliResult(denied.stdout, "setup done");
      assert(envelope.message !== undefined);
      assertEquals(envelope.error, "write_access");
      assertEquals(envelope.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        envelope.diagnostics?.[0]?.reproduce_cmd,
        "discern setup done",
      );
      assertStringIncludes(envelope.message, gitDir);
      assertEquals(await Deno.readTextFile(configPath), configBefore);
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
      assertEquals(await targetExists(join(dir, "..", "done-gate-ran")), false);
      assertEquals((await inspectGateProof(dir)).status, "missing");
    } finally {
      await Deno.chmod(gitDir, originalMode & 0o777);
    }
  });
});

Deno.test("successful setup done binds Proof and the worktree probe to the marker-bearing HEAD", async () => {
  await withTempDir(async (dir) => {
    const observedHeads = join(
      dirname(dir),
      `${crypto.randomUUID()}-setup-heads`,
    );
    await readyForDone(
      dir,
      `git rev-parse HEAD >> ${JSON.stringify(observedHeads)}`,
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const authoredHead = await gitOut(dir, "rev-parse", "HEAD");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const result = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(result, "bootstrapped");
    const completedHead = await gitOut(dir, "rev-parse", "HEAD");

    assert(
      completedHead !== authoredHead,
      "setup done must commit the completion marker before recording Proof",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
    assert(result.data.proof !== undefined);
    assert(result.data.proof.proof_data !== undefined);
    assertEquals(result.data.marker_committed, true);
    assertEquals(result.data.proof.status, "honored");
    assertEquals(result.data.proof.head, completedHead);
    assertEquals(result.data.proof.proof_data.head, completedHead.slice(0, 12));
    assertEquals(result.data.proof_line, result.data.proof.proof_line);

    const heads = (await Deno.readTextFile(observedHeads)).trim().split("\n");
    assert(
      heads.length >= 2,
      `the configured Gate must run in the probe and final checkout: ${heads}`,
    );
    for (const head of heads) {
      assertEquals(
        head,
        completedHead,
        "every completion check must read the marker-bearing commit",
      );
    }
    assertEquals(
      await gitOut(dir, "status", "--porcelain"),
      "",
      "successful completion must return a clean final tree",
    );
  });
});

Deno.test("setup done human output relays the same canonical Proof line stored for structured consumers", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);
    const proof = await inspectGateProof(dir);
    assertEquals(proof.status, "honored");
    assert(proof.proof_line !== undefined);
    assertStringIncludes(done.stdout, proof.proof_line);
    assert(
      done.stdout.length <= SETUP_RESULT_MAX_CHARS,
      `setup done human output exceeded ${SETUP_RESULT_MAX_CHARS} characters`,
    );
  });
});

realPtyTest({
  name: "setup done TTY uses the live activity frame for both composite gates",
  contracts: ["platform-transport"],
  canary: false,
  fn: async () => {
    await withTempDir(async (dir) => {
      await readyForDone(dir, "sleep 1");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

      const done = await runAgentPty(dir, ["setup", "done"], {
        env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      });
      assertEquals(done.code, 0, done.output);

      const probeLead = done.stdout.indexOf(
        "Proving your project runs inside a worktree",
      );
      const probeFrame = done.stdout.indexOf(HIDE_CURSOR, probeLead);
      const finalFrame = done.stdout.indexOf(HIDE_CURSOR, probeFrame + 1);
      assert(
        probeLead >= 0 && probeFrame > probeLead && finalFrame > probeFrame,
        done.output,
      );
      for (
        const [start, end] of [
          [probeFrame, finalFrame],
          [finalFrame, done.stdout.length],
        ] as const
      ) {
        const transcript = done.stdout.slice(start, end);
        assertStringIncludes(transcript, REPAINT);
        assertTerminalTextIncludes(transcript, "test started");
        assertTerminalTextIncludes(transcript, "test passed");
        assertStringIncludes(transcript, SHOW_CURSOR);
        assertEquals(transcript.includes("Gate progress"), false);
      }
    });
  },
});

Deno.test("setup done blocks when the refresh proof only partially completes", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);
    // Committed sabotage: the clean-tree precondition passes, so the failure
    // surfaces at the refresh stage of the proof, not as uncommitted work.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "stage");
    assert(res.message !== undefined);
    assertEquals(res.ok, false);
    assertEquals(res.error, "gate_failed");
    assertEquals(res.data.stage, "refresh");
    assertStringIncludes(res.message, "malformed JSON");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "setup done must not record completion after a partial refresh",
    );
    await assertIncompleteWithoutProof(dir, "refresh failure");
  });
});

Deno.test("setup done doctor and marker-commit failures leave setup incomplete without current Proof", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "discern-test-command-that-does-not-exist");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const headBefore = await gitOut(dir, "rev-parse", "HEAD");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const result = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(result, "rollback");
    assertEquals(result.data.stage, "doctor");
    assertEquals(result.data.rollback, "owned_commit_removed");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
    await assertIncompleteWithoutProof(dir, "doctor failure");
  });

  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const headBefore = await gitOut(dir, "rev-parse", "HEAD");
    await writeExecutable(
      join(dir, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\nexit 1\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const result = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(result, "rollback");
    assertEquals(result.data.stage, "marker_commit");
    assertEquals(result.data.rollback, "not_needed");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    await assertIncompleteWithoutProof(dir, "marker-commit failure");
  });
});

Deno.test("setup done rollback bypasses commit hooks and leaves no transaction history", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "false");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const headBefore = await gitOut(dir, "rev-parse", "HEAD");
    await writeExecutable(
      join(dir, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\nif test -f .git/setup-completion-hook-ran; then exit 1; fi\ntouch .git/setup-completion-hook-ran\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const result = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(result, "rollback");
    assertEquals(result.data.stage, "worktree_probe");
    assertEquals(result.data.rollback, "owned_commit_removed");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    assertEquals(
      (await gitOut(dir, "log", "--format=%s")).includes(
        "Restore incomplete discern setup",
      ),
      false,
    );
    await assertIncompleteWithoutProof(dir, "owned rollback");
  });
});

// ── the clean-tree precondition + the worktree-viability probe (ADR 0090) ────────
// `setup done` proves the gate in the main checkout AND in a throwaway worktree — the
// copy every future task runs in — so an env-anchored app can't pass setup and then
// break on the first real task. The probe branches from the committed marker-bearing
// HEAD. The authored setup must therefore be committed before the marker transaction,
// and the final tree must be fully clean before Proof can be recorded.

Deno.test("setup done refuses while the authored setup is uncommitted, naming what to commit", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // authored — but nothing committed since scaffold

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "uncommitted");
    assert(res.message !== undefined);
    assertEquals(res.ok, false);
    assertEquals(res.error, "uncommitted_changes");
    const uncommitted: string[] = res.data.uncommitted;
    assert(
      uncommitted.some((l) => l.includes("discern.toml")),
      `the wired config must be listed:\n${done.stdout}`,
    );
    assert(
      uncommitted.some((l) => l.includes("discern/")),
      `the authored docs/instructions must be listed:\n${done.stdout}`,
    );
    assertStringIncludes(res.message, "Commit these as your authoring commits");
    // Nothing recorded — status keeps reporting setup unfinished.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "an uncommitted setup must not record completion",
    );

    // Commit the authoring work; the same `done` now proceeds to the proof and passes.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const again = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(again.code, 0, again.output);
    const completed = decodeCliResult(again.stdout, "setup done");
    assertResultDataKey(completed, "bootstrapped");
    assertEquals(completed.data.bootstrapped, true);
  });
});

Deno.test("setup done catches an untracked footprint file whose path git quotes (B50)", async () => {
  // git C-quotes any path with non-ASCII bytes in line-oriented `--porcelain` output
  // (core.quotePath defaults on): `?? "discern/map/d\303\251cisions.md"`. A clean-tree
  // check that de-quotes by hand — slice(2).trim() then startsWith the unquoted footprint
  // prefix — never matches the quoted form, so `done` would proceed and record completion
  // over uncommitted authored work. The end-to-end guard for the `-z` porcelain parsing:
  // a real non-ASCII authored doc must still block completion. Pairs with the unit
  // coverage in git_paths_test.ts and the structural -z guard in git_path_quoting_test.ts.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");

    // Commit ALL the authored setup, so the ONLY uncommitted thing is the non-ASCII doc
    // below — the clean-tree check has exactly one path to catch, and it is a quoted one.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    // An untracked authored doc inside the footprint (the configured map tree) whose
    // name carries a non-ASCII byte, so git quotes it in line-oriented porcelain output.
    const quotedName = "décisions.md";
    await Deno.writeTextFile(
      defaultMapPath(dir, quotedName),
      "# A real authored decision\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "uncommitted");
    assertEquals(res.ok, false);
    assertEquals(
      res.error,
      "uncommitted_changes",
      `a quoted-path untracked footprint file must block completion; got ${done.stdout}`,
    );
    const uncommitted: string[] = res.data.uncommitted;
    assert(
      uncommitted.some((l) => l.includes(quotedName)),
      `the non-ASCII authored doc must be named as uncommitted (verbatim, not a ` +
        `C-quoted mangling):\n${JSON.stringify(uncommitted)}`,
    );
    // Nothing recorded — completion cannot be stamped over the uncommitted authored file.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "completion must not be recorded over an uncommitted quoted-path footprint file",
    );
  });
});

Deno.test("the worktree probe proves the CONFIGURED gate against the authored setup, not an empty tree", async () => {
  await withTempDir(async (dir) => {
    // A gate that can only pass when the AUTHORED content traveled into the probe:
    // before the clean-tree precondition, the probe branched from a HEAD holding
    // none of it and "proved" a vacuously green gate.
    await readyForDone(dir, "grep -q Conventions discern/instructions.md");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "bootstrapped");
    assertEquals(res.data.bootstrapped, true);
    assertEquals(
      res.data.worktree_proven,
      true,
      "the probe must run the configured gate against the authored tree",
    );
  });
});

Deno.test("setup done proves the project viable in a worktree and reports it, then tears the probe down (ADR 0090)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // a marker-free project with a passing gate
    // Commit the setup work so the probe worktree (branched from HEAD) sees the wired
    // config — the atomic-commit discipline the brief asks of the agent.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "bootstrapped");
    assertEquals(res.data.bootstrapped, true);
    assertEquals(
      res.data.worktree_proven,
      true,
      "the probe proved the gate green in a worktree",
    );
    // The throwaway probe left nothing behind — no worktree, no `agent/` branch.
    const worktrees = await gitOut(dir, "worktree", "list", "--porcelain");
    assert(
      !worktrees.includes(".worktrees"),
      `the probe worktree leaked:\n${worktrees}`,
    );
    assertEquals(
      (await gitOut(dir, "branch", "--list", "agent/*")).trim(),
      "",
      "the probe branch leaked",
    );
  });

  // The human render claims the coverage it earned.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);
    assertTerminalTextIncludes(done.stdout, "runs inside a worktree");
  });
});

Deno.test("setup done blocks when the gate is green here but red in a worktree — the env-anchored app (ADR 0090)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    // A smoke check that needs a file present only in the main checkout — the shape of an
    // env-anchored app (an untracked `.env`, an uninstalled dependency dir): it passes
    // here, but the file never travels into a fresh worktree.
    const wired = await runAgent(dir, [
      "config",
      "set-job",
      "smoke",
      "test -f PROBE_ANCHOR",
    ]);
    assertEquals(wired.code, 0, wired.output);
    // Commit the config so `smoke` travels to the probe, but create the anchor AFTER the
    // commit so it stays untracked — present here, absent in the copy.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
    await Deno.writeTextFile(
      join(dir, ".git", "info", "exclude"),
      "\nPROBE_ANCHOR\n",
      { append: true },
    );
    await Deno.writeTextFile(join(dir, "PROBE_ANCHOR"), "present only here\n");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "stage");
    assertEquals(res.ok, false);
    assertEquals(res.error, "gate_failed");
    assertEquals(
      res.data.stage,
      "worktree_probe",
      "the failure names the probe stage, not the main-checkout gate",
    );
    // The proof failed, so completion is NOT recorded — status keeps reporting unfinished.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "bootstrapped must not be recorded when the probe is red",
    );
    await assertIncompleteWithoutProof(dir, "worktree-probe failure");
    // And the probe was still torn down (a red probe must not strand its worktree).
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(
        ".worktrees",
      ),
      "the red probe leaked its worktree",
    );
  });
});

Deno.test("setup done commits the completion marker when discern.toml is the only tracked change", async () => {
  // The completion marker [meta].bootstrapped was written but never committed, so a
  // diligent atomic-commit setup still ended with a dirty tree. Ignored local
  // scratch files (for example an agent's permission/session file) do not enter
  // Proof identity, while the marker commit remains pathspec-limited to discern.toml.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // gitInits + lays a passing, marker-free project
    // Simulate the agent's atomic commits: wire the harness (MCP etc.) and commit
    // everything, so the marker is the only change `done` introduces.
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    await Deno.mkdir(join(dir, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".git", "info", "exclude"),
      "\n.codex/\n",
      { append: true },
    );
    await Deno.writeTextFile(
      join(dir, ".codex/session.local.toml"),
      "permission = 'local'\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "bootstrapped");
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, true);
    // The marker landed in its own commit; the unrelated local scratch remains.
    const status = await gitOut(dir, "status", "--porcelain");
    assertEquals(
      status.includes("discern.toml"),
      false,
      `the marker should be committed independently\n${status}`,
    );
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "Mark discern setup complete",
    );
    assertEquals(await parsedCommitTrailers(dir), DISCERN_MACHINE.trailer);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
    assert(await targetExists(join(dir, ".codex", "session.local.toml")));
  });
});

Deno.test("setup-authored commits omit attribution when DISCERN_NO_ATTRIBUTION is set", async () => {
  await withTempDir(async (dir) => {
    const env = { [DISCERN_NO_ATTRIBUTION]: "1" };
    await readyForDone(dir, "true", env);
    assertEquals(
      await parsedCommitTrailers(dir),
      "",
      "the scaffold-wiring commit should honor the environment opt-out",
    );

    await runAgent(dir, ["refresh"], { env });
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    const done = await runAgent(dir, ["setup", "done", "--json"], { env });
    assertEquals(done.code, 0, done.output);
    const completed = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(completed, "marker_committed");
    assertEquals(completed.data.marker_committed, true);
    assertEquals(
      await parsedCommitTrailers(dir),
      "",
      "the setup-completion commit should honor the environment opt-out",
    );
  });
});

Deno.test("setup done refuses on an uncommitted tracked change; --force still commits only the marker", async () => {
  // A tracked edit anywhere blocks `done` (the clean-tree precondition). Under
  // `--force` — which skips the whole proof — the marker auto-commit's narrower
  // safety invariant still holds: the marker commit includes only discern.toml,
  // and the unrelated edit is left for the agent's own tidy commit.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    // An unrelated uncommitted change present at `done` time.
    await Deno.writeTextFile(
      defaultMapPath(dir, "README.md"),
      "# changed again\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const refused = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(refused, "uncommitted");
    assertEquals(refused.error, "uncommitted_changes");
    assert(
      refused.data.uncommitted.some((l: string) =>
        l.includes(`${SOURCE_PATHS.map.defaultPath}README.md`)
      ),
      `the tracked edit must be listed:\n${done.stdout}`,
    );

    const forced = await runAgent(dir, ["setup", "done", "--force", "--json"]);
    assertEquals(forced.code, 0, forced.output);
    const res = decodeCliResult(forced.stdout, "setup done");
    assertResultDataKey(res, "bootstrapped");
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, true);
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "Mark discern setup complete",
    );
    const status = await gitOut(dir, "status", "--porcelain");
    assertEquals(
      status.includes("discern.toml"),
      false,
      `the marker should be committed independently\n${status}`,
    );
    assertStringIncludes(
      status,
      `M ${SOURCE_PATHS.map.defaultPath}README.md`,
      "the unrelated edit must be left for the agent's own tidy commit",
    );
  });
});

Deno.test("a forced done fails open when discern.toml carries an extra uncommitted edit beyond the marker", async () => {
  // discern.toml is the lone changed file, but it has more than the marker line dirty
  // (config the agent didn't commit). Only "that one dirty line" earns the auto-commit.
  // Reached via --force — the clean-tree precondition refuses this state otherwise.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    // A stray uncommitted edit to discern.toml itself (a comment), beyond the marker.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${toml}\n# stray edit\n`,
    );

    const done = await runAgent(dir, ["setup", "done", "--force", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "bootstrapped");
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, false);
    assert(
      (await gitOut(dir, "status", "--porcelain")).includes("discern.toml"),
      "discern.toml should stay dirty when more than the marker line changed",
    );
  });
});

Deno.test("setup done refuses when the gate is red, recording nothing; --force overrides (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(
      dir,
      'case "$PWD" in *".worktrees/"*) true ;; *) false ;; esac',
    ); // green in the probe, red in the final checkout
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(res, "stage");
    assertEquals(res.error, "gate_failed");
    assertEquals(res.data.stage, "done");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "a red gate must NOT record completion",
    );
    await assertIncompleteWithoutProof(dir, "Gate failure");

    // --force is the escape hatch: it skips the proof and records anyway.
    const forced = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertTerminalTextIncludes(forced.stdout, "the gate was not proven");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("discern setup migrates a pre-existing agent file into instructions.md, never destroying it (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    // A project with its own hand-written CLAUDE.md, harnessed by discern for the
    // first time (a true fresh install — no discern.toml).
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const rule = "ALWAYS RUN THE LINTER FIRST — this is my own house rule.";
    await Deno.writeTextFile(
      join(dir, "CLAUDE.md"),
      `# My project\n\n${rule}\n`,
    );

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The user's instruction survives in the tracked source...
    const instructions = await Deno.readTextFile(
      join(dir, "discern/instructions.md"),
    );
    assertStringIncludes(instructions, rule);
    assertStringIncludes(instructions, "Imported from CLAUDE.md");

    // ...and is re-emitted into the agent files (the compile folds
    // instructions.md into the canonical AGENTS.md, which CLAUDE.md then points at), so
    // reading the agent instructions still shows it — nothing was lost.
    const compiled = (await Promise.all(
      ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map(async (f) =>
        (await readTextIfExists(join(dir, f))) ?? ""
      ),
    )).join("\n");
    assertStringIncludes(compiled, rule);
  });
});

Deno.test("discern setup migrates EVERY provider's pre-existing instruction file — configured or not (the verify promise)", async () => {
  // `setup verify` names the pre-existing instruction files of ALL known
  // providers and promises "begin preserves them by folding their content into
  // the instruction source — nothing is lost". The migration must therefore cover
  // the full provider registry, not just the configured agent set: a
  // hand-authored file for an unwired agent is otherwise never folded, becomes
  // gitignored by the scaffold, and a later `discern uninstall` deletes it.
  // Driven off allInstructionFilePaths() (the registry aggregator `verify` reads),
  // so a new provider's instruction path auto-enrols in this guard.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    // Written AFTER the init commit, so each file is UNTRACKED — the fresh-repo
    // shape where a dropped migration is unrecoverable (no git history holds it).
    const paths = allInstructionFilePaths();
    for (const rel of paths) {
      await Deno.writeTextFile(
        join(dir, rel),
        `# ${rel}\n\nHOUSE RULE from ${rel}: never break userspace.\n`,
      );
    }
    // Wire ONLY claude_code, so every other provider's file belongs to an
    // unconfigured agent — the set the migration used to silently skip.
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);

    const instructions = await Deno.readTextFile(
      join(dir, "discern/instructions.md"),
    );
    for (const rel of paths) {
      assertStringIncludes(
        instructions,
        `HOUSE RULE from ${rel}`,
        `the pre-existing ${rel} must be folded into instructions.md whether or not ` +
          `its agent is configured — verify promised the user nothing is lost.`,
      );
      assertStringIncludes(instructions, `Imported from ${rel}`);
    }
  });
});

Deno.test("instruction adoption reports the conflict, preserves policy links, and emits exact pointers", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const paths = allInstructionFilePaths();
    for (const rel of paths) {
      const guide = `${rel.toLowerCase().replaceAll(".", "-")}-guide.md`;
      await Deno.writeTextFile(
        join(dir, rel),
        `# Existing ${rel}\n\nPOLICY FROM ${rel}: keep it.\n\n[Local guide](./${guide})\n`,
      );
    }

    const verify = await runAgent(dir, ["setup", "verify", "--json"]);
    assertEquals(verify.code, 0, verify.output);
    const verification = decodeCliResult(verify.stdout, "setup verify");
    assertResultDataKey(verification, "phase");
    assert(verification.data.conflicts !== undefined);
    assert(verification.data.findings !== undefined);
    assertEquals(
      verification.data.conflicts.some((conflict) =>
        conflict.kind === "existing_instructions"
      ),
      true,
      verify.stdout,
    );
    assertEquals(
      [...verification.data.findings.existing_instructions].sort(),
      [...paths].sort(),
    );

    const begin = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(begin.code, 0, begin.output);
    const instructions = await Deno.readTextFile(
      join(dir, SOURCE_PATHS.instructions.defaultPath),
    );
    const compiled = await Deno.readTextFile(join(dir, "AGENTS.md"));
    for (const rel of paths) {
      const guide = `${rel.toLowerCase().replaceAll(".", "-")}-guide.md`;
      assertStringIncludes(instructions, `POLICY FROM ${rel}: keep it.`);
      assertStringIncludes(
        instructions,
        `[Local guide](../${guide})`,
        `moving ${rel} into the authored source must preserve its root-relative target`,
      );
      assertStringIncludes(compiled, `POLICY FROM ${rel}: keep it.`);
      assertStringIncludes(
        compiled,
        `[Local guide](${guide})`,
        `compiling the adopted ${rel} policy must restore its original target`,
      );
    }
    for (const rel of paths.filter((path) => path !== "AGENTS.md")) {
      assertEquals(
        await Deno.readTextFile(join(dir, rel)),
        "@AGENTS.md\n",
        `${rel} must retain the provider pointer contract after adoption`,
      );
    }
  });
});

/**
 * Run `fn` with a PATH containing a fake executable named `name`. The executable
 * may be a terminal-agent launcher or a setup-only editor command.
 */
async function withFakeAgentPath<T>(
  name: string,
  fn: (path: string) => T | Promise<T>,
): Promise<T> {
  return await withTempDir(async (bin) => {
    const exe = join(bin, name);
    await Deno.writeTextFile(exe, "#!/bin/sh\n");
    await Deno.chmod(exe, 0o755);
    return await fn(`${bin}:${Deno.env.get("PATH") ?? ""}`);
  }, { prefix: "discern-fakebin-" });
}

Deno.test("discern setup persists an editor-only Cursor installation into [project].agents", async () => {
  // The resolver is unit-tested; this proves the SETUP WIRING — freshInstall &&
  // no --agents → write the detected set into discern.toml — actually lands, so a
  // future setup refactor cannot silently drop IDE installation evidence.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // a clean repo → setup runs its normal fresh-install path

    // `cursor` is the editor shell command, not the separate `cursor-agent`
    // terminal launcher. This is the end-to-end form of the reported regression.
    await withFakeAgentPath("cursor", async (path) => {
      const r = await runAgent(
        dir,
        ["setup", "begin", "--confirmed", "--json"],
        {
          env: { PATH: path },
        },
      );
      assertEquals(r.code, 0, r.output);

      // cursor ∉ DEFAULT_AGENTS, so it is in the WRITTEN config only via detection.
      // `[project].agents` is optional (unset ≠ explicit []); detection writes an
      // explicit list, so it must be present here — an absent key would itself be
      // the regression this guards.
      const agents = parseConfigOrThrow(
        await Deno.readTextFile(join(dir, "discern.toml")),
      ).project.agents;
      assert(
        agents !== undefined && agents.includes("cursor"),
        `the editor-only Cursor installation must be persisted to [project].agents — ` +
          `a setup refactor dropping IDE evidence fails here. Got: ${
            JSON.stringify(agents)
          }`,
      );
    });
  });
});

Deno.test("discern setup honours an explicit --agents over installation detection (the agents-unset guard)", async () => {
  // The other half of the condition: when the user NAMES agents, detection is
  // skipped (`effectiveFlags.agents === undefined` is false), so a detected-but-
  // unrequested agent never sneaks into the config.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    await withFakeAgentPath("gemini", async (path) => { // detected as installed…
      const r = await runAgent(
        dir,
        ["setup", "--confirmed", "--json", "--agents", "claude_code"], // …but the user named agents
        { env: { PATH: path } },
      );
      assertEquals(r.code, 0, r.output);

      const agents = parseConfigOrThrow(
        await Deno.readTextFile(join(dir, "discern.toml")),
      ).project.agents;
      assertEquals(
        agents,
        ["claude_code"],
        `an explicit --agents must win over detection (gemini is installed but unrequested); got: ${
          JSON.stringify(agents)
        }`,
      );
    });
  });
});

Deno.test("discern setup lays a marked instructions.md stub that setup done enforces (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The stub exists and carries the marker, so it is a real "flesh out the stub".
    const instructions = await Deno.readTextFile(
      join(dir, "discern/instructions.md"),
    );
    assertStringIncludes(instructions, "setup fills this");

    // setup done refuses while the instruction stub is unfilled — the existing marker
    // check now enforces instructions.md, with no second code path.
    const blocked = await runAgent(dir, ["setup", "done"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertStringIncludes(blocked.stderr, "instructions.md");
  });
});

Deno.test("discern setup preserves the project name's casing in the scaffolded files (ADR 0065)", async () => {
  await withTempDir(async (parent) => {
    // A directory whose name carries deliberate camelCase the lowercase slug loses.
    const dir = join(parent, "ListOfListsOfLists");
    await Deno.mkdir(dir);
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // TODO.md carries the original casing, not the slug-reconstructed
    // "Listoflistsoflists".
    const todo = await Deno.readTextFile(join(dir, "discern/TODO.md"));
    assertStringIncludes(todo, "ListOfListsOfLists");
    assert(!todo.includes("Listoflistsoflists"), todo);
  });
});

Deno.test("the laid TODO.md starts empty instead of seeding generic documentation work", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    const todo = await Deno.readTextFile(join(dir, "discern/TODO.md"));
    assert(
      !/^- \[ \]/m.test(todo),
      `a fresh ledger must not invent unresolved work:\n${todo}`,
    );
    assertStringIncludes(todo, "concrete unresolved decisions or defects");
  });
});

Deno.test("setup's _adr skeleton is byte-identical to the discern-write-adr skill's (single source)", async () => {
  for (const f of ["README.md", "0000-template.md"]) {
    const setupCopy = await Deno.readTextFile(
      join(REAL_TEMPLATES, "setup", "skeleton", "docs", "_adr", f),
    );
    const skillCopy = await Deno.readTextFile(
      join(
        REAL_TEMPLATES,
        "skills",
        "discern-write-adr",
        "skeleton",
        "docs",
        "_adr",
        f,
      ),
    );
    assertEquals(
      setupCopy,
      skillCopy,
      `templates/setup/skeleton/docs/_adr/${f} must stay identical to the discern-write-adr skill's copy`,
    );
  }
});

Deno.test("scaffolded docs contain no dead relative links — setup ships what it references (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    const dead: string[] = [];
    for await (
      const entry of walk(defaultMapPath(dir), {
        exts: [".md"],
        includeDirs: false,
      })
    ) {
      // Strip code (fenced + inline) first, so an illustrative link inside a code
      // example — `[some module](../src/path/Thing.ext)` — isn't read as a real link.
      const text = (await Deno.readTextFile(entry.path))
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "");
      for (const m of text.matchAll(linkRe)) {
        const raw = m[1];
        if (raw === undefined) continue;
        // The bare URL: drop any "title" suffix and trailing #anchor.
        const target = (raw.trim().split(/\s+/)[0] ?? "").split("#")[0] ?? "";
        if (target === "" || /^(https?:|mailto:)/.test(target)) continue;
        // A leading "/" is repo-root-relative; otherwise relative to the file.
        const resolved = target.startsWith("/")
          ? join(dir, target.slice(1))
          : join(dirname(entry.path), target);
        if (!(await targetExists(resolved))) {
          dead.push(`${relative(dir, entry.path)} → ${raw}`);
        }
      }
    }
    assertEquals(
      dead,
      [],
      `dead links in scaffolded docs:\n${dead.join("\n")}`,
    );
  });
});

Deno.test("discern setup isolates a fresh install on the discern-setup branch (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // commits everything → a clean tree on `main`
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );

    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    // Setup created and checked out a dedicated branch, off the user's `main`, so
    // the scaffold's commits never land on it.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "discern-setup",
    );
    const result = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(result, "branch");
    assertEquals(result.data.branch, "discern-setup");
    assert(await targetExists(join(dir, "discern.toml")));
  });
});

Deno.test("discern setup begin refuses to start from a feature branch when the trunk exists", async () => {
  // A setup branch forks from the CURRENT HEAD, and `setup accept` later
  // fast-forwards the integration branch to it — so a setup begun on a
  // feature branch would sweep that branch's unmerged commits onto `main`.
  // begin must refuse and name the exact recovery, leaving the tree untouched.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // commits on `main`
    // A remote default branch so detection picks `main` even from feature-x.
    const sha = await gitOut(dir, "rev-parse", "main");
    await git(dir, "update-ref", "refs/remotes/origin/main", sha);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    await git(dir, "checkout", "-q", "-b", "feature-x");
    await Deno.writeTextFile(join(dir, "wip.txt"), "unfinished feature\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "feature WIP", "--no-gpg-sign");

    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(
      decodeCliResult(r.stdout, "setup begin").error,
      "not_on_trunk",
    );

    // Nothing was scaffolded and no setup branch was created.
    assert(!(await targetExists(join(dir, "discern.toml"))));
    assertEquals(await gitOut(dir, "branch", "--show-current"), "feature-x");
    const branches = await gitOut(dir, "branch", "--format=%(refname:short)");
    assert(!branches.includes("discern-setup"));
  });
});

Deno.test("discern setup begin commits the scaffolded machinery, leaving docs/instructions/TODO for the agent", async () => {
  // The cold-setup failure this fixes: a coding agent's safety classifier refuses to
  // commit discern's own permission-widening wiring (.mcp.json / .claude/settings.json
  // pre-approve an MCP server), so setup ended on a dirty tree with discern's essentials
  // uncommitted. `begin` now OWNS that commit — extending the `setup done` marker-commit
  // precedent — committing exactly the machinery and nothing the agent authors.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // clean tree on `main`

    // Pin the agent set so the machinery footprint is deterministic (claude_code →
    // .mcp.json + .claude/settings.json), not whatever the CI host has on PATH.
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(result, "machinery_committed");
    assertEquals(result.data.machinery_committed, true);

    // One commit, on the isolated branch, with the agreed message.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "discern-setup",
    );
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "discern: scaffold wiring",
    );
    assertEquals(await parsedCommitTrailers(dir), DISCERN_MACHINE.trailer);
    assertEquals(
      await gitOut(
        dir,
        "log",
        "-1",
        "--format=%an <%ae>|%cn <%ce>",
      ),
      "Engine Test <engine-test@example.com>|Engine Test <engine-test@example.com>",
      "discern must leave the invoking user's author and committer identities intact",
    );

    // The commit holds EXACTLY discern's machinery — the config, managed Git
    // blocks, and per-agent MCP + hooks files — so an exact match proves both
    // that the wiring is committed AND that no authored content was swept in.
    const committed =
      (await gitOut(dir, "show", "--name-only", "--format=", "HEAD"))
        .split("\n").map((s) => s.trim()).filter(Boolean).sort();
    assertEquals(committed, [
      ".claude/settings.json",
      ".gitattributes",
      ".gitignore",
      ".mcp.json",
      "discern.toml",
    ]);

    // The authored-content seeds the agent fills are deliberately left UNCOMMITTED
    // (untracked) — discern committed its wiring, not the agent's canvas.
    // -uall expands the untracked discern/ dir so each seed is listed per-file.
    const untracked = await gitOut(dir, "status", "--porcelain", "-uall");
    for (
      const seed of [
        "discern/instructions.md",
        "discern/TODO.md",
        SOURCE_PATHS.map.defaultPath,
      ]
    ) {
      assertStringIncludes(untracked, seed);
    }
  });
});

Deno.test("discern setup begin commits EVERY registry-listed agent's scaffoldable config file (B10)", async () => {
  // Structural guard, in the spirit of agent_parity_test.ts: derive each agent's
  // expected machinery files from PROVIDERS itself — never a hand-copied list — so
  // a provider whose config file doesn't make it into the machinery commit fails
  // HERE automatically. This is the regression class for provider wiring categories
  // (Codex environment.toml, project rules, or a future surface) being silently
  // excluded: the committed set must be the full union of what discern actually
  // scaffolds, not a couple of named fields.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(result, "machinery_committed");
    assertEquals(result.data.machinery_committed, true);

    const committed = new Set(
      (await gitOut(dir, "show", "--name-only", "--format=", "HEAD"))
        .split("\n").map((s) => s.trim()).filter(Boolean),
    );

    for (const name of AGENT_NAMES) {
      const p = providerFor(name);
      assert(p !== undefined, `no provider for ${name}`);
      const expected: string[] = [];
      if (p.mcp.kind === "wired") {
        expected.push(p.mcp.integration.configFile);
      }
      if (p.hooks !== undefined) {
        expected.push(p.hooks.settingsFile);
      }
      if (p.worktreeApp !== undefined) {
        expected.push(p.worktreeApp.configFile);
      }
      if (p.projectRules !== undefined) {
        expected.push(p.projectRules.rulesFile);
      }
      for (const file of expected) {
        assert(
          committed.has(file),
          `${name}'s scaffolded config file ${file} was not committed by ` +
            `setup begin — committed: ${
              [...committed].sort().join(", ")
            }. A new wiring category must flow into ScaffoldOutcome and ` +
            `commitScaffoldedMachinery's path union, not just get written to disk.`,
        );
      }
    }
  });
});

Deno.test("discern setup begin fails open (commits nothing, no error) when there is no setup branch", async () => {
  // The machinery auto-commit only runs when `begin` created the `discern-setup` branch.
  // With --allow-dirty (setup proceeds in place, no branch) it must NOT commit — and must
  // NOT error: the agent commits as before. Mirrors commitCompletionMarker's fail-open.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--allow-dirty",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    const res = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(res, "branch");
    assertEquals(res.data.branch, null); // no isolated branch was created
    assertEquals(res.data.machinery_committed, false);

    // Still on `main`, and `begin` authored no commit — only the gitInit baseline exists,
    // so the scaffolded machinery sits uncommitted in the working tree for the agent.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );
    assertEquals(await gitOut(dir, "rev-list", "--count", "HEAD"), "1");
    assertStringIncludes(
      await gitOut(dir, "status", "--porcelain"),
      "discern.toml",
    );
  });

  // No git repo at all — also no branch — `begin` still succeeds, committing nothing.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    const res = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(res, "branch");
    assertEquals(res.data.branch, null);
    assertEquals(res.data.machinery_committed, false);
  });
});

Deno.test("discern setup begin fails open (no error) when the machinery commit itself fails", async () => {
  // The auto-commit is best-effort: if the commit can't be made (e.g. commit signing,
  // simulated here by a failing pre-commit hook), `begin` must NOT error — it falls back
  // to today's behaviour, leaving the machinery for the agent to commit by hand.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    // A pre-commit hook that always fails, so the machinery commit cannot be created.
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await Deno.writeTextFile(hook, "#!/bin/sh\nexit 1\n");
    await Deno.chmod(hook, 0o755);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output); // begin did not error
    const res = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(res, "branch");
    assertEquals(res.data.branch, "discern-setup"); // the branch was still created
    assertEquals(res.data.machinery_committed, false); // but the commit fell open

    // No `discern: scaffold wiring` commit was authored (only the gitInit baseline),
    // and the machinery is left in the working tree for the agent to commit by hand.
    assertEquals(await gitOut(dir, "rev-list", "--count", "HEAD"), "1");
    assertStringIncludes(
      await gitOut(dir, "status", "--porcelain"),
      "discern.toml",
    );
  });
});

Deno.test("begin reports the scaffold by category, never the old flat count", async () => {
  // "Harness files written: 6" undercounted what the scaffold commit contains
  // (the provider wiring), reading as a false containment claim. The summary now
  // counts per category, derived from the same ScaffoldOutcome arrays the
  // machinery commit is built from.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);
    // Pin the agent set so the wired categories are deterministic.
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "Files written into");
    assertTerminalTextIncludes(r.stdout, "seed file");
    assertTerminalTextIncludes(r.stdout, "agent file");
    assertTerminalTextIncludes(r.stdout, "MCP config");
    assert(
      !r.stdout.includes("files written:"),
      "the flat count must not survive",
    );
  });
});

Deno.test("a fresh begin without --confirmed refuses with awaiting_consent, re-serving verify's message (ADR 0086)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);

    // The consent attestation is required for a fresh, non-declarative scaffold. Absent
    // it, begin refuses BEFORE writing anything — the error path is the teaching path.
    const blocked = await runAgent(dir, ["setup", "begin", "--json"]);
    assertEquals(blocked.code, 1, blocked.output);
    const res = decodeCliResult(blocked.stdout, "setup begin");
    assertResultDataKey(res, "command");
    assert(res.data.command !== undefined);
    assertEquals(res.ok, false);
    assertEquals(res.error, "awaiting_consent");
    assertStringIncludes(res.data.command, "--confirmed");
    // Nothing was written — the read-only→destructive boundary held.
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "awaiting_consent must write nothing",
    );

    // Single source: the refusal's instructions are byte-identical to what `verify` serves,
    // so an agent that skipped verify is handed the very same conversation (ADR 0086).
    const verification = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(verification, "phase");
    assert(verification.data.instructions !== undefined);
    const verifyInstructions = verification.data.instructions;
    assert(res.data.instructions !== undefined);
    assertEquals(res.data.instructions, verifyInstructions);
    assertStringIncludes(
      res.data.instructions,
      "Would you like to switch models first, or shall I carry on here?",
    );
    assert(Array.isArray(res.hints));
    const attestation = res.hints.join("\n");
    for (
      const fact of [
        "three pillars",
        "footprint",
        "plan",
        "reversibility",
        "numbered confirmation",
        "time-and-tokens",
      ]
    ) {
      assertStringIncludes(attestation, fact);
    }

    // The human render carries the same message verbatim (dual-addressed, ADR 0078),
    // and still writes nothing.
    const human = await runAgent(dir, ["setup", "begin"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stdout, res.data.instructions);
    assert(!(await targetExists(join(dir, "discern.toml"))));

    // --dry-run is exempt: consent gates writes, and a dry run writes nothing —
    // a preview refusing without --confirmed made the consent gate look arbitrary.
    const preview = await runAgent(dir, [
      "setup",
      "begin",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(
      decodeCliResult(preview.stdout, "setup begin").dry_run,
      true,
    );
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "a dry run must still write nothing",
    );
  });
});

Deno.test("discern setup refuses on a dirty tree, writing nothing; --allow-dirty overrides (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);
    // An uncommitted change to a TRACKED file makes the tree dirty.
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 2;\n");

    const blocked = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
    ]);
    assertEquals(blocked.code, 1, blocked.output);
    assertEquals(
      decodeCliResult(blocked.stdout, "setup begin").error,
      "dirty_worktree",
    );
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "nothing must be written when setup refuses a dirty tree",
    );
    // No branch was created — still on the original branch.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );

    // --allow-dirty proceeds in place: no branch, scaffolds onto the current branch.
    const forced = await runAgent(dir, ["setup", "--allow-dirty"]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );
    assert(await targetExists(join(dir, "discern.toml")));
  });
});

Deno.test("setup begin refuses denied Git branch authority before checkout or scaffold and never degrades in place", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);
    const headBefore = await gitOut(dir, "rev-parse", "HEAD");
    const statusBefore = await gitOut(dir, "status", "--porcelain=v1");
    const gitDir = join(dir, ".git");
    const originalMode = (await Deno.stat(gitDir)).mode;
    assert(originalMode !== null);
    await Deno.chmod(gitDir, 0o555);
    try {
      const denied = await runAgent(dir, [
        "setup",
        "begin",
        "--confirmed",
        "--brief",
        "a project's exact brief",
        "--json",
      ]);
      assertEquals(denied.code, 1, denied.output);
      const envelope = decodeCliResult(denied.stdout, "setup begin");
      assertEquals(envelope.error, "write_access");
      assertEquals(envelope.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        envelope.diagnostics?.[0]?.reproduce_cmd,
        `discern setup begin --confirmed --brief 'a project'"'"'s exact brief'`,
      );
      assertEquals(
        await gitOut(dir, "branch", "--show-current"),
        "main",
      );
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
      assertEquals(await gitOut(dir, "status", "--porcelain=v1"), statusBefore);
      assertEquals(await targetExists(join(dir, "discern.toml")), false);
      assertEquals(
        (await gitOut(dir, "branch", "--format=%(refname:short)"))
          .split("\n").includes(SETUP_BRANCH),
        false,
        "branch denial must never fall back to in-place scaffolding",
      );
    } finally {
      await Deno.chmod(gitDir, originalMode & 0o777);
    }
  });
});

Deno.test("an unparseable config surfaces its TOML error without the setup redirect", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this is = not valid toml [[[\n",
    );
    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 1, r.output);
    assert(
      !r.stderr.includes("isn't set up yet"),
      "the redirect must not bury the real TOML parse error",
    );
  });
});

Deno.test("bare `discern` shows the setup welcome in an un-set-up project, but help once set up", async () => {
  await withTempDir(async (dir) => {
    // Un-set-up project (config present, not set up): bare `discern` shows the
    // read-only welcome (in-progress), NOT the brief and NOT a scaffold (ADR 0075).
    await scaffoldEngine(dir, { bootstrapped: false });
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assertTerminalTextIncludes(bare.stdout, "IN PROGRESS");
    assert(
      !bare.stdout.includes(INSTRUCTIONS_H1),
      "the welcome is not the brief — bare `discern` must not print the brief",
    );
  });

  await withTempDir(async (dir) => {
    // Set-up project: bare `discern` shows help, not the welcome.
    await scaffoldEngine(dir); // bootstrapped by default
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assert(
      !bare.stdout.includes(INSTRUCTIONS_H1),
      "a set-up project should show help, not the welcome",
    );
    assertStringIncludes(bare.stdout, "Usage:");
  });
});

Deno.test("bare `discern` shows the fresh welcome inside a git work tree, writing nothing", async () => {
  // No discern.toml, but a git repo → bare `discern` shows the FRESH welcome (the
  // first-contact path). It is READ-ONLY: nothing is scaffolded until `setup begin`.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.py"), "print('hi')\n");
    await gitInit(dir);
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assertTerminalTextIncludes(bare.stdout, "isn't set up yet");
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "the welcome is read-only — bare `discern` must not scaffold",
    );
  });
});

Deno.test("discern setup is still callable with --force after it is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped by default

    // Bare `discern setup` (the welcome) now reports it is already done...
    const bare = await runAgent(dir, ["setup"]);
    assertEquals(bare.code, 0, bare.output);
    assertTerminalTextIncludes(bare.stdout, "already set up");

    // ...but --force re-seeds (and reprints the instructions).
    const forced = await runAgent(dir, ["setup", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(forced.stdout, INSTRUCTIONS_H1);
  });
});

Deno.test("discern setup done ignores a real doc that merely mentions EXAMPLE", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    // A genuine doc (no skeleton) that happens to contain the bare word EXAMPLE
    // and an open paren — the validator must not mistake it for the skeleton's
    // `_(EXAMPLE — replace during ...)_` placeholder heading.
    await Deno.mkdir(defaultMapPath(dir), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "README.md"),
      "# Docs\n\nSee the sample config (EXAMPLE) in the appendix.\n",
    );
    await Deno.mkdir(defaultMapPath(dir, "10-runtime"), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "10-runtime", "README.md"),
      "# Runtime\n\n## Start here\n\nBegin at `main.ts`.\n\n" +
        "## Boundary\n\nThe runtime owns project execution.\n\n" +
        "## Non-obvious invariant\n\nPreserve the configured command's exit status.\n",
    );
    // ADR 0078: `done` also requires ≥1 wired capability (a derived per-step check).
    await runAgent(dir, ["config", "set-job", "test", "true"]);
    await runAgent(dir, ["refresh"]);
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", SETUP_BRANCH);
    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("discern setup --json emits the DiscernResult envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const res = decodeCliResult(r.stdout, "setup begin");
    assertResultDataKey(res, "skeletons");
    assert(res.data.skeletons !== undefined);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "setup");
    assert(res.data.skeletons.includes(SOURCE_PATHS.map.defaultPath));
    assert(
      typeof res.data.instructions === "string" &&
        res.data.instructions.length > 0,
    );
  });
});

Deno.test("the brief teaches bounded authoring with explicit authority and no mid-setup activation", async () => {
  // Read the printed brief directly — `templates/` is excluded from `deno fmt`,
  // so these anchors stay on one line and won't be reflowed out from under us.
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // Reversible project authoring stays agent-owned; material decisions stay human-owned.
  assertStringIncludes(brief, "configuration engine");
  assertStringIncludes(brief, "Inspect before claiming");
  assertStringIncludes(brief, "preserve the project");
  assertStringIncludes(brief, "revertible commit");
  assertStringIncludes(brief, "cost, data, access");
  assertStringIncludes(brief, "new to reliable software delivery");
  assertStringIncludes(brief, "transparency without interrogation");
  assertStringIncludes(brief, "your natural conversational voice");
  assertStringIncludes(brief, "name discern as the thing that will keep");
  assertStringIncludes(brief, "repository-external path");
  assertStringIncludes(brief, "use its structured or retrievable view");
  assertStringIncludes(
    brief,
    "never repeat an effectful command merely to recover omitted output",
  );
  assert(!brief.includes("always read in full"));

  // The old propose-and-confirm gate is reconciled away in EVERY place it lived:
  // the operating principle, the per-step capability gate, and the stop-condition.
  // These are the structural guards that keep the consent gate from creeping back.
  assert(
    !brief.includes("Propose, don't overwrite"),
    "the propose-and-confirm operating principle must not return",
  );
  assert(
    !brief.includes("let them confirm"),
    "per-step confirm-gating language must not return",
  );
  assert(
    !brief.includes("committed only if the user confirms"),
    "the capability-fill confirm gate must not return in the stop-conditions",
  );

  assertStringIncludes(brief, "Do not restart");
  assertStringIncludes(brief, "Do not run `discern improvement` during setup");
  assertStringIncludes(brief, "You are not done until all of these are true");
});

Deno.test("the brief keeps model selection neutral and bounds Map scope by durable boundaries", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  assertStringIncludes(brief, "exact provider/model identifier");
  assertStringIncludes(brief, "literal advisory value `unreported`");
  assertStringIncludes(brief, "## Step 0 - Confirm consent");
  assert(!brief.toLowerCase().includes("most capable model"));
  assert(
    !brief.includes("right tool for this job"),
    "Step 0's self-assessment framing must not return — it is now a relayed question",
  );

  assertStringIncludes(brief, "primary subsystem");
  assertStringIncludes(brief, "durable subsystem boundary");
  assertStringIncludes(brief, "reduce future repository reading");
  assertStringIncludes(brief, "not target counts");

  // The brief is the canonical agent-facing setup script. A new step anywhere in
  // it auto-enrols in this check, while the separate `docs/` reassurance stays in
  // the consent message that owns that distinction.
  const ambiguousDocNouns = [...brief.matchAll(/\bdocs?\b/gi)].map((hit) =>
    hit[0]
  );
  assertEquals(
    ambiguousDocNouns,
    [],
    `the setup brief names the agent-maintained tree as the map: ${
      ambiguousDocNouns.join(", ")
    }`,
  );
  assertEquals(
    [..."A later setup step authors the docs.".matchAll(/\bdocs?\b/gi)].map(
      (hit) => hit[0],
    ),
    ["docs"],
  );

  assertStringIncludes(brief, "concrete unresolved decisions or defects");
  assertStringIncludes(brief, "never generic aspirations");
});

Deno.test("the brief wires the gate before any authoring, with a refresh before the first gate run (ADR 0077)", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // The gate step precedes every authoring step, so a setup session that dies
  // mid-authoring still leaves the project protected — and the format job's
  // whole-tree sweep lands on the unauthored scaffold, keeping later content
  // commits clean. Guards against the job step drifting back behind the
  // authoring steps.
  const gateStep = brief.indexOf(
    "## Step 2 - Preserve project workflows and configure the Gate",
  );
  const firstAuthoringStep = brief.indexOf(
    "## Step 4 - Draft project-specific design principles",
  );
  assert(gateStep !== -1 && firstAuthoringStep !== -1);
  assert(
    gateStep < firstAuthoringStep,
    "the job step must precede the authoring steps",
  );
  assertStringIncludes(brief, "discern config set-job");

  // Stale generated files fail `done`'s currency check, so the brief must sequence
  // `discern refresh` before the first gate run in the wiring step — otherwise the
  // first gate run is a guaranteed failure.
  assertStringIncludes(brief, "run `discern refresh`");
  assertStringIncludes(brief, "discern prepare --json");
});

Deno.test("the brief keeps jobs, reporters, and worktree resources honest", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  assertStringIncludes(brief, "original exit status");
  assertStringIncludes(brief, "keep routine green output concise");
  assertStringIncludes(brief, "--not-applicable");
  assertStringIncludes(
    brief,
    "A new dependency, network access, paid service",
  );
  assertStringIncludes(brief, "tracked binary databases");
  assertStringIncludes(brief, "Cost, durable data, shared credentials");

  // The config template's smoke example is a placeholder that fails loudly if
  // copied verbatim — the old `node -e 'require(\"./\")'` silently failed on
  // ESM-first projects.
  const tmpl = await Deno.readTextFile(
    join(REAL_TEMPLATES, "discern.toml.tmpl"),
  );
  assertStringIncludes(tmpl, '# smoke     = "your-app --version"');
  // The description wraps at the template's width; compare it unwrapped.
  assertStringIncludes(
    tmpl.replace(/\n\s*#\s+/g, " "),
    "`discern done` and `discern test` run it in the same fail-fast test group",
  );
  assert(
    !tmpl.includes("node -e"),
    "the copy-paste-wrong smoke example must not return",
  );
});

Deno.test("the brief never marks an expected missing protection inapplicable to improve assurance", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );
  assertStringIncludes(
    brief,
    "leave a missing but expected protection applicable and absent",
  );
  assertStringIncludes(
    brief,
    "Do not mark a missing expected protection inapplicable",
  );
});
