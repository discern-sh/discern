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
 *     ADR 0051), never silently dropped from the report. Self-supplied commands
 *     (discern's own built-in vocabulary, e.g. the seeded `discern tidy`) count
 *     for nothing — such a job is deferred with the additive `self_supplied`
 *     marker (ADR 0220), so a fresh scaffold can never award itself coverage;
 *   - integration, over the real `setup done` CLI: the `--json` envelope carries the
 *     assurance block + verdict + the landing summary, and the human output names what
 *     is enforced vs deferred, where the just-finished work lives, the exact land
 *     command, and the ongoing-use steer.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import {
  parseConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  KnownJobAssuranceSchema,
  SetupAssuranceSchema,
} from "../src/shared/result_schemas.ts";
import { resultPresenterForVerb } from "../src/shared/result_contracts.ts";
import { renderResultMarkdown } from "../src/shared/result_markdown.ts";
import { ACCEPT_COMMAND_REF } from "../src/commands/setup_accept.ts";
import { HINTS } from "../src/shared/hints.ts";
import { KNOWN_VERBS } from "../src/shared/verbs.ts";
import { sectionBlockFromTemplate } from "../src/lib/config_template.ts";
import {
  assessSetupAssurance,
  classifyKnownJob,
  deferralReason,
  isSelfSuppliedCommand,
  KNOWN_JOB_STATES,
} from "../src/shared/setup_assurance.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
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

Deno.test("a capability carrying only discern's own commands is deferred housekeeping, never enforced", () => {
  // The seeded scaffold case: discern's own upkeep runs, but no project check —
  // deferred on the wire (the closed public state vocabulary), with the additive
  // self_supplied marker carrying the housekeeping distinction.
  const seeded = parseConfigOrThrow('[jobs]\nformat = "discern tidy"\n');
  assertEquals(classifyKnownJob(seeded, "format"), "deferred");
  const format = assessSetupAssurance(seeded).known_jobs.find(
    (job) => job.name === "format",
  );
  assertEquals(format?.state, "deferred");
  assertEquals(format?.self_supplied, true);
  // A project command alongside it carries the capability to enforced.
  const mixed = parseConfigOrThrow(
    '[jobs]\nformat = ["deno fmt", "discern tidy"]\n',
  );
  assertEquals(classifyKnownJob(mixed, "format"), "enforced");
  // No-op items don't change the answer: filtered first, the remainder is
  // still purely self-supplied.
  const padded = parseConfigOrThrow('[jobs]\nformat = ["discern tidy", ":"]\n');
  assertEquals(classifyKnownJob(padded, "format"), "deferred");
  // A plain no-op deferral never carries the marker — the two deferral kinds
  // stay distinguishable.
  const noop = assessSetupAssurance(parseConfigOrThrow('[jobs]\ntest = ":"\n'))
    .known_jobs.find((job) => job.name === "test");
  assertEquals(noop?.self_supplied, undefined);
});

Deno.test("EVERY built-in verb is self-supplied; a Project Script through the namespace is not", () => {
  // The class, driven off KNOWN_VERBS (the SSOT): a new built-in verb
  // auto-enrols as self-supplied the moment it joins the vocabulary.
  for (const verb of KNOWN_VERBS) {
    assert(
      isSelfSuppliedCommand(`discern ${verb}`),
      `\`discern ${verb}\` must count for nothing in the assurance`,
    );
  }
  assert(isSelfSuppliedCommand("discern"));
  assert(isSelfSuppliedCommand("  discern tidy toml  "));
  // `discern <script>` runs a project-authored script — real evidence of a
  // wired check, so it still counts as enforced.
  assert(!isSelfSuppliedCommand("discern check-licenses"));
  assert(!isSelfSuppliedCommand("deno fmt"));
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

  // A housekeeping-only config guards nothing of the project's own — the
  // verdict is minimal, never partial, so the honest no-checks copy fires.
  const housekeeping = parseConfigOrThrow('[jobs]\nformat = "discern tidy"\n');
  assertEquals(assessSetupAssurance(housekeeping).enforced, 0);
  assertEquals(assessSetupAssurance(housekeeping).verdict, "minimal");
});

Deno.test("a declared not-applicable job keeps the v1 state enum and leaves a full applicable denominator", () => {
  const config = parseConfigOrThrow(
    [
      "[assurance]",
      'not_applicable = ["build"]',
      "",
      "[jobs]",
      'format = "fmt"',
      'lint = "lint"',
      'typecheck = "tc"',
      'test = "test"',
      'smoke = "smoke"',
    ].join("\n"),
  );
  const assurance = assessSetupAssurance(config);
  assertEquals(assurance.verdict, "full");
  assertEquals(assurance.enforced, 5);
  assertEquals(assurance.total, 5);
  assertEquals(assurance.known_total, Object.keys(KNOWN_JOBS).length);
  assertEquals(assurance.not_applicable, 1);

  const build = assurance.known_jobs.find((job) => job.name === "build");
  assertEquals(build, {
    name: "build",
    state: "absent",
    not_applicable: true,
  });
  assertEquals(KnownJobAssuranceSchema.parse(build), build);
  assertEquals(SetupAssuranceSchema.parse(assurance), assurance);
});

Deno.test("result schema v1 keeps the three-state enum and accepts both legacy and additive assurance shapes", () => {
  assertEquals(KNOWN_JOB_STATES, ["enforced", "deferred", "absent"]);
  const legacy = {
    known_jobs: [{ name: "build", state: "absent" as const }],
    enforced: 0,
    total: 1,
    verdict: "minimal" as const,
  };
  assertEquals(SetupAssuranceSchema.parse(legacy), legacy);
  assertEquals(
    KnownJobAssuranceSchema.parse({
      name: "build",
      state: "absent",
      not_applicable: true,
    }),
    { name: "build", state: "absent", not_applicable: true },
  );
});

Deno.test("every known job auto-enrols in applicability and absent applicable jobs still keep coverage incomplete", () => {
  for (const name of Object.keys(KNOWN_JOBS)) {
    const config = parseConfigOrThrow(
      `[assurance]\nnot_applicable = ["${name}"]\n`,
    );
    const assurance = assessSetupAssurance(config);
    const row = assurance.known_jobs.find((job) => job.name === name);
    assertEquals(row?.state, "absent");
    assertEquals(row?.not_applicable, true);
    assertEquals(assurance.total, Object.keys(KNOWN_JOBS).length - 1);
  }

  const incomplete = assessSetupAssurance(parseConfigOrThrow([
    "[assurance]",
    'not_applicable = ["build"]',
    "",
    "[jobs]",
    'test = "test"',
  ].join("\n")));
  assertEquals(incomplete.verdict, "partial");
  assertEquals(incomplete.enforced, 1);
  assertEquals(incomplete.total, Object.keys(KNOWN_JOBS).length - 1);
  assertEquals(
    incomplete.known_jobs.find((job) => job.name === "lint")?.state,
    "absent",
  );
  assertEquals(
    incomplete.known_jobs.find((job) => job.name === "lint")
      ?.not_applicable,
    undefined,
  );
});

Deno.test("applicability rejects custom names, duplicates, and every configured-command contradiction", () => {
  const invalid = [
    {
      toml: '[assurance]\nnot_applicable = ["deploy"]\n',
      includes: "expected one of",
    },
    {
      toml: '[assurance]\nnot_applicable = ["build", "build"]\n',
      includes: "once",
    },
    {
      toml: '[assurance]\nnot_applicable = ["test"]\n\n[jobs]\ntest = ":"\n',
      includes: "configured",
    },
  ];
  for (const testCase of invalid) {
    const parsed = parseConfig(testCase.toml);
    assertEquals(parsed.config, undefined);
    assert(
      parsed.issues.some((issue) => issue.message.includes(testCase.includes)),
      JSON.stringify(parsed.issues),
    );
  }
});

Deno.test("the seeded template's [jobs] awards no coverage: a fresh scaffold reads minimal", async () => {
  // The false-green guard: the scaffold must never satisfy the assurance count
  // by itself. Assess the REAL template's canonical [jobs] block (the same
  // extractor `upgrade` reconciles from), so seeding any job there that would
  // fake coverage fails this test.
  const template = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const jobs = sectionBlockFromTemplate(template, "jobs");
  assert(jobs !== undefined, "the template must carry a [jobs] section");
  const a = assessSetupAssurance(parseConfigOrThrow(jobs));
  assertEquals(a.enforced, 0);
  assertEquals(
    a.verdict,
    "minimal",
    "the seeded [jobs] must not count as project coverage",
  );
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

Deno.test("setup done terminal, JSON, and Markdown agree on the applicable denominator", async () => {
  const applicableNames = Object.keys(KNOWN_JOBS).filter((name) =>
    name !== "build"
  );
  const applicableTotal = applicableNames.length;
  const config = [
    "[assurance]",
    'not_applicable = ["build"]',
    "",
    "[jobs]",
    ...applicableNames.map((name) => `${name} = "${name}"`),
  ].join("\n");

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(dir, config);
    const terminal = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(terminal.code, 0, terminal.output);
    assertTerminalTextIncludes(
      terminal.stdout,
      `${applicableTotal} of ${applicableTotal} applicable protections are enforced`,
    );
    assertTerminalTextIncludes(terminal.stdout, "build");
    assertTerminalTextIncludes(terminal.stdout, "does not apply");

    const result = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertEquals(result.data.assurance.enforced, applicableTotal);
    assertEquals(result.data.assurance.total, applicableTotal);
    assertEquals(
      result.data.assurance.known_total,
      Object.keys(KNOWN_JOBS).length,
    );
    assertEquals(result.data.assurance.not_applicable, 1);
    assertStringIncludes(
      result.data.instructions,
      `${applicableTotal} of ${applicableTotal} applicable protections are wired and running`,
    );
    assertStringIncludes(result.data.instructions, "`build` does not apply");

    const markdown = renderResultMarkdown(
      result,
      resultPresenterForVerb("setup done"),
    );
    assertStringIncludes(
      markdown,
      `Applicable protections: ${applicableTotal} of ${applicableTotal} enforced; 1 does not apply; verdict \`full\`.`,
    );
    for (const name of Object.keys(KNOWN_JOBS)) {
      assertStringIncludes(terminal.stdout, name);
    }
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
    assertTerminalTextIncludes(done.stdout, "Setup complete");
    assertTerminalTextIncludes(done.stdout, "Quality coverage: partial");
    assertStringIncludes(done.stdout, "enforced");
    assertStringIncludes(done.stdout, "deferred");
    // Where the work lives + the EXACT land command (the largest clean-room UX gap).
    assertStringIncludes(done.stdout, "discern-setup");
    assertTerminalTextIncludes(done.stdout, "discern setup accept");
    assertStringIncludes(done.stdout, "main");
    // The ongoing-use steer.
    assertTerminalTextIncludes(done.stdout, "discern improvement --json");
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

Deno.test("setup done on the seeded config alone is honest: minimal, with the no-checks copy", async () => {
  // The first-contact case: a scaffold whose only job is the seeded
  // `format = "discern tidy"` has wired no check of its own. The verdict must
  // be minimal — never a green earned by discern's own upkeep — and the relay
  // message must say so.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(dir, '[jobs]\nformat = "discern tidy"\n');
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    const a = res.data.assurance;
    assertEquals(a.verdict, "minimal");
    assertEquals(a.enforced, 0);
    const format = a.known_jobs.find(
      (c: { name: string }) => c.name === "format",
    );
    assertEquals(format.state, "deferred");
    assertEquals(format.self_supplied, true);
    assertStringIncludes(
      res.data.instructions,
      "No quality checks are wired yet",
    );
  });
});
