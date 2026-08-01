/**
 * Colour-discipline guard (B32 + B36) — the regression net for the CLI's one colour
 * contract: `--no-color`, NO_COLOR, and non-TTY output ALL mean zero ANSI bytes, on
 * every output path, because colour is resolved ONCE (from the flag + NO_COLOR +
 * isatty) and threaded everywhere rather than each path re-deciding.
 *
 * The class this catches is "an output path that decides colour without consulting
 * the one resolved colour mode". Its two original members were the root help
 * (`operatorHelp` sniffed whether Cliffy had already coloured, so it ignored the
 * flag) and every engine verb (they resolved colour through a parameterless
 * `colorEnabled()` that never saw `--no-color`). The guard has three layers:
 *
 *  1. Unit — the pure resolver `resolveColorMode` returns the single decision from
 *     its three inputs (flag wins, then NO_COLOR, then isatty).
 *  2. Unit — `operatorHelp` renders ZERO escapes when the resolved decision is "no
 *     colour", even though Cliffy's own `getHelp()` coloured the base (it consults
 *     only `Deno.noColor`). This is the exact help member of the class.
 *  3. Behavioural — a representative engine verb AND the root help, run through the
 *     real CLI with `--no-color` (NO_COLOR unset), emit zero escapes on the combined
 *     stdout+stderr. The verb set is reconciled against the engine-verb registry so a
 *     new verb must either pass the check or be consciously excepted.
 */

import { assert, assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { withTempDir } from "./helpers.ts";
import { fakeEnv } from "./helpers.ts";
import {
  gitInit,
  mapPool,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { buildCli, resolveColorMode } from "../src/main.ts";
import { operatorHelp } from "../src/cli_help.ts";
import { KNOWN_ENGINE_VERBS } from "../src/engine/dispatch.ts";
import { colorEnabled, setColorOverride } from "../src/engine/output.ts";

/** The ESC byte that opens every ANSI escape (built without a control-char regex). */
const ESC = String.fromCharCode(27);

/** The number of ANSI escapes in a string — the load-bearing measure of "coloured". */
function ansiCount(s: string): number {
  return s.split(ESC).length - 1;
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("resolveColorMode is the single decision: flag beats NO_COLOR beats isatty", () => {
  // The flag is the hard off-switch — true regardless of a TTY or an unset NO_COLOR.
  assertEquals(
    resolveColorMode(true, fakeEnv({}), () => true),
    false,
    "--no-color must force colour off even on a TTY",
  );
  // NO_COLOR (set, non-empty) is off, even on a TTY with no flag.
  assertEquals(
    resolveColorMode(false, fakeEnv({ NO_COLOR: "1" }), () => true),
    false,
    "a set NO_COLOR must force colour off",
  );
  // An empty NO_COLOR is "not set": defer to isatty.
  assertEquals(
    resolveColorMode(false, fakeEnv({ NO_COLOR: "" }), () => true),
    true,
  );
  // No flag, no NO_COLOR: the decision follows the terminal. Non-TTY (a pipe, CI,
  // an agent capturing output) is off — the B36 non-TTY member.
  assertEquals(resolveColorMode(false, fakeEnv({}), () => false), false);
  assertEquals(resolveColorMode(false, fakeEnv({}), () => true), true);
});

Deno.test("the engine colour choke point obeys the threaded decision, beating its own isatty check", () => {
  // Every engine verb resolves colour through colorEnabled(); the fix is that the
  // CLI's resolved decision (setColorOverride) wins over its standalone isatty rule.
  // Under `deno test` stdout is NOT a terminal, so the standalone rule yields false —
  // an override of `true` is therefore ONLY observable if the override is consulted.
  // Pre-fix (isatty alone) this returns false, so this is the discriminating check
  // for B32: an engine verb honouring --no-color on a TTY works by the same lever.
  try {
    setColorOverride(true);
    assertEquals(
      colorEnabled(),
      true,
      "override(true) must beat the isatty check",
    );
    setColorOverride(false);
    assertEquals(
      colorEnabled(),
      false,
      "override(false) must force colour off",
    );
  } finally {
    // Restore the standalone fallback so this process-global mutation can't leak
    // into sibling in-process tests.
    setColorOverride(undefined);
  }
});

Deno.test("operatorHelp honours the resolved 'no colour' decision, stripping Cliffy's own escapes", () => {
  const root = buildCli(false) as unknown as Command;

  // The core, env-independent guard for the B36 help member: whatever Cliffy's own
  // getHelp() emitted, the resolved "no colour" decision yields a completely plain
  // help. This holds regardless of the ambient colour state, so it is the assertion
  // that runs everywhere — including under the gate, which normalises child jobs to
  // NO_COLOR (so getHelp() there is already plain and this proves the strip is at
  // least idempotent). The DISCRIMINATING proof — that a genuinely COLOURED base is
  // stripped — needs colour to actually be available, which only holds when
  // Deno.noColor is false; the real-CLI subprocess sweep below (which sets its own
  // NO_COLOR="") carries that proof in the gate's forced-NO_COLOR environment.
  assertEquals(
    ansiCount(operatorHelp(root, { color: false })),
    0,
    "operatorHelp(color:false) must emit zero ANSI escapes",
  );

  // When colour IS available in-process (a direct `deno test`, NO_COLOR unset),
  // getHelp() colours the base — so we can prove color:false STRIPS real escapes
  // (not a vacuous pass) and color:true KEEPS them (a real switch, not a one-way
  // strip). Skipped only when the environment has forced colour off, where neither
  // is observable in-process.
  if (!Deno.noColor) {
    assert(
      ansiCount(root.getHelp()) > 0,
      "with colour available, Cliffy's base help is expected to be coloured",
    );
    assert(
      ansiCount(operatorHelp(root, { color: true })) > 0,
      "operatorHelp(color:true) must keep colour when colour is available",
    );
  }
});

/**
 * Engine verbs NOT exercised by the behavioural sweep below, each with a reason it
 * cannot be run bare-and-piped in this harness. Reconciled against the registry so a
 * new engine verb must either join the sweep or be listed here with a reason.
 */
const NOT_SWEPT: ReadonlySet<string> = new Set([
  "mcp", // starts a long-lived stdio server — would hang the test
  "desk", // interactive TUI (refuses --json; the human path needs a terminal)
  "accept", // worktree-lifecycle: needs a linked worktree to act on
  "update", // worktree-lifecycle: needs a linked worktree to act on
  "start", // must run from the main checkout and creates a worktree
  "identity", // resolves a worktree's identity — needs a worktree context
  "worktree", // a command group (prints help; its sub-verbs need a worktree)
  "skills", // a command group (list/eject); covered structurally, not swept here
]);

/** The engine verbs the behavioural sweep runs — every registry verb minus the
 * un-runnable ones. Derived from the SSOT so a new verb auto-enrols into the sweep. */
const SWEPT_VERBS: readonly string[] = [...KNOWN_ENGINE_VERBS].filter((v) =>
  !NOT_SWEPT.has(v)
);

Deno.test("the NOT_SWEPT exception set stays honest against the engine-verb registry", () => {
  // Every excepted verb must still be a real engine verb (no stale entry), so the
  // sweep's coverage claim can't rot. A new engine verb that belongs in neither set
  // fails the reconciliation in the sweep test below.
  for (const v of NOT_SWEPT) {
    assert(
      KNOWN_ENGINE_VERBS.has(v),
      `NOT_SWEPT lists "${v}", which is not an engine verb any more`,
    );
  }
  assertEquals(
    sorted([...SWEPT_VERBS, ...NOT_SWEPT]),
    sorted(KNOWN_ENGINE_VERBS),
    "every engine verb must be either swept for colour or listed in NOT_SWEPT",
  );
});

Deno.test("every swept engine verb honours --no-color on the real CLI (zero ANSI, combined streams)", async () => {
  // A working gate config so finish/prepare/test/standards actually run to output
  // rather than erroring out before the colour path is reached. Every verb
  // drives its own scaffold — gate verbs write receipts and rerun markers, so
  // a shared one would couple concurrent cases — and the sweep fans out.
  const config = [
    "[project]",
    'slug = "color-contract"',
    "",
    "[jobs]",
    `format = "true"`,
    `lint = "true"`,
    `typecheck = "true"`,
    `test = "true"`,
    "",
    "[standards.cov]",
    `run = "printf 'DISCERN_METRIC cov 90\\n'"`,
    'direction = "up"',
    "limit = 80",
    "",
  ].join("\n");
  await mapPool([...SWEPT_VERBS], 8, async (verb) => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, config);
      await gitInit(dir);
      // NO_COLOR forced empty (i.e. UNSET semantics) so the ONLY thing that can
      // suppress colour is the code path under test — the resolved decision from the
      // --no-color flag (and the non-TTY pipe). If a verb re-decided colour on its
      // own and ignored the flag, coloured bytes would leak here.
      const r = await runAgent(dir, [verb, "--no-color"], {
        env: { NO_COLOR: "" },
      });
      assertEquals(
        ansiCount(r.output),
        0,
        `\`discern ${verb} --no-color\` leaked ${
          ansiCount(r.output)
        } ANSI escape(s):\n${r.output}`,
      );
    });
  });
});

