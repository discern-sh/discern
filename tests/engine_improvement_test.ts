/**
 * Engine coverage for `discern improvement` — the continuous-improvement coach.
 * Drives the real verb as a subprocess (so Cliffy parsing, the `--json` envelope,
 * the human report, the category filter, and the exit codes are all exercised), the
 * black-box parity oracle for the coach's behaviour.
 *
 * A `scaffoldEngine(dir, { bootstrapped: false })` install is deliberately weak —
 * nothing wired, not set up, no instructions/docs — so it exercises the failing/teaching
 * path; a second config wires the practices and exercises the passing path. The
 * pure scoring/ranking/catalog-integrity invariants are guarded separately in
 * `improve_catalog_test.ts`.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { stripAnsi } from "discern-design-system/cli";
import { DISCERN_TRIANGLE_GLYPHS } from "../art/terminal/triangle.ts";
import { runImprovement } from "../src/engine/improve/improve.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { displayWidth } from "../src/lib/text.ts";
import {
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  assertTerminalTextIncludes,
  unexpectedTerminalControls,
  withTempDir,
} from "./helpers.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

const PACKAGE_SECTION_TRIANGLES = new Set(
  Object.values(DISCERN_TRIANGLE_GLYPHS),
);

/** Locate one package triangle section at or after a previous section. */
function triangleSectionAt(
  output: string,
  label: string,
  after = 0,
): number {
  const renderedLabel = label.toLowerCase();
  let cursor = after;
  while (cursor < output.length) {
    const end = output.indexOf("\n", cursor);
    const lineEnd = end < 0 ? output.length : end;
    const line = output.slice(cursor, lineEnd);
    const renderedLine = line.toLowerCase();
    const decoration = renderedLine.replace(renderedLabel, "");
    const hasTriangle = [...PACKAGE_SECTION_TRIANGLES].some((glyph) =>
      decoration.includes(glyph)
    );
    if (
      renderedLine.includes(renderedLabel) &&
      (hasTriangle || /[<>^v]/u.test(decoration))
    ) {
      return cursor;
    }
    cursor = lineEnd + 1;
  }
  return -1;
}

type ImprovementPayload = CliResultForCommand<"improvement">;
type ImprovementData = Exclude<
  NonNullable<ImprovementPayload["data"]>,
  { issues: unknown }
>;
type ParsedImprovementPayload = ImprovementPayload & { data: ImprovementData };
type CategoryJson = ImprovementData["categories"][number];
type RuleJson = CategoryJson["rules"][number];

/** Run `improvement <args>` and parse its `--json` stdout. */
async function improvementJson(
  dir: string,
  args: string[] = [],
): Promise<{ code: number; payload: ParsedImprovementPayload }> {
  const { code, stdout } = await runAgent(dir, [
    "improvement",
    "--json",
    ...args,
  ]);
  const payload = decodeCliResult(stdout, "improvement");
  assertResultDataKey(payload, "categories");
  return { code, payload };
}

