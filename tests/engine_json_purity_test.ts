/**
 * The `--json` purity guard (ADR 0030): the regression net that keeps every verb's
 * machine output to the single result envelope and nothing else.
 *
 * Two layers:
 *  1. **Behavioural** — run each `--json` verb against a config whose commands print
 *     loudly to BOTH stdout and stderr, and assert the COMBINED stdout+stderr is
 *     exactly one envelope line. Combined (not just stdout) because an agent calling
 *     through a shell tool captures both; a leak on either stream fails the test.
 *     The case table is reconciled against the FULL verb registry (`KNOWN_VERBS`,
 *     installer + engine): every built-in verb is either swept here — in the noisy
 *     project, or through the worktree lifecycle — or consciously excepted in
 *     `NOT_SWEPT` with the reason it has no envelope to sweep. A new verb cannot
 *     join the registry without joining the sweep.
 *  2. **Structural** — a source-level guard that `serializeResult` is called only
 *     through the one emission chokepoint, so a new verb cannot hand-roll an emit
 *     that bypasses the silence rule.
 *
 * Together they make the "an agent only ever sees JSON" contract impossible to
 * regress: add a verb that streams a stray line, or print an envelope off-channel,
 * and one of these fails the gate.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  type RunResult,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

/**
 * Assert a `<verb> --json` run emitted ONLY the envelope. The compact envelope is a
 * single physical line, and `JSON.stringify` escapes any newline inside a string
 * value (e.g. a diagnostic's captured output) — so a real newline in the combined
 * output means human narration or subprocess output leaked. The envelope is
 * asserted regardless of `ok`: a refusal or error must be the same single line.
 */
function assertEnvelopeOnly(
  r: RunResult,
  verb: string,
  context = verb,
): void {
  const combined = r.output.trim();
  assert(
    combined.length > 0 && !combined.includes("\n"),
    `${context} --json must emit exactly one line (the envelope), nothing else on stdout OR stderr.\n--- got ---\n${r.output}\n-----------`,
  );
  let obj: { ok?: unknown; verb?: unknown };
  try {
    obj = JSON.parse(combined);
  } catch {
    throw new Error(
      `${context} --json combined output is not valid JSON:\n${r.output}`,
    );
  }
  assertEquals(
    typeof obj.ok,
    "boolean",
    `${verb}: envelope missing boolean ok`,
  );
  assertEquals(obj.verb, verb, `${verb}: envelope carries the wrong verb`);
}

/** A config whose every gate command and standard prints loudly to stdout AND
 * stderr (and still succeeds), so a silence regression surfaces as leaked text. */
const NOISY_CONFIG = [
  "[project]",
  'slug = "json-purity"',
  "",
  "[jobs]",
  `format = "printf 'FMT-OUT\\n'; printf 'FMT-ERR\\n' >&2"`,
  `lint = "printf 'LINT-OUT\\n'; printf 'LINT-ERR\\n' >&2"`,
  `typecheck = "printf 'TC-OUT\\n'"`,
  `test = "printf 'TEST-OUT\\n'; printf 'TEST-ERR\\n' >&2"`,
  "",
  "[standards.cov]",
  `run = "printf 'STANDARD-NOISE\\n'; printf 'DISCERN_METRIC cov 90\\n'"`,
  'direction = "up"',
  "limit = 80",
  "",
].join("\n");

const NOISY_CONFIGS = [
  { name: "buffered", toml: NOISY_CONFIG },
  {
    name: "streamed",
    toml: `${NOISY_CONFIG}\n[gate]\nstream = true\n`,
  },
];

/**
 * One swept `--json` invocation: the top-level registry verb it enrols (a
 * `KNOWN_VERBS` member — what the reconciliation below counts), the verb the
 * emitted envelope must carry (a subcommand's differs, e.g. `skills list`),
 * and the argv to run.
 */
interface PurityCase {
  readonly registryVerb: string;
  readonly envelopeVerb: string;
  readonly args: readonly string[];
}

/**
 * The sweep over the noisy scaffolded project — every registry verb runnable
 * there, read-only verbs first, file-touching ones after. Some verbs are swept
 * through their one reachable envelope in this harness (a refusal or error is
 * still the envelope): `desk` refuses `--json` (interactive-only), `preset`
 * errors (discern ships no presets), and `map` reports the skeleton map. The
 * bare-value read surfaces (`config get`/`array`/…) are NOT the envelope by
 * design — `config` is swept through its editing side, which is.
 */
