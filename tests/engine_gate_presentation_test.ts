/** Closed-set and composition coverage for the Gate's pure CLI presentation. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  DISCERN_TRIANGLE_SPINNER_ORDER,
  stripAnsi,
} from "discern-design-system/cli";
import { DISCERN_TRIANGLE_GLYPHS } from "../art/terminal/triangle.ts";
import {
  createGateTtyProgress,
  type GateProgressScheduler,
  gateTtyPresentation,
  gateTtyProgressCanRepaint,
  renderGateTtyProgressTable,
  renderGateTtyTable,
} from "../src/engine/gate/gate_tty.ts";
import {
  GATE_DIAGNOSTIC_SEVERITY,
  GATE_FAILED_STAGE_LABEL,
  GATE_JOB_STATUS_LABEL,
  GATE_JOB_STEP_STATUS,
  GATE_LANDING_AUTHORITY_PRESENTATION,
  GATE_PLAN_STEP_STATUS,
  GATE_PROOF_CHECK_PRESENTATION,
  GATE_PROOF_RECORD_PRESENTATION,
  GATE_STANDARD_DIRECTION,
  GATE_STANDARD_MEASUREMENT_LABEL,
  GATE_STANDARD_TREND,
  renderGateDiagnostics,
  renderGateFailureSummary,
  renderGatePlan,
  renderGateProofCheckReceipt,
  renderGateProofReceipt,
  renderGateStandards,
} from "../src/engine/gate/presentation.ts";
import {
  renderProofLine,
  renderProofMarkdown,
} from "../src/engine/gate/proof_render.ts";
import { buildGatePlan, type JobGroup } from "../src/engine/gate/plan.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";
import {
  type Diagnostic,
  DIAGNOSTIC_SEVERITIES,
  type EnginePlan,
  FAILED_STAGES,
  STEP_DISPOSITIONS,
  STEP_OUTCOMES,
  type StepResult,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import {
  GATE_PROOF_CHECK_STATUSES,
  type GateData,
  type GateStandard,
  type Proof,
  STANDARD_MEASUREMENTS,
  STANDARD_VERDICTS,
} from "../src/shared/result_schemas.ts";
import { LANDING_AUTHORITY_KINDS } from "../src/shared/consent.ts";
import { displayWidth } from "../src/lib/text.ts";
import { fakeEnv } from "./helpers.ts";

type GateProofRecord = NonNullable<GateData["gate_proof"]>;

/** Construct one explicit terminal context without touching process state. */
function terminal(options: {
  readonly color?: "none" | "ansi16" | "ansi256" | "truecolor";
  readonly unicode?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  readonly stdoutIsTerminal?: boolean;
  readonly ci?: string;
} = {}): TerminalContext {
  const color = options.color ?? "none";
  const unicode = options.unicode ?? true;
  const columns = options.columns ?? 80;
  const env: Record<string, string> = {
    TERM: color === "ansi256" || color === "truecolor"
      ? "xterm-256color"
      : "xterm",
    LANG: unicode ? "en_GB.UTF-8" : "C",
    ...(color === "truecolor" ? { COLORTERM: "truecolor" } : {}),
    ...(options.ci === undefined ? {} : { CI: options.ci }),
  };
  return resolveTerminalContext({
    noColor: color === "none",
    env: fakeEnv(env),
    isTerminal: () => options.stdoutIsTerminal ?? true,
    consoleSize: () => ({ columns, rows: options.rows ?? 24 }),
  });
}

const PLAIN = terminal();

const TRIANGLE_WEAVE = [
  DISCERN_TRIANGLE_GLYPHS.upRight,
  DISCERN_TRIANGLE_GLYPHS.downRight,
  DISCERN_TRIANGLE_GLYPHS.upLeft,
  DISCERN_TRIANGLE_GLYPHS.downLeft,
].join("");
const TRIANGLE_RULE_TAIL = [
  DISCERN_TRIANGLE_GLYPHS.downRight,
  DISCERN_TRIANGLE_GLYPHS.upRight,
  DISCERN_TRIANGLE_GLYPHS.downLeft,
  DISCERN_TRIANGLE_GLYPHS.upLeft,
].join("");

