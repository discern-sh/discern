/**
 * Engine coverage for `discern improve` — the continuous-improvement coach.
 * Drives the real verb as a subprocess (so Cliffy parsing, the `--json` envelope,
 * the human report, the category filter, and the exit codes are all exercised), the
 * black-box parity oracle for the coach's behaviour.
 *
 * A `scaffoldEngine(dir, { bootstrapped: false })` install is deliberately weak —
 * nothing wired, not set up, no guidance/docs — so it exercises the failing/teaching
 * path; a second config wires the practices and exercises the passing path. The
 * pure scoring/ranking/catalog-integrity invariants are guarded separately in
 * `improve_catalog_test.ts`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { runAgent, scaffoldEngine, writeConfig } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** One deterministic rule result in the `improve --json` payload. */
interface RuleJson {
  id: string;
  title: string;
  status: "pass" | "partial" | "fail";
  weight: number;
  detail: string;
  fix?: string;
  teach: string;
}

/** One subjective review item in the payload. */
interface ReviewJson {
  id: string;
  title: string;
  ask: string;
  teach: string;
  against?: { source: string; excerpt: string };
}

/** One category in the payload. */
interface CategoryJson {
  name: string;
  title: string;
  score: number;
  weight: number;
  weak: number;
  rules: RuleJson[];
  reviews: ReviewJson[];
}

/** The `improve --json` envelope shape we assert against. */
interface ImprovePayload {
  ok: boolean;
  verb: string;
  error?: string;
  message?: string;
  data?: {
    score: number;
    weak: number;
    open_reviews: number;
    next_action: {
      kind: "fix" | "review";
      category: string;
      id: string;
      title: string;
      action: string;
      why: string;
    };
    categories: CategoryJson[];
  };
}

/** Run `improve <args>` and parse its `--json` stdout. */
async function improveJson(
  dir: string,
  args: string[] = [],
): Promise<{ code: number; payload: ImprovePayload }> {
  const { code, stdout } = await runAgent(dir, ["improve", "--json", ...args]);
  return { code, payload: JSON.parse(stdout) as ImprovePayload };
}

/** Find a category by slug, asserting it is present. */
function cat(payload: ImprovePayload, name: string): CategoryJson {
  const found = payload.data?.categories.find((c) => c.name === name);
  assert(found !== undefined, `expected a '${name}' category`);
  return found;
}

/** Find a rule by id within a category, asserting it is present. */
function rule(category: CategoryJson, id: string): RuleJson {
  const found = category.rules.find((r) => r.id === id);
  assert(found !== undefined, `expected a '${id}' rule in ${category.name}`);
  return found;
}

/** A config that wires every deterministic best practice (the passing path). */
const STRONG_CONFIG = `
[project]
slug = "strong-demo"
gotchas_doc = "docs/80-development/finish-gate-gotchas.md"

[meta]
bootstrapped = true
schema_version = 8

[capabilities]
format = "true"
lint = "true"
test = "true"

[worktree]
enabled = true

[ratchets.coverage]
limit = 1
run = "echo DISCERN_METRIC coverage 1"

[guidance]
agents = ["claude_code"]
sources = ["guidance.md"]
`;

/** Lay down the files the strong config's deterministic rules look for. */
async function writeStrongFiles(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, "guidance.md"),
    // Substantive prose (> the 400 non-whitespace-char substance threshold).
    "# Project guidance\n\n" +
      "This project follows a few hard conventions an agent could not infer from the code alone. "
        .repeat(8),
  );
  await ensureDir(join(dir, "docs", "_adr"));
  await Deno.writeTextFile(join(dir, "docs", "README.md"), "# Docs\n");
  await ensureDir(join(dir, "docs", "80-development"));
  await Deno.writeTextFile(
    join(dir, "docs", "80-development", "finish-gate-gotchas.md"),
    "# Gotchas\n",
  );
  await Deno.writeTextFile(
    join(dir, "docs", "_adr", "0001-first-decision.md"),
    "# 1. First decision\n",
  );
}

Deno.test("improve --json: a fresh install scores low and leads with one fix", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const { code, payload } = await improveJson(dir);

    assertEquals(
      code,
      0,
      "an improve run itself succeeds (advisory by default)",
    );
    assertEquals(payload.ok, true);
    assertEquals(payload.verb, "improve");
    assert(payload.data !== undefined);
    assert(
      payload.data.score < 50,
      `expected a low score, got ${payload.data.score}`,
    );
    assertEquals(payload.data.next_action.kind, "fix");
    assertEquals(payload.data.next_action.id, "gate.test");
    assert(payload.data.next_action.action.length > 0);
    assert(payload.data.next_action.why.length > 0);

    // The gate category is fully unwired → all three rules fail, each with a fix.
    const gate = cat(payload, "gate");
    assertEquals(gate.score, 0);
    for (const id of ["gate.test", "gate.static-analysis", "gate.format"]) {
      const r = rule(gate, id);
      assertEquals(r.status, "fail");
      assert(
        r.fix !== undefined && r.fix.length > 0,
        `${id} should carry a fix`,
      );
      assert(r.teach.length > 0, `${id} should carry a teach`);
    }

    // Not set up → the setup category flags it with the `discern setup` fix.
    assertEquals(
      rule(cat(payload, "setup"), "setup.bootstrapped").status,
      "fail",
    );
  });
});

