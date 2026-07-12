/**
 * Engine coverage for the setup PAGE surface and the derived per-step PROOF (ADR
 * 0078). Driven through the real CLI, so the page parser, the `setup step <n>`
 * structured envelope, the `setup begin` first-page emission, and the `setup done`
 * completion checks are all exercised end-to-end.
 *
 * The three measurable behaviors of ADR 0078, plus the two forcing functions that
 * keep the page format honest:
 *
 *  1. `setup step <n>` returns the structured spine + the prose guidance;
 *  2. `setup begin` emits the principles + the FIRST page only (never steps 1–9);
 *  3. `setup done` FAILS (naming the unmet check) when a step was skipped and
 *     PASSES when every check is satisfied — the anti-shallow-compliance guard;
 *  4. every completion check's `describe` matches its page's `completion_check`
 *     spine field (so the brief and the predicate can't drift);
 *  5. the shipped brief parses into nine full pages (a malformed spine fails here).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { guidanceSeedRel } from "../src/shared/paths_registry.ts";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import { git, gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { parseSetupBrief } from "../src/shared/setup_pages.ts";
import { SETUP_COMPLETION_CHECKS } from "../src/shared/setup_checks.ts";
import { SetupStepOutputSchema } from "../src/shared/result_schemas.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../src/shared/config_schema.ts";
import { normalizeMapDir } from "../src/shared/map_path.ts";

const BRIEF = join(REAL_TEMPLATES, "setup", "instructions.md");

// ── the page parser + the brief's structure ─────────────────────────────────

Deno.test("the shipped brief parses into the nine numbered pages, each with a full spine", async () => {
  // This is also the malformed-spine guard: a step with a broken `toml` block makes
  // parseSetupBrief throw, failing the gate before such a brief could ship.
  const text = await Deno.readTextFile(BRIEF);
  const brief = parseSetupBrief(text);

  assertEquals(brief.pages.map((p) => p.step), [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
  ]);
  assertStringIncludes(brief.preamble, "# Set up discern");
  assertStringIncludes(brief.preamble, "Operating principles");
  assertStringIncludes(
    brief.epilogue,
    "You are not done until all of these are true",
  );

  for (const p of brief.pages) {
    assert(p.spine.intent.length > 0, `Step ${p.step} intent is empty`);
    assert(p.spine.must_do.length > 0, `Step ${p.step} must_do is empty`);
    assert(
      p.spine.next_action.length > 0,
      `Step ${p.step} next_action is empty`,
    );
    assert(
      p.spine.completion_check.length > 0,
      `Step ${p.step} completion_check empty`,
    );
    assert(p.guidance.length > 0, `Step ${p.step} prose guidance is empty`);
    // The spine block is the machine lane only — its fence must not leak into prose.
    assert(
      !p.guidance.includes("```toml"),
      `Step ${p.step} prose carries its spine fence`,
    );
  }
});

// ── `setup step <n>` serves one structured page (both lanes) ─────────────────

Deno.test("setup step <n> --json carries the structured spine AND the prose guidance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "step", "4", "--json"]);
    assertEquals(r.code, 0, r.output);

    const res = JSON.parse(r.stdout);
    assertEquals(res.verb, "setup step");
    const d = res.data;
    assertEquals(d.step, 4);
    assertEquals(typeof d.title, "string");

    // The machine lane: all six spine fields are present.
    for (
      const k of [
        "intent",
        "files_to_read",
        "must_do",
        "what_not_to_do",
        "completion_check",
        "next_action",
      ]
    ) {
      assert(k in d.spine, `spine is missing '${k}'`);
    }
    assert(Array.isArray(d.spine.must_do) && d.spine.must_do.length > 0);

    // The prose lane: the warm guidance the agent follows verbatim.
    assert(typeof d.guidance === "string" && d.guidance.length > 0);
    assertStringIncludes(d.guidance, "single source of truth"); // a Step 4 prose anchor

    // Faithfulness (ADR 0041): the real serialized output validates against the schema.
    SetupStepOutputSchema.parse(res);
  });
});

Deno.test("setup step <n> human output leads with the prose, with light navigation rails", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "step", "4"]);
    assertEquals(r.code, 0, r.output);

    assertStringIncludes(r.stdout, "## Step 4 — Draft the design principles");
    assertStringIncludes(r.stdout, "single source of truth"); // the warm prose leads
    assertStringIncludes(r.stdout, "Next:"); // the chaining rail
    // The raw spine fence must never leak into the human rendering.
    assert(!r.stdout.includes("```toml"), r.stdout);
  });
});

Deno.test("setup step on a non-existent step is a structured no_such_step", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "step", "99", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(JSON.parse(r.stdout).error, "no_such_step");
  });
});

// ── `setup begin` emits the principles + the first page ONLY ─────────────────

Deno.test("setup begin emits the operating principles + the first page only, never the later steps", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The principles (preamble) and the first page (Step 0) are present...
    assertStringIncludes(r.stdout, "Operating principles");
    assertStringIncludes(
      r.stdout,
      "## Step 0 — Checkpoint: the model question, then orient",
    );
    assertStringIncludes(r.stdout, "am I your most capable model"); // Step 0's prose

    // ...but no later page is dumped — the agent pulls each with `setup step <n>`.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      assert(
        !r.stdout.includes(`## Step ${n} —`),
        `begin must not print the Step ${n} heading (A10):\n${r.stdout}`,
      );
    }
  });

  // The --json envelope carries the same first-page-only text plus the structured page.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const d = JSON.parse(r.stdout).data;
    assertStringIncludes(d.instructions, "# Set up discern");
    assert(
      !d.instructions.includes("## Step 2 —"),
      "begin --json must not carry Step 2",
    );
    assertEquals(d.page.step, 0);
    assertEquals(typeof d.page.spine.next_action, "string");
  });
});

// ── `setup done` proves per-step completion (the anti-shallow-compliance guard) ──

/** Lay a marker-free project whose docs/guidance satisfy every per-step check, then
 * let the caller break exactly one thing. `principles` is the design-principles body. */