/** Find a category by slug, asserting it is present. */
function cat(payload: ParsedImprovementPayload, name: string): CategoryJson {
  assertExists(payload.data.categories);
  const found = payload.data.categories.find((c) => c.name === name);
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
agents = ["claude_code"]
gotchas_doc = "docs/80-development/done-gate-gotchas.md"

[meta]
bootstrapped = true
schema_version = 8

[jobs]
format = "true"
lint = "true"
test = "true"

[worktree]

[standards.coverage]
direction = "up"
limit = 1
run = "echo DISCERN_METRIC coverage 1"

[instructions]
sources = ["instructions.md"]

[map]
dir = "docs/"
`;

/** Lay down the files the strong config's deterministic rules look for. */
async function writeStrongFiles(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, "instructions.md"),
    // Substantive prose (> the 400 non-whitespace-char substance threshold).
    "# Project instructions\n\n" +
      "This project follows a few hard conventions an agent could not infer from the code alone. "
        .repeat(8),
  );
  await ensureDir(join(dir, "docs", "_adr"));
  await Deno.writeTextFile(join(dir, "docs", "README.md"), "# Docs\n");
  await ensureDir(join(dir, "docs", "80-development"));
  await Deno.writeTextFile(
    join(dir, "docs", "80-development", "done-gate-gotchas.md"),
    "# Gotchas\n",
  );
  await Deno.writeTextFile(
    join(dir, "docs", "_adr", "0001-first-decision.md"),
    "# 1. First decision\n",
  );
}

Deno.test("improvement --json: a fresh install scores low and leads with one fix", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const { code, payload } = await improvementJson(dir);

    assertEquals(
      code,
      0,
      "an improvement run itself succeeds (advisory by default)",
    );
    assertEquals(payload.ok, true);
    assertEquals(payload.verb, "improvement");
    assert(payload.data !== undefined);
    assert(
      payload.data.score < 50,
      `expected a low score, got ${payload.data.score}`,
    );
    assertEquals(payload.data.next_action.kind, "fix");
    assertEquals(payload.data.next_action.id, "gate.test");
    assert(payload.data.next_action.action.length > 0);
    assert(payload.data.next_action.why.length > 0);

    // The embedded formatter is wired, while the project's checks remain unset.
    const gate = cat(payload, "gate");
    assertEquals(gate.score, 17);
    assertEquals(rule(gate, "gate.format").status, "pass");
    for (const id of ["gate.test", "gate.static-analysis"]) {
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

Deno.test("improvement --json: baseline 100 still leads with an open review", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STRONG_CONFIG);
    await writeStrongFiles(dir);
    // Compile the agent file from the instructions — the exact fix `instructions.compiled`
    // teaches, so the practice it checks is genuinely satisfied here.
    assertEquals((await runAgent(dir, ["refresh"])).code, 0);

    const { code, payload } = await improvementJson(dir);
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
    assertEquals(
      payload.data.next_action.against?.source,
      "the configured test command",
    );
    assert(
      (payload.data.next_action.against?.excerpt ?? "").length > 0,
      "the selected review must carry its citation through next_action",
    );
    assertEquals(rule(cat(payload, "gate"), "gate.test").status, "pass");
    assertEquals(
      rule(cat(payload, "setup"), "setup.bootstrapped").status,
      "pass",
    );
    assertEquals(
      rule(cat(payload, "instructions"), "instructions.source").status,
      "pass",
    );
    assertEquals(rule(cat(payload, "map"), "map.adrs").status, "pass");
    assertEquals(
      rule(cat(payload, "standards"), "standards.any").status,
      "pass",
    );
  });
});

Deno.test({
  name:
    "improvement: every render path keeps a selected review with its citation",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, STRONG_CONFIG);
      await writeStrongFiles(dir);
      assertEquals((await runAgent(dir, ["refresh"])).code, 0);

      const json = await improvementJson(dir);
      const selected = json.payload.data?.next_action;
      assert(selected?.kind === "review", "fixture must select a review");
      assert(
        selected.against !== undefined,
        "JSON review must include against",
      );

      const piped = await runAgent(dir, ["improvement", "--plain"]);
      assertEquals(piped.code, 0);
      const tty = await runAgentPty(dir, [
        "improvement",
        "--plain",
      ]);
      assertEquals(tty.code, 0);

      // The render-path class guard: a new path enrolls here, and every path
      // keeps the review prose and citation together. TTY forces static output
      // only to terminate the PTY; its summary is the block shown before the picker.
      const paths = [
        { name: "--json", rendered: JSON.stringify(selected) },
        { name: "piped", rendered: piped.stdout },
        { name: "TTY", rendered: tty.stdout },
      ];
      for (const path of paths) {
        assertStringIncludes(path.rendered, selected.title, path.name);
        assertStringIncludes(path.rendered, selected.against.source, path.name);
        assertStringIncludes(
          path.rendered,
          selected.against.excerpt,
          path.name,
        );
        if (path.name !== "--json") {
          assert(
            triangleSectionAt(path.rendered, "Next action") >= 0,
            `${path.name} is missing the package-backed Next action section`,
          );
        }
      }
    });
  },
});

Deno.test("improvement --json: a set-but-missing gotchas doc is partial", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[project]\nslug = "x"\ngotchas_doc = "docs/nope.md"\n[meta]\nbootstrapped = true\n`,
    );
    const { payload } = await improvementJson(dir);
    const r = rule(cat(payload, "setup"), "setup.gotchas-doc");
    assertEquals(r.status, "partial");
    assertStringIncludes(r.detail, "missing");
  });
});

