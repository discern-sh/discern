/**
 * Engine coverage for the read-only phases of the staged setup handshake (ADR 0075):
 * the 3-state WELCOME (`discern setup` / bare `discern`), the `verify` PREFLIGHT,
 * completion's phase boundary, and `begin`'s provenance recording. Driven through
 * the real CLI from the genuinely un-set-up state — the state ADR 0065 warned the suite
 * never exercised — so the read-only-until-`begin` invariant and the funnel are proven
 * where they are real, not asserted in prose.
 *
 * The scaffold/brief behaviour of `begin` and the `done` validator live in
 * engine_setup_test.ts; this file owns the welcome + verify surfaces.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { join } from "@std/path";
import { measureText, stripAnsi } from "discern-design-system/cli";
import { assertTerminalTextIncludes, fakeEnv, withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { DISCERN_MARK } from "../src/shared/brand.ts";
import { renderDiscernArt } from "../art/terminal/brand.ts";
import {
  SetupDoneOutputSchema,
  SetupVerifyOutputSchema,
} from "../src/shared/result_schemas.ts";
import {
  renderFreshWelcome,
  resolveWelcomeStyle,
} from "../src/commands/setup_welcome.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";

const ESC = String.fromCharCode(27);
const ANSI_ESCAPE = new RegExp(`${ESC}\\[[0-9;]*m`);

type DataWithKey<Data, Key extends PropertyKey> = Data extends unknown
  ? Key extends keyof Data ? Data : never
  : never;
type SetupData = DataWithKey<
  NonNullable<CliResultForCommand<"setup">["data"]>,
  "phase"
>;
type SetupVerifyData = DataWithKey<
  NonNullable<CliResultForCommand<"setup verify">["data"]>,
  "phase"
>;
type SetupDoneData = DataWithKey<
  NonNullable<CliResultForCommand<"setup done">["data"]>,
  "instructions"
>;

/** Decode normal welcome state while excluding shared configuration failures. */
function decodeSetupData(stdout: string): SetupData {
  const result = decodeCliResult(stdout, "setup");
  assertResultDataKey(result, "phase");
  return result.data;
}

/** Decode normal preflight state while excluding shared configuration failures. */
function decodeSetupVerifyData(stdout: string): SetupVerifyData {
  const result = decodeCliResult(stdout, "setup verify");
  assertResultDataKey(result, "phase");
  return result.data;
}

/** Decode the completion payload that carries the authored handoff. */
function decodeSetupDoneData(stdout: string): SetupDoneData {
  const result = decodeCliResult(stdout, "setup done");
  assertResultDataKey(result, "instructions");
  return result.data;
}

const FRESH_WELCOME_FACTS: readonly string[] = [
  DISCERN_MARK,
  "discern",
  "project-owned working practice",
  "people responsible for what lands",
  "This project isn't set up yet.",
  "FOR HUMANS",
  "final quality check",
  "separate working copies",
  "shared agent instructions",
  '"Run `discern setup` in this project."',
  "welcome is read-only",
  "separate `discern-setup` branch",
  "one visible `discern/` folder",
  "coding tools' local integration files",
  "discern uninstall",
  "No API key or outside service",
  "strongest suitable reasoning model",
  "model selector",
  "fresh project session",
  "future sessions",
  "Expect roughly 20–40 minutes",
  "FOR CODING AGENTS",
  "carry setup through each stated next action",
  "Nothing is written",
  "discern setup verify",
  "Don't hand this back as a report",
];

/** Require machine and non-TTY setup output to remain free of terminal control sequences. */
function assertNoAnsi(text: string, label: string): void {
  assert(!ANSI_ESCAPE.test(text), `${label} must not contain ANSI escapes`);
}