async function layMarkerFreeProject(
  dir: string,
  principles: string,
): Promise<void> {
  await scaffoldEngine(dir, { bootstrapped: false });
  await gitInit(dir);
  await Deno.mkdir(join(dir, "map/00-orientation"), {
    recursive: true,
  });
  await Deno.mkdir(join(dir, "discern"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "map/00-orientation/design-principles.md"),
    principles,
  );
  await Deno.writeTextFile(
    join(dir, "discern/guidance.md"),
    "# Guidance\n\nA real pitch describing the project.\n\n## Conventions\n\nReal conventions.\n",
  );
  await runAgent(dir, ["config", "set-capability", "test", "true"]);
}

Deno.test("setup done FAILS, naming the unmet check, when a step was skipped (anti-shallow-compliance)", async () => {
  await withTempDir(async (dir) => {
    // Marker-free, a capability wired, guidance filled — but design-principles.md has
    // had its EXAMPLE marker DELETED without being filled (one principle where the step
    // asks for ≥3). The marker walk is satisfied; the derived check is not.
    await layMarkerFreeProject(
      dir,
      "# Design principles\n\n## 1. Keep it simple\n\nDo the simplest thing.\n",
    );

    const blocked = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(blocked.code, 1, blocked.output);
    const res = JSON.parse(blocked.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "incomplete");

    // The diagnostic NAMES the unmet check — and only it (guidance + capability pass).
    const unmet = res.data.unmet as Array<{ name: string; step: number }>;
    assertEquals(
      unmet.map((u) => u.name),
      ["design_principles"],
      blocked.stdout,
    );
    assertEquals(unmet[0]?.step, 4);

    // Completion was NOT recorded — a skipped step can't pass `done`.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "a skipped step must not record completion",
    );

    // The human form names the check too.
    const human = await runAgent(dir, ["setup", "done"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stderr, "not finished");
    assertStringIncludes(human.stderr, "Step 4");
  });
});

