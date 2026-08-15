/**
 * Engine coverage for the read-only phases of the staged setup handshake (ADR 0075):
 * the 3-state WELCOME (`discern setup` / bare `discern`), the `verify` PREFLIGHT, the
 * `setup done` reactivation handoff, and `begin`'s provenance recording. Driven through
 * the real CLI from the genuinely un-set-up state — the state ADR 0065 warned the suite
 * never exercised — so the read-only-until-`begin` invariant and the funnel are proven
 * where they are real, not asserted in prose.
 *
 * The scaffold/brief behaviour of `begin` and the `done` validator live in
 * engine_setup_test.ts; this file owns the welcome + verify surfaces.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
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
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";

const ESC = String.fromCharCode(27);
const ANSI_ESCAPE = new RegExp(`${ESC}\\[[0-9;]*m`);

const FRESH_WELCOME_FACTS: readonly string[] = [
  DISCERN_MARK,
  "discern",
  "quality gates and safe worktrees",
  "coding agents and the humans who run them",
  "This project isn't set up yet.",
  "FOR HUMANS",
  "quality gate",
  "isolated git worktrees",
  "agent instructions",
  '"Run `discern setup` in this project."',
  "Setup is isolated and reversible",
  "one visible `discern/` folder",
  "config files your coding tools require",
  "discern uninstall",
  "no API",
  "key, and no surprises",
  "MOST CAPABLE model",
  "Expect roughly 20–40 minutes",
  "FOR CODING AGENTS",
  "verify → begin → author → done",
  "NOTHING is written",
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
    "quality gates and safe worktrees",
  );
  assertStringIncludes(
    styledLines[splitMark.length + 1] ?? "",
    "for coding agents and the humans who run them.",
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
      !(await exists(join(dir, "discern.toml"))),
      "the welcome must write nothing — scaffolding belongs to `begin`",
    );
  });
});

Deno.test("the fresh welcome --json carries phase=fresh and the verify funnel", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup", "--json"]);
    assertEquals(r.code, 0, r.output);
    const d = JSON.parse(r.stdout).data;
    assertEquals(d.phase, "fresh");
    assertEquals(d.complete, false);
    assertStringIncludes(d.next_action, "verify");
    assert(
      !(await exists(join(dir, "discern.toml"))),
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

    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;
    assertEquals(d.phase, "in_progress");
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
    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;
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
    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;

    // The agent guidance carries the role + the verify funnel the human prose has,
    // and points at verify as the source of the message to relay (ADR 0086).
    assertStringIncludes(d.agent_guidance, "nothing is written until");
    assertStringIncludes(
      d.agent_guidance,
      "hands you the exact message to relay",
    );
    assertStringIncludes(d.agent_guidance, "discern setup verify");
    // The human framing carries the most-capable-model nudge the human block makes.
    assertStringIncludes(d.human_framing, "most capable model");
    // Both surfaces actually say it, so neither path is the thinner one.
    assertStringIncludes(human, "MOST CAPABLE");
    // The footprint story rides both surfaces: one root file, one visible folder.
    assertStringIncludes(d.human_framing, "one visible discern/ folder");
    assertStringIncludes(human, "one visible `discern/` folder");
  });
});

Deno.test("the in-progress welcome --json carries the 'your job, not a status' agent guidance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]);
    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;
    assertEquals(d.phase, "in_progress");
    // The resume framing the human text carries ("this is YOUR job ... not a status
    // to report back") must ride the JSON path too, not just the human one.
    assertStringIncludes(d.agent_guidance, "YOUR job");
    assertStringIncludes(d.agent_guidance, "discern setup done");
  });
});

// ── the verify preflight ─────────────────────────────────────────────────────

Deno.test("verify reports grounded findings and the consent conversation, writing nothing", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    );
    const d = res.data;
    assertEquals(d.phase, "fresh");
    assertEquals(d.findings.git.repo, true);
    assertEquals(d.findings.docs.exists, false);
    assert(typeof d.findings.worktree_path === "string");
    // The consent conversation rides the prose `guidance` lane (not structured
    // fields the agent summarizes) as a ready-to-relay message: the relay licence,
    // then the points to settle with the human — model, worktree, ready — plus the
    // funnel to begin (ADR 0086).
    assertStringIncludes(d.guidance, "Relay the message below to your human");
    assertStringIncludes(d.guidance, "Am I your most capable model");
    assertStringIncludes(
      d.guidance,
      "Isolated working copies will live beside",
    );
    assertStringIncludes(d.guidance, "Ready for me to begin");
    assertStringIncludes(d.next_action, "begin");
    // The command the agent runs after the conversation carries the consent
    // attestation — a fresh begin refuses without it.
    assertStringIncludes(d.next_action, "--confirmed");
    // Read-only: verify scaffolds nothing.
    assert(
      !(await exists(join(dir, "discern.toml"))),
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
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertStringIncludes(d.next_action, "--model");
    // The consent guidance instructs passing --model for best-effort provenance.
    assertStringIncludes(d.guidance, "--model");
  });
});

Deno.test("verify's consent guidance is identical and faithful across the human render and --json (the A9 parity guard)", async () => {
  // Running `verify --json` once led an agent to summarize and weaken the consent
  // conversation — it dropped "open warmly", reworded the model question, and guessed a
  // model id — while the SAME verify in human-readable form was followed faithfully.
  // The consent now rides ONE prose `guidance` lane; this pins the two surfaces to the
  // same text and asserts every load-bearing instruction survives in both, so they can
  // never silently diverge again (ADR 0078, the two-lane rule).
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const human = (await runAgent(dir, ["setup", "verify"])).stdout;
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    const d = res.data;

    // One source, two renderings: the human preflight embeds the --json prose lane
    // verbatim, so the consent conversation cannot drift between the surfaces.
    assert(
      typeof d.guidance === "string" && d.guidance.length > 200,
      `expected a substantial consent guidance string: ${d.guidance}`,
    );
    assertStringIncludes(human, d.guidance);

    // Every load-bearing point is present in BOTH surfaces: the adaptive relay
    // licence, the exact model question verbatim, the three-pillar explainer, the
    // time+token expectation, the worktree location, and the confirmed command — the
    // content a courier agent must carry unweakened (ADR 0086, the two-lane rule).
    for (
      const needle of [
        "adapt the wording to your own voice if you like, but keep every point",
        "Am I your most capable model?",
        "Everything I configure here is inherited by every future session.",
        "isolated working copies (git worktrees)",
        "20–40 minutes",
        "Isolated working copies will live beside",
        "--confirmed",
      ]
    ) {
      assertStringIncludes(
        d.guidance,
        needle,
        `--json guidance missing: ${needle}`,
      );
      assertStringIncludes(human, needle, `human render missing: ${needle}`);
    }

    // Faithfulness (ADR 0041): the real serialized envelope — guidance and all —
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

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    );
    const d = res.data;
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
    assertStringIncludes(d.guidance, "You already have a docs/ folder");
    assertStringIncludes(d.guidance, "discern won't touch it");
    assertStringIncludes(d.guidance, SOURCE_PATHS.map.defaultPath);
    assert(
      !d.guidance.includes("--map"),
      "the existing-docs adoption offer must not return",
    );
    assert(!d.next_action.includes("--map"));
    SetupVerifyOutputSchema.parse(res);
  });
});

Deno.test("verify asks no docs question when the project has no docs folder", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertEquals(d.findings.docs.exists, false);
    assert(!d.guidance.includes("You already have a docs/ folder"));
    assert(!d.guidance.includes("--map"));
    // The default is still stated: the human render names where the map lands.
    const human = (await runAgent(dir, ["setup", "verify"])).stdout;
    assertStringIncludes(human, SOURCE_PATHS.map.defaultPath);
  });
});

Deno.test("verify redirects once setup is recorded (the preflight is moot)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    ).data;
    assertEquals(d.phase, "done");
  });
});

// ── the reactivation handoff + provenance ────────────────────────────────────

Deno.test("setup done emits the provider-aware reactivation handoff", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // agents: [claude_code]
    const done = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(done.code, 0, done.output);
    // The human handoff names the wired agent and the fresh-session step.
    assertTerminalTextIncludes(done.stdout, "load them at session start");
    assertTerminalTextIncludes(done.stdout, "Claude Code");
    // The --json carries it structurally for an agent to act on.
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    ).data;
    assert(typeof d.reactivation.summary === "string");
    assert(
      d.reactivation.per_agent.some((a: { agent: string }) =>
        a.agent === "claude_code"
      ),
      `expected claude_code in the handoff: ${JSON.stringify(d.reactivation)}`,
    );
  });
});

Deno.test("setup done serves the completion message at parity across the human render and --json (ADR 0086)", async () => {
  // The bookend of the served-message handshake: an agent that only relays discern's
  // words still gives the human a warm, accurate close. The message rides ONE prose
  // `guidance` lane, carried verbatim by both surfaces so the relay can't drift.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // agents: [claude_code]
    const human = (await runAgent(dir, ["setup", "done", "--force"])).stdout;
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    const d = res.data;

    // One source, two renderings: the human output embeds the --json guidance verbatim.
    assert(
      typeof d.guidance === "string" && d.guidance.length > 100,
      `expected a substantial completion guidance string: ${d.guidance}`,
    );
    assertStringIncludes(human, d.guidance);

    // The close carries the relay licence, the honest coverage (minimal here — the
    // seeded tidy job is housekeeping, nothing of the project's own is wired), the
    // reactivation step, and the landing account — in BOTH surfaces.
    for (
      const needle of [
        "Relay the message below to your human",
        "discern is set up",
        "No quality checks are wired yet",
        "start a fresh session",
      ]
    ) {
      assertStringIncludes(d.guidance, needle, `guidance missing: ${needle}`);
      assertStringIncludes(human, needle, `human render missing: ${needle}`);
    }

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

Deno.test("begin ignores a literal model placeholder, recording no bogus provenance", async () => {
  // The verify funnel shows `--model "<your-model-id>"`; an agent that copies it
  // verbatim instead of substituting must not record `<your-model-id>` as the model.
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
    assert(
      !toml.includes("setup_model"),
      `a placeholder model must not be recorded: ${toml}`,
    );
  });
});
