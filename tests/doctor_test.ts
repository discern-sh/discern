/**
 * Installer `doctor` surface tests: drive `src/main.ts doctor` as a subprocess
 * (so Cliffy parsing, JSON vs human rendering, the per-check diagnostics, and the
 * exit code are all exercised for real). With the committed engine gone, the
 * checks are in-process and few: the config parses, the recorded schema is
 * current (`[meta].schema_version`), and the capabilities resolve.
 *
 * Two output channels matter. `--json` prints the payload to STDOUT. The human
 * render (no `--json`) goes to STDERR: the `Logger` writes headings, ok/error
 * lines and fix details with `console.error`; only the trailing blank `line()`
 * lands on stdout. So the human-path assertions read `stderr`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { measureText, stripAnsi } from "discern-design-system/cli";
import {
  assertTerminalTextIncludes,
  fakeEnv,
  runCli,
  unexpectedTerminalControls,
  withTempDir,
} from "./helpers.ts";
import { addWorktree, git, gitInit } from "./engine_helpers.ts";
import { crossedRepoBoundaries } from "../src/shared/env.ts";
import {
  agentFilePaths,
  renderAgentFiles,
} from "../src/engine/instruction_render.ts";
import { providerFor, providersWithHooks } from "../src/lib/providers.ts";
import {
  AGENT_NAMES,
  loadConfig,
  toCommandList,
} from "../src/shared/config_schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../src/lib/version.ts";
import { DESK_SESSION_ENV } from "../src/engine/desk/session.ts";
import { DISCERN_MARK } from "../src/shared/brand.ts";
import { DISCERN_GENERATED_MERGE_DRIVER } from "../src/lib/agent_gitattributes.ts";
import {
  DOCTOR_ORIENTATION_MAX_CHARS,
  executionModelHumanGroups,
  renderDoctorCheck,
  renderDoctorCheckLine,
  renderDoctorHeader,
  renderDoctorHumanGroups,
  runChecks,
} from "../src/commands/doctor.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import type { DoctorData } from "../src/shared/result_schemas.ts";
import { z } from "@zod/zod";
import {
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

const DOCTOR_DIAGNOSTIC_ROUND_TRIP_SCHEMA = z.object({
  name: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  ok: z.boolean(),
  warn: z.boolean().optional(),
  detail: z.string(),
  fix: z.string().optional(),
});

const DOCTOR_ENVIRONMENT_ROUND_TRIP_SCHEMA = z.object({
  discern: z.string(),
  platform: z.string(),
  git: z.string().optional(),
});

const COMMAND_LIST_VALUE_SCHEMA = z.union([
  z.string(),
  z.array(z.string()),
]);

const DRIVER_KEY = `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver`;

const CLAUDE_SETTINGS_SCHEMA = z.object({
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        hooks: z.array(
          z.object({
            type: z.string(),
            command: z.string(),
          }).passthrough(),
        ),
      }).passthrough(),
    ),
  ).optional(),
}).passthrough();

/** One check in the validated `doctor --json` payload. */
type DoctorCheck = DoctorData["checks"][number];

/** One verb in the validated doctor execution model. */
type ExecVerb = NonNullable<DoctorData["execution_model"]>[number];

/** A validated doctor envelope narrowed to the command's normal data payload. */
type DoctorPayload = Omit<CliResultForCommand<"doctor">, "data"> & {
  data: DoctorData;
};

/** Decode doctor stdout and require the command's normal diagnostic payload. */
function decodeDoctor(stdout: string): DoctorPayload {
  const result = decodeCliResult(stdout, "doctor");
  assert(
    result.data !== undefined &&
      "checks" in result.data &&
      "environment" in result.data,
    "doctor must return its diagnostic data payload",
  );
  return { ...result, data: result.data };
}

Deno.test("doctor terminal Components make dynamic facts inert without mutating result data", () => {
  const width = 48;
  const terminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: width, rows: 24 }),
  });
  const diagnostic = {
    name: "repo 👩‍💻\x1b",
    status: "warn" as const,
    ok: true,
    warn: true as const,
    detail: "bell\x07 C1\u0085 bidi\u202E\r\nnext café",
    fix: "use safe\x1b path\u2066",
  };
  const originalDiagnostic = structuredClone(diagnostic);
  const environment = {
    discern: "0.1\x1b\u0085",
    platform: "café/👩‍💻\u202E\r\nos",
    git: "git version 2.0\x07",
  };
  const originalEnvironment = structuredClone(environment);
  const check = renderDoctorCheck(diagnostic, terminal);
  const okCheck = renderDoctorCheck(
    {
      name: "ok",
      status: "ok",
      ok: true,
      detail: `long-${"fact".repeat(24)}\x1b\u202E`,
    },
    terminal,
  );
  const header = renderDoctorHeader(environment, terminal);
  const okOutput = renderDoctorCheckLine(okCheck, terminal);

  assertStringIncludes(stripAnsi(header), DISCERN_MARK);
  assertStringIncludes(okCheck.line, "\n");
  assertEquals(
    stripAnsi(okOutput).split("\n").length,
    okCheck.line.split("\n").length,
  );
  assertEquals(okOutput.includes("␊"), false);

  for (const output of [header, check.line, check.fix ?? "", okOutput]) {
    const plain = stripAnsi(output);
    assertEquals(unexpectedTerminalControls(plain), []);
    assert(!/[\p{Cc}\p{Cf}]/u.test(plain.replaceAll("\n", "")));
    for (const line of plain.split("\n")) {
      assert(
        measureText(line) <= width,
        `doctor output overflowed ${width} columns: ${JSON.stringify(line)}`,
      );
    }
  }
  const combined = stripAnsi(
    `${header}\n${check.line}\n${check.fix ?? ""}\n${okOutput}`,
  );
  for (
    const visible of [
      "<U+200D>",
      "␛",
      "␇",
      "<U+0085>",
      "<U+202E>",
      "<U+2066>",
    ]
  ) {
    assertStringIncludes(combined, visible);
  }
  assertStringIncludes(combined, "next café");
  assertEquals(diagnostic, originalDiagnostic);
  assertEquals(environment, originalEnvironment);
  assertEquals(
    decodeWith(
      DOCTOR_DIAGNOSTIC_ROUND_TRIP_SCHEMA,
      JSON.stringify(diagnostic),
    ),
    originalDiagnostic,
  );
  assertEquals(
    decodeWith(
      DOCTOR_ENVIRONMENT_ROUND_TRIP_SCHEMA,
      JSON.stringify(environment),
    ),
    originalEnvironment,
  );
});

/** Scaffold a healthy install in `dir`; assert it succeeded. */
async function setupInstall(dir: string, slug = "doc-demo"): Promise<void> {
  const { code } = await runCli([
    "setup",
    "begin",
    "--confirmed",
    "--slug",
    slug,
  ], dir);
  assertEquals(code, 0, "setup should scaffold a healthy install");
}

/** Run the explicit verbose structured doctor used by execution-model tests. */
async function runDoctorJson(
  dir: string,
): Promise<{ code: number; payload: DoctorPayload }> {
  const { code, stdout } = await runCli([
    "doctor",
    "--verbose",
    "--json",
  ], dir);
  return { code, payload: decodeDoctor(stdout) };
}

Deno.test("doctor default JSON is a bounded orientation result and verbose opts into the execution model", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const routine = await runCli(["doctor", "--json"], dir);
    assertEquals(routine.code, 0, routine.stderr);
    assert(
      routine.stdout.length <= DOCTOR_ORIENTATION_MAX_CHARS,
      `routine doctor used ${routine.stdout.length} characters`,
    );
    const bounded = decodeDoctor(routine.stdout);
    assertEquals(bounded.data.execution_model, undefined);
    assert(
      bounded.hints?.some((hint) =>
        hint.includes("discern doctor --verbose --json")
      ),
    );

    const verbose = await runDoctorJson(dir);
    assert(verbose.payload.data.execution_model !== undefined);

    for (let call = 0; call < 2; call += 1) {
      const status = await runCli(["status", "--json"], dir);
      assertEquals(status.code, 0, status.stderr);
      assert(
        status.stdout.length <= DOCTOR_ORIENTATION_MAX_CHARS,
        `routine status call ${
          call + 1
        } used ${status.stdout.length} characters`,
      );
    }
  });
});

/** Find a named check in a payload, asserting it is present. */
function check(payload: DoctorPayload, name: string): DoctorCheck {
  const found = payload.data.checks.find((c) => c.name === name);
  assert(found !== undefined, `expected a '${name}' check`);
  return found;
}

/** Find a verb in the execution model, asserting it (and the model) is present. */
function modelVerb(payload: DoctorPayload, verb: string): ExecVerb {
  const model = payload.data.execution_model;
  assert(model !== undefined, "expected an execution_model in the payload");
  const found = model.find((v) => v.verb === verb);
  assert(
    found !== undefined,
    `expected a '${verb}' verb in the execution model`,
  );
  return found;
}

/** Assert one empty line, neither zero nor two, before each visible group start. */
function assertDoctorGroupBoundaries(
  output: string,
  starts: readonly string[],
): void {
  const plain = stripAnsi(output);
  const boundaryFailures: string[] = [];
  for (const marker of starts) {
    const renderedMarker = plain.includes(marker)
      ? marker
      : marker.toUpperCase();
    const markerAt = plain.indexOf(renderedMarker);
    assert(markerAt >= 0, `doctor should render ${marker}`);
    const lineStart = plain.lastIndexOf("\n", markerAt) + 1;
    let precedingNewlines = 0;
    for (
      let index = lineStart - 1;
      index >= 0 && plain[index] === "\n";
      index -= 1
    ) {
      precedingNewlines += 1;
    }
    if (precedingNewlines !== 2) {
      boundaryFailures.push(`${marker}: ${precedingNewlines}`);
    }
  }

  assertEquals(
    boundaryFailures,
    [],
    "each populated Doctor group must begin after exactly one blank line " +
      "(marker: preceding newline count)",
  );
  assert(
    !plain.includes("\n\n\n"),
    "Doctor must not render doubled blank boundaries",
  );
}