Deno.test("improvement --json: reviews carry the cited material", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STRONG_CONFIG);
    await writeStrongFiles(dir);

    const { payload } = await improvementJson(dir);
    assert(payload.data !== undefined);
    assert(payload.data.open_reviews > 0, "expected open review items");

    // The instructions review cites instructions.md as the material to judge against.
    const review = cat(payload, "instructions").reviews.find(
      (rv) => rv.id === "instructions.project-specific",
    );
    assert(review !== undefined, "expected the instructions review item");
    assert(review.ask.length > 0 && review.teach.length > 0);
    assertEquals(review.against?.source, "instructions.md");
    assert(
      (review.against?.excerpt ?? "").length > 0,
      "the review should quote the instructions to judge",
    );

    const structured = cat(payload, "gate").reviews.find(
      (rv) => rv.id === "gate.structured-diagnostics",
    );
    assert(structured !== undefined, "expected the structured-output review");
    assertEquals(
      structured.against?.source,
      "the configured check and test jobs",
    );
    assertStringIncludes(structured.against?.excerpt ?? "", "lint:");
    assertStringIncludes(structured.against?.excerpt ?? "", "test:");

    for (
      const [category, id] of [
        ["gate", "gate.test-depth"],
        ["gate", "gate.structured-diagnostics"],
        ["setup", "setup.failure-memory"],
        ["map", "map.navigation"],
        ["standards", "standards.normalize"],
        ["skills", "skills.executable"],
      ] as const
    ) {
      assert(
        cat(payload, category).reviews.some((item) => item.id === id),
        `expected the ${id} teaching review`,
      );
    }
  });
});

Deno.test("improvement: a configured checkpoint's question renders in the improvement audit", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `${STRONG_CONFIG}
[checkpoints.api-review]
paths = ["src/api/**"]
question = "A changed interface is described before it lands."
`,
    );
    await writeStrongFiles(dir);

    const { payload } = await improvementJson(dir);
    const checkpoints = cat(payload, "checkpoints");
    // The standing placement review teaches the ladder; the audited row carries
    // the checkpoint's identity — same id and prose the checkpoints verb reports.
    const placement = checkpoints.reviews.find(
      (review) => review.id === "checkpoints.opportunity",
    );
    assert(placement !== undefined, "the placement review is standing");
    assertStringIncludes(placement.teach, "→ a checkpoint");
    assertStringIncludes(placement.teach, "outlaw procedure");
    assertEquals(placement.against?.excerpt, "configured: api-review");
    const audited = checkpoints.reviews.find(
      (review) => review.id === "api-review",
    );
    assert(audited !== undefined, "the configured checkpoint renders a row");
    assertEquals(
      audited.ask,
      "A changed interface is described before it lands.",
    );
    assertEquals(audited.boundary, [{
      checkpoint: "api-review",
      mode: "stop",
    }]);
    assertEquals(audited.against?.source, "[checkpoints.api-review]");

    // The human report keeps the stock/flow line visible.
    const focused = await runAgent(dir, [
      "improvement",
      "--category",
      "checkpoints",
      "--plain",
    ]);
    assertEquals(focused.code, 0);
    assertTerminalTextIncludes(
      focused.stdout,
      "The existing work behind checkpoint",
    );
    assertTerminalTextIncludes(focused.stdout, "'api-review' (stop)");
    assertTerminalTextIncludes(
      focused.stdout,
      "audits what the boundary already tolerates",
    );
  });
});

Deno.test("improvement: variance evidence becomes an owner decision, declared-unmet preserved", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `${STRONG_CONFIG}
[checkpoints.api-review]
paths = ["src/api/**"]
question = "A changed interface is described before it lands."
`,
    );
    await writeStrongFiles(dir);
    assertEquals((await runAgent(dir, ["refresh"])).code, 0);
    await gitInit(dir);
    // Three landed efforts where the checkpoint fired, each under an
    // owner-authorized variance — the shared frequently-varied bar.
    const event = (at: string, over: Record<string, unknown>) => ({
      schema: 1,
      at,
      kind: "verb",
      verb: "done",
      surface: "cli",
      writer: "9.9.9",
      driver: { session: "cli:1", json: true, tty: false, ci: false },
      head: "abc1234",
      clean: true,
      outcome: "ok",
      duration_ms: 1_000,
      epoch: "e1",
      ...over,
    });
    const events: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const branch = `agent/effort-${i}`;
      events.push(
        event(`2026-07-01T0${i}:00:00.000Z`, {
          branch,
          checkpoints: { fired: [{ id: "api-review" }] },
        }),
        event(`2026-07-01T0${i}:30:00.000Z`, {
          branch,
          verb: "accept",
          checkpoints: { variances: [{ id: "api-review" }] },
        }),
      );
    }
    const logbook = join(dir, ".git", "discern", "logbook");
    await ensureDir(logbook);
    await Deno.writeTextFile(
      join(logbook, "2026-07.jsonl"),
      events.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    const { payload } = await improvementJson(dir);
    assert(payload.data !== undefined);
    const recommendations = payload.data.recommendations ?? [];
    assertEquals(recommendations.length, 1);
    const review = recommendations[0];
    assert(review !== undefined);
    assertEquals(review.id, "checkpoints.review");
    assertEquals(review.subject, "api-review");
    assertStringIncludes(review.evidence.excerpt, "3 of 3 landed efforts");
    assertStringIncludes(review.why, "declared-unmet");
    assertStringIncludes(review.why, "never records the question as met");
    // With the baseline clear, the decision leads the next action.
    assertEquals(payload.data.next_action.kind, "decide");
    assertEquals(payload.data.next_action.id, "checkpoints.review");

    // The human report renders the decision group with its evidence.
    const { code, stdout } = await runAgent(dir, ["improvement", "--plain"]);
    assertEquals(code, 0);
    assert(
      triangleSectionAt(stdout, "Owner decisions") >= 0,
      "the owner-decisions section renders",
    );
    assertTerminalTextIncludes(stdout, "often lands under a variance");
    assertTerminalTextIncludes(stdout, "Decide");
    assertTerminalTextIncludes(stdout, "never records the question as met");
  });
});

