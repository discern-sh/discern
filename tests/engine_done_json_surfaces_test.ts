/**
 * Engine tests for `done --json` surfaces past the core envelope: the dry-run
 * preview, human-mode parity, hint carriage, the artifact-currency checks
 * (guidance, skills, ADR numbers, tracked artifacts), and the proof.
 * Split from `engine_done_json_test.ts` so `deno test --parallel` (which
 * distributes per FILE) can spread these serial `done` runs across workers.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  addWorktree,
  defaultMapPath,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { diagFor, parseJson, stepFor } from "./engine_done_json_shared.ts";

Deno.test("done --dry-run --json: emits a preview envelope (plan, no steps)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'test = "echo hi"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "done");
    assertEquals(obj.dry_run, true); // the uniform "is this a preview?" signal
    assertEquals(obj.plan.title, "Gate plan");
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "test"),
      "dry-run plan should list the test job",
    );
    assert(
      obj.plan.steps.some((s: { label: string; disposition: string }) =>
        s.label === "tracked-artifacts-check" && s.disposition === "gate"
      ),
      "dry-run plan should list the tracked-artifacts precondition",
    );
    // A preview ran nothing, so there are no executed steps.
    assertEquals(obj.steps, undefined);
  });
});

Deno.test("done (human): a failure prints a structured Failures block with reproduce commands", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "exit 7"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done"]); // human mode
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Failures");
    assertStringIncludes(r.output, "reproduce:");
    assertStringIncludes(r.output, "exit 7");
  });
});

Deno.test("done --json: a passing gate carries next-step hints, and the human tail prints the SAME strings", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'test = "echo ok"',
        "",
        "[standards.cov]",
        'run = "echo DISCERN_METRIC cov 90"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // --json: the advice rides in the envelope (promoted off the human-only tail).
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assert(Array.isArray(obj.hints), `expected hints[], got ${r.stdout}`);
    assertHasHint(obj, HINTS["gate-update-docs"]);
    // The standard was measured IN the gate (not deferred to a follow-up verb),
    // so no "run discern standards" nudge is owed — the step itself is the record.
    const stdStep = stepFor(obj, "standard:cov");
    assertEquals(stdStep?.outcome, "ok", JSON.stringify(obj.steps));

    // Human mode renders the exact same hint strings (one source of truth).
    // The tree is unchanged, so the deliberate rerun carries the attestation.
    const human = await runAgent(dir, ["done", "--confirmed"]);
    assertEquals(human.code, 0, human.output);
    for (const hint of obj.hints) {
      assertStringIncludes(human.output, hint);
    }
  });
});

Deno.test("done --json: a failing gate carries the gotchas-doc pointer as a hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'gotchas_doc = "docs/gotchas.md"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assert(Array.isArray(obj.hints), `expected hints[], got ${r.stdout}`);
    assertHasHint(obj, HINTS["gate-failure-gotchas"], {
      path: join(await Deno.realPath(dir), "docs/gotchas.md"),
    });
  });
});

Deno.test("done --json: human mode is unaffected (stdout still human, not JSON)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["done"]); // no --json
    assertEquals(r.code, 0, r.output);
    // Human stdout, not JSON.
    let parsed = true;
    try {
      JSON.parse(r.stdout.trim());
    } catch {
      parsed = false;
    }
    assert(!parsed, "human-mode stdout should not be a JSON object");
  });
});

Deno.test("done --json: a STALE agent file fails the guidance check; refresh fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]); // compile CLAUDE.md so it is current

    // Baseline: current generated files → the gate passes.
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    // Hand-edit the generated file → stale → the gate blocks.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\nstray hand edit\n`,
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "guidance");
    const diag = diagFor(obj, "guidance");
    assert(diag !== undefined, `expected a guidance diagnostic: ${r.stdout}`);
    assertEquals(diag.reproduce_cmd, "discern refresh");
    assertStringIncludes(diag.output, "CLAUDE.md");
    assertStringIncludes(diag.output, "[guidance].sources"); // the redirect
    assertStringIncludes(diag.output, "stray hand edit"); // the diff shows the loss

    // Regenerating satisfies the check — the gate passes again.
    await runAgent(dir, ["refresh"]);
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "refresh should clear the drift",
    );
  });
});

Deno.test("done --json: a malformed authored SKILL.md fails the skill_frontmatter check; an edit fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    // An authored skill whose description sits on an indented continuation
    // line containing `: ` — a real YAML parser reads a nested mapping, not a
    // string, so an agent runtime would reject or misread the skill.
    const skillMd = join(
      dir,
      "discern",
      "skills",
      "label-the-jars",
      "SKILL.md",
    );
    const skillDoc = (description: string[]): string =>
      [
        "---",
        "name: label-the-jars",
        ...description,
        "---",
        "",
        "# Label the jars",
        "",
        "Body.",
        "",
      ].join("\n");
    await Deno.mkdir(join(dir, "discern", "skills", "label-the-jars"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      skillMd,
      skillDoc([
        "description:",
        "  Label every jar in the pantry. Out of scope: the fridge.",
      ]),
    );
    await runAgent(dir, ["refresh"]); // materialize, so the currency check is clean

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "skill_frontmatter");
    const diag = diagFor(obj, "skill-frontmatter");
    assert(
      diag !== undefined,
      `expected a skill-frontmatter diagnostic: ${r.stdout}`,
    );
    assertStringIncludes(diag.message, "label-the-jars");
    assertStringIncludes(diag.output, "nested mapping"); // what YAML reads
    assertStringIncludes(diag.output, "must be quoted"); // the remedy

    // Folding the value onto one quoted line satisfies every parser.
    await Deno.writeTextFile(
      skillMd,
      skillDoc([
        'description: "Label every jar in the pantry. Out of scope: the fridge."',
      ]),
    );
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "a valid identity should clear the check",
    );
  });
});

Deno.test("done --json: two ADR records claiming one number fail the adr_numbers check; renumbering fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    // The state two in-flight efforts land in when both pick the next free
    // number: different filenames, clean merge, one number claimed twice.
    const adrDir = defaultMapPath(dir, "_adr");
    await Deno.mkdir(adrDir, { recursive: true });
    await Deno.writeTextFile(join(adrDir, "0007-first.md"), "# first\n");
    await Deno.writeTextFile(join(adrDir, "0007-second.md"), "# second\n");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "adr_numbers");
    const diag = diagFor(obj, "adr-numbers");
    assert(
      diag !== undefined,
      `expected an adr-numbers diagnostic: ${r.stdout}`,
    );
    assertStringIncludes(diag.message, "0007");
    assertStringIncludes(diag.output, "0007-first.md");
    assertStringIncludes(diag.output, "0007-second.md");
    assertStringIncludes(diag.output, "next free"); // the remedy
    assertHasHint(obj, HINTS["gate-failure-adr-numbers"]);

    // Renumbering the newer record clears the check.
    await Deno.rename(
      join(adrDir, "0007-second.md"),
      join(adrDir, "0008-second.md"),
    );
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "renumbering should clear the check",
    );
  });
});

Deno.test("done --json: a stale generated file fails FAST — the currency check precedes the slow stage, so the capability is skipped (ADR 0056)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Wire one observable capability so its step outcome proves whether it ran.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'agents = ["claude_code"]',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'test = "true"',
        "",
      ].join("\n"),
    );
    await runAgent(dir, ["refresh"]); // materialize the agent files + skills (current)

    // Baseline: current artifacts → the currency checks pass and the capability runs.
    const ok = parseJson((await runAgent(dir, ["done", "--json"])).stdout);
    assertEquals(ok.data.failed_stage, null);
    assert(
      ok.steps.some((s: { kind: string; outcome: string }) =>
        s.kind === "job" && s.outcome === "ok"
      ),
      `baseline: the capability should run and pass: ${
        JSON.stringify(ok.steps)
      }`,
    );

    // Stale an agent file → the guidance currency precondition fails FIRST.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\nstray hand edit\n`,
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.data.failed_stage, "guidance");
    // Fail-fast (ADR 0056): the expensive stage never ran — every planned step is
    // skipped, exactly as for the merge precondition (ADR 0050). Were the currency
    // check still last, the capability would have run first (its step would be `ok`).
    assert(
      obj.steps.length >= 1,
      `expected a planned capability step: ${r.stdout}`,
    );
    assert(
      obj.steps.every((s: { outcome: string }) => s.outcome === "skipped"),
      `the capability must not run when the currency check fails first: ${r.stdout}`,
    );
  });
});

Deno.test("done --json: a MISSING agent file does NOT block (absent copy tolerated)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    await Deno.remove(join(dir, "CLAUDE.md")); // model a deletion, or a project keeping them untracked

    const r = await runAgent(dir, ["done", "--json"]);
    // Missing is advisory (surfaced by `status`), never a gate failure — a
    // project that keeps the compiled files untracked would otherwise
    // red-light first-run CI on every fresh checkout.
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    assertEquals(diagFor(obj, "guidance"), undefined);
  });
});

Deno.test("done --json: tracked discern-managed ignored artifacts fail before jobs run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'agents = ["claude_code", "codex"]',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'test = "true"',
        "",
      ].join("\n"),
    );
    await runAgent(dir, ["refresh"]);
    // The compiled guidance files are tracked by design — add them normally.
    // Machine-local state forced into the index is what the check catches.
    await git(dir, "add", "AGENTS.md", "CLAUDE.md");
    await Deno.writeTextFile(
      join(dir, ".claude", "settings.local.json"),
      "{}\n",
    );
    await git(dir, "add", "-f", ".claude/settings.local.json");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "tracked_artifacts");
    assert(
      obj.steps.every((s: { outcome: string }) => s.outcome === "skipped"),
      `the test job must not run after the tracked-artifacts precondition fails: ${r.stdout}`,
    );
    const diag = diagFor(obj, "tracked-artifacts");
    assert(
      diag !== undefined,
      `expected tracked-artifacts diagnostic: ${r.stdout}`,
    );
    assertStringIncludes(diag.reproduce_cmd, "git ls-files --");
    assertStringIncludes(
      diag.output,
      "git rm -r --cached -- .claude/settings.local.json",
    );
    assertStringIncludes(diag.output, "discern refresh");
    assertEquals(diagFor(obj, "guidance"), undefined);
  });
});

Deno.test("done --json: a hand-edited materialized skill blocks (skills); a foreign drop-in does not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Materialize the agent files + skills so the currency checks have real artifacts.
    await runAgent(dir, ["refresh"]);
    const skillsDir = join(dir, ".claude", "skills");

    // Hand-edit a copied bundled skill → stale → finish blocks with a skills diagnostic.
    await Deno.writeTextFile(
      join(skillsDir, "discern-write-adr", "SKILL.md"),
      "\nHAND EDIT\n",
      { append: true },
    );
    let obj = parseJson((await runAgent(dir, ["done", "--json"])).stdout);
    assertEquals(obj.data.failed_stage, "skills");
    const diag = diagFor(obj, "skills");
    assert(diag !== undefined, "a skills diagnostic should be attached");
    assertEquals(diag.reproduce_cmd, "discern refresh");

    // Re-materialize, then drop in a FOREIGN skill discern never owns — it must NOT
    // block finish (the never-clobber contract; only `stale` blocks).
    await runAgent(dir, ["refresh"]);
    await Deno.mkdir(join(skillsDir, "user-dropin"));
    await Deno.writeTextFile(
      join(skillsDir, "user-dropin", "SKILL.md"),
      "# mine\n",
    );
    obj = parseJson((await runAgent(dir, ["done", "--json"])).stdout);
    assertEquals(
      obj.data.failed_stage,
      null,
      "a foreign drop-in must not block finish",
    );
  });
});

// ── the proof (v1): the review-moment summary a green gate emits ──────────────

const PROOF_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'test = "echo proof-gate-ok"',
  "",
].join("\n");

Deno.test("done --json: a green worktree gate emits a compact proof and stores the full page in the marker", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, PROOF_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await writeExecutable(join(wt, "feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "Add the feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);

    // Compact data keeps the claim and omits the review-page rendering.
    const proof = obj.data.proof;
    assert(proof !== undefined, `expected data.proof: ${r.stdout}`);
    assertEquals(proof.branch, "agent/alpha");
    assertEquals(proof.trunk, "main");
    assertEquals(proof.files_total, 1);
    const shortHead = (await gitOut(wt, "rev-parse", "--short=12", "HEAD"))
      .trim();
    assertEquals(proof.head, shortHead);
    assertStringIncludes(
      proof.line,
      `Proof: gate passed on agent/alpha @ ${shortHead} · 1 file `,
    );
    assertStringIncludes(
      proof.line,
      "full proof: discern status --verbose",
    );
    assertEquals(proof.markdown, undefined);

    // The relay affordance rides the envelope's hints, led by the
    // prove-before-claiming guardrail that replaced the prove-it-works skill.
    assertHasHint(obj, HINTS["gate-prove-it-works"]);
    assertHasHint(obj, HINTS["gate-relay-proof"]);

    // The marker stores the line and the page beside the sha it vouches for, so
    // status and accept can surface the proof without re-running the gate.
    assertEquals(obj.data.gate_proof.status, "recorded");
    const marker = await Deno.readTextFile(obj.data.gate_proof.path);
    const head = (await gitOut(wt, "rev-parse", "HEAD")).trim();
    assert(
      marker.startsWith(`${head}\nline: Proof: `),
      `marker must carry sha + line: ${marker.slice(0, 80)}`,
    );
    assertStringIncludes(marker, "\n\n### Proof");

    // Deterministic: the same tree emits the same compact Proof. The unchanged
    // tree makes this a rerun, so it carries the required attestation.
    const again = parseJson(
      (await runAgent(wt, ["done", "--confirmed", "--json"])).stdout,
    );
    assertEquals(again.data.proof, proof);
  });
});

Deno.test("done --json: no proof on the trunk itself, or over a dirty tree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, PROOF_CONFIG);
    await gitInit(dir);

    // The trunk: nothing ahead of main to review — no proof, gate still records.
    const onMain = parseJson(
      (await runAgent(dir, ["done", "--json"])).stdout,
    );
    assertEquals(onMain.ok, true);
    assertEquals(onMain.data.proof, undefined);

    // A dirty worktree: the diff vs the trunk would describe a different tree than
    // the one the gate validated — no proof, and no relay hint.
    const wt = await addWorktree(dir, "beta");
    await writeExecutable(join(wt, "feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "Add the feature", "--no-gpg-sign");
    await Deno.writeTextFile(join(wt, "wip.txt"), "wip\n");
    const dirty = parseJson((await runAgent(wt, ["done", "--json"])).stdout);
    assertEquals(dirty.ok, true);
    assertEquals(dirty.data.proof, undefined);
    assertEquals(dirty.data.gate_proof.status, "skipped_dirty");
    // The refusal NAMES what blocks the proof — in the reason and the hint —
    // so the agent commits the right file instead of diagnosing a bare "dirty".
    assertStringIncludes(dirty.data.gate_proof.reason, "wip.txt");
    assertHasHint(dirty, HINTS["gate-proof-skipped-dirty"], {
      reason: dirty.data.gate_proof.reason,
    });
    assertLacksHint(dirty, HINTS["gate-relay-proof"]);
    assertLacksHint(dirty, HINTS["gate-prove-it-works"]);
  });
});