/** Locate the package's ruled section line for one title without depending on
 * Unicode-vs-ASCII glyph selection or on a coincidental mention in body text. */
function doctorSectionRuleIndex(
  lines: readonly string[],
  title: string,
): number {
  const marker = ` ${title.toUpperCase()} `;
  return lines.findIndex((line) => {
    const markerAt = line.indexOf(marker);
    if (markerAt < 0) return false;
    const frame = `${line.slice(0, markerAt)}${
      line.slice(markerAt + marker.length)
    }`;
    return frame.trim().length > 0 &&
      !/[\p{L}\p{N}]/u.test(frame.replaceAll("v", ""));
  });
}

/** Assert exactly one empty line immediately before each indexed subgroup. */
function assertOneBlankBefore(
  lines: readonly string[],
  starts: readonly { readonly id: string; readonly index: number }[],
): void {
  const failures: string[] = [];
  for (const start of starts) {
    assert(start.index >= 0, `doctor should render ${start.id}`);
    let blanks = 0;
    for (
      let index = start.index - 1;
      index >= 0 && lines[index] === "";
      index -= 1
    ) {
      blanks += 1;
    }
    if (blanks !== 1) failures.push(`${start.id}: ${blanks}`);
  }
  assertEquals(
    failures,
    [],
    "each execution-model subgroup must begin after exactly one blank line " +
      "(group: blank-line count)",
  );
}

/** Check boundaries for the legend/pointers and every member of the canonical
 * execution model returned by the same invocation's machine result. */
function assertExecutionModelGroupBoundaries(
  output: string,
  model: readonly ExecVerb[],
  verbose: boolean,
): void {
  const lines = stripAnsi(output).split("\n");
  const pointerText =
    "Run `discern doctor --verbose` to show hints explaining each execution step.";
  const pointerStarts = lines.flatMap((line, index) =>
    line.includes(pointerText) ? [{ id: `pointer-${index}`, index }] : []
  );
  assertEquals(
    pointerStarts.length,
    verbose ? 0 : 2,
    verbose
      ? "verbose execution model must omit both opt-in pointers"
      : "default execution model must render top and footer pointers",
  );
  const verbStarts = model.map((verb) => ({
    id: `verb:${verb.verb}`,
    index: doctorSectionRuleIndex(lines, verb.verb),
  }));
  const orderedStarts = verbose ? verbStarts : (() => {
    const [top, footer] = pointerStarts;
    assert(top !== undefined && footer !== undefined);
    return [top, ...verbStarts, footer];
  })();
  assertEquals(
    orderedStarts.map((start) => start.index),
    orderedStarts.map((start) => start.index).toSorted((a, b) => a - b),
    "execution-model subgroups must follow canonical model order",
  );
  assertOneBlankBefore(lines, orderedStarts);
}

/** Append a TOML fragment to the scaffold's config (e.g. a worktree resource). */
async function appendConfig(dir: string, toml: string): Promise<void> {
  const p = join(dir, "discern.toml");
  await Deno.writeTextFile(p, `${await Deno.readTextFile(p)}\n${toml}`);
}

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
}

/** Replace the scaffold's configured agent set. */
async function setAgents(dir: string, agents: string): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/agents = \[[^\]]*\]/, `agents = ${agents}`),
  );
}

/** Add a key under the scaffold's existing `[jobs]` table. */
async function addCapability(
  dir: string,
  key: string,
  value: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/^\[jobs\]\n/m, `[jobs]\n${key} = "${value}"\n`),
  );
}

/** Add a key under `[jobs]` with a pre-rendered TOML value literal
 * (single-quoted, so the value itself may contain double quotes). */
async function addCapabilityLiteral(
  dir: string,
  key: string,
  literal: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(
      /^\[jobs\]\n/m,
      `[jobs]\n${key} = '${literal}'\n`,
    ),
  );
}

/** Set a `[jobs]` key to a RAW TOML value literal, verbatim — the caller
 * writes the exact right-hand side (`""`, `[]`, `":"`, `["echo hi"]`), so a test can
 * exercise the no-op forms `toCommandList` drops, which the quote-wrapping helpers
 * above cannot express. */
async function setCapabilityRaw(
  dir: string,
  key: string,
  rawValue: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(
      /^\[jobs\]\n/m,
      `[jobs]\n${key} = ${rawValue}\n`,
    ),
  );
}

/** Remove the seeded tidy job and optionally mark setup complete. */
async function removeTidyFormatJob(
  dir: string,
  bootstrapped: boolean,
): Promise<void> {
  const p = join(dir, "discern.toml");
  let text = await Deno.readTextFile(p);
  text = text.replace(/^\s*format\s*=\s*"discern tidy"\s*\n/m, "");
  if (bootstrapped) {
    text = text.replace(/^\[meta\]\n/m, "[meta]\nbootstrapped = true\n");
  }
  await Deno.writeTextFile(p, text);
}

/** Append a `[jobs.<name>]` table to the scaffold's config. */
async function addCheck(
  dir: string,
  name: string,
  stage: string,
  run: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    `${text}\n[jobs.${name}]\nstage = "${stage}"\nrun = "${run}"\n`,
  );
}

/** One `[generated.<name>]` fixture. Multi-group tests render this table
 * directly, so adding a group enrols it in every per-group row assertion. */
interface GeneratedGroupFixture {
  readonly name: string;
  readonly paths: readonly string[];
  readonly run: string;
}

/** Append production-shaped generated-artifact groups to a scaffolded test config. */
async function addGeneratedGroups(
  dir: string,
  groups: readonly GeneratedGroupFixture[],
): Promise<void> {
  await appendConfig(
    dir,
    groups.map((group) =>
      `[generated.${group.name}]\npaths = ${
        JSON.stringify(group.paths)
      }\nrun = ${JSON.stringify(group.run)}`
    ).join("\n\n"),
  );
}

/** Keep a just-initialized test repository from failing doctor's separate
 * logbook-history check before these generated-contract assertions run. */
async function disableLogbook(dir: string): Promise<void> {
  const path = join(dir, "discern.toml");
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(
    path,
    text.replace("logbook = true", "logbook = false"),
  );
}

/** Scaffold and commit generated paths used by Git-attribute doctor cases. */
async function generatedDoctorProject(
  dir: string,
  paths: readonly string[] = ["generated/bundle.txt"],
): Promise<void> {
  await setupInstall(dir);
  await disableLogbook(dir);
  await Deno.mkdir(join(dir, "generated"));
  for (const path of paths) {
    await Deno.writeTextFile(join(dir, path), `${path}\n`);
  }
  await addGeneratedGroups(dir, [{
    name: "bundle",
    paths: ["generated/**"],
    run: "sh -c true",
  }]);
  const refresh = await runCli(["refresh", "--json"], dir);
  assertEquals(refresh.code, 0, refresh.stderr);
  await gitInit(dir);
}

Deno.test("doctor --json: a fresh install includes the seeded tidy format job", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(payload.ok, true);
    assertEquals(payload.verb, "doctor");
    assertEquals(payload.data.kit_version, KIT_VERSION);
    for (
      const name of ["discern.toml", "schema version", "known jobs", "git"]
    ) {
      assertEquals(check(payload, name).ok, true, `${name} should pass`);
    }
    for (const c of payload.data.checks) {
      assert(
        c.status === "ok" || c.status === "warn" || c.status === "fail",
        `${c.name} should carry a closed status`,
      );
    }
    const capabilities = check(payload, "known jobs");
    // The seeded tidy job runs, but protects nothing of the project's own —
    // a fresh install warns instead of reading as covered.
    assertEquals(capabilities.status, "warn");
    assertStringIncludes(capabilities.detail, "only discern's own upkeep");
    assertStringIncludes(capabilities.detail, "format");
    const tidy = check(payload, "tidy format job");
    assertEquals(tidy.status, "ok");
    assertStringIncludes(tidy.detail, "includes `discern tidy`");
    // The schema check names the current version.
    assertStringIncludes(check(payload, "schema version").detail, "current");
    // The git check reports the resolved version (triage context).
    assertStringIncludes(check(payload, "git").detail, ".");
    // The environment block is populated for bug-report triage.
    assertEquals(payload.data.environment.discern, KIT_VERSION);
    assert(
      payload.data.environment.platform.includes("/"),
      "platform should be os/arch",
    );
  });
});

Deno.test("doctor reports when it runs inside a desk-owned child session", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const env = { [DESK_SESSION_ENV]: "1" };

    const json = await runCli(["doctor", "--json"], dir, env);
    assertEquals(json.code, 0);
    const payload = decodeDoctor(json.stdout);
    assertEquals(payload.data.environment.desk_session, true);

    const human = await runCli(["doctor"], dir, env);
    assertEquals(human.code, 0);
    assertTerminalTextIncludes(human.stderr, "desk session: active");
    assertTerminalTextIncludes(human.stderr, "launched by discern desk");
  });
});