Deno.test("improvement --category: focuses one area; unknown is a clean error", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const focused = await improvementJson(dir, ["--category", "gate"]);
    assertEquals(focused.code, 0);
    assertEquals(focused.payload.data?.categories.length, 1);
    assertEquals(focused.payload.data?.categories[0]?.name, "gate");

    const unknown = await improvementJson(dir, ["--category", "bogus"]);
    assertEquals(unknown.code, 1);
    assertEquals(unknown.payload.ok, false);
    assertEquals(unknown.payload.error, "unknown_category");
    assertStringIncludes(unknown.payload.message ?? "", "known categories");
  });
});

Deno.test("improvement --min-score: gates the build below the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // a weak install (0/100)

    const below = await improvementJson(dir, ["--min-score", "50"]);
    assertEquals(below.code, 1, "a score under the floor exits non-zero");
    assertEquals(below.payload.ok, false);
    assertEquals(below.payload.error, "below_min_score");

    const met = await improvementJson(dir, ["--min-score", "0"]);
    assertEquals(met.code, 0, "a score at/above the floor exits zero");
    assertEquals(met.payload.ok, true);
  });
});

Deno.test("improvement: every catalog category is always reviewed; an unknown one is rejected", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `[meta]\nbootstrapped = true\n`);

    // The subsystems are all core (ADR 0101): the standards category is reviewed
    // even with no standard configured — the coaching is exactly "define one".
    const all = await improvementJson(dir);
    assert(
      all.payload.data?.categories.some((c) => c.name === "standards"),
      "the standards category is always part of the catalog",
    );

    const focused = await improvementJson(dir, ["--category", "bogus"]);
    assertEquals(focused.code, 1);
    assertEquals(focused.payload.error, "unknown_category");
  });
});

Deno.test("improvement: every human report group has a visible section", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const { payload } = await improvementJson(dir);
    // Non-interactive (the subprocess has no TTY) → the full static report.
    const { code, stdout } = await runAgent(dir, [
      "improvement",
      "--plain",
    ]);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "discern improvement");
    assertStringIncludes(stdout, "Automated practice health");
    assertStringIncludes(stdout, "Reviews open:");
    const labels = [
      "Health",
      "Next action",
      "Steps",
      "Areas",
      ...(payload.data?.categories.map((category) => category.title) ?? []),
      "Commands",
    ];
    let after = 0;
    for (const label of labels) {
      const at = triangleSectionAt(stdout, label, after);
      assert(
        at >= after,
        `expected package triangle section '${label}' after byte ${after}`,
      );
      after = at + label.length;
    }
    // A failing rule shows its fix line.
    assertStringIncludes(stdout, "Fix:");
    // A subjective rule shows its ask line.
    assertStringIncludes(stdout, "Review question:");
  });
});

