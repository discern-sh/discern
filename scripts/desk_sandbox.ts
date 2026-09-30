/**
 * Materialise a persistent, disposable Desk project seeded with the redesign
 * brief's fleet, for hands-on work and gallery captures.
 *
 * The project is built by the Desk PTY fixture in keep mode: real Git
 * worktrees, commits, branches, ready markers, Proof records, grants, a real
 * queue-only acceptance, logbook events, and Park records. What the fixture
 * cannot yet express is listed in SIMULATED_FACTS and printed with the paths.
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { fileExists, readDirIfExists } from "../src/shared/fs_presence.ts";
import {
  createDeskTtyProject,
  deskCollision,
  deskFailedAction,
  deskFleetEntry,
  type DeskFleetFixture,
  deskFleetFixture,
  deskLandingAuthority,
  deskOrphanBranch,
  deskProof,
  deskRunningAction,
} from "../tests/fixtures/desk_tty_harness.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The marker that lets --replace remove only a directory this script made. */
export const SANDBOX_MARKER = ".discern-desk-sandbox";

/**
 * Facts the brief states that the sandbox approximates rather than holds.
 * Everything else in the fleet is real repository or engine state.
 */
export const SIMULATED_FACTS = [
  "Proof records are written when the sandbox is built, so every Proof reads as recent: the stale task's Proof is not 11 days old and the queued task's is not 35 minutes old.",
  "The running check is a logbook begin event with no process behind it; its elapsed time and the typical duration prior age in real time, so rebuild the sandbox for the brief's 1m 12s.",
  "manual-concision holds 4 small commits, not the brief's 61 files (+2023 -2038).",
  "docs-glossary's 5 uncommitted files are modifications and additions; the fixture has no deletion.",
  "release-notes has no setup steps configured, so it shows setup incomplete with a retry but no step count.",
  "Parked branches hold one commit each, are parked when the sandbox is built, and carry fixture task titles without a brief.",
  "Branches use the agent/<name>-<hex> form; friendly titles come from the name before the six-hex suffix.",
] as const;

/** The redesign brief's fleet: one task per Desk state, plus parked branches. */
export function briefFleet(): DeskFleetFixture {
  return deskFleetFixture([
    deskFleetEntry("manual-concision-a1b2c3", {
      aheadCommits: 4,
      proof: deskProof(),
    }),
    deskFleetEntry("homepage-session-prototype-b2c3d4", {
      aheadCommits: 1,
      behindCommits: 361,
      idleMs: 11 * DAY,
      proof: deskProof(),
    }),
    deskFleetEntry("fix-flaky-upload-c3d4e5", {
      aheadCommits: 2,
      action: deskRunningAction("done", {
        startedAgoMs: 72_000,
        typicalDurationMs: 3 * MINUTE,
      }),
    }),
    // Five fixture commits plus the overlap commit make the brief's six.
    deskFleetEntry("auth-refactor-d4e5f6", {
      aheadCommits: 5,
      action: deskFailedAction("done", {
        failedStage: "test",
        finishedAgoMs: 2 * HOUR,
      }),
    }),
    deskFleetEntry("docs-glossary-e5f6a7", {
      committedFiles: [
        { path: "docs/glossary.md" },
        { path: "docs/terms.md" },
      ],
      dirtyFiles: [
        { path: "docs/glossary.md", contents: "Glossary, edited.\n" },
        { path: "docs/terms.md", contents: "Terms, edited.\n" },
        { path: "docs/landing.md" },
        { path: "docs/queue.md" },
        { path: "docs/exception.md" },
      ],
    }),
    deskFleetEntry("release-notes-f6a7b8", { setup: "incomplete" }),
    deskFleetEntry("search-index-a7b8c9", {
      aheadCommits: 3,
      proof: deskProof(),
      landingAuthority: deskLandingAuthority("effort-grant"),
      queued: true,
    }),
    deskFleetEntry("tidy-scripts-b8c9d0", { idleMs: 2 * DAY }),
  ], {
    collisions: [
      deskCollision("src/auth/session.ts", [
        "auth-refactor-d4e5f6",
        "docs-glossary-e5f6a7",
      ]),
    ],
    orphanBranches: [
      deskOrphanBranch("parked-ideas-c9d0e1", { parked: true }),
      deskOrphanBranch("old-experiment-d0e1f2", { parked: true }),
      deskOrphanBranch("spike-cache-e1f2a3", { parked: true }),
    ],
  });
}

/** One sandbox request. */
export interface DeskSandboxRequest {
  readonly directory: string;
  /** Remove an earlier sandbox at the same directory first. */
  readonly replace: boolean;
}

/** Parse `<directory> [--replace]`. */
export function parseDeskSandboxArgs(
  args: readonly string[],
): DeskSandboxRequest {
  let directory: string | undefined;
  let replace = false;
  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--replace") {
      replace = true;
    } else if (argument.startsWith("-")) {
      throw new TypeError(`unknown desk sandbox option: ${argument}`);
    } else if (directory === undefined) {
      directory = argument;
    } else {
      throw new TypeError("pass exactly one sandbox directory");
    }
  }
  if (directory === undefined) {
    throw new TypeError("name the directory to build the sandbox in");
  }
  return { directory: resolve(directory), replace };
}

/** Clear the target, refusing any directory this script did not create. */
export async function prepareSandboxDirectory(
  request: DeskSandboxRequest,
): Promise<void> {
  const entries = await readDirIfExists(request.directory);
  if (entries === undefined || entries.length === 0) return;
  const marked = await fileExists(join(request.directory, SANDBOX_MARKER));
  if (!request.replace || !marked) {
    throw new Error(
      marked
        ? `${request.directory} already holds a Desk sandbox; pass --replace to rebuild it`
        : `${request.directory} is not empty and is not a Desk sandbox`,
    );
  }
  await Deno.remove(request.directory, { recursive: true });
}

/** Build the sandbox and print where it is and what it approximates. */
async function main(): Promise<void> {
  const request = parseDeskSandboxArgs(Deno.args);
  await prepareSandboxDirectory(request);
  await Deno.mkdir(request.directory, { recursive: true });
  await Deno.writeTextFile(
    join(request.directory, SANDBOX_MARKER),
    "Disposable Desk sandbox built by scripts/desk_sandbox.ts.\n",
  );
  const project = await createDeskTtyProject(request.directory, briefFleet());
  console.log(`Desk sandbox: ${project.root}`);
  console.log(`Tasks: ${project.worktrees.size}`);
  const repository = dirname(dirname(fromFileUrl(import.meta.url)));
  console.log("Open it with this checkout's source:");
  console.log(
    `  cd ${project.root} && deno run -A --config ${
      join(repository, "deno.json")
    } ${join(repository, "src/main.ts")} desk`,
  );
  console.log("or against a local design-system checkout:");
  console.log(`  deno task cli:design-system desk --project ${project.root}`);
  console.log("Simulated facts:");
  for (const fact of SIMULATED_FACTS) console.log(`  - ${fact}`);
}

if (import.meta.main) await main();