Deno.test("every failing doctor check names a fix (shape guard over the emitted set)", async () => {
  // The per-check tests pin fix-presence one check at a time (schema version, git,
  // script contract, gotchas, the capability nudge…). This ties the invariant to the
  // whole emitted set: degrade the install so a broad set of checks trips at once,
  // then assert every check carries a closed status and every FAILING one names a
  // non-empty fix — an unactionable failure is a dead end. A new check that fails
  // without a remedy red-lights here rather than shipping silently.
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const cfgPath = join(dir, "discern.toml");
    let toml = await Deno.readTextFile(cfgPath);
    toml = toml.replace(/agents = \[[^\]]*\]/, 'agents = ["bogus_agent"]'); // unknown → fails
    await Deno.writeTextFile(cfgPath, toml);

    const { payload } = await runDoctorJson(dir);
    const failing = payload.data.checks.filter((c) => c.status === "fail");
    assert(
      failing.length >= 1,
      `the degraded fixture should fail at least one check, got: ${
        payload.data.checks.map((c) => `${c.name}:${c.status}`).join(", ")
      }`,
    );
    for (const c of payload.data.checks) {
      assert(
        c.status === "ok" || c.status === "warn" || c.status === "fail",
        `${c.name}: must carry a closed status, got "${c.status}"`,
      );
      if (c.status === "fail") {
        assert(
          (c.fix ?? "").trim().length > 0,
          `${c.name}: a failing check must name a fix (it is a dead end otherwise)`,
        );
      }
    }
  });
});

Deno.test("doctor: the git check fails with a fix when git is unreachable", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Point GIT_BIN at a name that does not resolve, so the git probe fails the
    // same way a machine with no git would — without touching the real PATH.
    const { code, stdout } = await runCli(["doctor", "--json"], dir, {
      GIT_BIN: "definitely-not-git-12345",
    });
    const payload = decodeDoctor(stdout);
    assertEquals(code, 1);
    const git = check(payload, "git");
    assertEquals(git.ok, false);
    assertStringIncludes(git.fix ?? "", "install Git");
    // The environment block records git as absent (omitted) rather than crashing.
    assertEquals(payload.data.environment.git, undefined);
  });
});

Deno.test("doctor: Git below the declared minimum fails before repository probes", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const fakeGit = join(dir, "old-git");
    await Deno.writeTextFile(
      fakeGit,
      '#!/bin/sh\necho "git version 2.29.9"\n',
    );
    await Deno.chmod(fakeGit, 0o755);

    const { code, stdout } = await runCli(["doctor", "--json"], dir, {
      GIT_BIN: fakeGit,
    });
    const payload = decodeDoctor(stdout);
    assertEquals(code, 1);
    const git = check(payload, "git");
    assertEquals(git.status, "fail");
    assertStringIncludes(git.detail, "requires Git 2.30.0 or later");
    assertStringIncludes(git.fix ?? "", "upgrade Git");
  });
});

Deno.test("doctor: human output reports advisories separately from failures", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "discern doctor");
    // The environment header gives at-a-glance triage context.
    assertStringIncludes(stderr, `discern ${KIT_VERSION} ·`);
    assertStringIncludes(stderr, "discern.toml: present and valid TOML");
    assertStringIncludes(stderr, `schema ${SCHEMA_VERSION} (current)`);
    assertStringIncludes(
      stderr,
      "known jobs: only discern's own upkeep is wired (format)",
    );
    assertStringIncludes(stderr, "tidy format job: the format job includes");
    assertStringIncludes(stderr, "git: ");
    assertStringIncludes(stderr, "All checks passed (see the advisory above).");
    const modelAt = stderr.indexOf("EXECUTION MODEL");
    const checksAt = stderr.indexOf("DOCTOR CHECKS");
    const firstCheckAt = stderr.indexOf("discern.toml: present and valid TOML");
    const summaryAt = stderr.indexOf("All checks passed");
    assert(modelAt >= 0, "doctor should render the execution model");
    assert(checksAt > modelAt, "doctor checks should follow the model");
    assert(firstCheckAt > checksAt, "checks should render under their heading");
    assert(summaryAt > firstCheckAt, "the summary should close the output");
  });
});

Deno.test("doctor: every populated top-level human group has one boundary", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor", "--no-color"], dir);
    assertEquals(code, 0);

    assertDoctorGroupBoundaries(stderr, [
      "Execution model",
      "Doctor checks",
      "All checks passed",
    ]);
  });
});

Deno.test("doctor: top-level grouping enrolls empty combinations and a fresh sibling", () => {
  const events: string[] = [];
  renderDoctorHumanGroups(
    {
      group: (id: string): void => {
        events.push(`group:${id}`);
      },
    },
    [
      {
        id: "orbit",
        items: [(): void => {
          events.push("item:orbit");
        }],
      },
      { id: "canopy", items: [] },
      {
        id: "fresh-sibling",
        items: [(): void => {
          events.push("item:fresh-sibling");
        }],
      },
      { id: "harbor", items: [] },
      {
        id: "estuary",
        items: [(): void => {
          events.push("item:estuary");
        }],
      },
    ],
  );

  assertEquals(events, [
    "group:orbit",
    "item:orbit",
    "group:fresh-sibling",
    "item:fresh-sibling",
    "group:estuary",
    "item:estuary",
  ]);
});

Deno.test("doctor: execution-model grouping enrolls a fresh canonical member", () => {
  const events: string[] = [];
  const model = [
    { verb: "orbit" },
    { verb: "fresh sibling" },
    { verb: "estuary" },
  ];
  const groups = executionModelHumanGroups(model, false, {
    legend: (): void => {
      events.push("item:legend");
    },
    pointer: (position): void => {
      events.push(`item:pointer:${position}`);
    },
    verb: (plan): void => {
      events.push(`item:verb:${plan.verb}`);
    },
  });
  renderDoctorHumanGroups(
    {
      group: (id: string): void => {
        events.push(`group:${id}`);
      },
    },
    groups,
  );

  assertEquals(events, [
    "group:execution-model-legend",
    "item:legend",
    "group:execution-model-pointer-top",
    "item:pointer:top",
    "group:execution-model-verb:orbit",
    "item:verb:orbit",
    "group:execution-model-verb:fresh sibling",
    "item:verb:fresh sibling",
    "group:execution-model-verb:estuary",
    "item:verb:estuary",
    "group:execution-model-pointer-footer",
    "item:pointer:footer",
  ]);

  assertEquals(
    executionModelHumanGroups(model, true, {
      legend: (): void => {},
      pointer: (): void => {},
      verb: (): void => {},
    }).filter((group) => group.items.length > 0).map((group) => group.id),
    [
      "execution-model-legend",
      "execution-model-verb:orbit",
      "execution-model-verb:fresh sibling",
      "execution-model-verb:estuary",
    ],
  );
});

Deno.test("doctor: execution-model subgroups keep one gap in default and verbose views", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const machine = await runDoctorJson(dir);
    const model = machine.payload.data.execution_model;
    assert(
      model !== undefined,
      "healthy Doctor should carry its canonical model",
    );

    const normal = await runCli(["doctor", "--no-color"], dir);
    assertEquals(normal.code, 0);
    assertExecutionModelGroupBoundaries(normal.stderr, model, false);

    const verbose = await runCli(
      ["doctor", "--no-color", "--verbose"],
      dir,
    );
    assertEquals(verbose.code, 0);
    assertExecutionModelGroupBoundaries(verbose.stderr, model, true);
  });
});

Deno.test("doctor: invalid (malformed) discern.toml is flagged with a syntax fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, "discern.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "invalid");
    assertEquals(toml.fix, "fix the TOML syntax in discern.toml");
    // With an unparseable config the later checks have nothing to read, so they
    // are not emitted.
    assertEquals(
      payload.data.checks.find((c) => c.name === "schema version"),
      undefined,
    );
  });
});

Deno.test("doctor: human output still prints checks when the execution model cannot load", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );

    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 1);
    assert(
      !stderr.includes("EXECUTION MODEL"),
      "invalid config should omit the execution model",
    );
    assertStringIncludes(stderr, "DOCTOR CHECKS");
    assertStringIncludes(stderr, "discern.toml: invalid");
    assertStringIncludes(stderr, "fix: fix the TOML syntax in discern.toml");
    assertStringIncludes(stderr, "1 check failed — see the fixes above.");
    assertDoctorGroupBoundaries(stderr, [
      "Doctor checks",
      "1 check failed",
    ]);
  });
});

Deno.test("doctor: a missing config is flagged as not initialized", async () => {
  await withTempDir(async (dir) => {
    // No `setup` here — the dir has no discern.toml.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, "discern.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "not found");
    assertStringIncludes(toml.fix ?? "", "discern setup");
  });
});

// The class guard for B30: `discern doctor` must resolve the project root by
// walking up from the cwd (via `findRoot`), the same way status/finish and its own
// `discern_doctor` MCP tool do — so it diagnoses the real install from ANY
// subdirectory, never a phantom "broken" one at the cwd. Table-shaped over several
// nesting depths so it guards the class, not one depth; it fails on the pre-fix
// `destDir = Deno.cwd()`, which reports "discern.toml: not found in this directory"
// from every subdir.
const SUBDIR_DEPTHS: { label: string; segments: string[] }[] = [
  { label: "one level down", segments: ["src"] },
  { label: "two levels down", segments: ["src", "commands"] },
  { label: "three levels down", segments: ["a", "b", "c"] },
];