const GROUP: JobGroup = {
  stage: "check",
  mode: "parallel",
  heading: "Checking...",
  display: "Check",
  jobs: ["format", "lint", "types", "test"].map((label) => ({
    label,
    command: `run ${label}`,
    kind: "known",
    reportStage: "check",
    willRun: true,
  })),
};

const CURRENT_GATE_GROUPS = buildGatePlan(
  parseConfigOrThrow([
    "[project]",
    'slug = "gate-viewport"',
    "agents = []",
    "",
    "[guidance]",
    "sources = []",
    "",
    "[jobs]",
    'format = "deno fmt"',
    'build = "deno task build"',
    'lint = "deno lint"',
    'typecheck = "deno check"',
    'test = "deno task test"',
    'smoke = "deno task smoke"',
  ].join("\n")),
  [],
).groups;

const OK_FORMAT: JobResult = {
  label: "format",
  status: "ok",
  code: 0,
  durationS: 1,
  outputLines: 0,
  errorLikeLines: 0,
};

const PROOF_FACTS = {
  branch: "agent/gate-components",
  trunk: "main",
  head: "abc1234def01",
  files_total: 2,
  insertions: 42,
  deletions: 7,
} as const;

const PROOF_STEPS: StepResult[] = [{
  step: {
    kind: "job",
    label: verbatimStepLabel("test"),
    disposition: "run",
    note: "deno task test",
    group: "Check & test",
  },
  outcome: "ok",
  durationS: 2,
}, {
  step: {
    kind: "scope-gate",
    label: verbatimStepLabel("scope:site"),
    disposition: "skip",
    note: "scope unchanged",
    group: "Scope gates",
  },
  outcome: "skipped",
}];

const PROOF: Proof = {
  ...PROOF_FACTS,
  line: renderProofLine(PROOF_FACTS),
  markdown: renderProofMarkdown(PROOF_FACTS, PROOF_STEPS),
};

/** Assert two finite key sets are identical without relying on order. */
function assertKeys(
  actual: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  assertEquals(Object.keys(actual).sort(), [...expected].sort());
}

/** Assert every rendered line fits its full terminal width. */
function assertWithinWidth(rendered: string, width: number): void {
  for (const line of rendered.split("\n")) {
    assert(
      displayWidth(line) <= width,
      `line is ${displayWidth(line)} columns at width ${width}: ${line}`,
    );
  }
}

Deno.test("Gate presentation mappings cover every closed typed state", () => {
  assertKeys(GATE_JOB_STEP_STATUS, [...STEP_OUTCOMES, "pending", "running"]);
  assertKeys(GATE_JOB_STATUS_LABEL, [...STEP_OUTCOMES, "pending", "running"]);
  assertKeys(GATE_PLAN_STEP_STATUS, STEP_DISPOSITIONS);
  assertKeys(GATE_FAILED_STAGE_LABEL, FAILED_STAGES);
  assertKeys(GATE_DIAGNOSTIC_SEVERITY, DIAGNOSTIC_SEVERITIES);
  assertKeys(GATE_STANDARD_DIRECTION, ["up", "down"]);
  assertKeys(GATE_STANDARD_TREND, STANDARD_VERDICTS);
  assertKeys(GATE_STANDARD_MEASUREMENT_LABEL, STANDARD_MEASUREMENTS);
  assertKeys(GATE_PROOF_CHECK_PRESENTATION, GATE_PROOF_CHECK_STATUSES);
  assertKeys(GATE_LANDING_AUTHORITY_PRESENTATION, LANDING_AUTHORITY_KINDS);
  assertKeys(
    GATE_PROOF_RECORD_PRESENTATION,
    [
      "recorded",
      "skipped_dirty",
      "skipped_head_moved",
      "unavailable",
      "record_failed",
      "cleared",
      "clear_failed",
    ] satisfies GateProofRecord["status"][],
  );
});

Deno.test("Gate TTY selection consumes only injected attachment, CI, plain, JSON, and width facts", () => {
  const live = terminal({ columns: 93, ci: "false" });
  assertEquals(gateTtyPresentation(false, false, live), {
    ttyWidth: 93,
    liveWidth: 93,
  });

  const ci = terminal({ columns: 71, ci: "  TRUE " });
  assertEquals(gateTtyPresentation(false, false, ci), { ttyWidth: 71 });
  assertEquals(gateTtyPresentation(false, true, live), { ttyWidth: 93 });
  assertEquals(
    gateTtyPresentation(
      false,
      false,
      terminal({ columns: 67, stdoutIsTerminal: false }),
    ),
    {},
  );
  assertEquals(gateTtyPresentation(true, false, live), {});
});