Deno.test("improve --json: baseline 100 still leads with an open review", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STRONG_CONFIG);
    await writeStrongFiles(dir);
    // Compile the agent file from the guidance — the exact fix `guidance.compiled`
    // teaches, so the practice it checks is genuinely satisfied here.
    assertEquals((await runAgent(dir, ["refresh"])).code, 0);

    const { code, payload } = await improveJson(dir);
    assertEquals(code, 0);
    assert(payload.data !== undefined);
    // Every deterministic rule is satisfied → a perfect score, no weak rules.
    assertEquals(
      payload.data.score,
      100,
      JSON.stringify(payload.data.categories),
    );
    assertEquals(payload.data.weak, 0);
    assertEquals(payload.data.next_action.kind, "review");
    assertEquals(payload.data.next_action.id, "gate.fast-feedback");
    assertEquals(rule(cat(payload, "gate"), "gate.test").status, "pass");
    assertEquals(
      rule(cat(payload, "setup"), "setup.bootstrapped").status,
      "pass",
    );
    assertEquals(
      rule(cat(payload, "guidance"), "guidance.source").status,
      "pass",
    );
    assertEquals(rule(cat(payload, "docs"), "docs.adrs").status, "pass");
    assertEquals(rule(cat(payload, "ratchets"), "ratchets.any").status, "pass");
  });
});

Deno.test("improve --json: a set-but-missing gotchas doc is partial", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[project]\nslug = "x"\ngotchas_doc = "docs/nope.md"\n[meta]\nbootstrapped = true\n`,
    );
    const { payload } = await improveJson(dir);
    const r = rule(cat(payload, "setup"), "setup.gotchas-doc");
    assertEquals(r.status, "partial");
    assertStringIncludes(r.detail, "missing");
  });
});

Deno.test("improve --json: reviews carry the cited material", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STRONG_CONFIG);
    await writeStrongFiles(dir);

    const { payload } = await improveJson(dir);
    assert(payload.data !== undefined);
    assert(payload.data.open_reviews > 0, "expected open review items");

    // The guidance review cites guidance.md as the material to judge against.
    const review = cat(payload, "guidance").reviews.find(
      (rv) => rv.id === "guidance.project-specific",
    );
    assert(review !== undefined, "expected the guidance review item");
    assert(review.ask.length > 0 && review.teach.length > 0);
    assertEquals(review.against?.source, "guidance.md");
    assert(
      (review.against?.excerpt ?? "").length > 0,
      "the review should quote the guidance to judge",
    );
  });
});

Deno.test("improve --category: focuses one area; unknown is a clean error", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const focused = await improveJson(dir, ["--category", "gate"]);
    assertEquals(focused.code, 0);
    assertEquals(focused.payload.data?.categories.length, 1);
    assertEquals(focused.payload.data?.categories[0]?.name, "gate");

    const unknown = await improveJson(dir, ["--category", "bogus"]);
    assertEquals(unknown.code, 1);
    assertEquals(unknown.payload.ok, false);
    assertEquals(unknown.payload.error, "unknown_category");
    assertStringIncludes(unknown.payload.message ?? "", "known categories");
  });
});

Deno.test("improve --min-score: gates the build below the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // a weak install (~11/100)

    const below = await improveJson(dir, ["--min-score", "50"]);
    assertEquals(below.code, 1, "a score under the floor exits non-zero");
    assertEquals(below.payload.ok, false);
    assertEquals(below.payload.error, "below_min_score");

    const met = await improveJson(dir, ["--min-score", "1"]);
    assertEquals(met.code, 0, "a score at/above the floor exits zero");
    assertEquals(met.payload.ok, true);
  });
});

Deno.test("improve: a disabled feature category is skipped and rejected", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[meta]\nbootstrapped = true\n[features]\nratchets = false\n`,
    );

    const all = await improveJson(dir);
    assertEquals(
      all.payload.data?.categories.find((c) => c.name === "ratchets"),
      undefined,
      "the ratchets category vanishes when the feature is off",
    );

    const focused = await improveJson(dir, ["--category", "ratchets"]);
    assertEquals(focused.code, 1);
    assertEquals(focused.payload.error, "category_disabled");
  });
});

Deno.test("improve: the human report leads with coaching context", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Non-interactive (the subprocess has no TTY) → the full static report.
    const { code, stdout } = await runAgent(dir, [
      "improve",
      "--no-interactive",
    ]);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "discern improve");
    assertStringIncludes(stdout, "Baseline health");
    assertStringIncludes(stdout, "improvement reviews open");
    assertStringIncludes(stdout, "Next action:");
    assertStringIncludes(stdout, "weakest first");
    assertStringIncludes(stdout, "Quality gate");
    // A failing rule shows its fix line.
    assertStringIncludes(stdout, "fix:");
    // A subjective rule shows its ask line.
    assertStringIncludes(stdout, "ask:");
  });
});
