/**
 * The outside-a-project `--json` contract, held over the WHOLE verb surface.
 *
 * An agent that runs `discern <verb> --json` outside any discern project must
 * get a structured envelope on stdout to branch on — the `no_project`
 * slug for every verb that needs a project — never a bare stderr line with an
 * empty stdout (the pre-fix `requireRoot` behavior, which left `discern done
 * --json` mute). The spec below is TOTAL over the `KNOWN_VERBS` SSOT: a new
 * verb fails the reconciliation until it either proves the uniform refusal or
 * records a pinned alternative / documented skip — coverage by enrolment, not
 * by memory.
 *
 * Command groups run ONE representative subcommand: every worktree lifecycle
 * subcommand reaches the same `runWorktreeOp` → `requireRoot` chokepoint, as
 * do both `skills` subcommands and the five `config` read ops.
 */

import { assert, assertEquals } from "@std/assert";
import { buildCli, KNOWN_VERBS } from "../src/main.ts";
import { withTempDir } from "./helpers.ts";
import { runAgent } from "./engine_helpers.ts";
import {
  type CliResultEnvelope,
  decodeCliResult,
} from "./decode_cli_result.ts";

/** One verb's expected outside-a-project `--json` behavior. */
type OutsideSpec =
  /** Runs `run` + `--json`; expects exit 1 and the uniform refusal envelope. */
  | { run: string[]; verb: string; expect: "no_project" }
  /** Runs `run` + `--json`; expects a DIFFERENT pinned structured envelope. */
  | { run: string[]; verb: string; expect: "envelope"; ok: boolean }
  /** Not executed here — the reason must say where the behavior lives instead. */
  | { skip: string };

const SPEC: Record<string, OutsideSpec> = {
  releases: {
    run: ["releases"],
    verb: "releases",
    expect: "envelope",
    ok: true,
  },
  // Engine verbs behind the requireRoot chokepoint — the uniform refusal.
  done: { run: ["done"], verb: "done", expect: "no_project" },
  prepare: { run: ["prepare"], verb: "prepare", expect: "no_project" },
  test: { run: ["test"], verb: "test", expect: "no_project" },
  await: {
    run: ["await", "--trunk-moved", "--timeout", "0"],
    verb: "await",
    expect: "no_project",
  },
  improvement: {
    run: ["improvement"],
    verb: "improvement",
    expect: "no_project",
  },
  checkpoints: {
    run: ["checkpoints"],
    verb: "checkpoints",
    expect: "no_project",
  },
  progress: {
    run: ["progress"],
    verb: "progress",
    expect: "no_project",
  },
  standards: {
    run: ["standards"],
    verb: "standards",
    expect: "no_project",
  },
  refresh: { run: ["refresh"], verb: "refresh", expect: "no_project" },
  tidy: { run: ["tidy"], verb: "tidy", expect: "no_project" },
  impact: { run: ["impact"], verb: "impact", expect: "no_project" },
  coupling: { run: ["coupling"], verb: "coupling", expect: "no_project" },
  patterns: { run: ["patterns"], verb: "patterns", expect: "no_project" },
  status: { run: ["status"], verb: "status", expect: "no_project" },
  accept: { run: ["accept"], verb: "accept", expect: "no_project" },
  update: { run: ["update"], verb: "update", expect: "no_project" },
  start: { run: ["start"], verb: "start", expect: "no_project" },
  worktree: {
    run: ["worktree", "setup"],
    verb: "worktree setup",
    expect: "no_project",
  },
  identity: { run: ["identity"], verb: "identity", expect: "no_project" },
  skills: {
    run: ["skills", "list"],
    verb: "skills list",
    expect: "no_project",
  },
  scripts: { run: ["scripts"], verb: "scripts", expect: "no_project" },
  queue: {
    skip:
      "exec-style wrapper; engine_queue_test proves it runs without a project and emits no result envelope",
  },

  // Installer verbs with their own guards — same slug, verb-tailored message.
  upgrade: { run: ["upgrade"], verb: "upgrade", expect: "no_project" },
  uninstall: {
    run: ["uninstall"],
    verb: "uninstall",
    expect: "no_project",
  },
  config: {
    run: ["config", "get", "repository.trunk"],
    verb: "config",
    expect: "no_project",
  },

  // Pinned alternatives — structured envelopes with their OWN outcome. Pinning
  // them here keeps the exceptions honest: if one ever degrades to bare stderr
  // (or starts needing a project), this test catches the drift.
  desk: { run: ["desk"], verb: "desk", expect: "envelope", ok: false },
  enter: {
    run: ["enter"],
    verb: "enter",
    expect: "envelope",
    ok: false,
  },
  map: { run: ["map"], verb: "map", expect: "envelope", ok: false },
  doctor: { run: ["doctor"], verb: "doctor", expect: "envelope", ok: false },
  docs: { run: ["docs", "--list"], verb: "docs", expect: "envelope", ok: true },
  licenses: {
    run: ["licenses"],
    verb: "licenses",
    expect: "envelope",
    ok: true,
  },
  triangle: {
    run: ["triangle"],
    verb: "triangle",
    expect: "envelope",
    ok: true,
  },

  // Not executed — each reason names where the behavior is held instead.
  setup: {
    skip: "the initializer: outside a project is its normal operating mode " +
      "(running it would scaffold one here)",
  },
  mcp: {
    skip: "long-running stdio server; runTool's per-tool no_project " +
      "guard is covered by tests/engine_mcp_test.ts over the whole TOOLS table",
  },
  help: {
    skip:
      "human-readable CLI reference; result_codegen_test holds its explicit JSON-contract exclusion",
  },
};

