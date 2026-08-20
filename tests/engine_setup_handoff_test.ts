/**
 * Regression guard: `discern setup begin` hands work to the agent and exits 0, and an
 * agent once read that exit 0 + the brief's closing checklist as "setup done",
 * echoing the checklist back as completed work. (Under ADR 0075 the brief is printed
 * by the `begin` sub-verb; bare `discern setup` is the read-only welcome, covered in
 * the welcome tests.) These tests lock in the structural defences that make that
 * misread fail loudly rather than slip through:
 *
 *  1. the command output leads with a non-success "NOT FINISHED" banner and ends
 *     with a tail-survivable footer (so a truncated tail still says "not done" +
 *     how to reprint + how to finish);
 *  2. `--json` carries an explicit incomplete signal (complete:false), so a
 *     JSON-consuming agent can't read ok:true / exit 0 as complete;
 *  3. `status` surfaces unfinished setup loudly in EVERY location (not the old
 *     main-only buried nudge) and goes silent once `[meta].bootstrapped` is set;
 *  4. the SessionStart `worktree ensure` reminder fires while setup is unfinished;
 *  5. the printed brief frames its close as stop-conditions, not a report.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  assertTerminalTextIncludes,
  REAL_TEMPLATES,
  withTempDir,
} from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { HINTS } from "../src/shared/hints.ts";
import { SETUP_HUMAN_AUDIENCES } from "../src/commands/setup.ts";
import { OFF_RAMP_PROMPT } from "../src/shared/setup_messages.ts";
import { CLI_JSON_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";

/** The H1 of the printed brief — the boundary the footer must come AFTER. */
const INSTRUCTIONS_H1 = "# Set up discern";

/** Find one package section rule without pinning its Unicode/ASCII ornaments. */
function sectionRuleLine(output: string, label: string): string | undefined {
  const marker = ` ${label} `;
  return output.split("\n").find((candidate) => {
    const markerAt = candidate.indexOf(marker);
    if (markerAt < 1) return false;
    const left = candidate.slice(0, markerAt);
    const right = candidate.slice(markerAt + marker.length);
    const ornaments = `${left}${right}`.replaceAll(" ", "");
    return ornaments.length > 0 && !/[\p{L}\p{N}\s]/u.test(ornaments);
  });
}

Deno.test("setup output can't be mistaken for completion: banner leads, footer survives truncation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // A loud, non-success banner LEADS — the scaffold succeeding is not the task
    // succeeding, and the headline must not read as "done".
    assertTerminalTextIncludes(r.stdout, "SETUP STARTED — NOT FINISHED");
    // No green success check on the scaffold line (the ✓ that read as "done").
    assert(!r.stdout.includes("✓"), "setup must not print a success check");

    // The footer is tail-survivable: even if the top is chopped to save context,
    // the LAST lines still carry "not done", how to reprint the brief, and how to
    // finish. Assert all three, and that they land AFTER the brief's H1.
    assertTerminalTextIncludes(r.stdout, "You are NOT done");
    assertTerminalTextIncludes(r.stdout, "discern setup done");
    assertTerminalTextIncludes(
      r.stdout,
      "Re-run `discern setup begin` to reprint",
    );
    const h1At = r.stdout.indexOf(INSTRUCTIONS_H1);
    const footerAt = r.stdout.indexOf("You are NOT done");
    assert(
      h1At >= 0 && footerAt > h1At,
      "footer must follow the brief, not precede it",
    );
  });
});

Deno.test("setup --json carries an explicit incomplete signal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout);
    assertEquals(obj.ok, true);
    // ok:true / exit 0 means the SCAFFOLD succeeded — these say setup is not done.
    assertEquals(obj.data.complete, false);
    assertEquals(obj.data.bootstrapped, false);
    assertEquals(typeof obj.data.next_action, "string");
    assert(obj.data.next_action.includes("discern setup done"));
    // The brief is still carried for the agent to act on.
    assertStringIncludes(obj.data.instructions, INSTRUCTIONS_H1);
  });
});