for (const { label, segments } of SUBDIR_DEPTHS) {
  Deno.test(`doctor: run from a subdirectory (${label}) diagnoses the install at the root`, async () => {
    await withTempDir(async (dir) => {
      await setupInstall(dir);
      const sub = join(dir, ...segments);
      await Deno.mkdir(sub, { recursive: true });

      // Run doctor with the cwd set to the subdirectory. It must find the real
      // discern.toml at the root, not report the install missing/broken.
      const { code, stdout } = await runCli(["doctor", "--json"], sub);
      const payload = decodeDoctor(stdout);
      assertEquals(
        code,
        0,
        `doctor from ${label} should be healthy: ${
          JSON.stringify(payload.data.checks)
        }`,
      );
      const toml = check(payload, "discern.toml");
      assertEquals(
        toml.ok,
        true,
        "the config must resolve from a subdirectory",
      );
      assertStringIncludes(toml.detail, "present and valid TOML");
      // The schema check reads the root's recorded version, not a phantom default.
      assertStringIncludes(check(payload, "schema version").detail, "current");
    });
  });
}

Deno.test("doctor: a stale schema is flagged with an upgrade fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const checks = await runChecks(dir, {
      currentSchema: SCHEMA_VERSION + 1,
    });
    const schema = checks.find((candidate) =>
      candidate.name === "schema version"
    );
    assert(schema !== undefined, "expected a 'schema version' check");
    assertEquals(schema.status, "fail");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.detail, `v${SCHEMA_VERSION}`);
    assertStringIncludes(schema.detail, `v${SCHEMA_VERSION + 1}`);
    assertStringIncludes(schema.fix ?? "", "discern upgrade");
  });
});

// The class guard for B51: doctor must give schema advice the recommended command
// actually honors. The synthetic-current-schema test above proves that an older
// install points at `discern upgrade`; this test proves a newer one points at the
// binary update channel and that upgrade refuses the exact state.
Deno.test("doctor: a NEWER-than-binary schema advises updating discern, never the `discern upgrade` it refuses", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The project was upgraded by a newer binary than this one.
    await setSchema(dir, SCHEMA_VERSION + 1);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const schema = check(payload, "schema version");
    assertEquals(schema.status, "fail");
    assertStringIncludes(schema.detail, `v${SCHEMA_VERSION + 1}`);
    assertStringIncludes(schema.detail, "newer");
    // The remedy must point at updating discern itself, NOT at running the migrate
    // command upgrade would refuse.
    const fix = schema.fix ?? "";
    assert(
      /re-run the install script|get a newer discern/i.test(fix),
      `newer-schema fix must point at updating discern: ${fix}`,
    );
    assert(
      !/run `discern upgrade`/i.test(fix),
      `newer-schema fix must not recommend the \`discern upgrade\` that refuses this state: ${fix}`,
    );

    // Prove the contradiction the old advice created: `discern upgrade` genuinely
    // refuses this exact install, so recommending it would send the user nowhere.
    const up = await runCli(["upgrade", "--json"], dir);
    assertEquals(up.code, 1);
    assertEquals(
      decodeCliResult(up.stdout, "upgrade").error,
      "schema_version_too_new",
      "upgrade must refuse a newer-than-binary schema — the state doctor's fix must route around",
    );
  });
});

Deno.test("doctor: unknown-job shorthand is flagged with the custom table fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // An unknown name is a custom job and therefore cannot use shorthand.
    await addCapability(dir, "bogus", "echo hi");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(check(payload, "discern.toml").ok, true);
    const schema = check(payload, "config schema");
    assertEquals(schema.status, "fail");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.detail, "bogus");
    assertStringIncludes(schema.detail, "table form");
    assertStringIncludes(schema.detail, "stage");
  });
});

Deno.test("doctor: a fresh install reports its wired capabilities", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The default scaffold ships none wired; add a known one.
    await addCapability(dir, "test", "echo ok");
    const { payload } = await runDoctorJson(dir);
    const caps = check(payload, "known jobs");
    assertEquals(caps.status, "ok");
    assertEquals(caps.ok, true);
    assertStringIncludes(caps.detail, "test");
  });
});

Deno.test("doctor: explicitly inapplicable lifecycles do not trigger a known-job warning", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await removeTidyFormatJob(dir, true);
    for (const name of Object.keys(KNOWN_JOBS)) {
      const marked = await runCli(
        ["config", "set-job", name, "--not-applicable"],
        dir,
      );
      assertEquals(marked.code, 0, marked.stderr);
    }

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    const jobs = check(payload, "known jobs");
    assertEquals(jobs.status, "ok");
    assertEquals(jobs.warn, undefined);
    assertStringIncludes(jobs.detail, "no known jobs apply");
  });
});

Deno.test("doctor: missing tidy fails during setup but is informational after bootstrap", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await removeTidyFormatJob(dir, false);

    const duringSetup = await runDoctorJson(dir);
    assertEquals(duringSetup.code, 1);
    const failing = check(duringSetup.payload, "tidy format job");
    assertEquals(failing.status, "fail");
    assertStringIncludes(failing.detail, "during setup");
    assertStringIncludes(failing.fix ?? "", "restore `discern tidy`");

    const p = join(dir, "discern.toml");
    const text = await Deno.readTextFile(p);
    await Deno.writeTextFile(
      p,
      text.replace(/^\[meta\]\n/m, "[meta]\nbootstrapped = true\n"),
    );

    const afterSetup = await runDoctorJson(dir);
    assertEquals(afterSetup.code, 0);
    const informational = check(afterSetup.payload, "tidy format job");
    assertEquals(informational.status, "ok");
    assertEquals(informational.warn, undefined);
    assertEquals(informational.fix, undefined);
    assertStringIncludes(informational.detail, "opted out");
  });
});

Deno.test("doctor: a check-only command cannot masquerade as the format-stage fixer", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const configured = await runCli([
      "config",
      "set-job",
      "format",
      "--run",
      "deno fmt --check",
      "--run",
      "discern tidy",
      "--json",
    ], dir);
    assertEquals(configured.code, 0, configured.stdout + configured.stderr);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const semantics = check(payload, "format job semantics");
    assertEquals(semantics.status, "fail");
    assertStringIncludes(semantics.detail, "deno fmt --check");
    assertStringIncludes(semantics.detail, "mutating fix stage");
    assertStringIncludes(semantics.fix ?? "", "write mode");

    const repaired = await runCli([
      "config",
      "set-job",
      "format",
      "--run",
      "deno fmt",
      "--run",
      "discern tidy",
      "--json",
    ], dir);
    assertEquals(repaired.code, 0, repaired.stdout + repaired.stderr);
    const healthy = await runDoctorJson(dir);
    assertEquals(
      healthy.payload.data.checks.some((candidate) =>
        candidate.name === "format job semantics"
      ),
      false,
    );
  });
});

for (
  const invocation of ["discern tidy", "discern tidy md", "discern tidy toml"]
) {
  Deno.test(`doctor: format job invocation '${invocation}' counts as tidy`, async () => {
    await withTempDir(async (dir) => {
      await setupInstall(dir);
      const p = join(dir, "discern.toml");
      const text = await Deno.readTextFile(p);
      await Deno.writeTextFile(
        p,
        text.replace('format = "discern tidy"', `format = "${invocation}"`),
      );
      const { code, payload } = await runDoctorJson(dir);
      assertEquals(code, 0, JSON.stringify(payload.data.checks));
      assertEquals(check(payload, "tidy format job").status, "ok");
    });
  });
}

// The class guard for B29: doctor's "wired" verdict must mean the SAME thing the
// gate/status/improve mean — a capability is wired iff `toCommandList` keeps a
// command from it. Each no-op form below empties `toCommandList`, so doctor must
// report it NOT wired (warn, "none wired yet"), never healthy. Driven off the SSOT
// (`toCommandList`) and table-shaped so a new no-op form auto-enrols; it fails on the
// pre-fix `v !== undefined` predicate, which counted `""`/`[]` as wired.
const NOOP_CAPABILITY_VALUES: { label: string; raw: string }[] = [
  { label: "empty string", raw: '""' },
  { label: "empty list", raw: "[]" },
  { label: "the : no-op", raw: '":"' },
  { label: "a list of only no-ops", raw: '["", ":"]' },
];

for (const { label, raw } of NOOP_CAPABILITY_VALUES) {
  Deno.test(`doctor: a capability set to ${label} is NOT counted as wired (agrees with toCommandList)`, async () => {
    // The SSOT: this value contributes no runnable command to the gate.
    assertEquals(
      toCommandList(decodeWith(COMMAND_LIST_VALUE_SCHEMA, raw)),
      [],
      `${label} should be a toCommandList no-op — fix the fixture if this trips`,
    );
    await withTempDir(async (dir) => {
      await setupInstall(dir);
      await removeTidyFormatJob(dir, true);
      await setCapabilityRaw(dir, "test", raw);
      const { code, payload } = await runDoctorJson(dir);
      assertEquals(code, 0, JSON.stringify(payload.data.checks));
      const caps = check(payload, "known jobs");
      // The scaffold wires no other capability, so a no-op `test` leaves zero wired.
      assertEquals(
        caps.status,
        "warn",
        `a no-op capability must not read as wired: ${caps.detail}`,
      );
      assertEquals(caps.ok, true);
      assertStringIncludes(caps.detail, "none wired yet");
      assert(
        !caps.detail.includes("test"),
        `no-op capability must not appear as wired: ${caps.detail}`,
      );
    });
  });
}

Deno.test("doctor: an env-assignment prefix probes the real command, not the assignment", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The gate runs this fine through `sh -c` (the prefix is the shell's), so
    // doctor must not report the healthy install as broken.
    await addCapability(dir, "test", "CI=1 echo ok");
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    assertEquals(check(payload, "job commands").ok, true);
  });
});

Deno.test("doctor: an env-prefixed MISSING command is still detected, naming the real word", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await addCapability(dir, "test", "CI=1 definitely-not-a-tool-xyz --flag");
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const cmds = check(payload, "job commands");
    assertEquals(cmds.ok, false);
    assertStringIncludes(cmds.detail, "test → definitely-not-a-tool-xyz");
  });
});