Deno.test("Gate receipt makes landing readiness explicit without claiming consent", () => {
  const authorized = renderGateProofReceipt(
    PROOF,
    { status: "recorded" },
    PROOF_STEPS,
    { width: 76, terminal: PLAIN },
    { kind: "authorized", source: "effort-grant" },
  );
  assertStringIncludes(authorized, "Landing authority");
  assertStringIncludes(authorized, "effort-grant");
  assertStringIncludes(authorized, "authorized");

  const conversational = renderGateProofReceipt(
    PROOF,
    { status: "recorded" },
    PROOF_STEPS,
    { width: 76, terminal: PLAIN },
    {
      kind: "conversation-required",
      uncovered: [{ path: "src/gate.ts", scopes: ["engine"] }],
    },
  );
  assertStringIncludes(conversational, "conversation required");
  assertStringIncludes(conversational, "1 uncovered");
  assertStringIncludes(conversational, "Landing still needs");
  assertStringIncludes(conversational, "conversation consent");
  assertEquals(conversational.includes("Landing is authorized"), false);
});

Deno.test("Gate presentation renders every failure stage through ResultSummary", () => {
  for (const stage of FAILED_STAGES) {
    const rendered = renderGateFailureSummary(
      "done",
      "The Gate stopped.",
      [],
      { width: 80, terminal: PLAIN },
      stage,
    );
    assertStringIncludes(rendered, "Failed: discern done failed");
    assertStringIncludes(rendered, GATE_FAILED_STAGE_LABEL[stage]);
    assertStringIncludes(rendered, "The Gate stopped.");
  }
});

Deno.test("Gate progress: a stable 25 percent frame pins Component composition", () => {
  const actual = renderGateTtyProgressTable(
    [GROUP],
    new Set(),
    new Map([["format", OK_FORMAT]]),
    { width: 54, terminal: PLAIN },
  );
  const expected = [
    "Gate progress  1 / 4 steps settled",
    `[ 25%] ${TRIANGLE_WEAVE.repeat(2)}${
      TRIANGLE_WEAVE.slice(0, 3)
    }..................................`,
    "",
    "Check",
    "",
    `${TRIANGLE_WEAVE.repeat(5)}${TRIANGLE_WEAVE.slice(0, 2)} Steps ${
      TRIANGLE_RULE_TAIL.repeat(5)
    }${TRIANGLE_RULE_TAIL.slice(0, 3)}`,
    ` ${DISCERN_TRIANGLE_GLYPHS.upRight}  format [passed]`,
    " │",
    " ·  lint [pending]",
    " │",
    " ·  types [pending]",
    " │",
    " ·  test [pending]",
    "",
    "Complete when: Every configured step reaches a final",
    "               reported state.",
    "",
    "$ run format",
    "format: Configured known job passed in 1s.",
    "",
    "$ run lint",
    "lint: Configured known job pending.",
    "",
    "$ run types",
    "types: Configured known job pending.",
    "",
    "$ run test",
    "test: Configured known job pending.",
  ].join("\n");
  assertEquals(actual, expected);
});

Deno.test("Gate progress: Unicode and ASCII expose every package spinner phase", () => {
  assertEquals(DISCERN_TRIANGLE_SPINNER_ORDER.length, 4);
  const unicode = new Set<string>();
  const ascii = new Set<string>();
  for (let phase = 0; phase < DISCERN_TRIANGLE_SPINNER_ORDER.length; phase++) {
    const args = [
      [GROUP],
      new Set(["lint"]),
      new Map<string, JobResult>(),
    ] as const;
    const unicodeFrame = renderGateTtyProgressTable(
      ...args,
      { width: 50, terminal: PLAIN },
      phase,
    );
    const asciiFrame = renderGateTtyProgressTable(
      ...args,
      { width: 50, terminal: terminal({ unicode: false }) },
      phase,
    );
    unicode.add(
      unicodeFrame.split("\n").find((line) => line.includes("lint [running]"))
        ?.split(" ")[0] ?? "",
    );
    ascii.add(
      asciiFrame.split("\n").find((line) => line.includes("lint [running]"))
        ?.split(" ")[0] ?? "",
    );
  }
  assertEquals(
    [...unicode].sort(),
    DISCERN_TRIANGLE_SPINNER_ORDER.map((name) =>
      `[${DISCERN_TRIANGLE_GLYPHS[name]}]`
    ).sort(),
  );
  assertEquals([...ascii].sort(), ["[>]", "[v]", "[^]", "[<]"].sort());
});

