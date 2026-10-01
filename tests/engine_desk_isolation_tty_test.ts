/**
 * Real-PTY proof that a Desk change running beside the screen keeps its own
 * signals. A Ctrl-C typed into a foreground Project Script stops the script,
 * and the landing that runs meanwhile goes on, its own child untouched, and
 * lands; quitting while it runs asks first, and Quit anyway stops it and its
 * child through its journal.
 *
 * The landing blocks in the repository ensure command it runs after the
 * trunk moves, until the test releases it, so the interrupt lands while the
 * landing still has a child of its own.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  latestOperationRecord,
  type OperationJournalRecord,
} from "../src/engine/completion/operation_journal.ts";
import { gitOut } from "./engine_helpers.ts";
import {
  deskAtRest,
  deskFleetEntry,
  deskFleetFixture,
  deskFocused,
  type DeskFrameTest,
  deskLandingAuthority,
  deskLayerOpen,
  deskProof,
  deskSettledPhase,
  type DeskTtyInputPhase,
  type DeskTtyProject,
  type DeskTtyRunResult,
  processExists,
  runDeskTty,
  withDeskTtyProject,
} from "./fixtures/desk_tty_harness.ts";
import { realPtyTest } from "./real_pty.ts";

const PTY_UNAVAILABLE = Deno.build.os === "windows";
const phase = deskSettledPhase;
const SIZE = { columns: 100, rows: 40 };
const LANDING = "isolated-landing-a1b2c3";
const SCRIPTED = "script-holder-c0ffee";
const REVIEW = "review-accept-review";
const SCRIPT_FORM = "form-scripts-review";
const SIGNALS = "DESK_TTY_SIGNALS";
const SCRIPT_WAITING = "Fixture script waits for Ctrl-C";

/**
 * The landing's ensure command: it names its shell, says it has started,
 * and waits for the test's release. Outside the Desk session, as when the
 * fixture proves the task, it has nothing to wait for.
 */
const ENSURE = [
  `[ -n "$${SIGNALS}" ] || exit 0`,
  `echo $$ > "$${SIGNALS}/ensure.pid"`,
  `touch "$${SIGNALS}/landing-converging"`,
  `while [ ! -e "$${SIGNALS}/landing-release" ]; do sleep 0.05; done`,
].join("; ");

/** A Project Script that names its shell and runs until it is stopped. */
const SCRIPT = [
  "#!/bin/sh",
  `echo $$ > "$${SIGNALS}/script.pid"`,
  `echo "${SCRIPT_WAITING}"`,
  "while :; do sleep 0.05; done",
  "",
].join("\n");

/** The process id a fixture child recorded. */
async function recordedPid(directory: string, name: string): Promise<number> {
  return Number((await Deno.readTextFile(join(directory, name))).trim());
}

/** Both tests hold. */
function both(left: DeskFrameTest, right: DeskFrameTest): DeskFrameTest {
  return (capture) => left(capture) && right(capture);
}

/** The screen shows `text`, whatever is open. */
function showing(text: string): DeskFrameTest {
  return (capture) => capture.text.includes(text);
}

/** Whether a fixture child has left the named signal file. */
function signalled(directory: string, name: string): boolean {
  try {
    Deno.statSync(join(directory, name));
    return true;
  } catch {
    return false;
  }
}

/** The project with its signal directory, as the Desk's children see it. */
async function signalDirectory(project: DeskTtyProject): Promise<string> {
  const directory = join(project.parent, "signals");
  await Deno.mkdir(directory);
  return directory;
}

/** From the landing task at rest to its confirmed review. */
function confirmLanding(): DeskTtyInputPhase[] {
  return [
    phase(SIZE, undefined, "the landing task at rest", deskAtRest(LANDING), {
      input: "l",
    }),
    phase(
      SIZE,
      "land-review",
      "the landing review on its safe choice",
      deskFocused(REVIEW, "button:safe"),
      { keys: ["right"] },
    ),
    phase(
      SIZE,
      undefined,
      "Land focused",
      deskFocused(REVIEW, "button:confirm"),
      { keys: ["enter"] },
    ),
  ];
}

/** The landing's journal record for the branch it landed. */
async function landingRecord(
  project: DeskTtyProject,
): Promise<OperationJournalRecord> {
  const record = await latestOperationRecord(project.root, {
    branch: `agent/${LANDING}`,
    verb: "accept",
  });
  assert(record !== undefined, "the landing kept its journal record");
  return record.record;
}

/** The ensure step's last state in the journal. */
function ensureState(record: OperationJournalRecord): string | undefined {
  return record.steps?.find((step) => step.label === ENSURE)?.state;
}

/** The session ended cleanly and returned the terminal as it found it. */
function assertReturnedTerminal(result: DeskTtyRunResult): void {
  assertEquals(result.code, 0, result.transcript);
  assertEquals(result.terminal.restored, true, JSON.stringify(result.terminal));
  assertEquals(result.terminal.noChild, true, JSON.stringify(result.terminal));
}