Deno.test("doctor: a quoted leading word (a path with spaces) resolves as one command", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const script = join(dir, "my tool.sh");
    await Deno.writeTextFile(script, "#!/bin/sh\necho ok\n");
    await Deno.chmod(script, 0o755);
    await addCapabilityLiteral(dir, "test", '"./my tool.sh" --all');
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    assertEquals(check(payload, "job commands").ok, true);
  });
});

Deno.test("doctor: a dynamic leading word is skipped (advisory scope), never failed", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // `$TOOL run` can't be resolved without executing the shell — doctor skips
    // the probe rather than failing a command it cannot judge.
    await addCapabilityLiteral(dir, "test", "$TOOL run");
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    assertEquals(check(payload, "job commands").ok, true);
  });
});

Deno.test("doctor: generated run probes resolve each leading word without executing generators", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await disableLogbook(dir);
    const groups = [
      {
        name: "reference",
        paths: ["reference-*.txt"],
        run: "sh -c 'touch generator-ran'",
      },
      {
        name: "schema",
        paths: ["schema-*.json"],
        run: "definitely-not-a-generator-xyz --write",
      },
    ] satisfies readonly GeneratedGroupFixture[];
    await addGeneratedGroups(dir, groups);
    await Deno.writeTextFile(join(dir, "reference-output.txt"), "reference\n");
    await Deno.writeTextFile(join(dir, "schema-output.json"), "{}\n");
    await gitInit(dir);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    for (const group of groups) {
      const paths = check(payload, `generated: ${group.name} paths`);
      assertEquals(paths.status, "ok", `${group.name} paths should resolve`);
      assertStringIncludes(paths.detail, group.paths[0] ?? "");
      assertStringIncludes(paths.detail, "git-tracked file");
    }

    const resolved = check(payload, "generated: reference run");
    assertEquals(resolved.status, "ok");
    assertStringIncludes(resolved.detail, "leading word `sh` resolves");
    assertEquals(
      await targetExists(join(dir, "generator-ran")),
      false,
      "doctor must probe the leading word without running the generator",
    );

    const missing = check(payload, "generated: schema run");
    assertEquals(missing.status, "fail");
    assertStringIncludes(
      missing.detail,
      "leading word `definitely-not-a-generator-xyz` does not resolve",
    );
    assertStringIncludes(missing.fix ?? "", "[generated.schema] run");
  });
});

Deno.test("doctor: a stale generated-merge block warns with the refresh remedy", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await disableLogbook(dir);
    await Deno.mkdir(join(dir, "generated"));
    await Deno.writeTextFile(join(dir, "generated/bundle.txt"), "bundle\n");
    await gitInit(dir);
    await addGeneratedGroups(dir, [{
      name: "bundle",
      paths: ["generated/**"],
      run: "sh -c true",
    }]);

    const stale = await runDoctorJson(dir);
    assertEquals(stale.code, 1, JSON.stringify(stale.payload.data.checks));
    const warning = check(stale.payload, "Git attributes");
    assertEquals(warning.status, "warn");
    assertStringIncludes(warning.detail, "does not match");
    assertStringIncludes(warning.fix ?? "", "discern refresh");
    assertEquals(
      check(
        stale.payload,
        "generated merge attribute: generated/bundle.txt",
      ).status,
      "fail",
    );

    const refresh = await runCli(["refresh", "--json"], dir);
    assertEquals(refresh.code, 0, refresh.stderr);
    const current = await runDoctorJson(dir);
    assertEquals(
      current.payload.data.checks.some((candidate) =>
        candidate.name === "Git attributes"
      ),
      false,
    );
  });
});

Deno.test("doctor: a later project attribute override exposes an unsafe generated path without rewriting rules", async () => {
  await withTempDir(async (dir) => {
    await generatedDoctorProject(dir);

    const attributesPath = join(dir, ".gitattributes");
    const managed = await Deno.readTextFile(attributesPath);
    const overridden = `${managed}generated/** merge=project-driver\n`;
    await Deno.writeTextFile(attributesPath, overridden);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1, JSON.stringify(payload.data.checks));
    const unsafe = check(
      payload,
      "generated merge attribute: generated/bundle.txt",
    );
    assertEquals(unsafe.status, "fail");
    assertStringIncludes(unsafe.detail, "project-driver");
    assertStringIncludes(unsafe.detail, "generated merges are unsafe");
    assertStringIncludes(unsafe.fix ?? "", "git check-attr");
    assertEquals(
      await Deno.readTextFile(attributesPath),
      overridden,
      "doctor must preserve every project-owned attribute byte",
    );
  });
});

Deno.test("doctor: Git precedence exposes later, nested, info, unspecified, and unset generated overrides", async () => {
  await withTempDir(async (dir) => {
    await generatedDoctorProject(dir);
    const attributesPath = join(dir, ".gitattributes");
    const nestedPath = join(dir, "generated/.gitattributes");
    const infoPath = join(dir, ".git/info/attributes");
    const baseline = await Deno.readTextFile(attributesPath);
    const cases = [
      {
        name: "later root",
        value: "root-driver",
        install: async (): Promise<void> => {
          await Deno.writeTextFile(
            attributesPath,
            `${baseline}generated/** merge=root-driver\n`,
          );
        },
      },
      {
        name: "nested",
        value: "nested-driver",
        install: async (): Promise<void> => {
          await Deno.writeTextFile(nestedPath, "* merge=nested-driver\n");
        },
      },
      {
        name: "info",
        value: "info-driver",
        install: async (): Promise<void> => {
          await Deno.writeTextFile(
            infoPath,
            "generated/** merge=info-driver\n",
          );
        },
      },
      {
        name: "unspecified",
        value: "unspecified",
        install: async (): Promise<void> => {
          await Deno.writeTextFile(
            attributesPath,
            `${baseline}generated/** !merge\n`,
          );
        },
      },
      {
        name: "unset",
        value: "unset",
        install: async (): Promise<void> => {
          await Deno.writeTextFile(
            attributesPath,
            `${baseline}generated/** -merge\n`,
          );
        },
      },
    ] as const;

    for (const fixture of cases) {
      await Deno.writeTextFile(attributesPath, baseline);
      await Deno.remove(nestedPath).catch(() => {});
      await Deno.remove(infoPath).catch(() => {});
      await fixture.install();
      const beforeRoot = await Deno.readTextFile(attributesPath);
      const beforeNested = await targetExists(nestedPath)
        ? await Deno.readTextFile(nestedPath)
        : undefined;
      const beforeInfo = await targetExists(infoPath)
        ? await Deno.readTextFile(infoPath)
        : undefined;

      const { code, payload } = await runDoctorJson(dir);
      assertEquals(code, 1, `${fixture.name}: ${JSON.stringify(payload)}`);
      const unsafe = check(
        payload,
        "generated merge attribute: generated/bundle.txt",
      );
      assertEquals(unsafe.status, "fail", fixture.name);
      assertStringIncludes(unsafe.detail, fixture.value, fixture.name);
      assertEquals(await Deno.readTextFile(attributesPath), beforeRoot);
      assertEquals(
        await targetExists(nestedPath)
          ? await Deno.readTextFile(nestedPath)
          : undefined,
        beforeNested,
      );
      assertEquals(
        await targetExists(infoPath)
          ? await Deno.readTextFile(infoPath)
          : undefined,
        beforeInfo,
      );
    }
  });
});

Deno.test("doctor: spaces and newly tracked outputs auto-enroll in effective attribute verification", async () => {
  await withTempDir(async (dir) => {
    await generatedDoctorProject(dir, [
      "generated/bundle.txt",
      "generated/space file.txt",
      "generated/line\nbreak.txt",
      "generated/future-output.txt",
    ]);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    const attributes = check(payload, "generated merge attributes");
    assertEquals(attributes.status, "ok");
    const expected = 4 + agentFilePaths(await loadConfig(dir)).length;
    assertStringIncludes(
      attributes.detail,
      `${expected} tracked generated path(s)`,
    );
  });
});

Deno.test("doctor: main and linked checkouts require one shared generated merge driver", async () => {
  await withTempDir(async (dir) => {
    await generatedDoctorProject(dir);
    const worktree = await addWorktree(dir, "driver-health");

    for (const checkout of [dir, worktree]) {
      const healthy = await runDoctorJson(checkout);
      assertEquals(
        healthy.code,
        0,
        JSON.stringify(healthy.payload.data.checks),
      );
      const configured = check(healthy.payload, "generated merge driver");
      assertEquals(configured.status, "ok");
      assertStringIncludes(configured.detail, 'scope "local"');
      assertStringIncludes(configured.detail, ".git/config");
    }

    await git(dir, "config", "--unset-all", DRIVER_KEY);
    const missing = await runDoctorJson(worktree);
    assertEquals(missing.code, 1);
    const absent = check(missing.payload, "generated merge driver");
    assertEquals(absent.status, "fail");
    assertStringIncludes(absent.detail, "has no");
    assertStringIncludes(
      absent.fix ?? "",
      `${DRIVER_KEY} true`,
    );

    await git(dir, "config", DRIVER_KEY, "wrong-common-driver");
    const wrongValue = await runDoctorJson(worktree);
    assertEquals(wrongValue.code, 1);
    const common = check(wrongValue.payload, "generated merge driver");
    assertEquals(common.status, "fail");
    assertStringIncludes(common.detail, "wrong-common-driver");
    assertStringIncludes(common.detail, 'scope "local"');

    // A private-era checkout-local definition wins effective precedence until
    // refresh migrates it to the one common clone-local definition.
    await git(dir, "config", DRIVER_KEY, "true");
    await git(dir, "config", "extensions.worktreeConfig", "true");
    await git(worktree, "config", "--worktree", DRIVER_KEY, "false");
    const wrong = await runDoctorJson(worktree);
    assertEquals(wrong.code, 1);
    const incorrect = check(wrong.payload, "generated merge driver");
    assertEquals(incorrect.status, "fail");
    assertStringIncludes(incorrect.detail, 'resolves to "false"');
    assertStringIncludes(incorrect.detail, 'scope "worktree"');

    const refresh = await runCli(["refresh", "--json"], worktree);
    assertEquals(refresh.code, 0, refresh.stderr);
    const migrated = await runDoctorJson(worktree);
    assertEquals(
      migrated.code,
      0,
      JSON.stringify(migrated.payload.data.checks),
    );
    const shared = check(migrated.payload, "generated merge driver");
    assertEquals(shared.status, "ok");
    assertStringIncludes(shared.detail, 'scope "local"');
  });
});