Deno.test("Gate progress controller injects time, resize, cancellation, and scheduler stop", async () => {
  let callback: (() => void) | undefined;
  let stops = 0;
  let now = 1_000;
  const scheduler: GateProgressScheduler = {
    repeat(next, intervalMs): () => void {
      assertEquals(intervalMs, 50);
      callback = next;
      return (): void => {
        stops += 1;
      };
    },
  };
  const writes: string[] = [];
  const progress = createGateTtyProgress((value) => writes.push(value), {
    width: 54,
    terminal: terminal({ columns: 54, rows: 200 }),
    scheduler,
    intervalMs: 50,
    clock: () => now,
  });
  progress.start([GROUP]);
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);
  progress.started(lint);
  await Promise.resolve();
  assert(callback !== undefined);
  now = 3_000;
  callback?.();
  await Promise.resolve();
  assertStringIncludes(writes.at(-1) ?? "", "running for 2s");

  progress.resize({ columns: 34, rows: 200 });
  assertStringIncludes(writes.at(-1) ?? "", "run lint");
  const frame = (writes.at(-1) ?? "").split("\x1b[J").at(-1) ?? "";
  assertWithinWidth(frame.trimEnd(), 34);

  progress.settled({
    label: "lint",
    status: "failed",
    code: 1,
    durationS: 2,
    outputLines: 0,
    errorLikeLines: 0,
    cancelled: true,
  });
  await Promise.resolve();
  assertEquals(stops, 1);
  assertStringIncludes(writes.at(-1) ?? "", "cancelled");

  progress.complete(PROOF_STEPS);
  assertEquals(stops, 1);
  const completedFrame = writes.at(-1) ?? "";
  assertStringIncludes(completedFrame, "scope:site [skipped]");
  assert(completedFrame.endsWith("\n"));
  assertEquals(completedFrame.endsWith("\x1b[J"), false);
  const completedWriteCount = writes.length;
  callback?.();
  progress.resize({ columns: 20, rows: 200 });
  await Promise.resolve();
  assertEquals(
    writes.length,
    completedWriteCount,
    "ticks and resizes must not erase or replace the completed static frame",
  );
  assertThrows(
    () =>
      createGateTtyProgress(() => {}, {
        width: 80,
        terminal: PLAIN,
        intervalMs: 0,
      }),
    TypeError,
    "positive safe integer",
  );
});

Deno.test("Gate progress never repaints a frame taller than its viewport", async () => {
  let tick: (() => void) | undefined;
  let stops = 0;
  const writes: string[] = [];
  const progress = createGateTtyProgress((value) => writes.push(value), {
    width: 54,
    terminal: terminal({ columns: 54, rows: 12 }),
    scheduler: {
      repeat(callback): () => void {
        tick = callback;
        return (): void => {
          stops += 1;
        };
      },
    },
  });

  progress.start(CURRENT_GATE_GROUPS);
  const lint = CURRENT_GATE_GROUPS.flatMap((group) => group.jobs).find((job) =>
    job.label === "lint"
  );
  assert(lint !== undefined);
  progress.started(lint);
  await Promise.resolve();
  tick?.();
  await Promise.resolve();

  assertEquals(
    writes.some((value) => value.includes("\x1b[")),
    false,
    "an unaddressable frame must never enter cursor-up repainting",
  );
  assertEquals(
    tick,
    undefined,
    "static fallback never starts an activity ticker",
  );
  assertEquals(stops, 0);

  progress.complete(PROOF_STEPS);
  assertEquals(
    writes.filter((value) => value.includes("Gate progress")).length,
    1,
    "the completed Gate is emitted once as static output",
  );
  assertStringIncludes(writes.at(-1) ?? "", "scope:site [skipped]");
  assertEquals(writes.at(-1)?.includes("\x1b["), false);
});