/** Require every canonical first-run fact on each setup welcome surface. */
function assertFreshWelcomeFacts(
  text: string,
  label: string,
  includeUnicodeMark = true,
): void {
  const normalized = text.replaceAll(/[│|]/gu, " ").replaceAll(/\s+/gu, " ");
  const facts = includeUnicodeMark
    ? FRESH_WELCOME_FACTS
    : FRESH_WELCOME_FACTS.filter((fact) => fact !== DISCERN_MARK);
  for (const fact of facts) {
    assertStringIncludes(
      normalized,
      fact.replaceAll(/\s+/gu, " "),
      `${label} missing ${fact}`,
    );
  }
}

/** Resolve deterministic TTY facts for responsive Unicode and ASCII rendering. */
function welcomeTerminal(
  columns: number,
  unicode = true,
): TerminalContext {
  return resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      TERM: "xterm-256color",
      ...(unicode ? { LANG: "en_GB.UTF-8" } : { LC_ALL: "C" }),
    }),
    isTerminal: () => true,
    consoleSize: () => ({ columns, rows: 24 }),
  });
}

/** A git work tree with a file but NO discern.toml — the fresh-install entry point. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
}

// ── the welcome ────────────────────────────────────────────────────────────────

Deno.test("the fresh welcome renderer adds TTY decoration without losing content", () => {
  const plain = renderFreshWelcome({ tty: false }).join("\n");
  const styled = renderFreshWelcome({ tty: true }).join("\n");
  const styledPlain = stripAnsi(styled);

  assertNoAnsi(plain, "plain renderer");
  assert(
    ANSI_ESCAPE.test(styled),
    "TTY renderer should apply ANSI styling",
  );
  assertStringIncludes(styledPlain, "┌");
  assertStringIncludes(styledPlain, "└");
  const styledLines = styledPlain.split("\n");
  const splitMark = renderDiscernArt("split").split("\n");
  for (const [index, row] of splitMark.entries()) {
    assertEquals(
      styledLines[index],
      row,
      `styled welcome split-mark row ${index + 1}`,
    );
  }
  assert(
    splitMark.slice(0, -1).every((row) => !plain.includes(row.trim())),
    "the split-mark art belongs only to the styled TTY welcome",
  );
  assertStringIncludes(
    styledLines[splitMark.length] ?? "",
    "project-owned working practice",
  );
  assertStringIncludes(
    styledLines[splitMark.length + 1] ?? "",
    "for coding agents and the people responsible",
  );
  const frameStart = styledLines.findIndex((line) => line.startsWith("┌"));
  assert(frameStart >= 0, "expected the package-rendered welcome frame");
  const boxWidth = measureText(styledLines[frameStart] ?? "");
  assertEquals(boxWidth, 78);
  for (const line of styledLines.slice(frameStart)) {
    assert(
      measureText(line) === boxWidth,
      `styled welcome line has width ${
        measureText(line)
      }, expected ${boxWidth}: ${line}`,
    );
  }
  assertFreshWelcomeFacts(plain, "plain welcome");
  assertFreshWelcomeFacts(styledPlain, "styled welcome");
});

Deno.test("the styled welcome follows package width and ASCII capabilities", () => {
  for (const columns of [42, 120]) {
    const terminal = welcomeTerminal(columns);
    const lines = stripAnsi(
      renderFreshWelcome({ tty: true, terminal }).join("\n"),
    ).split("\n");
    const frameStart = lines.findIndex((line) => line.startsWith("┌"));
    const expectedWidth = Math.min(78, columns);
    assert(frameStart >= 0, `missing ${columns}-column package frame`);
    for (const line of lines.slice(frameStart)) {
      assertEquals(measureText(line), expectedWidth, `${columns}-column frame`);
    }
    assertFreshWelcomeFacts(lines.join("\n"), `${columns}-column welcome`);
  }

  const ascii = stripAnsi(
    renderFreshWelcome({
      tty: true,
      terminal: welcomeTerminal(78, false),
    }).join("\n"),
  );
  assertStringIncludes(ascii, renderDiscernArt("stamp"));
  assert(!ascii.includes("┌") && !ascii.includes("└") && !ascii.includes("│"));
  assertFreshWelcomeFacts(ascii, "ASCII welcome", false);
});

Deno.test("the fresh welcome keeps the human CTA contiguous", () => {
  const styledPlain = stripAnsi(renderFreshWelcome({ tty: true }).join("\n"));
  const lines = styledPlain.split("\n");
  const tellIndex = lines.findIndex((line) =>
    line.includes("tell your coding agent:")
  );
  const quoteIndex = lines.findIndex((line) =>
    line.includes('"Run `discern setup` in this project."')
  );

  assert(tellIndex >= 0, "expected the human lead-in");
  assert(
    quoteIndex > tellIndex,
    "expected the quoted command after the lead-in",
  );
  const intervening = lines.slice(tellIndex + 1, quoteIndex).join("\n");
  assert(
    !intervening.includes("quality gate"),
    `the feature summary must not split the CTA:\n${intervening}`,
  );
});

Deno.test("the fresh welcome style resolver keeps --no-color and NO_COLOR plain on a TTY", () => {
  const plain = renderFreshWelcome({ tty: false });
  // The CLI's existing noColor flag is shared by `--no-color` and NO_COLOR; when it
  // is true, the welcome falls back to the plain render even if stdout is a TTY.
  assertEquals(
    renderFreshWelcome(resolveWelcomeStyle({
      stdoutTty: true,
      noColor: true,
    })),
    plain,
  );
  assertEquals(
    renderFreshWelcome(resolveWelcomeStyle({
      stdoutTty: false,
      noColor: false,
    })),
    plain,
  );
});

Deno.test("the fresh welcome dual-addresses both readers and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);
    assertNoAnsi(r.stdout, "piped fresh welcome");
    // Both readers are addressed — robust where detecting them is not (ADR 0075).
    assertTerminalTextIncludes(r.stdout, "FOR HUMANS");
    assertTerminalTextIncludes(r.stdout, "FOR CODING AGENTS");
    // The agent is funnelled into the preflight, not handed the brief.
    assertTerminalTextIncludes(r.stdout, "discern setup verify");
    // Read-only: the welcome scaffolds nothing.
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "the welcome must write nothing — scaffolding belongs to `begin`",
    );
  });
});

Deno.test("the fresh welcome --json carries phase=fresh and the verify funnel", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup", "--json"]);
    assertEquals(r.code, 0, r.output);
    const d = decodeSetupData(r.stdout);
    assertEquals(d.phase, "fresh");
    assertEquals(d.complete, false);
    assertExists(d.next_action);
    assertStringIncludes(d.next_action, "verify");
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "the welcome --json must also write nothing",
    );
  });
});

Deno.test("the in-progress welcome shows derived progress and funnels to done", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]); // lay the marker-carrying skeletons

    const human = await runAgent(dir, ["setup"]);
    assertTerminalTextIncludes(human.stdout, "IN PROGRESS");
    assertTerminalTextIncludes(human.stdout, "discern setup done");

    const d = decodeSetupData(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    );
    assertEquals(d.phase, "in_progress");
    assertExists(d.progress);
    // Derived progress: docs markers remain and only discern's seeded formatter
    // is wired; every project-specific job is still unset.
    assert(
      Array.isArray(d.progress.pending_markers) &&
        d.progress.pending_markers.length > 0,
      `expected pending markers: ${JSON.stringify(d.progress)}`,
    );
    assertEquals(d.progress.known_jobs.length, 6);
    const wired = d.progress.known_jobs.filter(
      (job: { wired: boolean }) => job.wired,
    );
    assertEquals(wired.map((job: { name: string }) => job.name), ["format"]);
  });
});

Deno.test("bare `discern setup` reports already-set-up once recorded (phase done)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped by default
    const d = decodeSetupData(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    );
    assertEquals(d.phase, "done");
    assertEquals(d.complete, true);
  });
});

Deno.test("the fresh welcome --json carries the same instructional substance as the human render (parity)", async () => {
  // A JSON-consuming agent must not get a colder, thinner welcome than one reading
  // the dual-addressed human text (ADR 0075): the "you drive this; nothing until
  // begin; verify hands you the message to relay" framing rides on both paths.
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const human = (await runAgent(dir, ["setup"])).stdout;
    const d = decodeSetupData(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    );
    assertExists(d.agent_instructions);
    assertExists(d.human_framing);

    // The agent instructions carries the role + the verify funnel the human prose has,
    // and points at verify as the source of the message to relay (ADR 0086).
    assertStringIncludes(d.agent_instructions, "Nothing is written until");
    assertStringIncludes(
      d.agent_instructions,
      "relay its owner conversation naturally",
    );
    assertStringIncludes(d.agent_instructions, "discern setup verify");
    // The human framing recommends a model for the long-lived outcome, gives the
    // concrete switch route, and keeps provenance separate.
    assertStringIncludes(d.human_framing, "strongest suitable reasoning model");
    assertStringIncludes(d.human_framing, "model selector");
    assertStringIncludes(d.human_framing, "fresh project session");
    assertStringIncludes(d.human_framing, "future sessions");
    // Both surfaces actually say it, so neither path is the thinner one.
    assertStringIncludes(human, "strongest suitable reasoning model");
    // The footprint story rides both surfaces: one root file, one visible folder.
    assertStringIncludes(d.human_framing, "one visible `discern/` folder");
    assertStringIncludes(human, "one visible `discern/` folder");
  });
});

Deno.test("the in-progress welcome --json carries the 'your job, not a status' agent instructions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]);
    const d = decodeSetupData(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    );
    assertEquals(d.phase, "in_progress");
    assertExists(d.agent_instructions);
    // The resume framing the human text carries ("this is YOUR job ... not a status
    // to report back") must ride the JSON path too, not just the human one.
    assertStringIncludes(d.agent_instructions, "YOUR job");
    assertStringIncludes(d.agent_instructions, "discern setup done");
  });
});

// ── the verify preflight ─────────────────────────────────────────────────────

Deno.test("verify reports grounded findings and the consent conversation, writing nothing", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# Atlas\n");
    await freshRepo(dir);
    const res = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(res, "phase");
    const d = res.data;
    assertEquals(d.phase, "fresh");
    assertExists(d.findings);
    assertExists(d.instructions);
    assertExists(d.findings.project_identity.evidence[0]);
    assertEquals(d.findings.git.repo, true);
    assertEquals(d.findings.docs.exists, false);
    assert(typeof d.findings.worktree_path === "string");
    assertEquals(d.findings.project_identity.proposed_name, "Atlas");
    assertEquals(d.findings.project_identity.fallback_only, false);
    assertEquals(d.findings.project_identity.requires_confirmation, true);
    assertEquals(d.findings.project_identity.evidence[0].location, "README.md");
    // The consent conversation rides the prose `instructions` lane (not structured
    // fields the agent summarizes) as a ready-to-relay message: the relay licence,
    // then the points to settle with the human — model, worktree, ready — plus the
    // funnel to begin (ADR 0086).
    assertStringIncludes(
      d.instructions,
      "as one natural conversation",
    );
    assertStringIncludes(
      d.instructions,
      "Everything I set up here is inherited by future sessions",
    );
    assertStringIncludes(
      d.instructions,
      "Isolated working copies will live beside",
    );
    assertStringIncludes(d.instructions, "Ready for me to begin");
    assertStringIncludes(
      d.instructions,
      "strongest project name I found is “Atlas”",
    );
    assertStringIncludes(d.next_action, "begin");
    assertStringIncludes(d.next_action, "--name 'Atlas'");
    // The command the agent runs after the conversation carries the consent
    // attestation — a fresh begin refuses without it.
    assertStringIncludes(d.next_action, "--confirmed");
    // Read-only: verify scaffolds nothing.
    assert(
      !(await targetExists(join(dir, "discern.toml"))),
      "verify must write nothing (the verify|begin read-only boundary)",
    );
  });
});

Deno.test("verify funnels begin with --model so the configuring model is recorded as provenance", async () => {
  // A cold run never recorded setup_model because nothing told the agent to pass
  // --model. The funnel into begin now carries it, in both the next_action and the
  // model confirmation the agent presents to its human.
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const d = decodeSetupVerifyData(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    assertExists(d.instructions);
    assertStringIncludes(d.next_action, "--model");
    // The consent instructions instructs passing --model for best-effort provenance.
    assertStringIncludes(d.instructions, "--model");
  });
});

Deno.test("verify's consent instructions are identical and faithful across the human render and --json (the A9 parity guard)", async () => {
  // Running `verify --json` once led an agent to summarize and weaken the consent
  // conversation — it dropped "open warmly", reworded the model question, and guessed a
  // model id — while the SAME verify in human-readable form was followed faithfully.
  // The consent now rides ONE prose `instructions` lane; this pins the two surfaces to the
  // same text and asserts every load-bearing instruction survives in both, so they can
  // never silently diverge again (ADR 0078, the two-lane rule).
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const human = (await runAgent(dir, ["setup", "verify"])).stdout;
    const res = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(res, "phase");
    const d = res.data;
    assertExists(d.instructions);

    // One source, two renderings: the human preflight embeds the --json prose lane
    // verbatim, so the consent conversation cannot drift between the surfaces.
    assert(
      typeof d.instructions === "string" && d.instructions.length > 200,
      `expected a substantial consent instructions string: ${d.instructions}`,
    );
    assertStringIncludes(human, d.instructions);

    // Every load-bearing point is present in BOTH surfaces: the adaptive relay
    // licence, the exact model question verbatim, the three-pillar explainer, the
    // time+token expectation, the worktree location, and the confirmed command — the
    // content a courier agent must carry unweakened (ADR 0086, the two-lane rule).
    for (
      const needle of [
        "as one natural conversation",
        "form the consent record",
        "Everything I set up here is inherited by future sessions",
        "Lasting outcome: future sessions inherit",
        "strongest suitable reasoning model",
        "switch models first",
        "Current provider/model (self-declared)",
        "never copy the placeholder",
        "Only if the owner chooses to continue in this session",
        "separate task workspaces",
        "20–40 minutes",
        "Isolated working copies will live beside",
        "The strongest project name I found",
        "--confirmed",
      ]
    ) {
      assertStringIncludes(
        d.instructions,
        needle,
        `--json instructions missing: ${needle}`,
      );
      assertStringIncludes(human, needle, `human render missing: ${needle}`);
    }

    // Faithfulness (ADR 0041): the real serialized envelope — instructions and all —
    // validates against the schema the data is typed from.
    SetupVerifyOutputSchema.parse(res);
  });
});

Deno.test("verify reassures about existing docs, and surfaces agent instructions as a conflict", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# mine\n");
    await Deno.writeTextFile(join(dir, "CLAUDE.md"), "# my rules\n");

    const res = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(res, "phase");
    const d = res.data;
    assertExists(d.conflicts);
    assertExists(d.findings);
    assertExists(d.instructions);
    const kinds = d.conflicts.map((c: { kind: string }) => c.kind);
    // An existing docs/ folder is NOT a conflict: the map's own default home
    // collides with nothing (ADR 0100) — the message reassures, nothing more.
    assert(
      !kinds.includes("existing_docs"),
      `existing docs must not be a conflict: ${JSON.stringify(kinds)}`,
    );
    assert(
      kinds.includes("existing_instructions"),
      `expected an existing_instructions conflict: ${JSON.stringify(kinds)}`,
    );
    assert(d.findings.existing_instructions.includes("CLAUDE.md"));
    assertEquals(d.findings.docs.exists, true);
    // With a docs/ folder present, the relay message promises it stays untouched
    // and names the map's separate home — and never offers to point discern at
    // the human's docs (the retired ADR 0100 opt-in; ADR 0131).
    assertStringIncludes(d.instructions, "already has `docs/`");
    assertStringIncludes(d.instructions, "does not adopt or overwrite it");
    assertStringIncludes(d.instructions, SOURCE_PATHS.map.defaultPath);
    assert(
      !d.instructions.includes("--map"),
      "the existing-docs adoption offer must not return",
    );
    assert(!d.next_action.includes("--map"));
    SetupVerifyOutputSchema.parse(res);
  });
});

Deno.test("verify asks no docs question when the project has no docs folder", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const d = decodeSetupVerifyData(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    assertExists(d.findings);
    assertExists(d.instructions);
    assertEquals(d.findings.docs.exists, false);
    assert(!d.instructions.includes("already has `docs/`"));
    assert(!d.instructions.includes("--map"));
    // The default is still stated: the human render names where the map lands.
    const human = (await runAgent(dir, ["setup", "verify"])).stdout;
    assertStringIncludes(human, SOURCE_PATHS.map.defaultPath);
  });
});

Deno.test("verify redirects once setup is recorded (the preflight is moot)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped
    const d = decodeSetupVerifyData(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    assertEquals(d.phase, "done");
  });
});

// ── completion phase boundary + provenance ───────────────────────────────────

Deno.test("forced setup completion withholds activation and improvement without Proof", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // agents: [claude_code]
    const done = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(done.code, 0, done.output);
    assertTerminalTextIncludes(done.stdout, "activation handoff are withheld");
    assert(!done.stdout.includes("start a fresh Claude Code session"));
    assert(!done.stdout.includes("discern improvement"));
    const d = decodeSetupDoneData(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertExists(d.instructions);
    assertEquals(d.reactivation, undefined);
    assertEquals(d.optional_improvement, undefined);
    assert(
      d.instructions.includes("cannot use setup acceptance"),
      d.instructions,
    );
  });
});

Deno.test("setup done serves the completion message at parity across the human render and --json (ADR 0086)", async () => {
  // The bookend of the served-message handshake: an agent that only relays discern's
  // words still gives the human a warm, accurate close. The message rides ONE prose
  // `instructions` lane, carried verbatim by both surfaces so the relay can't drift.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // agents: [claude_code]
    const human = (await runAgent(dir, ["setup", "done", "--force"])).stdout;
    const res = decodeCliResult(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
      "setup done",
    );
    assertResultDataKey(res, "instructions");
    const d = res.data;
    assertExists(d.instructions);

    // One source, two renderings: the human output embeds the --json instructions verbatim.
    assert(
      typeof d.instructions === "string" && d.instructions.length > 100,
      `expected a substantial completion instructions string: ${d.instructions}`,
    );
    assertStringIncludes(human, d.instructions);

    // The close carries the relay licence, honest coverage, canonical inventory,
    // and the unproved boundary — in BOTH surfaces.
    for (
      const needle of [
        "Relay the message below to your human",
        "discern setup was recorded without a Gate Proof",
        "No quality checks are wired yet",
        "project-guide areas",
      ]
    ) {
      assertStringIncludes(
        d.instructions,
        needle,
        `instructions missing: ${needle}`,
      );
      assertStringIncludes(human, needle, `human render missing: ${needle}`);
    }
    assert(!d.instructions.includes("start a fresh Claude Code session"));
    assert(!d.instructions.includes("discern improvement"));

    // Faithfulness (ADR 0041): the real serialized envelope validates against schema.
    SetupDoneOutputSchema.parse(res);
  });
});

Deno.test("begin records the agent's self-declared model + discern version as provenance", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--model",
      "test-model-x",
    ]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'setup_model = "test-model-x"');
    // setup_version is observed (non-empty), recorded alongside the model.
    assert(
      /setup_version = "[^"]+"/.test(toml),
      `expected a recorded setup_version: ${toml}`,
    );
  });
});

Deno.test("begin records explicit unreported provenance when the runtime model is unknown", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'setup_model = "unreported"',
    );
  });
});

Deno.test("begin normalizes a retired model placeholder to explicit unreported provenance", async () => {
  // Compatibility callers may still copy the retired placeholder. It must never
  // be stored literally; uncertainty is represented by the supported value.
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--model",
      "<your-model-id>",
    ]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'setup_model = "unreported"');
    assert(!toml.includes("<your-model-id>"));
  });
});