const PROJECT_CASES: readonly PurityCase[] = [
  { registryVerb: "done", envelopeVerb: "done", args: ["done"] },
  { registryVerb: "done", envelopeVerb: "done", args: ["done", "--dry-run"] },
  { registryVerb: "prepare", envelopeVerb: "prepare", args: ["prepare"] },
  { registryVerb: "test", envelopeVerb: "test", args: ["test"] },
  { registryVerb: "standards", envelopeVerb: "standards", args: ["standards"] },
  {
    registryVerb: "improvement",
    envelopeVerb: "improvement",
    args: ["improvement"],
  },
  { registryVerb: "impact", envelopeVerb: "impact", args: ["impact"] },
  { registryVerb: "status", envelopeVerb: "status", args: ["status"] },
  { registryVerb: "coupling", envelopeVerb: "coupling", args: ["coupling"] },
  { registryVerb: "patterns", envelopeVerb: "patterns", args: ["patterns"] },
  { registryVerb: "desk", envelopeVerb: "desk", args: ["desk"] },
  { registryVerb: "doctor", envelopeVerb: "doctor", args: ["doctor"] },
  { registryVerb: "setup", envelopeVerb: "setup", args: ["setup"] },
  { registryVerb: "map", envelopeVerb: "map", args: ["map", "--list"] },
  { registryVerb: "help", envelopeVerb: "help", args: ["help", "--list"] },
  { registryVerb: "licenses", envelopeVerb: "licenses", args: ["licenses"] },
  {
    registryVerb: "preset",
    envelopeVerb: "preset",
    args: ["preset", "zz-missing", "--yes"],
  },
  { registryVerb: "script", envelopeVerb: "script", args: ["script"] },
  {
    registryVerb: "skills",
    envelopeVerb: "skills list",
    args: ["skills", "list"],
  },
  {
    registryVerb: "config",
    envelopeVerb: "config",
    args: ["config", "set", "project.name", "Purity", "--dry-run"],
  },
  {
    registryVerb: "uninstall",
    envelopeVerb: "uninstall",
    args: ["uninstall", "--dry-run"],
  },
  { registryVerb: "refresh", envelopeVerb: "refresh", args: ["refresh"] },
  { registryVerb: "tidy", envelopeVerb: "tidy", args: ["tidy"] },
  {
    registryVerb: "skills",
    envelopeVerb: "skills eject",
    args: ["skills", "eject", "discern-write-adr"],
  },
  {
    registryVerb: "upgrade",
    envelopeVerb: "upgrade",
    // Earlier file-touching cases (tidy, eject) dirty the tree by design.
    args: ["upgrade", "--allow-dirty"],
  },
];

/** The registry verbs whose output path consults `[gate].stream` — the only
 * ones the streamed config variant can affect, so the only ones re-swept
 * under it (the rest would just repeat their buffered run verbatim). */
const STREAM_SENSITIVE: ReadonlySet<string> = new Set([
  "done",
  "prepare",
  "test",
  "standards",
]);

/**
 * The worktree-lifecycle sweep (run in order after `start` below): argv given
 * the started worktree's id, run either inside that worktree or from the main
 * checkout. These need a real linked worktree, so they sweep in their own
 * harness rather than the noisy project above.
 */
interface LifecycleCase {
  readonly registryVerb: string;
  readonly envelopeVerb: string;
  readonly cwd: "worktree" | "main";
  args(id: string): string[];
}

const START_CASE: PurityCase = {
  registryVerb: "start",
  envelopeVerb: "start",
  args: ["start", "--name", "purity"],
};

const LIFECYCLE_CASES: readonly LifecycleCase[] = [
  {
    registryVerb: "update",
    envelopeVerb: "update",
    cwd: "worktree",
    args: () => ["update"],
  },
  {
    registryVerb: "worktree",
    envelopeVerb: "worktree setup",
    cwd: "worktree",
    args: () => ["worktree", "setup"],
  },
  // Without --confirmed, accept refuses read-only — the refusal must still be
  // the single envelope line.
  {
    registryVerb: "accept",
    envelopeVerb: "accept",
    cwd: "worktree",
    args: () => ["accept"],
  },
  {
    registryVerb: "worktree",
    envelopeVerb: "worktree teardown",
    cwd: "worktree",
    args: () => ["worktree", "teardown"],
  },
  {
    registryVerb: "worktree",
    envelopeVerb: "worktree drop",
    cwd: "main",
    args: (id) => ["worktree", "drop", id],
  },
  {
    registryVerb: "worktree",
    envelopeVerb: "worktree prune",
    cwd: "main",
    args: () => ["worktree", "prune", "--yes"],
  },
];