Deno.test("Gate repaint admission counts the production trailing-newline row", () => {
  const width = 54;
  const rendered = renderGateTtyProgressTable(
    [GROUP],
    new Set(),
    new Map(),
    { width, terminal: terminal({ columns: width, rows: 200 }) },
  );
  const frameRows = `${rendered}\n`.split("\n").length;
  assertEquals(
    gateTtyProgressCanRepaint([GROUP], {
      width,
      terminal: terminal({ columns: width, rows: frameRows }),
    }),
    true,
  );
  assertEquals(
    gateTtyProgressCanRepaint([GROUP], {
      width,
      terminal: terminal({ columns: width, rows: frameRows - 1 }),
    }),
    false,
  );

  const writes: string[] = [];
  const progress = createGateTtyProgress((value) => writes.push(value), {
    width,
    terminal: terminal({ columns: width, rows: frameRows - 1 }),
  });
  progress.start([GROUP]);
  assertEquals(writes, ["\n"]);
});

Deno.test("Gate progress abandons repainting after an injected viewport shrink", async () => {
  let tick: (() => void) | undefined;
  let stops = 0;
  const writes: string[] = [];
  const progress = createGateTtyProgress((value) => writes.push(value), {
    width: 54,
    terminal: terminal({ columns: 54, rows: 200 }),
    scheduler: {
      repeat(callback): () => void {
        tick = callback;
        return (): void => {
          stops += 1;
        };
      },
    },
  });

  progress.start([GROUP]);
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);
  progress.started(lint);
  await Promise.resolve();
  assert(tick !== undefined);

  progress.resize({ columns: 54, rows: 12 });
  const afterShrink = writes.length;
  tick?.();
  await Promise.resolve();
  assertEquals(stops, 1);
  assertEquals(
    writes.length,
    afterShrink,
    "activity ticks must stay stopped after the package refuses a repaint",
  );

  progress.complete(PROOF_STEPS);
  assertStringIncludes(writes.at(-1) ?? "", "scope:site [skipped]");
  assertEquals(
    writes.slice(afterShrink).some((value) => value.includes("\x1b[")),
    false,
    "the final static Gate must not resume cursor replacement",
  );
});

Deno.test("Gate progress delegates initial and growing frame safety to the package painter", async () => {
  const context = terminal({ columns: 54, rows: 32 });
  const options = { width: 54, terminal: context };
  assertEquals(gateTtyProgressCanRepaint([GROUP], options), true);
  assertEquals(gateTtyProgressCanRepaint(CURRENT_GATE_GROUPS, options), false);

  let stops = 0;
  const writes: string[] = [];
  const progress = createGateTtyProgress((value) => writes.push(value), {
    ...options,
    scheduler: {
      repeat(): () => void {
        return (): void => {
          stops += 1;
        };
      },
    },
  });
  progress.start([GROUP]);
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);
  progress.started(lint);
  progress.replaceGroups(CURRENT_GATE_GROUPS);
  await Promise.resolve();
  assertEquals(stops, 1);

  progress.complete(PROOF_STEPS);
  assertEquals(progress.renderedFinal(), true);
  assertEquals(
    writes.filter((value) => value.includes("scope:site [skipped]")).length,
    1,
    "one static completion follows the abandoned growing frame",
  );
});

Deno.test("Gate progress prints an oversized final result once after stopping repaint", () => {
  const context = terminal({ columns: 54, rows: 32 });
  let stops = 0;
  const writes: string[] = [];
  const progress = createGateTtyProgress((value) => writes.push(value), {
    width: 54,
    terminal: context,
    scheduler: {
      repeat(): () => void {
        return (): void => {
          stops += 1;
        };
      },
    },
  });
  progress.start([GROUP]);
  const lint = GROUP.jobs.find((job) => job.label === "lint");
  assert(lint !== undefined);
  progress.started(lint);
  const oversized = Array.from({ length: 12 }, (_, index): StepResult => ({
    step: {
      kind: "job",
      label: verbatimStepLabel(`final-${index}`),
      disposition: "run",
      note: `run final-${index}`,
      group: "Check & test",
    },
    outcome: "ok",
  }));

  progress.complete(oversized);
  assertEquals(stops, 1);
  assertEquals(progress.renderedFinal(), true);
  assertEquals(
    writes.filter((value) => value.includes("final-11 [passed]")).length,
    1,
  );
});

