/**
 * Setup-completion ASSURANCE coverage (A12) — the honest, per-capability account
 * `discern setup done` reports so "the gate is proven" can't read as "every
 * protection runs".
 *
 * Two layers:
 *   - unit, over {@link assessSetupAssurance}: the three-way classification
 *     (enforced / deferred / absent) is derived from the resolved `[jobs]`
 *     alone, the verdict rolls them up, and the summary covers EXACTLY the
 *     {@link KNOWN_JOBS} SSOT — so a new capability auto-enrols (fix-the-class,
 *     ADR 0051), never silently dropped from the report;
 *   - integration, over the real `setup done` CLI: the `--json` envelope carries the
 *     assurance block + verdict + the landing summary, and the human output names what
 *     is enforced vs deferred, where the just-finished work lives, the exact land
 *     command, and the ongoing-use steer.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { ACCEPT_COMMAND_REF } from "../src/commands/setup_accept.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  assessSetupAssurance,
  classifyKnownJob,
  deferralReason,
} from "../src/shared/setup_assurance.ts";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

// ── unit: classification + verdict, derived from [jobs] alone ───────────

Deno.test("the assurance summary covers EXACTLY the known-capability SSOT", () => {
  // Drive the guarantee off KNOWN_JOBS so a new capability auto-enrols in the
  // report (fix-the-class): the summary's names must equal the SSOT, in its order.
  const a = assessSetupAssurance(parseConfigOrThrow(""));
  assertEquals(
    a.known_jobs.map((job) => job.name),
    Object.keys(KNOWN_JOBS),
  );
  assertEquals(a.total, Object.keys(KNOWN_JOBS).length);
});

Deno.test("classifyKnownJob: enforced (real command) / deferred (no-op) / absent (omitted)", () => {
  const config = parseConfigOrThrow(
    [
      "[jobs]",
      'format = "deno fmt"', // a real command → enforced
      'test = ":"', // the POSIX no-op → deferred
      'lint = ""', // an empty command → deferred
      // typecheck + build omitted → absent
    ].join("\n"),
  );
  assertEquals(classifyKnownJob(config, "format"), "enforced");
  assertEquals(classifyKnownJob(config, "test"), "deferred");
  assertEquals(classifyKnownJob(config, "lint"), "deferred");
  assertEquals(classifyKnownJob(config, "typecheck"), "absent");
  assertEquals(classifyKnownJob(config, "build"), "absent");
});

Deno.test("a list capability with only no-op items is deferred, not enforced", () => {
  const config = parseConfigOrThrow('[jobs]\ntest = ["", ":"]\n');
  assertEquals(classifyKnownJob(config, "test"), "deferred");
});

Deno.test("the verdict rolls up enforced coverage: full / partial / minimal", () => {
  const full = parseConfigOrThrow(
    [
      "[jobs]",
      'format = "fmt"',
      'build = "build"',
      'lint = "lint"',
      'typecheck = "tc"',
      'test = "test"',
      'smoke = "smoke"',
    ].join("\n"),
  );
  assertEquals(assessSetupAssurance(full).verdict, "full");
  assertEquals(assessSetupAssurance(full).enforced, 6);

  const partial = parseConfigOrThrow('[jobs]\ntest = "test"\n');
  assertEquals(assessSetupAssurance(partial).verdict, "partial");
  assertEquals(assessSetupAssurance(partial).enforced, 1);

  // A deferred capability does NOT count as enforced — coverage with only a no-op
  // is minimal, never partial.
  const deferred = parseConfigOrThrow('[jobs]\ntest = ":"\n');
  assertEquals(assessSetupAssurance(deferred).verdict, "minimal");
  assertEquals(assessSetupAssurance(deferred).enforced, 0);

  assertEquals(assessSetupAssurance(parseConfigOrThrow("")).verdict, "minimal");
});

Deno.test("deferralReason extracts an inline comment, scoped to [jobs]", () => {
  const toml = [
    "[scopes.test]",
    'run = "x"  # not this comment', // a different section, ignored
    "",
    "[jobs]",
    'format = "deno fmt"',
    'test = ":"  # blocked by a runtime mismatch, see TODO.md',
  ].join("\n");
  assertEquals(
    deferralReason(toml, "test"),
    "blocked by a runtime mismatch, see TODO.md",
  );
  // A job line without a comment yields nothing — another job's comment is never
  // mis-attributed.
  assertEquals(deferralReason(toml, "format"), undefined);
  assertEquals(deferralReason(toml, "lint"), undefined);
});

Deno.test("assessSetupAssurance attaches a deferred capability's reason from the raw toml", () => {
  const toml = '[jobs]\ntest = ":"  # deferred until the runtime is fixed\n';
  const a = assessSetupAssurance(parseConfigOrThrow(toml), toml);
  const test = a.known_jobs.find((job) => job.name === "test");
  assertEquals(test?.state, "deferred");
  assertEquals(test?.reason, "deferred until the runtime is fixed");
  // Without the raw toml, the state is still correct; only the reason is omitted.
  const noRaw = assessSetupAssurance(parseConfigOrThrow(toml));
  assertEquals(
    noRaw.known_jobs.find((job) => job.name === "test")?.reason,
    undefined,
  );
});

// ── integration: the real `setup done` surfaces the assurance + landing ─────────

/** A config wiring two real capabilities, deferring one with a reason, leaving two
 * absent — the mixed, honest case the assurance block exists to report. */
