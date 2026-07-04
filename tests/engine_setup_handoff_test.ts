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
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

/** The H1 of the printed brief — the boundary the footer must come AFTER. */
const INSTRUCTIONS_H1 = "# Set up the harness";

Deno.test("setup output can't be mistaken for completion: banner leads, footer survives truncation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // A loud, non-success banner LEADS — the scaffold succeeding is not the task
    // succeeding, and the headline must not read as "done".
    assertStringIncludes(r.stdout, "SETUP STARTED — NOT FINISHED");
    // No green success check on the scaffold line (the ✓ that read as "done").
    assert(!r.stdout.includes("✓"), "setup must not print a success check");

    // The footer is tail-survivable: even if the top is chopped to save context,
    // the LAST lines still carry "not done", how to reprint the brief, and how to
    // finish. Assert all three, and that they land AFTER the brief's H1.
    assertStringIncludes(r.stdout, "You are NOT done");
    assertStringIncludes(r.stdout, "discern setup done");
    assertStringIncludes(r.stdout, "Re-run `discern setup begin` to reprint");
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

Deno.test("status flags unfinished setup loudly, with evidence, then goes silent once recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]); // lays the marker-carrying skeletons

    // Human view: a loud banner under the heading, not a buried hint.
    const human = await runAgent(dir, ["status"]);
    assertStringIncludes(human.stdout, "SETUP NOT FINISHED");

    // Machine view: structured evidence + a lead hint.
    const j = JSON.parse((await runAgent(dir, ["status", "--json"])).stdout);
    assert(
      Array.isArray(j.data.setup_unfinished?.pending_markers) &&
        j.data.setup_unfinished.pending_markers.length > 0,
      `expected pending markers: ${JSON.stringify(j.data.setup_unfinished)}`,
    );
    assert(
      (j.hints ?? []).some((h: string) => h.includes("Setup is NOT finished")),
      `expected a lead setup hint: ${JSON.stringify(j.hints)}`,
    );

    // Once setup is recorded, the signal is gone — and the marker walk is skipped.
    await runAgent(dir, ["setup", "done", "--force"]);
    const done = JSON.parse((await runAgent(dir, ["status", "--json"])).stdout);
    assertEquals(done.data.setup_unfinished, undefined);
    assertEquals(
      (done.hints ?? []).some((h: string) =>
        h.includes("Setup is NOT finished")
      ),
      false,
    );
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
    assert(
      (j.hints ?? []).some((h: string) => h.includes("Setup is NOT finished")),
      `expected the lead setup hint from a worktree: ${
        JSON.stringify(j.hints)
      }`,
    );
  });
});

Deno.test("worktree ensure reminds on session start while setup is unfinished, then stops", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]);

    const before = await runAgent(dir, ["worktree", "ensure"]);
    assertEquals(before.code, 0, before.output);
    assertStringIncludes(before.stdout, "Setup is NOT finished");

    await runAgent(dir, ["setup", "done", "--force"]);
    const after = await runAgent(dir, ["worktree", "ensure"]);
    assertEquals(after.code, 0, after.output);
    assertEquals(
      after.output.includes("Setup is NOT finished"),
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