Deno.test("Gate progress latches every painter write failure without a cleanup retry", async () => {
  const scenarios = [
    { name: "initial boundary", failAt: 1, run: "start" },
    { name: "initial paint", failAt: 2, run: "start" },
    { name: "replacement", failAt: 3, run: "replacement" },
    { name: "refusal cleanup", failAt: 3, run: "cleanup" },
    { name: "final static", failAt: 4, run: "final" },
  ] as const;
  for (const scenario of scenarios) {
    let attempts = 0;
    let stops = 0;
    const progress = createGateTtyProgress(() => {
      attempts += 1;
      if (attempts === scenario.failAt) throw new Error(scenario.name);
    }, {
      width: 54,
      terminal: terminal({ columns: 54, rows: 200 }),
      scheduler: {
        repeat(): () => void {
          return (): void => {
            stops += 1;
          };
        },
      },
    });
    progress.start([GROUP]);
    const lint = GROUP.jobs.find((job) => job.label === "lint");
    assert(lint !== undefined);

    if (scenario.run === "replacement") {
      progress.started(lint);
      await Promise.resolve();
    } else if (scenario.run === "cleanup") {
      progress.started(lint);
      progress.resize({ columns: 54, rows: 2 });
      await Promise.resolve();
    } else if (scenario.run === "final") {
      progress.started(lint);
      progress.resize({ columns: 54, rows: 2 });
      progress.complete(PROOF_STEPS);
      await Promise.resolve();
    }

    const attemptsAfterFailure = attempts;
    progress.resize({ columns: 20, rows: 1 });
    progress.complete(PROOF_STEPS);
    await Promise.resolve();
    assertEquals(
      attempts,
      attemptsAfterFailure,
      `${scenario.name} must not trigger a second cleanup or control write`,
    );
    assertEquals(progress.renderedFinal(), false, scenario.name);
    if (scenario.run !== "start") assertEquals(stops, 1, scenario.name);
  }
});

Deno.test("Gate workflow sanitizes controls and preserves long facts across widths", () => {
  const longCommand =
    "deno check a/very/long/path/to/the/project/entrypoint.ts\x1b[31m\rnext";
  const group: JobGroup = {
    ...GROUP,
    jobs: [{
      label: "types\x07",
      command: longCommand,
      kind: "custom",
      reportStage: "check",
      willRun: true,
    }],
  };
  for (const width of [28, 120]) {
    const rendered = renderGateTtyProgressTable(
      [group],
      new Set(),
      new Map(),
      { width, terminal: PLAIN },
    );
    assertEquals(rendered.includes("\x1b"), false);
    assertEquals(rendered.includes("\x07"), false);
    assertStringIncludes(
      rendered.replaceAll(/\s/gu, ""),
      longCommand.replace("\x1b", "␛")
        .replace("\r", "␍")
        .replaceAll(/\s/gu, ""),
    );
    assertStringIncludes(rendered, "types␇");
    assertWithinWidth(rendered, width);
  }
});

Deno.test("Gate workflow colour depth changes styling only", () => {
  const contexts = ["ansi16", "ansi256", "truecolor"] as const;
  const plain = renderGateTtyProgressTable(
    [GROUP],
    new Set(["lint"]),
    new Map([["format", OK_FORMAT]]),
    { width: 80, terminal: PLAIN },
    1,
  );
  for (const color of contexts) {
    const context = terminal({ color });
    assertEquals(context.capabilities.colorDepth, color);
    const rendered = renderGateTtyProgressTable(
      [GROUP],
      new Set(["lint"]),
      new Map([["format", OK_FORMAT]]),
      { width: 80, terminal: context },
      1,
    );
    assert(rendered.includes("\x1b["));
    assertEquals(stripAnsi(rendered), plain);
    assertWithinWidth(rendered, 80);
  }
});

Deno.test("Gate workflow TERM=dumb degrades through the shared context", () => {
  const dumb = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "dumb", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 48, rows: 24 }),
  });
  assertEquals(dumb.capabilities.colorDepth, "none");
  assertEquals(dumb.capabilities.ansiControl, false);
  assertEquals(dumb.capabilities.unicode, true);
  assertEquals(gateTtyPresentation(false, false, dumb), { ttyWidth: 48 });
  const rendered = renderGateTtyProgressTable(
    [GROUP],
    new Set(["lint"]),
    new Map<string, JobResult>(),
    { width: 48, terminal: dumb },
    0,
  );
  assertStringIncludes(
    rendered,
    `[${DISCERN_TRIANGLE_GLYPHS.upRight}] lint [running]`,
  );
  assertStringIncludes(rendered, "·  format [pending]");
  assertEquals(rendered.includes("\x1b["), false);
});