Deno.test("the root help and a bare invocation honour --no-color on the real CLI (zero ANSI)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ["[project]", 'slug = "color-contract"', ""].join("\n"),
    );
    await gitInit(dir);

    // Explicit help path (main() prints the grouped operator help).
    for (const args of [["--help", "--no-color"], ["--no-color"]]) {
      const r = await runAgent(dir, args, { env: { NO_COLOR: "" } });
      assertEquals(
        ansiCount(r.output),
        0,
        `\`discern ${args.join(" ")}\` leaked ANSI:\n${r.output}`,
      );
    }
  });
});

Deno.test("FORCE_COLOR never overrides the resolved decision on any help spelling (zero ANSI)", async () => {
  // FORCE_COLOR flips `Deno.noColor` false even when NO_COLOR is set, so any
  // path that consults Cliffy's own colouring instead of the one resolved
  // decision recolours under it (the `help` verb once did, via a "did Cliffy
  // colour the base?" fallback in `operatorHelp`). Every spelling that prints
  // help must stay plain when the resolved decision is "no colour", whatever
  // the inherited environment says.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ["[project]", 'slug = "color-contract"', ""].join("\n"),
    );
    await gitInit(dir);

    const spellings = [["help"], ["--help"], [], ["help", "done"], [
      "done",
      "--help",
    ]];
    for (const args of spellings) {
      const r = await runAgent(dir, args, {
        env: { NO_COLOR: "1", FORCE_COLOR: "3" },
      });
      assertEquals(
        ansiCount(r.output),
        0,
        `\`discern ${args.join(" ")}\` leaked ${
          ansiCount(r.output)
        } ANSI escape(s) under FORCE_COLOR:\n${r.output}`,
      );
    }
  });
});