Deno.test("doctor: an untranslatable generated glob names the config row", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await disableLogbook(dir);
    await addGeneratedGroups(dir, [{
      name: "bundle",
      paths: ["{schema,reference}/**"],
      run: "sh -c true",
    }]);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    const warning = check(payload, "Git attributes");
    assertEquals(warning.status, "warn");
    assertStringIncludes(warning.detail, "[generated.bundle].paths");
    assertStringIncludes(warning.detail, '"{schema,reference}/**"');
    assertStringIncludes(warning.detail, "cannot be translated");
    assertStringIncludes(warning.fix ?? "", "discern refresh");
  });
});

Deno.test("doctor: generated path probes distinguish empty, untracked, and ignored groups", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await disableLogbook(dir);
    const groups = [
      { name: "empty", paths: ["missing/**"], run: "sh -c true" },
      {
        name: "untracked",
        paths: ["untracked-*.txt"],
        run: "sh -c true",
      },
      {
        name: "ignored",
        paths: ["ignored-*.txt"],
        run: "sh -c true",
      },
    ] satisfies readonly GeneratedGroupFixture[];
    await addGeneratedGroups(dir, groups);
    await Deno.writeTextFile(join(dir, ".gitignore"), "ignored-output.txt\n", {
      append: true,
    });
    await Deno.writeTextFile(join(dir, "ignored-output.txt"), "ignored\n");
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, "untracked-output.txt"), "untracked\n");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    for (const group of groups) {
      assertEquals(check(payload, `generated: ${group.name} run`).status, "ok");
      const paths = check(payload, `generated: ${group.name} paths`);
      assertEquals(paths.status, "warn", `${group.name} should be advisory`);
      assertStringIncludes(paths.detail, group.paths[0] ?? "");
      assertStringIncludes(paths.fix ?? "", `[generated.${group.name}] paths`);
    }

    const empty = check(payload, "generated: empty paths");
    assertStringIncludes(empty.detail, "match no git-tracked");

    for (const name of ["untracked", "ignored"]) {
      const inert = check(payload, `generated: ${name} paths`);
      assertStringIncludes(inert.detail, "all untracked or ignored");
      assertStringIncludes(inert.detail, "inert");
      assertStringIncludes(inert.detail, "never conflict and never drift");
      assertStringIncludes(inert.detail, "Track them or drop the group");
    }
  });
});

Deno.test("doctor: overlapping generated ownership warns with every claiming config row", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await disableLogbook(dir);
    const groups = [
      { name: "reference", paths: ["shared-*.txt"], run: "sh -c true" },
      { name: "manifest", paths: ["shared-output.txt"], run: "sh -c true" },
    ] satisfies readonly GeneratedGroupFixture[];
    await addGeneratedGroups(dir, groups);
    await Deno.writeTextFile(join(dir, "shared-output.txt"), "shared\n");
    await gitInit(dir);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    for (const group of groups) {
      assertEquals(check(payload, `generated: ${group.name} run`).status, "ok");
      assertEquals(
        check(payload, `generated: ${group.name} paths`).status,
        "ok",
      );
    }
    const overlap = check(
      payload,
      "generated ownership: shared-output.txt",
    );
    assertEquals(overlap.status, "warn");
    for (const group of groups) {
      assertStringIncludes(overlap.detail, `[generated.${group.name}]`);
      assertStringIncludes(
        overlap.fix ?? "",
        `[generated.${group.name}] paths`,
      );
    }
  });
});

Deno.test("doctor: no generated config emits no generated check rows", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(
      payload.data.checks.filter((candidate) =>
        candidate.name.startsWith("generated")
      ),
      [],
    );
  });
});

Deno.test("doctor: worktree-resource commands honor env-assignment prefixes too", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await appendConfig(
      dir,
      '[worktree.resources.db]\ncreate = "CI=1 echo up"\ndestroy = "CI=1 echo down"\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    // The prefix probes through to `echo`, which resolves — no advisory warn.
    assertEquals(
      payload.data.checks.find((c) => c.name === "worktree resource commands"),
      undefined,
      "an env-prefixed resolvable resource command must not warn",
    );
  });
});

Deno.test("doctor: a fresh install passes the script-contract check (no project scripts)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // A fresh install seeds no project scripts directory, so nothing is sourcing
    // the retired shell library.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "script contract").ok, true);
  });
});

Deno.test("doctor: a project script sourcing the retired shell library is flagged", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // A script carried forward from a pre-binary install: it sources the engine
    // library that no longer exists, so it would break at runtime. (The default
    // [scripts].dir is discern/scripts; a fresh install seeds no scripts dir.)
    await Deno.mkdir(join(dir, "discern/scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/scripts/reset"),
      '#!/usr/bin/env sh\n# desc: reset fixtures\n. "$DISCERN_LIB/bootstrap.sh"\nok done\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const script = check(payload, "script contract");
    assertEquals(script.ok, false);
    assertStringIncludes(script.detail, "reset");
    assertStringIncludes(script.fix ?? "", "discern config get");
  });
});

Deno.test("doctor: a project script running the project's OWN bootstrap.sh is healthy", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // bootstrap.sh is a generic script name; a project script invoking its own
    // bootstrap script has nothing to do with discern's retired shell library
    // and must not fail the health check.
    await Deno.mkdir(join(dir, "discern/scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/scripts/reset-env"),
      "#!/usr/bin/env sh\n# desc: reset the dev environment\n./scripts/bootstrap.sh --seed\n",
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0, JSON.stringify(payload.data.checks));
    const script = check(payload, "script contract");
    assertEquals(script.ok, true);
  });
});

Deno.test("doctor: any DISCERN_LIB reference in a project script is flagged", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The retired contract's own identifier is the discriminator: a script
    // reaching for `$DISCERN_LIB` breaks at runtime regardless of which helper
    // it names.
    await Deno.mkdir(join(dir, "discern/scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/scripts/legacy"),
      '#!/usr/bin/env sh\n# desc: legacy helper user\n. "$DISCERN_LIB/output.sh"\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const script = check(payload, "script contract");
    assertEquals(script.ok, false);
    assertStringIncludes(script.detail, "legacy");
  });
});

Deno.test("doctor: a fresh install confirms `sh` resolves on PATH", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "sh").ok, true);
  });
});

Deno.test("doctor: a foreign worktree hook is an advisory warning, not a failure", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Inject another tool's worktree automation alongside the harness's own hooks
    // (which call `discern`); the harness's stay, this one is foreign.
    const p = join(dir, ".claude/settings.json");
    const settings = decodeWith(
      CLAUDE_SETTINGS_SCHEMA,
      await Deno.readTextFile(p),
    );
    settings.hooks ??= {};
    (settings.hooks.WorktreeCreate ??= []).push({
      hooks: [{ type: "command", command: "other-tool worktree-setup" }],
    });
    await Deno.writeTextFile(p, `${JSON.stringify(settings, null, 2)}\n`);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // an advisory does NOT make doctor unhealthy
    assertEquals(payload.ok, true);
    const wt = check(payload, "worktree automation");
    assertEquals(wt.status, "warn");
    assertEquals(wt.ok, true);
    assertEquals(wt.warn, true);
    const advisory = payload.advisories?.find((candidate) =>
      candidate.kind === "doctor-warning" &&
      candidate.evidence.some((evidence) =>
        evidence.includes("worktree automation")
      )
    );
    assert(advisory !== undefined);
    assertEquals(advisory.next_action, wt.fix);
  });
});

Deno.test("doctor: a known job that declares stage fails with the derivation rule", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await addCheck(dir, "lint", "check", "echo lint");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const schema = check(payload, "config schema");
    assertStringIncludes(schema.detail, "jobs.lint.stage");
    assertStringIncludes(schema.detail, "derives stage");
  });
});

Deno.test("doctor reports custom jobs separately from known-job readiness", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await addCheck(dir, "licenses", "check", "echo licenses");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    const jobs = check(payload, "known jobs");
    // The seeded format job is still named, but a custom job never rescues the
    // known-name readiness line from its honest "nothing of the project's own"
    // reading.
    assertStringIncludes(jobs.detail, "only discern's own upkeep is wired");
    assertStringIncludes(jobs.detail, "custom jobs: licenses");
  });
});

Deno.test("doctor: flags a gotchas_doc that points at a missing file", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    assertEquals(
      (await runCli(
        ["config", "set", "project.gotchas_doc", "docs/nope.md"],
        dir,
      )).code,
      0,
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const g = check(payload, "gotchas doc");
    assertEquals(g.ok, false);
    assertStringIncludes(g.detail, "does not exist");
    assertStringIncludes(g.fix ?? "", "gotchas_doc");
  });
});