/**
 * Registry verbs NOT swept, each with the reason it has no envelope to assert.
 * Reconciled against `KNOWN_VERBS` below so a stale entry fails, and a new verb
 * that joins neither the cases nor this set fails the reconciliation.
 */
const NOT_SWEPT: ReadonlyMap<string, string> = new Map([
  ["mcp", "starts a long-lived stdio server — would hang the sweep"],
  [
    "identity",
    "prints bare identity values for shell substitution in scripts and hooks — that plumbing output IS its machine interface; it has no envelope mode",
  ],
]);

/** Every registry verb the sweeps enrol (project + start + lifecycle). */
const ENROLLED_VERBS: readonly string[] = [
  ...PROJECT_CASES.map((c) => c.registryVerb),
  START_CASE.registryVerb,
  ...LIFECYCLE_CASES.map((c) => c.registryVerb),
];

/**
 * Registry members with neither a sweep case nor a `NOT_SWEPT` entry. Pure and
 * input-driven so the future-sibling proof below can feed it a synthetic
 * registry; the honesty test drives it with the real one.
 */
function unenrolledVerbs(
  registry: Iterable<string>,
  enrolled: Iterable<string>,
  excepted: Iterable<string>,
): string[] {
  const covered = new Set([...enrolled, ...excepted]);
  return [...registry].filter((verb) => !covered.has(verb)).sort();
}

Deno.test("the purity case table stays honest against the full verb registry", () => {
  // No stale exception: every excepted verb is still a real built-in, carries a
  // reason, and is not ALSO swept (which would make the exception a lie).
  for (const [verb, reason] of NOT_SWEPT) {
    assert(
      KNOWN_VERBS.has(verb),
      `NOT_SWEPT lists "${verb}", which is not a built-in verb any more`,
    );
    assert(reason.trim().length > 0, `NOT_SWEPT("${verb}") needs a reason`);
    assert(
      !ENROLLED_VERBS.includes(verb),
      `"${verb}" is both swept and excepted — drop one`,
    );
  }
  // No stale case: every case enrols a verb the registry still owns.
  for (const verb of ENROLLED_VERBS) {
    assert(
      KNOWN_VERBS.has(verb),
      `the sweep enrols "${verb}", which is not a built-in verb any more`,
    );
  }
  // Complete: every built-in verb is either swept or consciously excepted.
  assertEquals(
    unenrolledVerbs(KNOWN_VERBS, ENROLLED_VERBS, NOT_SWEPT.keys()),
    [],
    "every built-in verb must either be swept for --json purity or listed in NOT_SWEPT with a reason",
  );
});

Deno.test("the reconciliation catches a fresh verb joining the registry unenrolled", () => {
  // Future-sibling proof: a brand-new verb under an unrelated name joins the
  // registry, and the reconciliation names it with no case-table edit — the
  // mechanism that forces every future verb into the sweep.
  const withFreshVerb = new Set([...KNOWN_VERBS, "zz-fresh-verb"]);
  assertEquals(
    unenrolledVerbs(withFreshVerb, ENROLLED_VERBS, NOT_SWEPT.keys()),
    ["zz-fresh-verb"],
  );
});

Deno.test("every swept --json verb emits ONLY the envelope (no human or subprocess leak)", async () => {
  for (const config of NOISY_CONFIGS) {
    const cases = config.name === "buffered"
      ? PROJECT_CASES
      : PROJECT_CASES.filter((c) => STREAM_SENSITIVE.has(c.registryVerb));
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, config.toml);
      await gitInit(dir);

      for (const c of cases) {
        assertEnvelopeOnly(
          await runAgent(dir, [...c.args, "--json"]),
          c.envelopeVerb,
          `${c.args.join(" ")} (${config.name})`,
        );
      }
    });
  }
});

