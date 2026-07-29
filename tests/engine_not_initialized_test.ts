/**
 * The outside-a-project `--json` contract, held over the WHOLE verb surface.
 *
 * An agent that runs `discern <verb> --json` outside any discern project must
 * get a structured envelope on stdout to branch on — the `not_initialized`
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

/** One verb's expected outside-a-project `--json` behavior. */
type OutsideSpec =
  /** Runs `run` + `--json`; expects exit 1 and the uniform refusal envelope. */
  | { run: string[]; verb: string; expect: "not_initialized" }
  /** Runs `run` + `--json`; expects a DIFFERENT pinned structured envelope. */
  | { run: string[]; verb: string; expect: "envelope"; ok: boolean }
  /** Not executed here — the reason must say where the behavior lives instead. */
  | { skip: string };

const SPEC: Record<string, OutsideSpec> = {
  // Engine verbs behind the requireRoot chokepoint — the uniform refusal.
  done: { run: ["done"], verb: "done", expect: "not_initialized" },
  prepare: { run: ["prepare"], verb: "prepare", expect: "not_initialized" },
  test: { run: ["test"], verb: "test", expect: "not_initialized" },
  await: {
    run: ["await", "--trunk-moved", "--timeout", "0"],
    verb: "await",
    expect: "not_initialized",
  },
  improvement: {
    run: ["improvement"],
    verb: "improvement",
    expect: "not_initialized",
  },
  standards: {
    run: ["standards"],
    verb: "standards",
    expect: "not_initialized",
  },
  refresh: { run: ["refresh"], verb: "refresh", expect: "not_initialized" },
  tidy: { run: ["tidy"], verb: "tidy", expect: "not_initialized" },
  impact: { run: ["impact"], verb: "impact", expect: "not_initialized" },
  coupling: { run: ["coupling"], verb: "coupling", expect: "not_initialized" },
  patterns: { run: ["patterns"], verb: "patterns", expect: "not_initialized" },
  status: { run: ["status"], verb: "status", expect: "not_initialized" },
  accept: { run: ["accept"], verb: "accept", expect: "not_initialized" },
  update: { run: ["update"], verb: "update", expect: "not_initialized" },
  start: { run: ["start"], verb: "start", expect: "not_initialized" },
  worktree: {
    run: ["worktree", "setup"],
    verb: "worktree setup",
    expect: "not_initialized",
  },
  identity: { run: ["identity"], verb: "identity", expect: "not_initialized" },
  skills: {
    run: ["skills", "list"],
    verb: "skills list",
    expect: "not_initialized",
  },
  script: { run: ["script"], verb: "script", expect: "not_initialized" },

  // Installer verbs with their own guards — same slug, verb-tailored message.
  upgrade: { run: ["upgrade"], verb: "upgrade", expect: "not_initialized" },
  uninstall: {
    run: ["uninstall"],
    verb: "uninstall",
    expect: "not_initialized",
  },
  preset: {
    run: ["preset", "example", "--yes"],
    verb: "preset",
    expect: "not_initialized",
  },
  config: {
    run: ["config", "get", "repository.trunk"],
    verb: "config",
    expect: "not_initialized",
  },

  // Pinned alternatives — structured envelopes with their OWN outcome. Pinning
  // them here keeps the exceptions honest: if one ever degrades to bare stderr
  // (or starts needing a project), this test catches the drift.
  desk: { run: ["desk"], verb: "desk", expect: "envelope", ok: false },
  map: { run: ["map"], verb: "map", expect: "envelope", ok: false },
  doctor: { run: ["doctor"], verb: "doctor", expect: "envelope", ok: false },
  docs: { run: ["docs", "--list"], verb: "docs", expect: "envelope", ok: true },
  licenses: {
    run: ["licenses"],
    verb: "licenses",
    expect: "envelope",
    ok: true,
  },

  // Not executed — each reason names where the behavior is held instead.
  setup: {
    skip: "the initializer: outside a project is its normal operating mode " +
      "(running it would scaffold one here)",
  },
  mcp: {
    skip: "long-running stdio server; runTool's per-tool not_initialized " +
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
      "entry proving the not_initialized envelope (or pin its alternative)",
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
          let result: {
            ok?: boolean;
            verb?: string;
            error?: string;
            data?: unknown;
          };
          try {
            result = JSON.parse(r.stdout);
          } catch {
            throw new Error(
              `${label} printed no parseable --json envelope on stdout — an ` +
                `agent has nothing to branch on\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
            );
          }
          assertEquals(result.verb, spec.verb, label);
          if (spec.expect === "not_initialized") {
            assertEquals(r.code, 1, `${label}: ${r.output}`);
            assertEquals(result.ok, false, label);
            assertEquals(
              result.error,
              "not_initialized",
              `${label} must refuse with the uniform machine slug`,
            );
            return;
          }
          assertEquals(r.code, spec.ok ? 0 : 1, `${label}: ${r.output}`);
          assertEquals(result.ok, spec.ok, label);
          if (name === "doctor") {
            // doctor DIAGNOSES the missing install rather than refusing: no
            // error slug, a data.checks payload naming the discern.toml gap.
            assertEquals(result.error, undefined, label);
            assert(result.data !== undefined, label);
          }
        }),
      );
    }
  });
});