realPtyTest({
  name:
    "Desk PTY: Ctrl-C in a Project Script stops the script while a landing beside it lands",
  contracts: ["signal-delivery", "line-discipline", "process-lifecycle"],
  canary: false,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry(LANDING, {
        aheadCommits: 1,
        proof: deskProof(),
        queued: true,
        landingAuthority: deskLandingAuthority("effort-grant"),
      }),
      deskFleetEntry(SCRIPTED, {
        aheadCommits: 1,
        availability: {
          agents: "missing",
          scripts: "available",
          script: SCRIPT,
        },
      }),
    ], { repositoryEnsure: [ENSURE] });
    await withDeskTtyProject(fixture, async (project) => {
      const signals = await signalDirectory(project);
      const landed = await gitOut(
        project.root,
        "rev-parse",
        `agent/${LANDING}`,
      );
      const result = await runDeskTty(project, {
        geometry: SIZE,
        colorMode: "no-color-env",
        env: { [SIGNALS]: signals },
        timeoutMs: 120_000,
        input: [
          ...confirmLanding(),
          phase(
            SIZE,
            "landing-progress",
            "the landing converging main",
            both(
              deskLayerOpen("progress"),
              () => signalled(signals, "landing-converging"),
            ),
            { keys: ["escape"], allowLoneEscape: true },
          ),
          phase(
            SIZE,
            undefined,
            "the landing hidden on its row",
            deskAtRest(LANDING),
            { keys: ["down"] },
          ),
          phase(SIZE, undefined, "the script task", deskAtRest(SCRIPTED), {
            input: "x",
          }),
          phase(
            SIZE,
            undefined,
            "its Project Scripts",
            deskLayerOpen("scripts"),
            { keys: ["enter"] },
          ),
          phase(
            SIZE,
            undefined,
            "the script's arguments",
            deskFocused(SCRIPT_FORM, "field:args"),
            { keys: ["enter"] },
          ),
          phase(
            SIZE,
            undefined,
            "the script form's safe choice",
            deskFocused(SCRIPT_FORM, "button:safe"),
            { keys: ["right"] },
          ),
          phase(
            SIZE,
            undefined,
            "Run focused",
            deskFocused(SCRIPT_FORM, "button:confirm"),
            { keys: ["enter"] },
          ),
          { waitFor: SCRIPT_WAITING, chunks: [{ keys: ["ctrl-c"] }] },
          // The Desk holds the script's last words until they are read.
          { waitFor: "Press Enter to continue.", chunks: [{ input: "\r" }] },
          phase(
            SIZE,
            "script-interrupted",
            "the Desk back from the interrupted script, the landing still converging",
            both(
              deskAtRest(SCRIPTED),
              () => !signalled(signals, "landing-release"),
            ),
            {
              effect: async () => {
                assertEquals(
                  await processExists(await recordedPid(signals, "script.pid")),
                  false,
                  "Ctrl-C stopped the script",
                );
                assert(
                  await processExists(
                    await recordedPid(signals, "ensure.pid"),
                  ),
                  "the landing's ensure command outlived the script's Ctrl-C",
                );
                await Deno.writeTextFile(join(signals, "landing-release"), "");
              },
            },
          ),
          phase(
            SIZE,
            "landed",
            "the landing's message",
            showing("Landed"),
            { input: "q" },
          ),
        ],
      });
      assertReturnedTerminal(result);
      assertEquals(
        await gitOut(project.root, "rev-parse", "main"),
        landed,
        "the landing moved main to the task's head",
      );
      const record = await landingRecord(project);
      assertEquals(record.outcome, "completed");
      assertEquals(ensureState(record), "finished");
      assertStringIncludes(result.transcript, "discern desk ran:");
    });
  },
});

realPtyTest({
  name:
    "Desk PTY: quitting while a landing runs asks first, and Quit anyway stops it through its journal",
  contracts: ["signal-delivery", "process-lifecycle"],
  canary: false,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry(LANDING, {
        aheadCommits: 1,
        proof: deskProof(),
        queued: true,
        landingAuthority: deskLandingAuthority("effort-grant"),
      }),
    ], { repositoryEnsure: [ENSURE] });
    await withDeskTtyProject(fixture, async (project) => {
      const signals = await signalDirectory(project);
      const result = await runDeskTty(project, {
        geometry: SIZE,
        colorMode: "no-color-env",
        env: { [SIGNALS]: signals },
        timeoutMs: 120_000,
        input: [
          ...confirmLanding(),
          phase(
            SIZE,
            undefined,
            "the landing converging main",
            both(
              deskLayerOpen("progress"),
              () => signalled(signals, "landing-converging"),
            ),
            { keys: ["ctrl-c"] },
          ),
          phase(
            SIZE,
            "quit-sheet",
            "the quit sheet on Keep waiting",
            deskFocused("quit", "button:safe"),
            { keys: ["right"] },
          ),
          phase(
            SIZE,
            undefined,
            "Quit anyway focused",
            deskFocused("quit", "button:quit"),
            { keys: ["enter"] },
          ),
        ],
      });
      assertReturnedTerminal(result);
      assertEquals(
        await processExists(await recordedPid(signals, "ensure.pid")),
        false,
        "the landing's ensure command stopped with it",
      );
      const record = await landingRecord(project);
      assertEquals(record.outcome, "cancelled");
      assertEquals(ensureState(record), "cancelled");
      assertStringIncludes(result.transcript, "· stopped");
    });
  },
});