Deno.test("improvement: responsive package reports keep hostile evidence inert and cap at 104 columns", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STRONG_CONFIG);
    await writeStrongFiles(dir);
    await Deno.writeTextFile(
      join(dir, "instructions.md"),
      `Project evidence \u001b[31m\u0007\u009b stays visible. ${
        "These are project-specific instructions with enough substance to review. "
          .repeat(10)
      }`,
    );
    assertEquals((await runAgent(dir, ["refresh"])).code, 0);

    const outputs = new Map<number, string>();
    for (const width of [39, 80, 104, 400]) {
      const run = await runAgent(
        dir,
        ["improvement", "--category", "instructions", "--plain"],
        {
          env: {
            COLUMNS: String(width),
            LINES: "24",
            TERM: "xterm-256color",
            LANG: "en_US.UTF-8",
          },
        },
      );
      assertEquals(run.code, 0);
      outputs.set(width, run.stdout);
      assert(
        triangleSectionAt(run.stdout, "Agent instructions") >= 0,
        "the category needs its package-backed heading",
      );
      assertTerminalTextIncludes(run.stdout, "Review question:");
      assertTerminalTextIncludes(
        run.stdout.replaceAll(/\s+/gu, " "),
        "Project evidence ␛[31m␇<U+009B>",
      );
      assert(!run.stdout.includes("\u001b[31m"));
      assert(!run.stdout.includes("\u009b"));
      assert(
        unexpectedTerminalControls(run.stdout).length === 0,
        `${width}-column improvement output contains a raw terminal control`,
      );
      const budget = Math.min(width, 104);
      for (const line of run.stdout.split("\n")) {
        assert(
          displayWidth(line) <= budget,
          `${width}-column improvement line is ${
            displayWidth(line)
          } columns: ${line}`,
        );
      }
    }
    assertEquals(outputs.get(400), outputs.get(104));
  });
});

Deno.test("improvement: one injected context controls colour and width without re-observation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const render = async (
      width: number,
      color: boolean,
    ): Promise<string> => {
      let processObservations = 0;
      const values: Readonly<Record<string, string>> = {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "en_US.UTF-8",
      };
      const terminal = resolveTerminalContext({
        noColor: !color,
        env: {
          get(name: string): string | undefined {
            processObservations++;
            return values[name];
          },
        },
        isTerminal: () => {
          processObservations++;
          return true;
        },
        consoleSize: () => {
          processObservations++;
          return { columns: width, rows: 24 };
        },
      });
      const observationsAtBoundary = processObservations;
      let stdout = "";
      let stderr = "";
      assertEquals(
        await runImprovement(dir, {
          json: false,
          category: "instructions",
          terminal,
          stdout: (text) => stdout += text,
          stderr: (text) => stderr += text,
        }),
        0,
      );
      assertEquals(stderr, "");
      assertEquals(
        processObservations,
        observationsAtBoundary,
        "rendering must consume the injected snapshot without reading its process seams again",
      );
      return stdout;
    };

    const narrow = await render(39, true);
    const wide = await render(80, false);
    const narrowPlain = stripAnsi(narrow);
    assert(narrow !== narrowPlain, "the injected colour capability must win");
    assertEquals(
      wide,
      stripAnsi(wide),
      "the injected no-colour policy must win",
    );
    for (const line of narrowPlain.split("\n")) {
      assert(
        displayWidth(line) <= 39,
        `injected 39-column context produced ${displayWidth(line)} columns`,
      );
    }
    assert(
      narrowPlain.split("\n").length > wide.split("\n").length,
      "the injected narrow viewport must produce the more wrapped report",
    );
  });
});

Deno.test({
  name:
    "improvement: truecolour, 256, 16, and no-colour package modes keep the same coaching facts",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, STRONG_CONFIG);
      await writeStrongFiles(dir);

      const modes = [
        {
          name: "truecolour",
          env: {
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            NO_COLOR: "",
          },
          marker: "\u001b[38;2;",
        },
        {
          name: "256",
          env: { TERM: "xterm-256color", COLORTERM: "", NO_COLOR: "" },
          marker: "\u001b[38;5;",
        },
        {
          name: "16",
          env: { TERM: "xterm-color", COLORTERM: "", NO_COLOR: "" },
          marker: "\u001b[",
        },
        {
          name: "no-colour",
          env: {
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            NO_COLOR: "1",
          },
          marker: "",
        },
      ] as const;
      let baseline: string | undefined;
      for (const mode of modes) {
        const run = await runAgentPty(
          dir,
          ["improvement", "--category", "instructions"],
          { env: { ...mode.env, LANG: "en_US.UTF-8" } },
        );
        assertEquals(run.code, 0);
        const rendered = run.stdout.replaceAll("\r", "");
        if (mode.marker === "") {
          assert(!rendered.includes("\u001b["), mode.name);
        } else {
          assertStringIncludes(rendered, mode.marker, mode.name);
        }
        const facts = stripAnsi(rendered);
        assert(
          triangleSectionAt(facts, "Agent instructions") >= 0,
          `${mode.name} lost the category heading`,
        );
        assertStringIncludes(facts, "Review question:");
        baseline ??= facts;
        assertEquals(facts, baseline, `${mode.name} changed coaching facts`);
      }
    });
  },
});