Deno.test("doctor qualifies its all-clear while setup is unfinished, then goes silent once recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });

    // Human view: the verdict is qualified — a healthy install is not a finished
    // setup, and doctor must not contradict status's incomplete-state message.
    const human = await runAgent(dir, ["doctor"]);
    assertTerminalTextIncludes(human.output, "Setup is incomplete");
    assertTerminalTextIncludes(human.output, "discern setup done");

    // Machine view: the same qualifier rides the hints.
    const j = JSON.parse((await runAgent(dir, ["doctor", "--json"])).stdout);
    assertHasHint(j, HINTS["setup-unfinished-doctor"]);
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    const human = await runAgent(dir, ["doctor"]);
    assert(
      !human.output.includes("Setup is incomplete"),
      "a recorded setup must not re-raise the mid-setup banner",
    );
    const j = JSON.parse((await runAgent(dir, ["doctor", "--json"])).stdout);
    assertLacksHint(j, HINTS["setup-unfinished-doctor"]);
  });
});

// ── the human off-ramp, swept over EVERY setup surface ─────────────────────────
// A human who runs an agent-addressed setup command by hand hits text addressed
// to an agent; each such surface carries one line telling them the handoff that
// makes it work. SETUP_HUMAN_AUDIENCES classifies every setup-family command
// path — carrier or named exception — and this sweep drives each one, so a new
// setup command cannot ship with its audience unclassified, and an exception
// cannot silently grow (or shed) the off-ramp without flipping its classification.

/** A canonical invocation of one setup command path's human render. */
interface OffRampDriver {
  fixture: (dir: string) => Promise<void>;
  argv: string[];
  code: number;
}

/** A fresh one-commit repo with no discern config — the pre-setup state. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
}

/** Lay the setup branch so `setup accept` has a landing to perform. */
async function begunSetup(dir: string): Promise<void> {
  await freshRepo(dir);
  const r = await runAgent(dir, [
    "setup",
    "begin",
    "--confirmed",
    "--agents",
    "claude_code",
  ]);
  assertEquals(r.code, 0, r.output);
}

const OFF_RAMP_DRIVERS: Record<string, OffRampDriver> = {
  "setup": { fixture: freshRepo, argv: ["setup"], code: 0 },
  "setup begin": {
    fixture: (dir) => scaffoldEngine(dir, { bootstrapped: false }),
    argv: ["setup", "begin", "--confirmed"],
    code: 0,
  },
  "setup verify": { fixture: freshRepo, argv: ["setup", "verify"], code: 0 },
  "setup step": {
    fixture: (dir) => scaffoldEngine(dir, { bootstrapped: false }),
    argv: ["setup", "step", "4"],
    code: 0,
  },
  "setup done": {
    fixture: (dir) => scaffoldEngine(dir, { bootstrapped: false }),
    argv: ["setup", "done", "--force"],
    code: 0,
  },
  "setup accept": { fixture: begunSetup, argv: ["setup", "accept"], code: 0 },
};

Deno.test("every setup command path classifies its human-render audience (enrolment)", () => {
  // Total over the public result-contract registry's setup family: a new setup
  // command registers a contract, so it lands here unclassified and fails until
  // SETUP_HUMAN_AUDIENCES (and a driver) account for it.
  const registered = CLI_JSON_RESULT_CONTRACTS
    .filter((c) => c.verb === "setup" || c.verb.startsWith("setup "))
    .flatMap((c) => [...c.commands])
    .sort();
  assertEquals(Object.keys(SETUP_HUMAN_AUDIENCES).sort(), registered);
  assertEquals(Object.keys(OFF_RAMP_DRIVERS).sort(), registered);
});

for (const [path, audience] of Object.entries(SETUP_HUMAN_AUDIENCES)) {
  const driver = OFF_RAMP_DRIVERS[path];
  Deno.test(
    `the \`${path}\` human render ${
      audience.offRamp ? "carries" : "omits"
    } the human off-ramp`,
    async () => {
      assert(driver !== undefined, `no off-ramp driver for ${path}`);
      await withTempDir(async (dir) => {
        await driver.fixture(dir);
        const r = await runAgent(dir, driver.argv);
        assertEquals(r.code, driver.code, r.output);
        if (audience.offRamp) {
          assertStringIncludes(r.stdout, OFF_RAMP_PROMPT);
          assertTerminalTextIncludes(r.stdout, "Run `discern setup`");
        } else {
          assert(
            !r.output.includes(OFF_RAMP_PROMPT),
            `${path} is a named exception (${audience.reason}) — carrying the off-ramp means its classification must flip:\n${r.output}`,
          );
        }
      });
    },
  );
}