Deno.test("doctor: reports resolved instruction sources and authored skills when present", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // An instruction source + an authored skill exercise the "populated" branch of
    // both checks (a fresh install only hits the "none yet" branch).
    await Deno.writeTextFile(
      join(dir, "discern/instructions.md"),
      "# project instructions\n",
    );
    await Deno.mkdir(join(dir, "discern/skills/my-skill"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/skills/my-skill/SKILL.md"),
      "# mine\n",
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertStringIncludes(
      check(payload, "instruction sources").detail,
      "resolve",
    );
    assertStringIncludes(check(payload, "skills").detail, "1 authored skill");
  });
});

Deno.test("doctor: flags a [instructions].sources entry naming an agent file", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // An output can never be a source (resolveInstructionSources refuses it), so a
    // config that names one explicitly must get a diagnostic with the reason —
    // not a silent zero-match the user has to puzzle out.
    const tomlPath = join(dir, "discern.toml");
    const toml = await Deno.readTextFile(tomlPath);
    await Deno.writeTextFile(
      tomlPath,
      toml.replace(
        'sources = ["discern/instructions.md"]',
        'sources = ["discern/instructions.md", "AGENTS.md"]',
      ),
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const g = check(payload, "instruction sources");
    assertEquals(g.ok, false);
    assertStringIncludes(g.detail, "AGENTS.md");
    assertStringIncludes(g.detail, "an output can never be a source");
    assertStringIncludes(g.fix ?? "", "[instructions].sources");
  });
});

Deno.test("doctor: surfaces per-agent integration coverage (MCP + hooks wired for all three)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir); // default agents: claude_code + codex
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // a registry-described divergence is healthy, just reported

    // Claude Code wires every surface, and needs no separate trust step (discern
    // pre-approves its MCP server) — surfaced so the gap between "wired" and "active"
    // is visible (deliverable 5).
    const claude = check(payload, "agent: Claude Code");
    assertEquals(claude.ok, true);
    assertStringIncludes(claude.detail, "instructions CLAUDE.md");
    assertStringIncludes(claude.detail, "mcp");
    assertStringIncludes(claude.detail, "hooks");
    assertStringIncludes(claude.detail, "trust: not required");

    // Codex's MCP + SessionStart hooks are now WIRED (Phase B) — reported as wired, no
    // longer a pending gap — plus the one-time directory/hook trust it still needs for
    // the committed config to fire (the typed McpStatus + TrustGate made visible).
    const codex = check(payload, "agent: Codex");
    assertEquals(codex.ok, true);
    assertStringIncludes(codex.detail, "instructions AGENTS.md");
    assertStringIncludes(codex.detail, "mcp");
    assertStringIncludes(codex.detail, "hooks");
    assertEquals(
      codex.detail.includes("not wired"),
      false,
      `Codex MCP + hooks are wired now; detail should carry no "not wired" clause: ${codex.detail}`,
    );
    assertStringIncludes(codex.detail, "trust: one-time");
    assertStringIncludes(codex.detail, "--dangerously-bypass-hook-trust");
    const codexTrust = payload.data.provider_trust?.find((trust) =>
      trust.provider === "codex"
    );
    assert(codexTrust !== undefined, "doctor JSON must carry Codex trust data");
    const facts = codexTrust.actions.flatMap((action) => action.facts);
    assert(
      facts.some((fact) =>
        fact.kind === "config-key" && fact.value === "trust_level"
      ),
    );
    assert(
      facts.some((fact) =>
        fact.kind === "flag" &&
        fact.value === "--dangerously-bypass-hook-trust"
      ),
    );
  });
});

Deno.test("doctor: rejects a scope preview whose static command is unavailable", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const configured = await runCli([
      "config",
      "set-scope",
      "future_ui",
      "future-ui/**",
      "--preview",
      "discern-preview-command-that-does-not-exist --serve",
    ], dir);
    assertEquals(configured.code, 0, configured.stderr);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const preview = check(payload, "scope preview commands");
    assertEquals(preview.ok, false);
    assertStringIncludes(
      preview.detail,
      "discern-preview-command-that-does-not-exist",
    );
    assertStringIncludes(preview.detail, "no preview ran");
    assertStringIncludes(preview.fix ?? "", "[scopes.<name>].preview");
    assertStringIncludes(preview.fix ?? "", "discern doctor");
  });
});

Deno.test("doctor: fails when configured provider hook files are missing", async () => {
  await withTempDir(async (dir) => {
    const hookProviders = providersWithHooks();
    const { code: setupCode } = await runCli([
      "setup",
      "begin",
      "--confirmed",
      "--slug",
      "doctor-hooks",
      "--agents",
      hookProviders.map((p) => p.name).join(","),
    ], dir);
    assertEquals(setupCode, 0, "setup should scaffold every hooks provider");

    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      await Deno.remove(join(dir, hooks.settingsFile));
    }

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      const hookCheck = check(payload, `agent hooks: ${provider.label}`);
      assertEquals(hookCheck.status, "fail");
      assertStringIncludes(hookCheck.detail, hooks.settingsFile);
      assertStringIncludes(hookCheck.detail, "missing");
      assertStringIncludes(hookCheck.fix ?? "", "discern refresh");
    }
  });
});

Deno.test("doctor: Cursor-only instructions report is backed by compiled AGENTS.md output", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await setAgents(dir, '["cursor"]');
    const refresh = await runCli(["refresh", "--json"], dir);
    assertEquals(refresh.code, 0, refresh.stdout + refresh.stderr);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    const cursor = check(payload, "agent: Cursor");
    assertEquals(cursor.ok, true);
    assertStringIncludes(cursor.detail, "instructions AGENTS.md");

    const rendered = await renderAgentFiles(dir);
    assertEquals(
      rendered.has("AGENTS.md"),
      true,
      "doctor must not report instructions wired for a file refresh would not render",
    );
  });
});

Deno.test("doctor: surfaces Gemini's one-time trust step and the bypass action", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Configure Gemini so its per-agent coverage row appears, then re-run doctor.
    await setAgents(dir, '["gemini"]');
    const { payload } = await runDoctorJson(dir);
    const gemini = check(payload, "agent: Gemini");
    assertEquals(gemini.ok, true);
    // The committable target, the one-time trust, and the exact bypass action.
    assertStringIncludes(gemini.detail, ".gemini/settings.json");
    assertStringIncludes(gemini.detail, "trust: one-time");
    assertStringIncludes(gemini.detail, "GEMINI_CLI_TRUST_WORKSPACE=true");
    assertStringIncludes(gemini.detail, "`hooksConfig.enabled` = `true`");
  });
});

Deno.test("doctor surfaces an integration-coverage row for EVERY configured agent", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Configure every known agent, so each must produce its `agent: <label>` row.
    // The per-agent tests above pin each provider's specific detail; this ties the
    // ROW's existence to the registry (AGENT_NAMES), so a new agent auto-enrols —
    // the coverage loop can't quietly omit it.
    await setAgents(dir, JSON.stringify([...AGENT_NAMES]));
    const { payload } = await runDoctorJson(dir);
    for (const name of AGENT_NAMES) {
      const label = providerFor(name)?.label;
      assert(label !== undefined, `no provider label for ${name}`);
      const row = check(payload, `agent: ${label}`);
      assertEquals(
        row.ok,
        true,
        `${name}: doctor's per-agent coverage row must be ok (a divergence is reported, not failed)`,
      );
      assert(
        row.detail.trim().length > 0,
        `${name}: the coverage row must carry a non-empty detail naming its surfaces`,
      );
    }
  });
});

Deno.test("doctor --json: carries the execution model, each step marked project/discern with a hint", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await addCapability(dir, "lint", "echo lint"); // a real [project] gate command
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    // Every configurable verb the issue-template goal needs is covered.
    for (
      const v of [
        "done",
        "prepare",
        "test",
        "standards",
        "start",
        "worktree ensure",
        "update",
        "accept",
        "worktree prune",
      ]
    ) {
      modelVerb(payload, v);
    }
    const finish = modelVerb(payload, "done");
    // A built-in precondition is discern's, and every step carries a hint.
    const merge = finish.steps.find((s) => s.label === "merge-check");
    assert(merge !== undefined, "finish should run the merge-check");
    assertEquals(merge.actor, "discern");
    assert((merge.hint ?? "").length > 0, "every step should carry a hint");
    // The lint job we wired is the user's own command.
    const lint = finish.steps.find((s) => s.label === "lint");
    assert(lint !== undefined, "finish should run the lint job");
    assertEquals(lint.actor, "project");
    assertEquals(lint.note, "echo lint");
  });
});

Deno.test("doctor execution-model human facts are inert while JSON stays exact", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const command = "echo café 👩‍💻\x1b\x07\u0085\u202E";
    await setCapabilityRaw(dir, "lint", JSON.stringify(command));

    const human = await runCli(
      ["doctor", "--no-color"],
      dir,
      { COLUMNS: "48" },
    );
    assertEquals(human.code, 0);
    assertEquals(unexpectedTerminalControls(human.stderr), []);
    assert(!/[\p{Cc}\p{Cf}]/u.test(human.stderr.replaceAll("\n", "")));
    for (const visible of ["<U+200D>", "␛", "␇", "<U+0085>", "<U+202E>"]) {
      assertStringIncludes(human.stderr, visible);
    }
    const machine = await runDoctorJson(dir);
    const lint = modelVerb(machine.payload, "done").steps.find((step) =>
      step.label === "lint"
    );
    assert(lint !== undefined);
    assertEquals(lint.note, command);
  });
});

