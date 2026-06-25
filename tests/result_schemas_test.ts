/**
 * Faithfulness coverage for the typed result schemas (ADR 0041) — the runtime guard
 * that makes the SSOT spine real. For every verb it runs the REAL core (across the
 * modes it can reach) and asserts the actual `serializeResult` output validates
 * against the verb's declared output schema. If a core ever returns a shape its
 * schema doesn't model, a test here fails — which is exactly what keeps the MCP
 * `outputSchema` (validated by the SDK on every call) from turning a valid call into
 * an error.
 *
 * The envelope schema itself is locked to `serializeResult` by the first test: a
 * maximal result must serialize to exactly the envelope's keys, so a new field in
 * `serializeResult` fails here until the schema models it.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { type DiscernResult, serializeResult } from "../src/shared/result.ts";
import {
  AuditOutputSchema,
  ChangedScopesOutputSchema,
  DocsOutputSchema,
  DoctorOutputSchema,
  EnvelopeSchema,
  FinishOutputSchema,
  StatusOutputSchema,
} from "../src/shared/result_schemas.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { prepareResult } from "../src/engine/gate/prepare.ts";
import { testResult } from "../src/engine/gate/test.ts";
import { ratchetsResult } from "../src/engine/gate/ratchets.ts";
import { doctorResult } from "../src/commands/doctor.ts";
import { changedScopesResult } from "../src/engine/scopes/changed.ts";
import { statusResult } from "../src/engine/status/status.ts";
import { auditResult } from "../src/engine/audit/audit.ts";
import { docsResult, helpResult } from "../src/commands/docs.ts";
import {
  graduateResult,
  lifecycleContext,
} from "../src/engine/worktree/lifecycle.ts";
import { Logger } from "../src/lib/log.ts";

/** Validate a real verb result's serialized form against its declared schema, with a
 * readable failure (the Zod issues + the offending payload) when it drifts. */
function expectValid(
  schema: z.ZodType,
  result: DiscernResult,
  label: string,
): void {
  const serialized = serializeResult(result);
  const parsed = schema.safeParse(serialized);
  assert(
    parsed.success,
    `${label} drifted from its schema:\n${
      JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
    }\n--- serialized result ---\n${JSON.stringify(serialized, null, 2)}`,
  );
}

Deno.test("envelope schema is locked to serializeResult's wire shape", () => {
  // A maximal result — every envelope field populated — so its serialized keys are
  // the full envelope key set. If serializeResult gains a field the schema doesn't
  // model, the subset check below fails until the schema is updated.
  const maximal: DiscernResult = {
    ok: false,
    verb: "demo",
    dry_run: true,
    plan: {
      title: "Plan",
      details: ["detail"],
      steps: [{
        kind: "job",
        label: "l",
        disposition: "run",
        note: "n",
        group: "g",
      }],
    },
    steps: [{
      step: {
        kind: "job",
        label: "l",
        disposition: "run",
        note: "n",
        group: "g",
      },
      outcome: "ok",
      durationS: 3,
    }],
    diagnostics: [{
      tool: "t",
      severity: "error",
      message: "m",
      reproduce_cmd: "c",
      output: "o",
      truncated: true,
      file: "f",
      line: 1,
      col: 2,
      rule: "r",
      fix_available: true,
    }],
    data: { anything: 1 },
    hints: ["h"],
    error: "e",
    message: "msg",
  };
  const serialized = serializeResult(maximal);
  expectValid(EnvelopeSchema, maximal, "maximal envelope");
  // Every key serializeResult emits is one the envelope schema declares (and vice
  // versa) — so neither side can grow a field the other doesn't know about.
  const schemaKeys = Object.keys(EnvelopeSchema.shape).sort();
  assertEquals(Object.keys(serialized).sort(), schemaKeys);
});

Deno.test("finish result is faithful to FinishOutputSchema (preview, clean, failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    expectValid(
      FinishOutputSchema,
      await finishResult(dir, { dryRun: true }),
      "finish dry-run",
    );
    expectValid(FinishOutputSchema, await finishResult(dir), "finish clean");

    // A failing capability → steps + a diagnostic + data.failed_stage.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'lint = "echo nope >&2; exit 1"',
        "",
      ].join("\n"),
    );
    const failing = await finishResult(dir);
    assertEquals(failing.ok, false);
    expectValid(FinishOutputSchema, failing, "finish failing");
  });
});

Deno.test("prepare/test results are faithful (clean and failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Clean no-op scaffold: both pass.
    expectValid(EnvelopeSchema, await prepareResult(dir), "prepare clean");
    expectValid(EnvelopeSchema, await testResult(dir), "test unconfigured");

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'lint = "echo boom >&2; exit 1"',
        'test = "echo bust >&2; exit 1"',
        "",
      ].join("\n"),
    );
    const prep = await prepareResult(dir);
    assertEquals(prep.ok, false);
    expectValid(EnvelopeSchema, prep, "prepare failing");
    const test = await testResult(dir);
    assertEquals(test.ok, false);
    expectValid(EnvelopeSchema, test, "test failing");
  });
});