Deno.test("worktree lifecycle --json: start/update/accept/setup/teardown/drop/prune emit only the envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Noisy worktree setup steps and resource commands: they inherit stdio in
    // human mode, so any of these lifecycle verbs re-running them un-silenced
    // under --json surfaces as leaked text.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "json-purity"',
        "",
        "[worktree.setup]",
        `steps = ["printf 'SETUP-NOISE-OUT\\n'; printf 'SETUP-NOISE-ERR\\n' >&2"]`,
        "",
        "[worktree.resources.thing]",
        `create = "printf 'RESOURCE-CREATE-NOISE\\n'"`,
        `destroy = "printf 'RESOURCE-DESTROY-NOISE\\n'"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // `start` runs the noisy setup steps and resource create while emitting its
    // envelope; its data names the worktree the rest of the sweep drives.
    const started = await runAgent(dir, [...START_CASE.args, "--json"]);
    assertEnvelopeOnly(started, START_CASE.envelopeVerb);
    const envelope = JSON.parse(started.stdout.trim()) as {
      data?: { id?: unknown; path?: unknown };
    };
    const id = envelope.data?.id;
    const worktree = envelope.data?.path;
    assert(
      typeof id === "string" && typeof worktree === "string",
      `start --json must carry data.id and data.path:\n${started.stdout}`,
    );

    for (const c of LIFECYCLE_CASES) {
      assertEnvelopeOnly(
        await runAgent(
          c.cwd === "worktree" ? worktree : dir,
          [...c.args(id), "--json"],
        ),
        c.envelopeVerb,
        `${c.args(id).join(" ")} (${c.cwd})`,
      );
    }
  });
});

Deno.test("done --json: a FAILING gate captures output INTO the envelope, never leaks it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "json-purity"',
        "",
        "[jobs]",
        `lint = "printf 'LINT-BOOM-OUT\\n'; printf 'LINT-BOOM-ERR\\n' >&2; exit 1"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    // Single envelope line, despite the failing command's multi-line output…
    assertEnvelopeOnly(r, "done");
    const obj = JSON.parse(r.output.trim());
    assertEquals(obj.ok, false);
    // …and that output rode INTO the envelope as a diagnostic (newlines escaped),
    // which is exactly why it didn't leak as a real stream line.
    assertStringIncludes(
      JSON.stringify(obj.diagnostics),
      "LINT-BOOM",
      "the failing command's output must be captured into the diagnostic",
    );
  });
});

Deno.test("a pre-verb config error is still the uniform envelope (verb + single line)", async () => {
  await withTempDir(async (dir) => {
    // A malformed discern.toml fails during the pre-flight config read, before the
    // verb runs — the one global error path. It must still be the envelope.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this is = not valid toml [[[\n",
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEnvelopeOnly(r, "done"); // carries the attempted verb, single line
    assertEquals(JSON.parse(r.output.trim()).error, "invalid_toml");
  });
});

Deno.test("serializeResult reaches stdout ONLY through the emitResult chokepoint", async () => {
  // The wire shape is defined once (result.ts) and printed once (emit.ts). The MCP
  // server is the one other legitimate caller — it folds the serialized envelope
  // into a JSON-RPC tool result, not onto stdout. Any other file calling
  // serializeResult is a verb hand-rolling an emit that escapes the silence rule.
  const allowed = new Set([
    join("src", "shared", "result_serialization.ts"), // the definition
    join("src", "shared", "emit.ts"), // the single print site
    join("src", "engine", "mcp", "server.ts"), // builds the MCP tool result
  ]);
  const offenders: string[] = [];
  for await (const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })) {
    const rel = relative(REPO_ROOT, entry.path);
    if (allowed.has(rel)) {
      continue;
    }
    const text = await Deno.readTextFile(entry.path);
    if (/serializeResult\s*\(/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    `serializeResult must only be emitted via emitResult (src/shared/emit.ts) or the MCP renderer.\n` +
      `Hand-rolled envelope emission found in:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("CLI and MCP share the registered failure-recovery preparation", async () => {
  for (
    const rel of [
      join("src", "shared", "emit.ts"),
      join("src", "engine", "mcp", "server.ts"),
    ]
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    assertStringIncludes(
      text,
      "withFailureRecoveryHint(",
      `${rel} must prepare failures through the shared registered recovery floor`,
    );
  }
});