Deno.test("doctor --json: a per-worktree resource shows its teardown step with the user's command", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await appendConfig(
      dir,
      '[worktree.resources.db]\ncreate = "createdb x"\ndestroy = "dropdb x"\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    // The user's destroy command is surfaced verbatim as a [project] teardown step — the
    // motivating "why did accept tear down my database?" answered up front.
    const grad = modelVerb(payload, "accept");
    const destroy = grad.steps.find((s) => s.kind === "resource-destroy");
    assert(destroy !== undefined, "accept should tear the resource down");
    assertEquals(destroy.actor, "project");
    assertEquals(destroy.note, "dropdb x");
  });
});

Deno.test("doctor: human output prints the execution-model section on stderr", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The human render goes to stderr like the rest of doctor's narration.
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "EXECUTION MODEL");
    assertStringIncludes(stderr, "[discern] merge-check");
    assertStringIncludes(stderr, " ACCEPT ");
  });
});

Deno.test("doctor: human output hides step hints by default and points to --verbose (top and foot)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    // Step lines are present; their explanatory hints are not — the default render stays
    // a scannable sequence before the actionable checks close the output.
    assertStringIncludes(stderr, "[discern] merge-check");
    assert(
      !stderr.includes("A built-in git mutation"),
      "a step hint must not appear in the default (non-verbose) render",
    );
    // The opt-in pointer is shown twice: at the top of the section and at its foot (the
    // model is long enough to scroll past the first).
    const pointers =
      stderr.split("to show hints explaining each execution step").length - 1;
    assertEquals(
      pointers,
      2,
      "the --verbose pointer should appear at the top and the foot",
    );
  });
});

Deno.test("doctor --verbose: shows every step's hint, undeduplicated, and drops the pointer", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor", "--verbose"], dir);
    assertEquals(code, 0);
    // Hints are shown and never deduplicated: the git hint recurs on every git step
    // within a single verb (accept runs several), so it appears more than
    // once in that one section — the ambiguity a per-verb dedup would introduce.
    const start = stderr.indexOf(" ACCEPT ");
    const section = stderr.slice(
      start,
      stderr.indexOf(" WORKTREE PRUNE ", start),
    );
    const gitHints = section.split("A built-in git mutation").length - 1;
    assert(
      gitHints > 1,
      `the git hint should repeat within a verb (no dedup); saw ${gitHints}`,
    );
    // The pointer is for the default render only — with hints shown it would be noise.
    assert(
      !stderr.includes("to show hints explaining each execution step"),
      "the --verbose pointer should not appear when hints are already shown",
    );
  });
});

Deno.test("doctor --json: omits the execution model when there is no readable config", async () => {
  await withTempDir(async (dir) => {
    // No init — no discern.toml to derive a model from, so the field is omitted
    // (the failing checks are the actionable report; a defaults-derived model would
    // only add noise to a broken install).
    const { payload } = await runDoctorJson(dir);
    assertEquals(payload.data.execution_model, undefined);
  });
});

Deno.test("doctor: the logbook check covers healthy-empty, recording, and disabled states", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await gitInit(dir);

    // Enabled with no completed event yet is a healthy new-install state. The
    // first invocation settles it in one pass rather than demanding a rerun.
    const empty = await runDoctorJson(dir);
    const emptyCheck = check(empty.payload, "logbook");
    assertEquals(emptyCheck.status, "ok");
    assertStringIncludes(emptyCheck.detail, "healthy but empty");
    assertEquals(empty.code, 0, "an empty new Logbook is sound immediately");

    // A later invocation observes the canonical recorder's completed event.
    const recording = await runDoctorJson(dir);
    const recordingCheck = check(recording.payload, "logbook");
    assertEquals(recordingCheck.status, "ok");
    assertStringIncludes(recordingCheck.detail, "recording");
    assertEquals(recording.code, 0);

    // Toggled off: an advisory nudge (exit 0), because the history a novice
    // switches off at setup can never be recorded retroactively.
    const p = join(dir, "discern.toml");
    await Deno.writeTextFile(
      p,
      (await Deno.readTextFile(p)).replace("logbook = true", "logbook = false"),
    );
    const off = await runDoctorJson(dir);
    const offCheck = check(off.payload, "logbook");
    assertEquals(offCheck.status, "warn");
    assertStringIncludes(offCheck.detail, "off");
    assertStringIncludes(offCheck.fix ?? "", "re-enabling");
    assertEquals(off.code, 0, "a deliberate opt-out advises, never fails");
  });
});

Deno.test("doctor: an environment-denied Logbook write is advisory and disables this session", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await gitInit(dir);
    const discernAdmin = join(dir, ".git", "discern");
    await Deno.mkdir(discernAdmin, { recursive: true });
    await Deno.chmod(discernAdmin, 0o500);
    try {
      const denied = await runDoctorJson(dir);
      const logbook = check(denied.payload, "logbook");
      assertEquals(logbook.status, "warn");
      assertStringIncludes(logbook.detail, "environment refused");
      assertStringIncludes(logbook.detail, "disabled for this session");
      assertStringIncludes(logbook.detail, join(discernAdmin, "logbook"));
      assertEquals(denied.code, 0, "advisory recording cannot make doctor red");
    } finally {
      await Deno.chmod(discernAdmin, 0o700);
    }
  });
});

Deno.test("doctor: corrupt schema warns, but unmatched historical begins do not affect health", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await gitInit(dir);
    assertEquals((await runDoctorJson(dir)).code, 0);
    const logbookDir = join(dir, ".git", "discern", "logbook");
    const months: string[] = [];
    for await (const entry of Deno.readDir(logbookDir)) {
      if (entry.isFile && /^\d{4}-\d{2}\.jsonl$/.test(entry.name)) {
        months.push(entry.name);
      }
    }
    const month = months.sort().at(-1);
    assert(month !== undefined, "doctor should have recorded a month file");
    const monthPath = join(logbookDir, month);

    await Deno.writeTextFile(monthPath, "not json\n", { append: true });
    const corrupt = await runDoctorJson(dir);
    const corruptCheck = check(corrupt.payload, "logbook");
    assertEquals(corruptCheck.status, "warn");
    assertStringIncludes(corruptCheck.detail, "invalid or unreadable");
    assertEquals(corrupt.code, 0);

    const cleanLines = (await Deno.readTextFile(monthPath)).split("\n")
      .filter((line) => line.trim() !== "" && line !== "not json");
    const unmatchedBegins = [
      {
        schema: 1,
        at: "2020-01-01T00:00:00.000Z",
        kind: "begin",
        invocation: "apollo-interruption",
        verb: "done",
        surface: "cli",
        driver: {},
        branch: "main",
        head: null,
        epoch: null,
      },
      {
        schema: 1,
        at: "2021-06-15T12:30:00.000Z",
        kind: "begin",
        invocation: "margaret-interruption",
        verb: "scripts",
        surface: "mcp",
        driver: {},
        branch: "main",
        head: null,
        epoch: null,
      },
    ].map((event) => JSON.stringify(event));
    await Deno.writeTextFile(
      monthPath,
      `${[...cleanLines, ...unmatchedBegins].join("\n")}\n`,
    );
    const healthy = await runDoctorJson(dir);
    const healthyCheck = check(healthy.payload, "logbook");
    assertEquals(healthyCheck.status, "ok");
    assertStringIncludes(healthyCheck.detail, "recording");
    assertEquals(healthyCheck.fix, undefined);
    assertEquals(healthy.code, 0);
  });
});

Deno.test("doctor: the logbook check stays out of non-repository installs", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { payload } = await runDoctorJson(dir);
    // No git repository → no logbook to write; the repository-shape check
    // already owns that conversation.
    assertEquals(
      payload.data.checks.find((c) => c.name === "logbook"),
      undefined,
    );
  });
});

Deno.test("doctor: warns when the working directory is a nested repository resolving outward", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const child = join(dir, "vendor", "childrepo");
    await Deno.mkdir(child, { recursive: true });
    await Deno.writeTextFile(join(child, "README.md"), "a nested repo\n");
    await gitInit(child);

    // From inside the nested repo, root discovery walks up to the outer
    // project — the crossing is disclosed as advice, exit stays 0.
    const { code, stdout } = await runCli(["doctor", "--json"], child);
    assertEquals(code, 0);
    const payload = decodeDoctor(stdout);
    const boundary = check(payload, "root discovery");
    assertEquals(boundary.status, "warn");
    assertStringIncludes(boundary.detail, "childrepo");
    assertStringIncludes(boundary.fix ?? "", "discern setup");

    // From the project root itself the row stays absent: nothing was crossed.
    const clean = await runDoctorJson(dir);
    assertEquals(
      clean.payload.data.checks.find((c) => c.name === "root discovery"),
      undefined,
    );
  });
});

Deno.test("crossedRepoBoundaries: spots .git files and stays empty off the walk", async () => {
  await withTempDir(async (dir) => {
    const root = join(dir, "project");
    const nested = join(root, "sub", "member");
    await Deno.mkdir(nested, { recursive: true });
    // A `.git` FILE is how linked worktrees and submodule checkouts mark their
    // root — existence is the signal, not directory-ness.
    await Deno.writeTextFile(
      join(nested, ".git"),
      "gitdir: ../../.git/modules/member\n",
    );

    const crossed = await crossedRepoBoundaries(nested, root);
    assertEquals(crossed.length, 1);
    assert(crossed[0]?.endsWith("member"), crossed.join(", "));

    // Starts at or outside the root cross nothing on this walk.
    assertEquals(await crossedRepoBoundaries(root, root), []);
    assertEquals(await crossedRepoBoundaries(dir, root), []);
  });
});