Deno.test("doctor result is faithful (healthy and failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectValid(DoctorOutputSchema, await doctorResult(dir), "doctor healthy");

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "[capabilities]",
        'lint = "totally-not-a-real-binary-zzz --flag"',
        "",
      ].join("\n"),
    );
    const failing = await doctorResult(dir);
    assertEquals(failing.ok, false);
    expectValid(DoctorOutputSchema, failing, "doctor failing");
  });
});

Deno.test("changed-scopes result is faithful", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectValid(
      ChangedScopesOutputSchema,
      await changedScopesResult(dir),
      "changed-scopes",
    );
  });
});

Deno.test("status result is faithful across modes (main, fleet, worktree, unset-up)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Main checkout, local view.
    expectValid(StatusOutputSchema, await statusResult(dir), "status main");
    // Main checkout with the fleet survey forced on (exercises StatusFleetEntry).
    expectValid(
      StatusOutputSchema,
      await statusResult(dir, { all: true }),
      "status main --all",
    );
    // Conflicting flags → an operational refusal envelope.
    expectValid(
      StatusOutputSchema,
      await statusResult(dir, { all: true, local: true }),
      "status conflicting flags",
    );

    // From inside a worktree → location "worktree", a worktree block.
    const wt = await addWorktree(dir, "stat");
    expectValid(
      StatusOutputSchema,
      await statusResult(wt),
      "status worktree",
    );
  });

  // A not-yet-bootstrapped project → data.setup_unfinished present.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    const result = await statusResult(dir);
    assert(
      (result.data as { setup_unfinished?: unknown }).setup_unfinished !==
        undefined,
      "expected setup_unfinished while un-bootstrapped",
    );
    expectValid(StatusOutputSchema, result, "status unset-up");
  });
});

Deno.test("audit result is faithful (full, category, below-min, unknown category)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectValid(AuditOutputSchema, await auditResult(dir), "audit full");
    expectValid(
      AuditOutputSchema,
      await auditResult(dir, { category: "gate" }),
      "audit one category",
    );
    const belowMin = await auditResult(dir, { minScore: 200 });
    assertEquals(belowMin.ok, false);
    expectValid(AuditOutputSchema, belowMin, "audit below-min");
    const unknown = await auditResult(dir, { category: "no-such-category" });
    assertEquals(unknown.ok, false);
    expectValid(AuditOutputSchema, unknown, "audit unknown category");
  });
});

Deno.test("docs/help results are faithful (index, single doc, not-found, no-tree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // No docs/ tree yet → a no_docs error envelope (no data).
    expectValid(DocsOutputSchema, await docsResult(dir), "docs no-tree");

    // Seed a tiny tree → index + single doc + not-found.
    await Deno.mkdir(join(dir, "docs", "00-orientation"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs", "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas.\n",
    );
    const index = await docsResult(dir);
    expectValid(DocsOutputSchema, index, "docs index");
    const slug = (index.data as { docs: { slug: string }[] }).docs[0]?.slug;
    assert(slug !== undefined);
    expectValid(
      DocsOutputSchema,
      await docsResult(dir, { target: slug }),
      "docs single",
    );
    expectValid(
      DocsOutputSchema,
      await docsResult(dir, { target: "no-such-doc" }),
      "docs not-found",
    );

    // help reads discern's OWN bundled docs (always present in this repo's build).
    expectValid(DocsOutputSchema, await helpResult(dir), "help index");
    expectValid(
      DocsOutputSchema,
      await helpResult(dir, { target: "config-reference" }),
      "help single",
    );
    expectValid(
      DocsOutputSchema,
      await helpResult(dir, { target: "no-such-doc" }),
      "help not-found",
    );
  });
});

Deno.test("ratchets result is faithful (dry-run plan and applied steps)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[ratchets.coverage]",
        'run = "echo DISCERN_METRIC coverage 90"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    expectValid(
      EnvelopeSchema,
      await ratchetsResult(dir, { dryRun: true }),
      "ratchets dry-run",
    );
    const applied = await ratchetsResult(dir);
    assertEquals(applied.ok, true);
    expectValid(EnvelopeSchema, applied, "ratchets applied");
  });
});

Deno.test("graduate result is faithful (dry-run plan from a worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad");
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );
    const preview = await graduateResult(ctx, { dryRun: true });
    assertEquals(preview.dry_run, true);
    expectValid(EnvelopeSchema, preview, "graduate dry-run");
  });
});