Deno.test("setup done PASSES once every per-step check is satisfied", async () => {
  await withTempDir(async (dir) => {
    // The same project, but with three real principles — every check is now met.
    await layMarkerFreeProject(
      dir,
      "# Design principles\n\n## 1. First\n\nx.\n\n## 2. Second\n\ny.\n\n## 3. Third\n\nz.\n",
    );
    // Committed, so the clean-tree precondition passes too.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.gate_proven, true);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("setup done --force records completion even when a per-step check would fail", async () => {
  await withTempDir(async (dir) => {
    // Capabilities unset → the capability check would fail; --force skips it (and the
    // marker walk and the gate proof) as the manual-setup escape hatch.
    await scaffoldEngine(dir, { bootstrapped: false });
    const forced = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

// ── forcing function: the registry's describe matches the page's completion_check ──

Deno.test("each completion check's describe matches its page's completion_check spine field", async () => {
  // A brief edit that changes a `completion_check` field — or a predicate edit that
  // changes a `describe` — must update the other, or this fails. It also pins every
  // registered check to a real page (no check for a step the brief doesn't carry).
  const brief = parseSetupBrief(await Deno.readTextFile(BRIEF));
  for (const check of SETUP_COMPLETION_CHECKS) {
    const page = brief.pages.find((p) => p.step === check.step);
    assert(
      page !== undefined,
      `the '${check.name}' check targets Step ${check.step}, which the brief has no page for`,
    );
    assertEquals(
      page.spine.completion_check,
      check.describe,
      `Step ${check.step}'s completion_check must match the '${check.name}' check's describe (ADR 0078)`,
    );
  }
});

// ── forcing function: every check's evaluate() actually fails when work is skipped ──

const baseConfig = (patch: Record<string, unknown> = {}): DiscernConfig =>
  configSchema.parse({ project: { slug: "demo" }, ...patch });

/** Write the design-principles doc at the config's docs dir with `body`. */
async function writePrinciples(
  root: string,
  config: DiscernConfig,
  body: string,
): Promise<void> {
  const path = join(
    root,
    `${normalizeMapDir(config.map.dir)}00-orientation/design-principles.md`,
  );
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, body);
}

/**
 * For every completion check: a context where its step's work is ABSENT/stubbed
 * (evaluate must be false) and one where it's PRESENT (true). The describe-parity
 * loop above proves each check exists; this proves each check's evaluate() actually
 * catches a skipped step — end-to-end only `design_principles` did, so `guidance`
 * and `capabilities` could have been broken to always-pass unnoticed. Coupled to the
 * SSOT, so a new check must supply a fail/pass fixture.
 */
type EvalCtx = { root: string; config: DiscernConfig };
type EvalCase = {
  fail(root: string): Promise<EvalCtx>;
  pass(root: string): Promise<EvalCtx>;
};

const CHECK_EVAL_CASES: Record<string, EvalCase> = {
  design_principles: {
    async fail(root): Promise<EvalCtx> {
      const config = baseConfig();
      await writePrinciples(
        root,
        config,
        "# Design principles\n\n## 1. Only one\n\nEXAMPLE deleted, not filled.\n",
      );
      return { root, config };
    },
    async pass(root): Promise<EvalCtx> {
      const config = baseConfig();
      await writePrinciples(
        root,
        config,
        "# Design principles\n\n## 1. First\n\na.\n\n## 2. Second\n\nb.\n\n## 3. Third\n\nc.\n",
      );
      return { root, config };
    },
  },
  guidance: {
    async fail(root): Promise<EvalCtx> {
      // Conventions heading present but the stub placeholder never replaced.
      const config = baseConfig();
      await Deno.mkdir(
        join(root, dirname(guidanceSeedRel(config.guidance.sources))),
        { recursive: true },
      );
      await Deno.writeTextFile(
        join(root, guidanceSeedRel(config.guidance.sources)),
        "# Guidance\n\nA pitch.\n\n## Conventions\n\n_(replace this section with the project's real conventions)_\n",
      );
      return { root, config };
    },
    async pass(root): Promise<EvalCtx> {
      const config = baseConfig();
      await Deno.mkdir(
        join(root, dirname(guidanceSeedRel(config.guidance.sources))),
        { recursive: true },
      );
      await Deno.writeTextFile(
        join(root, guidanceSeedRel(config.guidance.sources)),
        "# Guidance\n\nA real pitch.\n\n## Conventions\n\nReal conventions.\n",
      );
      return { root, config };
    },
  },
  capabilities: {
    // Reads config only — no capability wired vs one wired.
    fail(root): Promise<EvalCtx> {
      return Promise.resolve({ root, config: baseConfig() });
    },
    pass(root): Promise<EvalCtx> {
      return Promise.resolve({
        root,
        config: baseConfig({ capabilities: { test: "true" } }),
      });
    },
  },
};

Deno.test("every completion check's evaluate() fails when its step's work is skipped, passes when done", async () => {
  // Coupling: the fixtures name EXACTLY the checks — a new check can't ship without
  // its fail-path exercised (or a recorded fixture).
  assertEquals(
    Object.keys(CHECK_EVAL_CASES).sort(),
    SETUP_COMPLETION_CHECKS.map((c) => c.name).sort(),
    "CHECK_EVAL_CASES must cover exactly SETUP_COMPLETION_CHECKS",
  );

  for (const check of SETUP_COMPLETION_CHECKS) {
    const c = CHECK_EVAL_CASES[check.name];
    if (c === undefined) continue; // covered by the coupling assertion above
    await withTempDir(async (root) => {
      assertEquals(
        await check.evaluate(await c.fail(root)),
        false,
        `${check.name}: evaluate() must FAIL when the step's work is skipped`,
      );
    });
    await withTempDir(async (root) => {
      assertEquals(
        await check.evaluate(await c.pass(root)),
        true,
        `${check.name}: evaluate() must PASS when the step's work is present`,
      );
    });
  }
});