const MIXED_CONFIG = [
  "[project]",
  'slug = "assurance-test"',
  "",
  "[guidance]",
  'agents = ["claude_code"]',
  "",
  "[jobs]",
  'format = ["deno fmt", "discern tidy"]',
  'lint = "deno lint"',
  'test = ":"  # tests blocked by a runtime mismatch, see TODO.md',
].join("\n");

Deno.test("setup done --json carries the per-capability assurance block + verdict", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(dir, MIXED_CONFIG);

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertEquals(res.verb, "setup done");
    const a = res.data.assurance;
    assertEquals(a.verdict, "partial");
    assertEquals(a.enforced, 2);
    assertEquals(a.total, 6);
    const cap = (name: string): { state: string; reason?: string } => {
      const c = a.known_jobs.find((x: { name: string }) => x.name === name);
      assert(c !== undefined, `assurance is missing capability "${name}"`);
      return c;
    };
    assertEquals(cap("format").state, "enforced");
    assertEquals(cap("lint").state, "enforced");
    assertEquals(cap("test").state, "deferred");
    assertEquals(
      cap("test").reason,
      "tests blocked by a runtime mismatch, see TODO.md",
    );
    assertEquals(cap("typecheck").state, "absent");
    assertEquals(cap("build").state, "absent");
  });
});

Deno.test("setup done --json carries the landing summary + coach pointer", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(dir, MIXED_CONFIG);
    await gitInit(dir);
    await git(dir, "checkout", "-b", "discern-setup");

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertEquals(res.data.landing.command, "discern setup accept");
    assertEquals(res.data.landing.in_repo, true);
    assertEquals(res.data.landing.branch, "discern-setup");
    assertEquals(res.data.landing.target, "main");
    assertEquals(res.data.landing.on_target, false);
    // The ongoing-use steer resolves the live coach verb (improve), never hardcoded.
    assertEquals(res.data.coach.verb, "improvement");
    assertStringIncludes(res.data.coach.command, "discern improvement --json");
    // The ordered next-action hints name landing and the coach.
    assertHasHint(res, HINTS["setup-done-land-dedicated"], {
      branch: "discern-setup",
      target: "main",
      acceptCommand: ACCEPT_COMMAND_REF,
    });
    assertHasHint(res, HINTS["setup-run-coach"], {
      coachVerb: "improvement",
      todoRel: "discern/TODO.md",
    });
  });
});

Deno.test("setup done's human output names where the work lives, the land command, and the coach", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(dir, MIXED_CONFIG);
    await gitInit(dir);
    await git(dir, "checkout", "-b", "discern-setup");

    const done = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(done.code, 0, done.output);
    // Celebratory + honest coverage.
    assertStringIncludes(done.stdout, "Setup complete");
    assertStringIncludes(done.stdout, "Quality coverage: partial");
    assertStringIncludes(done.stdout, "enforced");
    assertStringIncludes(done.stdout, "deferred");
    // Where the work lives + the EXACT land command (the largest clean-room UX gap).
    assertStringIncludes(done.stdout, "discern-setup");
    assertStringIncludes(done.stdout, "discern setup accept");
    assertStringIncludes(done.stdout, "main");
    // The ongoing-use steer.
    assertStringIncludes(done.stdout, "discern improvement --json");
  });
});

Deno.test("setup done reports an absent test capability honestly, not as a false 'tests running'", async () => {
  // The motivating clean-room case: format/lint wired, NO test capability. The output
  // must not imply tests run — the verdict is partial and test reads absent.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(
      dir,
      [
        "[jobs]",
        'format = ["deno fmt", "discern tidy"]',
        'lint = "deno lint"',
      ].join("\n"),
    );
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    const test = res.data.assurance.known_jobs.find(
      (c: { name: string }) => c.name === "test",
    );
    assertEquals(test.state, "absent");
    assertEquals(res.data.assurance.verdict, "partial");
  });
});