Deno.test("Gate plan preserves prerequisite and configured-job group boundaries", () => {
  const plan: EnginePlan = {
    title: "Gate plan",
    details: ["Changed scopes: site"],
    steps: [{
      kind: "merge-check",
      label: verbatimStepLabel("merge-check"),
      disposition: "gate",
      note: "main is already merged",
    }, {
      kind: "job",
      label: verbatimStepLabel("format"),
      disposition: "run",
      note: "deno fmt",
      group: "Fix",
    }, {
      kind: "scope-gate",
      label: verbatimStepLabel("scope:map"),
      disposition: "skip",
      note: "scope unchanged",
      group: "Scope gates",
    }, {
      kind: "tracked-refresh-check",
      label: verbatimStepLabel("refresh-check"),
      disposition: "gate",
      note: "refresh has no pending effect",
    }],
  };
  const rendered = renderGatePlan(plan, { width: 62, terminal: PLAIN });
  assertStringIncludes(rendered, "Changed scopes: site");
  assertStringIncludes(rendered, "Gate prerequisites");
  assertStringIncludes(rendered, "main is already merged");
  assertStringIncludes(rendered, "Fix");
  assertStringIncludes(rendered, "$ deno fmt");
  assertStringIncludes(rendered, "scope:map [skipped]");
  assertStringIncludes(rendered, "Final checks");
  assertStringIncludes(rendered, "refresh has no pending effect");
  assert(rendered.indexOf("Gate prerequisites") < rendered.indexOf("Fix"));
  assert(rendered.indexOf("Fix") < rendered.indexOf("Scope gates"));
  assert(rendered.indexOf("Scope gates") < rendered.indexOf("Final checks"));
});

Deno.test("Gate Standards render every measurement and verdict without invented values", () => {
  const standards: GateStandard[] = [
    {
      name: "coverage",
      direction: "up",
      limit: 80,
      measurement: "measured",
      value: 83,
      verdict: "held",
      duration_s: 3,
    },
    {
      name: "cli_pending",
      direction: "down",
      limit: 10,
      measurement: "measured",
      value: 8,
      verdict: "improved",
      pin_eligible: true,
      pin_target: 9,
    },
    {
      name: "bundle",
      direction: "down",
      limit: 100,
      measurement: "replayed",
      value: 104,
      verdict: "regressed",
      replayed_from: "abc1234",
    },
    {
      name: "docs",
      direction: "up",
      limit: 90,
      measurement: "deferred",
    },
    {
      name: "prose",
      direction: "down",
      limit: 40,
      measurement: "skipped",
    },
  ];
  const rendered = renderGateStandards(standards, {
    width: 64,
    terminal: PLAIN,
  });
  for (
    const fact of [
      "coverage · flat",
      "Current: 83",
      "Limit: floor 80",
      "cli_pending · improving",
      "Pin eligible: yes",
      "Pin target: 9",
      "bundle · drifting",
      "Current: 104",
      "replayed from abc1234",
      "Measurement is deferred",
      "Run discern standards.",
      "The Gate stopped before this Standard measurement ran.",
    ]
  ) {
    assertStringIncludes(rendered.replaceAll(/\s+/gu, " "), fact);
  }
  assertEquals(rendered.includes("Current: undefined"), false);
  assertEquals(rendered.includes("Current: 0"), false);
});