Deno.test("status flags unfinished setup loudly, with evidence, then goes silent once recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]); // lays the marker-carrying skeletons

    // Human view: a leading semantic section, not a buried hint.
    const human = await runAgent(dir, ["status"]);
    assertTerminalTextIncludes(human.stdout, "Setup is not finished");
    const setupSection = sectionRuleLine(human.stdout, "SETUP");
    assert(setupSection !== undefined, human.stdout);
    assert(
      human.stdout.indexOf(setupSection) <
        human.stdout.toLowerCase().indexOf("main checkout"),
      human.stdout,
    );

    // Machine view: structured evidence + a lead hint.
    const j = JSON.parse((await runAgent(dir, ["status", "--json"])).stdout);
    assert(
      Array.isArray(j.data.setup_unfinished?.pending_markers) &&
        j.data.setup_unfinished.pending_markers.length > 0,
      `expected pending markers: ${JSON.stringify(j.data.setup_unfinished)}`,
    );
    const pendingCount = j.data.setup_unfinished.pending_markers.length +
      (j.data.projection.omitted?.["setup_unfinished.pending_markers"] ?? 0);
    assertHasHint(j, HINTS["setup-unfinished-status"], {
      pendingCount,
    });

    // Once setup is recorded, the signal is gone — and the marker walk is skipped.
    await runAgent(dir, ["setup", "done", "--force"]);
    const done = JSON.parse((await runAgent(dir, ["status", "--json"])).stdout);
    assertEquals(done.data.setup_unfinished, undefined);
    assertLacksHint(done, HINTS["setup-unfinished-status"], {
      pendingCount: 0,
    });
  });
});

Deno.test("status surfaces unfinished setup from a worktree too, not just the main checkout", async () => {
  await withTempDir(async (dir) => {
    // bootstrapped:false, then commit so a linked worktree inherits the un-set-up
    // config. The old nudge only fired when location === "main"; this guards that
    // an agent working in a worktree mid-setup still gets the signal.
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    const wt = await addWorktree(dir, "midsetup");

    const j = JSON.parse((await runAgent(wt, ["status", "--json"])).stdout);
    assertEquals(j.data.location, "worktree");
    assert(
      j.data.setup_unfinished !== undefined,
      "setup-unfinished must surface from a worktree, not only from main",
    );
    const pendingCount = j.data.setup_unfinished.pending_markers.length +
      (j.data.projection.omitted?.["setup_unfinished.pending_markers"] ?? 0);
    assertHasHint(j, HINTS["setup-unfinished-status"], {
      pendingCount,
    });
  });
});

Deno.test("worktree ensure reminds on session start while setup is unfinished, then stops", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]);

    const before = await runAgent(dir, ["worktree", "ensure"]);
    assertEquals(before.code, 0, before.output);
    assertTerminalTextIncludes(before.stdout, "Setup is incomplete");

    await runAgent(dir, ["setup", "done", "--force"]);
    const after = await runAgent(dir, ["worktree", "ensure"]);
    assertEquals(after.code, 0, after.output);
    assertEquals(
      after.output.includes("Setup is incomplete"),
      false,
      `ensure must stop reminding once setup is recorded\n${after.output}`,
    );
  });
});

Deno.test("the printed brief frames its close as stop-conditions, not a completion report", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );
  // The old "## Done when" heading read as a report and got echoed back as done.
  assert(
    !brief.includes("## Done when"),
    "the report-shaped 'Done when' heading must not return",
  );
  assertStringIncludes(brief, "You are not done until all of these are true");
  // The trap is named explicitly so a skimming agent is warned off it.
  assertStringIncludes(
    brief,
    "Do not paraphrase this list to the user as completed work",
  );
  assertStringIncludes(brief, "work to do now, not a summary to hand back");
});