/** The SSOT members the spec does not cover — the enrolment forcing function. */
function unspecifiedVerbs(
  verbs: Iterable<string>,
  spec: Record<string, OutsideSpec>,
): string[] {
  return [...verbs].filter((v) => !(v in spec)).sort();
}

Deno.test("the outside-a-project spec covers EXACTLY the CLI verb SSOT", () => {
  buildCli(false); // touch the real registrations so KNOWN_VERBS stays honest
  assertEquals(
    unspecifiedVerbs(KNOWN_VERBS, SPEC),
    [],
    "a CLI verb has no outside-a-project --json expectation — add a SPEC " +
      "entry proving the no_project envelope (or pin its alternative)",
  );
  assertEquals(
    Object.keys(SPEC).filter((v) => !KNOWN_VERBS.has(v)).sort(),
    [],
    "the SPEC names a verb the CLI SSOT does not know — remove the stale entry",
  );
});

Deno.test("a fresh-named verb cannot dodge the outside-a-project spec", () => {
  // The adversarial future sibling: extend the verb universe with a name the
  // spec has never seen and the reconciliation must flag it unprompted.
  assertEquals(
    unspecifiedVerbs([...KNOWN_VERBS, "compact-ledger"], SPEC),
    ["compact-ledger"],
  );
});

Deno.test("every verb answers `--json` outside a project with a structured envelope", async () => {
  await withTempDir(async (dir) => {
    const cases = Object.entries(SPEC).flatMap(([name, spec]) =>
      "skip" in spec ? [] : [{ name, spec }]
    );
    // Independent read-only refusals in one empty dir — chunked to bound the
    // concurrent subprocess count.
    const CHUNK = 8;
    for (let i = 0; i < cases.length; i += CHUNK) {
      await Promise.all(
        cases.slice(i, i + CHUNK).map(async ({ name, spec }) => {
          const r = await runAgent(dir, [...spec.run, "--json"]);
          const label = `${name} (${spec.run.join(" ")}) outside a project`;
          let result: CliResultEnvelope;
          try {
            result = decodeCliResult(r.stdout, spec.verb);
          } catch {
            throw new Error(
              `${label} printed no parseable --json envelope on stdout — an ` +
                `agent has nothing to branch on\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
            );
          }
          assertEquals(result.verb, spec.verb, label);
          if (spec.expect === "no_project") {
            assertEquals(r.code, 1, `${label}: ${r.output}`);
            assertEquals(result.ok, false, label);
            assertEquals(
              result.error,
              "no_project",
              `${label} must refuse with the uniform machine slug`,
            );
            return;
          }
          assertEquals(r.code, spec.ok ? 0 : 1, `${label}: ${r.output}`);
          assertEquals(result.ok, spec.ok, label);
          if (name === "doctor") {
            // Doctor completed its diagnosis but the required health check is
            // red: the envelope is false and keeps the typed check evidence.
            assertEquals(result.error, "precondition_failed", label);
            assert(result.data !== undefined, label);
          }
        }),
      );
    }
  });
});