Deno.test("Gate diagnostics preserve severity, location, controls, excerpt, and retry", () => {
  const diagnostics: Diagnostic[] = [{
    tool: "lint",
    severity: "error",
    message: "Unexpected control\x07 byte",
    reproduce_cmd: "deno lint\n--again",
    file: "src/a/very/long/path/to/entrypoint.ts\x1b[31m",
    line: 12,
    col: 4,
    rule: "no-control",
    fix_available: true,
    output: "first\nsecond\x00",
    truncated: true,
    output_path: "/tmp/full-output.log",
  }, {
    tool: "tests",
    severity: "warning",
    message: "One flaky case was observed.",
    reproduce_cmd: "deno task test",
  }];
  const rendered = renderGateDiagnostics(diagnostics, {
    width: 48,
    terminal: PLAIN,
  });
  for (
    const fact of [
      "FAILURE: lint: no-control",
      "Unexpected control␇ byte",
      ":12:4",
      "Reproduce: $ deno lint",
      "--again",
      "lint captured output excerpt",
      "second␀",
      "Full output artifact:",
      "/tmp/full-output.log",
      "Safe to retry",
      "Run discern prepare",
      "ATTENTION: tests",
      "One flaky case was observed.",
    ]
  ) {
    assertStringIncludes(rendered.replaceAll(/\s+/gu, " "), fact);
  }
  assertStringIncludes(rendered, "lint␊--again");
  assertEquals(rendered.includes("\x1b"), false);
  assertEquals(rendered.includes("\x07"), false);
  assertEquals(rendered.includes("\x00"), false);
  assertWithinWidth(rendered, 48);
});

Deno.test("Gate Proof receipts present every recording and currency state truthfully", () => {
  for (
    const status of Object.keys(
      GATE_PROOF_RECORD_PRESENTATION,
    ) as GateProofRecord["status"][]
  ) {
    const rendered = renderGateProofReceipt(
      PROOF,
      { status },
      PROOF_STEPS,
      { width: 76, terminal: PLAIN },
    );
    const state = GATE_PROOF_RECORD_PRESENTATION[status];
    assertStringIncludes(rendered, `Receipt: Gate proof`);
    assertStringIncludes(rendered, state.stateLabel);
    assertStringIncludes(rendered, state.summary);
    assertStringIncludes(rendered, "1 passed, 1 skipped");
    assertEquals(rendered.includes("[PASS]"), status === "recorded");
    assertEquals(rendered.split("\n").at(-1), PROOF.line);
  }

  for (const status of GATE_PROOF_CHECK_STATUSES) {
    const rendered = renderGateProofCheckReceipt({
      status,
      path: ".git/discern-proof.json",
      recorded: "abc1234",
      head: "def5678",
      reason: status === "stale" ? "The branch advanced." : undefined,
      proof_line: status === "honored" ? PROOF.line : undefined,
    }, { width: 76, terminal: PLAIN });
    const state = GATE_PROOF_CHECK_PRESENTATION[status];
    assertStringIncludes(rendered, state.stateLabel);
    assertStringIncludes(rendered, state.summary);
    assertEquals(rendered.includes("[PASS]"), status === "honored");
    assertEquals(rendered.includes(PROOF.line), status === "honored");
  }
});

Deno.test("Gate completed workflow renders all result outcomes and Standards", () => {
  const outcomes = STEP_OUTCOMES.map((outcome, index): StepResult => ({
    step: {
      kind: "job",
      label: verbatimStepLabel(`job-${outcome}`),
      disposition: outcome === "skipped" ? "skip" : "run",
      note: `run job-${outcome}`,
      group: "Check",
    },
    outcome,
    durationS: index,
  }));
  const rendered = renderGateTtyTable(outcomes, {
    width: 72,
    terminal: PLAIN,
  }, [{
    name: "coverage",
    direction: "up",
    limit: 80,
    measurement: "measured",
    value: 82,
    verdict: "held",
  }]);
  for (const outcome of STEP_OUTCOMES) {
    assertStringIncludes(
      rendered,
      `job-${outcome} [${GATE_JOB_STATUS_LABEL[outcome]}]`,
    );
  }
  assertStringIncludes(rendered, "coverage · flat");
  assertStringIncludes(rendered, "A Gate job failed.");
});

Deno.test("Gate cancellation never earns the completed lifecycle", () => {
  const rendered = renderGateTtyTable([{
    step: {
      kind: "job",
      label: verbatimStepLabel("test"),
      disposition: "run",
      note: "deno task test",
      group: "Test",
    },
    outcome: "cancelled",
    durationS: 1,
  }], { width: 60, terminal: PLAIN });
  assertStringIncludes(rendered, "The Gate run was cancelled.");
  assertStringIncludes(rendered, "test [cancelled]");
  assertEquals(rendered.includes("✓ Complete"), false);
});
