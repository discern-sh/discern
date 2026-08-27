/**
 * Real-terminal contract for the production Desk.
 *
 * The public test API scaffolds a temporary configured project, materialises a
 * caller-authored fleet through real Git worktrees and Discern admin state,
 * and drives `discern desk` through `script(1)`. The same file runs as the
 * child-side sentinel: it records kernel terminal state around the actual CLI
 * process and services readiness-ordered resize requests on the shared PTY.
 *
 * Normalisation is deliberately narrower than a general terminal emulator.
 * It interprets the cursor, erase, viewport, and cursor-visibility controls
 * emitted by the package-backed interaction painter, while delegating SGR and
 * OSC 8 style decoding plus grapheme width to `@discern-sh/design-system`.
 * Each visible frame retains styled cell spans, focus markers, clear counts,
 * implicit hardware wraps, cursor state, and every unsupported control. A
 * clear-screen, competing-focus, dim-state, overflow, or restoration defect
 * therefore remains assertable; unsupported bytes are evidence, never silently
 * stripped. Raw PTY bytes and the decoded transcript remain alongside frames
 * for diagnosis.
 */

import { SYSTEM_CLOCK } from "../../src/shared/clock.ts";
import { ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  graphemeWidth,
  measureText,
} from "discern-design-system/cli";
import type { TerminalKeyName } from "discern-design-system/cli/interactive";
import { encodeTerminalKeys } from "discern-design-system/cli/interactive/testing";
import {
  projectTerminalSpans,
  type TerminalSpanStyle,
} from "discern-design-system/cli/projection";
import { loadConfig } from "../../src/shared/config_schema.ts";
import { targetExists } from "../../src/shared/fs_presence.ts";
import { waitUntil } from "../waiting.ts";
import { SOURCE_PATHS } from "../../src/shared/paths_registry.ts";
import type { Proof } from "../../src/shared/result_schemas.ts";
import {
  buildGateProof,
} from "../../src/engine/gate/proof_render.ts";
import {
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
} from "../../src/engine/gate/proof.ts";
import { configEpoch } from "../../src/engine/logbook/epoch.ts";
import { LOGBOOK_SCHEMA_VERSION, type LogbookEvent } from "../../src/engine/logbook/schema.ts";
import { appendEvent } from "../../src/engine/logbook/store.ts";
import { grantEffort } from "../../src/engine/worktree/effort_grant_writer.ts";
import {
  addWorktree,
  engineEnv,
  engineRunArgs,
  git,
  gitInit,
  gitOut,
  repoSourceRunArgs,
  scaffoldEngine,
} from "../engine_helpers.ts";
import { withTempDir } from "../temp_dir.ts";
import {
  type PtyGeometry,
  type PtyInputPhase,
  runPtyProcess,
  TEST_PROCESS_TIMEOUT_MS,
} from "./pty_process.ts";
import { z } from "@zod/zod";
import { decodeWith } from "../decode_cli_result.ts";

const HARNESS_PATH = fromFileUrl(import.meta.url);
const DEFAULT_TIMEOUT_MS = TEST_PROCESS_TIMEOUT_MS;
// The child watcher competes with the full coverage suite for CPU. This bounds
// readiness without turning elapsed time into evidence that a resize applied.
const RESIZE_ACK_TIMEOUT_MS = 60_000;
const RESIZE_ACK_POLL_MS = 10;
const SAFE_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const MARKER_OPEN = "\uE000";
const MARKER_CLOSE = "\uE001";
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const PTY_GEOMETRY_SCHEMA = z.object({
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
});

const PARTIAL_PTY_GEOMETRY_SCHEMA = PTY_GEOMETRY_SCHEMA.partial();

const CHILD_TERMINAL_EVIDENCE_SCHEMA = z.object({
  code: z.number().int(),
  before: z.string(),
  after: z.string(),
  beforeDescription: z.string(),
  afterDescription: z.string(),
  restored: z.boolean(),
  exactStateRestored: z.boolean(),
  initialSize: PTY_GEOMETRY_SCHEMA,
  finalSize: PTY_GEOMETRY_SCHEMA,
  resizes: z.array(PTY_GEOMETRY_SCHEMA),
  childPid: z.number().int().positive(),
  childExited: z.boolean(),
  resizeError: z.string().optional(),
});

export interface DeskFixtureFile {
  readonly path: string;
  readonly contents?: string;
}

export interface DeskProofFixture {
  readonly kind: "honored";
  /** Optional presentation override; identity facts remain generated live. */
  readonly presentation?: Pick<Proof, "line" | "markdown">;
}

export interface DeskRunningActionFixture {
  readonly kind: "running";
  readonly verb: string;
  readonly startedAgoMs: number;
  readonly typicalDurationMs: number;
}

export interface DeskFailedActionFixture {
  readonly kind: "failed";
  readonly verb: string;
  readonly failedStage?: string;
  readonly finishedAgoMs: number;
}

export type DeskActionFixture =
  | DeskRunningActionFixture
  | DeskFailedActionFixture;

export interface DeskLandingAuthorityFixture {
  readonly kind: "conversation-required" | "effort-grant";
}

export interface DeskAvailabilityFixture {
  readonly agents: "missing" | "project-default";
  readonly scripts: "missing" | "available";
}

export interface DeskFleetEntryFixture {
  /** Worktree id stem. A six-hex suffix recovers a friendly Desk task name. */
  readonly name: string;
  readonly aheadCommits: number;
  readonly committedFiles: readonly DeskFixtureFile[];
  readonly dirtyFiles: readonly DeskFixtureFile[];
  readonly proof?: DeskProofFixture;
  readonly action?: DeskActionFixture;
  readonly landingAuthority: DeskLandingAuthorityFixture;
  readonly availability: DeskAvailabilityFixture;
}

export interface DeskCollisionFixture {
  readonly path: string;
  /** Entry names that change the same path. Empty means every fleet entry. */
  readonly entries: readonly string[];
}

export interface DeskOrphanBranchFixture {
  readonly name: string;
}

export interface DeskFleetFixture {
  readonly entries: readonly DeskFleetEntryFixture[];
  readonly collisions: readonly DeskCollisionFixture[];
  readonly orphanBranches: readonly DeskOrphanBranchFixture[];
}

/** Build current, structured Proof evidence without paying for a fixture gate. */
export function deskProof(
  presentation?: Pick<Proof, "line" | "markdown">,
): DeskProofFixture {
  return {
    kind: "honored",
    ...(presentation === undefined ? {} : { presentation }),
  };
}

/** Build one unmatched logbook begin event plus duration priors. */
export function deskRunningAction(
  verb = "done",
  options: {
    readonly startedAgoMs?: number;
    readonly typicalDurationMs?: number;
  } = {},
): DeskRunningActionFixture {
  return {
    kind: "running",
    verb,
    startedAgoMs: options.startedAgoMs ?? 2_000,
    typicalDurationMs: options.typicalDurationMs ?? 4_000,
  };
}

/** Build one completed failed action with optional gate-stage evidence. */
export function deskFailedAction(
  verb = "done",
  options: {
    readonly failedStage?: string;
    readonly finishedAgoMs?: number;
  } = {},
): DeskFailedActionFixture {
  return {
    kind: "failed",
    verb,
    finishedAgoMs: options.finishedAgoMs ?? 2_000,
    ...(options.failedStage === undefined
      ? {}
      : { failedStage: options.failedStage }),
  };
}

/** Build the landing evidence later Desk waves need to vary explicitly. */
export function deskLandingAuthority(
  kind: DeskLandingAuthorityFixture["kind"],
): DeskLandingAuthorityFixture {
  return { kind };
}

/** Keep both optional action sources absent and deterministic. */
export function deskMissingAgentsAndScripts(): DeskAvailabilityFixture {
  return { agents: "missing", scripts: "missing" };
}

/** Build one real worktree entry with cheap ahead/dirty/proof/activity knobs. */
export function deskFleetEntry(
  name: string,
  options: {
    readonly aheadCommits?: number;
    readonly committedFiles?: readonly DeskFixtureFile[];
    readonly dirtyFiles?: readonly DeskFixtureFile[];
    readonly proof?: DeskProofFixture;
    readonly action?: DeskActionFixture;
    readonly landingAuthority?: DeskLandingAuthorityFixture;
    readonly availability?: DeskAvailabilityFixture;
  } = {},
): DeskFleetEntryFixture {
  if (name.trim() === "") throw new TypeError("Desk fleet entry name is empty");
  const aheadCommits = options.aheadCommits ?? 0;
  if (!Number.isSafeInteger(aheadCommits) || aheadCommits < 0) {
    throw new TypeError("Desk aheadCommits must be a non-negative integer");
  }
  return {
    name,
    aheadCommits,
    committedFiles: [...(options.committedFiles ?? [])],
    dirtyFiles: [...(options.dirtyFiles ?? [])],
    ...(options.proof === undefined ? {} : { proof: options.proof }),
    ...(options.action === undefined ? {} : { action: options.action }),
    landingAuthority: options.landingAuthority ??
      deskLandingAuthority("conversation-required"),
    availability: options.availability ?? deskMissingAgentsAndScripts(),
  };
}

/** Build pairwise changed-path evidence; the status core derives collisions. */
export function deskCollision(
  path: string,
  entries: readonly string[] = [],
): DeskCollisionFixture {
  return { path, entries: [...entries] };
}

/** Build a branch without a checkout for the Desk header's orphan account. */
export function deskOrphanBranch(name: string): DeskOrphanBranchFixture {
  return { name };
}

/** Compose a caller-owned fleet in a few lines. */
export function deskFleetFixture(
  entries: readonly DeskFleetEntryFixture[] = [],
  options: {
    readonly collisions?: readonly DeskCollisionFixture[];
    readonly orphanBranches?: readonly DeskOrphanBranchFixture[];
  } = {},
): DeskFleetFixture {
  return {
    entries: [...entries],
    collisions: [...(options.collisions ?? [])],
    orphanBranches: [...(options.orphanBranches ?? [])],
  };
}

export interface DeskTtyProject {
  readonly parent: string;
  readonly root: string;
  readonly worktrees: ReadonlyMap<string, string>;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Own one temporary project for a callback. The parent contains the main
 * checkout and its sibling worktree root, so recursive cleanup cannot strand a
 * checkout even when the callback or PTY session throws.
 */
export async function withDeskTtyProject<T>(
  fixture: DeskFleetFixture,
  run: (project: DeskTtyProject) => Promise<T>,
): Promise<T> {
  return await withTempDir(async (parent) => {
    const root = join(parent, "project");
    const project = await materialiseDeskProject(parent, root, fixture);
    return await run(project);
  }, { prefix: "discern-desk-tty-" });
}

async function materialiseDeskProject(
  parent: string,
  root: string,
  fixture: DeskFleetFixture,
): Promise<DeskTtyProject> {
  await Deno.mkdir(root, { recursive: true });
  await scaffoldEngine(root);
  await gitInit(root);
  const worktrees = new Map<string, string>();
  for (const entry of fixture.entries) {
    if (worktrees.has(entry.name)) {
      throw new TypeError(`duplicate Desk fleet entry ${entry.name}`);
    }
    worktrees.set(entry.name, await addWorktree(root, entry.name));
  }

  const collisionFiles = new Map<string, DeskFixtureFile[]>();
  for (const collision of fixture.collisions) {
    const names = collision.entries.length === 0
      ? fixture.entries.map((entry) => entry.name)
      : collision.entries;
    if (names.length < 2) {
      throw new TypeError(`Desk collision ${collision.path} needs two entries`);
    }
    for (const name of names) {
      if (!worktrees.has(name)) {
        throw new TypeError(`Desk collision names unknown entry ${name}`);
      }
      const files = collisionFiles.get(name) ?? [];
      files.push({ path: collision.path, contents: `${name}\n` });
      collisionFiles.set(name, files);
    }
  }

  for (const entry of fixture.entries) {
    const worktree = requiredWorktree(worktrees, entry.name);
    let committed = false;
    for (let index = 0; index < entry.aheadCommits; index += 1) {
      await writeFixtureFile(worktree, {
        path: `.desk-fixture/commit-${index + 1}.txt`,
        contents: `${entry.name} commit ${index + 1}\n`,
      });
      await commitFixture(worktree, `Add ${entry.name} fixture commit ${index + 1}`);
      committed = true;
    }
    const committedFiles = [
      ...entry.committedFiles,
      ...(collisionFiles.get(entry.name) ?? []),
    ];
    if (committedFiles.length > 0) {
      for (const file of committedFiles) await writeFixtureFile(worktree, file);
      await commitFixture(worktree, `Add ${entry.name} fleet state`);
      committed = true;
    }
    if (entry.availability.scripts === "available") {
      const script = join(
        worktree,
        SOURCE_PATHS.scripts.defaultPath,
        "desk-fixture",
      );
      await ensureDir(dirname(script));
      await Deno.writeTextFile(script, "#!/bin/sh\nexit 0\n");
      await Deno.chmod(script, 0o755);
      await commitFixture(worktree, `Add ${entry.name} fixture script`);
      committed = true;
    }
    if (entry.proof !== undefined && !committed) {
      await writeFixtureFile(worktree, {
        path: ".desk-fixture/proof-subject.txt",
        contents: `${entry.name} proof subject\n`,
      });
      await commitFixture(worktree, `Add ${entry.name} proof subject`);
    }
  }

  for (const entry of fixture.entries) {
    const worktree = requiredWorktree(worktrees, entry.name);
    if (entry.proof !== undefined) {
      await materialiseProof(worktree, entry.proof);
    }
    if (entry.landingAuthority.kind === "effort-grant") {
      await grantEffort(
        worktree,
        await gitOut(worktree, "branch", "--show-current"),
        "2026-08-23T12:00:00.000Z",
      );
    }
    for (const file of entry.dirtyFiles) await writeFixtureFile(worktree, file);
  }

  const commonGitDir = await gitOut(root, "rev-parse", "--absolute-git-dir");
  const epoch = configEpoch(await loadConfig(root)).fingerprint;
  for (const entry of fixture.entries) {
    if (entry.action !== undefined) {
      await materialiseAction(
        requiredWorktree(worktrees, entry.name),
        commonGitDir,
        epoch,
        entry.action,
      );
    }
  }
  for (const orphan of fixture.orphanBranches) {
    if (worktrees.has(orphan.name)) {
      throw new TypeError(`Desk orphan duplicates fleet entry ${orphan.name}`);
    }
    const orphanWorktree = await addWorktree(root, orphan.name);
    await writeFixtureFile(orphanWorktree, {
      path: ".desk-fixture/orphan-subject.txt",
      contents: `${orphan.name} unlanded work\n`,
    });
    await commitFixture(orphanWorktree, `Add ${orphan.name} orphan fixture`);
    await git(root, "worktree", "remove", orphanWorktree);
  }

  const allAgentsMissing = fixture.entries.every((entry) =>
    entry.availability.agents === "missing"
  );
  return {
    parent,
    root,
    worktrees,
    env: allAgentsMissing ? { PATH: SAFE_SYSTEM_PATH } : {},
  };
}

function requiredWorktree(
  worktrees: ReadonlyMap<string, string>,
  name: string,
): string {
  const worktree = worktrees.get(name);
  if (worktree === undefined) throw new Error(`missing worktree ${name}`);
  return worktree;
}

async function writeFixtureFile(
  root: string,
  file: DeskFixtureFile,
): Promise<void> {
  if (file.path === "" || file.path.startsWith("/") || file.path.includes("..")) {
    throw new TypeError(`unsafe Desk fixture path ${file.path}`);
  }
  const path = join(root, file.path);
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, file.contents ?? `${file.path}\n`);
}

async function commitFixture(root: string, message: string): Promise<void> {
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", message, "--no-gpg-sign");
}

async function materialiseProof(
  worktree: string,
  fixture: DeskProofFixture,
): Promise<void> {
  const proof = await buildGateProof(worktree, "main", []);
  if (proof === undefined) {
    throw new Error(`could not build Desk fixture Proof for ${worktree}`);
  }
  const selected: Proof = fixture.presentation === undefined
    ? proof
    : { ...proof, ...fixture.presentation };
  const preflight = await preflightAdminStateWrites(worktree);
  if (!preflight.ok) {
    throw new Error(`could not preflight Desk fixture Proof at ${preflight.path}`);
  }
  const recorded = await recordGateOutcome(
    worktree,
    preflight.authority,
    true,
    await pinValidatedTree(worktree),
    selected,
  );
  if (recorded.status !== "recorded") {
    throw new Error(`could not record Desk fixture Proof: ${recorded.status}`);
  }
}

async function materialiseAction(
  worktree: string,
  commonGitDir: string,
  epoch: string,
  action: DeskActionFixture,
): Promise<void> {
  const branch = await gitOut(worktree, "branch", "--show-current");
  const head = await gitOut(worktree, "rev-parse", "--short", "HEAD");
  const now = SYSTEM_CLOCK.wallNow();
  const base = {
    schema: LOGBOOK_SCHEMA_VERSION,
    writer: "desk-tty-fixture",
    surface: "cli" as const,
    driver: {},
    branch,
    head,
    epoch,
  };
  if (action.kind === "running") {
    for (const [index, ago] of [60_000, 30_000].entries()) {
      await appendEvent(commonGitDir, {
        ...base,
        at: new Date(now - ago).toISOString(),
        kind: "verb",
        invocation: `${branch}-prior-${index}`,
        verb: action.verb,
        clean: true,
        outcome: "ok",
        duration_ms: action.typicalDurationMs,
      } satisfies LogbookEvent);
    }
    await appendEvent(commonGitDir, {
      ...base,
      at: new Date(now - action.startedAgoMs).toISOString(),
      kind: "begin",
      invocation: `${branch}-running`,
      verb: action.verb,
    } satisfies LogbookEvent);
    return;
  }
  await appendEvent(commonGitDir, {
    ...base,
    at: new Date(now - action.finishedAgoMs).toISOString(),
    kind: "verb",
    invocation: `${branch}-failed`,
    verb: action.verb,
    clean: true,
    outcome: "failed",
    duration_ms: 1_000,
    ...(action.failedStage === undefined
      ? {}
      : { failed_stage: action.failedStage }),
  } satisfies LogbookEvent);
}

export type DeskTtyColorMode = "color" | "no-color-flag" | "no-color-env";

export interface DeskTtyInputChunk {
  readonly keys?: readonly TerminalKeyName[];
  readonly input?: string | Uint8Array;
  readonly resize?: PtyGeometry;
  /** Bounded delay after readiness and before this chunk. */
  readonly settleMs?: number;
  readonly allowLoneEscape?: boolean;
}

export interface DeskTtyInputPhase {
  readonly waitFor: string | readonly [string, ...string[]];
  readonly captureAs?: string;
  /** Pause after the readiness marker before capturing and sending chunks. */
  readonly settleMs?: number;
  readonly chunks: readonly [DeskTtyInputChunk, ...DeskTtyInputChunk[]];
}

export interface DeskTerminalResize {
  readonly transcriptOffset: number;
  readonly columns: number;
  readonly rows: number;
}

export interface DeskTerminalEvidence {
  readonly before: string;
  readonly after: string;
  readonly beforeDescription: string;
  readonly afterDescription: string;
  readonly restored: boolean;
  readonly exactStateRestored: boolean;
  readonly initialSize: PtyGeometry;
  readonly finalSize: PtyGeometry;
  readonly resizes: readonly PtyGeometry[];
  readonly childPid: number;
  readonly childExited: boolean;
  readonly noChild: boolean;
  readonly resizeError?: string | undefined;
}

export interface DeskFrameSpan {
  readonly text: string;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly style?: TerminalSpanStyle;
  readonly link?: string;
  readonly roles: readonly string[];
}

export interface DeskFrameRow {
  readonly row: number;
  readonly text: string;
  readonly columns: number;
  readonly focused: boolean;
  readonly spans: readonly DeskFrameSpan[];
}

export interface DeskFrameControl {
  readonly offset: number;
  readonly raw: string;
  readonly action: string;
}

export interface DeskImplicitWrap {
  readonly row: number;
  readonly column: number;
  readonly text: string;
}

export interface DeskVisibleFrame {
  readonly name: string;
  readonly columns: number;
  readonly rows: number;
  readonly lines: readonly DeskFrameRow[];
  readonly text: string;
  readonly focusMarkers: readonly { readonly row: number; readonly column: number }[];
  readonly controls: readonly DeskFrameControl[];
  readonly unexpectedControls: readonly DeskFrameControl[];
  readonly implicitWraps: readonly DeskImplicitWrap[];
  readonly clearCount: number;
  readonly cursor: {
    readonly row: number;
    readonly column: number;
    readonly visible: boolean;
  };
  readonly alternateScreen: boolean;
}

export interface DeskTtyRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly transcript: string;
  readonly stdoutBytes: Uint8Array;
  readonly stderrBytes: Uint8Array;
  readonly rawBytes: Uint8Array;
  readonly frames: readonly DeskVisibleFrame[];
  readonly terminal: DeskTerminalEvidence;
}

interface ChildTerminalEvidence {
  readonly code: number;
  readonly before: string;
  readonly after: string;
  readonly beforeDescription: string;
  readonly afterDescription: string;
  readonly restored: boolean;
  readonly exactStateRestored: boolean;
  readonly initialSize: PtyGeometry;
  readonly finalSize: PtyGeometry;
  readonly resizes: PtyGeometry[];
  readonly childPid: number;
  readonly childExited: boolean;
  readonly resizeError?: string | undefined;
}

/** Drive the real source CLI and return raw streams plus semantic screens. */
export async function runDeskTty(
  project: DeskTtyProject,
  options: {
    readonly geometry: PtyGeometry;
    readonly colorMode?: DeskTtyColorMode;
    readonly input: readonly DeskTtyInputPhase[];
    readonly env?: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
  },
): Promise<DeskTtyRunResult> {
  assertGeometry(options.geometry);
  const colorMode = options.colorMode ?? "color";
  return await withTempDir(async (runDir) => {
    const resultPath = join(runDir, "terminal.json");
    const resizeDir = join(runDir, "resizes");
    await Deno.mkdir(resizeDir);
    const resizeTimeline: DeskTerminalResize[] = [];
    const captureGeometry = new Map<string, PtyGeometry>();
    let expectedGeometry = options.geometry;
    let resizeSequence = 0;
    const input: PtyInputPhase[] = options.input.map((phase) => {
    const phaseSettleMs = phase.settleMs ?? 20;
    assertSettle(phaseSettleMs);
    if (phase.captureAs !== undefined) {
      captureGeometry.set(phase.captureAs, expectedGeometry);
    }
    const steps = phase.chunks.map((chunk) => {
      if (chunk.settleMs !== undefined) assertSettle(chunk.settleMs);
      const keys = chunk.keys === undefined
        ? ""
        : encodeTerminalKeys(...chunk.keys);
      const bytes = combineInput(keys, chunk.input);
      const resized = chunk.resize;
      if (resized !== undefined) {
        assertGeometry(resized);
        expectedGeometry = resized;
      }
      return {
        ...(chunk.settleMs === undefined ? {} : { delayMs: chunk.settleMs }),
        ...(bytes === undefined ? {} : { bytes }),
        ...(chunk.allowLoneEscape === true || chunk.keys?.at(-1) === "escape"
          ? { allowLoneEscape: true }
          : {}),
        ...(resized === undefined
          ? {}
          : {
            effect: async (
              context: { readonly transcript: string },
            ): Promise<void> => {
              resizeSequence += 1;
              resizeTimeline.push({
                transcriptOffset: context.transcript.length,
                ...resized,
              });
              const requestName =
                `${String(resizeSequence).padStart(4, "0")}.json`;
              const requestPath = join(resizeDir, requestName);
              const temporary = `${requestPath}.tmp`;
              await Deno.writeTextFile(
                temporary,
                `${JSON.stringify(resized)}\n`,
                { createNew: true },
              );
              await Deno.rename(temporary, requestPath);
              await waitForResizeAcknowledgement(resizeDir, requestName);
            },
          }),
      };
    });
    return {
      waitFor: phase.waitFor,
      settleMs: phaseSettleMs,
      ...(phase.captureAs === undefined ? {} : { captureAs: phase.captureAs }),
      steps: steps as [typeof steps[number], ...typeof steps[number][]],
    };
  });

    const targetArgs = [
    "desk",
    ...(colorMode === "color" ? ["--theme", "dark"] : []),
    ...(colorMode === "no-color-flag" ? ["--no-color"] : []),
  ];
    const childArgs = [
    "--child",
    "--result",
    resultPath,
    "--resize-dir",
    resizeDir,
    "--",
    Deno.execPath(),
    ...engineRunArgs(targetArgs),
  ];
    const colorEnv = colorMode === "color"
    ? { NO_COLOR: "", FORCE_COLOR: "1" }
    : colorMode === "no-color-env"
    ? { NO_COLOR: "1", FORCE_COLOR: "" }
    : { NO_COLOR: "", FORCE_COLOR: "" };
    const process = await runPtyProcess({
      command: Deno.execPath(),
      args: repoSourceRunArgs(HARNESS_PATH, childArgs),
      cwd: project.root,
      env: await engineEnv({
        TERM: "xterm-256color",
        COLORTERM: colorMode === "color" ? "truecolor" : "",
        ...colorEnv,
        ...project.env,
        ...options.env,
      }),
      geometry: options.geometry,
      input,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const terminal: ChildTerminalEvidence = decodeWith(
      CHILD_TERMINAL_EVIDENCE_SCHEMA,
      await Deno.readTextFile(resultPath),
    );
    const finalGeometry = resizeTimeline.at(-1) ?? options.geometry;
    const frames = Object.entries(process.keyframes).map(([name, transcript]) =>
      normaliseDeskTranscript(
        name,
        transcript,
        options.geometry,
        resizeTimeline.filter((resize) =>
          resize.transcriptOffset < transcript.length
        ),
        captureGeometry.get(name),
      )
    );
    frames.push(normaliseDeskTranscript(
      "exit",
      process.transcript,
      options.geometry,
      resizeTimeline,
      finalGeometry,
    ));
    return {
      code: process.code,
      stdout: process.stdout,
      stderr: process.stderr,
      transcript: process.transcript,
      stdoutBytes: process.stdoutBytes,
      stderrBytes: process.stderrBytes,
      rawBytes: process.transcriptBytes,
      frames,
      terminal: {
        ...terminal,
        noChild: !(await processExists(terminal.childPid)),
      },
    };
  }, { parent: project.parent, prefix: "desk-session-" });
}

function assertGeometry(geometry: PtyGeometry): void {
  if (
    !Number.isSafeInteger(geometry.columns) || geometry.columns < 1 ||
    !Number.isSafeInteger(geometry.rows) || geometry.rows < 1
  ) {
    throw new TypeError("Desk PTY geometry must use positive integers");
  }
}

function assertSettle(milliseconds: number): void {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 1_000) {
    throw new TypeError("Desk PTY settle time must be between 0 and 1000ms");
  }
}

function combineInput(
  keys: string,
  input: string | Uint8Array | undefined,
): string | Uint8Array | undefined {
  if (input === undefined) return keys === "" ? undefined : keys;
  if (keys === "") return input;
  if (typeof input === "string") return `${keys}${input}`;
  const prefix = new TextEncoder().encode(keys);
  const output = new Uint8Array(prefix.length + input.length);
  output.set(prefix, 0);
  output.set(input, prefix.length);
  return output;
}

async function processExists(pid: number): Promise<boolean> {
  const result = await new Deno.Command("ps", {
    args: ["-p", String(pid), "-o", "pid="],
    stdout: "piped",
    stderr: "null",
  }).output().catch(() => undefined);
  return result?.success === true &&
    new TextDecoder().decode(result.stdout).trim() !== "";
}

interface ScreenOperation {
  readonly offset: number;
  readonly raw: string;
  readonly action: string;
  readonly parameters?: readonly number[];
  readonly geometry?: PtyGeometry;
  readonly unexpected?: boolean;
}

interface PreparedProjection {
  readonly source: string;
  readonly operations: readonly ScreenOperation[];
}

interface ScreenCell {
  readonly text: string;
  readonly width: number;
  readonly style?: TerminalSpanStyle;
  readonly link?: string;
}

interface ContinuationCell {
  readonly continuation: true;
}

type MutableCell = ScreenCell | ContinuationCell | undefined;

/** Project one transcript prefix into the cells a person can currently see. */
export function normaliseDeskTranscript(
  name: string,
  transcript: string,
  initialGeometry: PtyGeometry,
  resizes: readonly DeskTerminalResize[] = [],
  expectedGeometry?: PtyGeometry,
): DeskVisibleFrame {
  assertGeometry(initialGeometry);
  if (transcript.includes(MARKER_OPEN) || transcript.includes(MARKER_CLOSE)) {
    throw new TypeError("Desk transcript contains reserved normalisation markers");
  }
  const prepared = prepareProjection(transcript, resizes);
  const screen = new DeskScreen(initialGeometry);
  const markerPattern = new RegExp(
    `${MARKER_OPEN}(\\d+)${MARKER_CLOSE}`,
    "gu",
  );
  for (const span of projectTerminalSpans(prepared.source)) {
    let cursor = 0;
    for (const match of span.text.matchAll(markerPattern)) {
      const at = match.index;
      if (at === undefined) continue;
      if (at > cursor) {
        screen.write(
          span.text.slice(cursor, at),
          span.style,
          span.link,
        );
      }
      const operation = prepared.operations[Number(match[1])];
      if (operation === undefined) {
        throw new Error(`Desk transcript references missing operation ${match[1]}`);
      }
      screen.apply(operation);
      cursor = at + match[0].length;
    }
    if (cursor < span.text.length) {
      screen.write(span.text.slice(cursor), span.style, span.link);
    }
  }
  if (
    expectedGeometry !== undefined &&
    (screen.columns !== expectedGeometry.columns ||
      screen.rows !== expectedGeometry.rows)
  ) {
    throw new Error(
      `Desk frame ${name} ended at ${screen.columns}x${screen.rows}; ` +
        `expected ${expectedGeometry.columns}x${expectedGeometry.rows}`,
    );
  }
  return screen.frame(name);
}

function prepareProjection(
  transcript: string,
  requestedResizes: readonly DeskTerminalResize[],
): PreparedProjection {
  const resizes = [...requestedResizes].sort((left, right) =>
    left.transcriptOffset - right.transcriptOffset
  );
  const operations: ScreenOperation[] = [];
  let source = "";
  let resizeIndex = 0;
  const appendOperation = (operation: ScreenOperation): void => {
    const index = operations.length;
    operations.push(operation);
    source += `${MARKER_OPEN}${index}${MARKER_CLOSE}`;
  };
  const appendDueResizes = (offset: number): void => {
    while (
      resizeIndex < resizes.length &&
      (resizes[resizeIndex]?.transcriptOffset ?? Number.POSITIVE_INFINITY) <=
        offset
    ) {
      const resize = resizes[resizeIndex];
      if (resize !== undefined) {
        appendOperation({
          offset: resize.transcriptOffset,
          raw: "",
          action: "resize",
          geometry: { columns: resize.columns, rows: resize.rows },
        });
      }
      resizeIndex += 1;
    }
  };

  let offset = 0;
  while (offset < transcript.length) {
    appendDueResizes(offset);
    const code = transcript.charCodeAt(offset);
    if (code === 0x1b) {
      if (transcript[offset + 1] === "[") {
        const end = csiEnd(transcript, offset + 2);
        if (end === undefined) {
          appendOperation({
            offset,
            raw: transcript.slice(offset),
            action: "incomplete-csi",
            unexpected: true,
          });
          offset = transcript.length;
          continue;
        }
        const raw = transcript.slice(offset, end + 1);
        if (raw.endsWith("m")) {
          source += raw;
        } else {
          appendOperation(csiOperation(raw, offset));
        }
        offset = end + 1;
        continue;
      }
      if (transcript[offset + 1] === "]") {
        const end = oscEnd(transcript, offset + 2);
        if (end === undefined) {
          appendOperation({
            offset,
            raw: transcript.slice(offset),
            action: "incomplete-osc",
            unexpected: true,
          });
          offset = transcript.length;
          continue;
        }
        const raw = transcript.slice(offset, end);
        if (raw.startsWith("\x1b]8;")) {
          source += raw;
        } else if (raw === "\x1b]11;?\x1b\\") {
          appendOperation({ offset, raw, action: "background-query" });
        } else {
          appendOperation({
            offset,
            raw,
            action: "unexpected-osc",
            unexpected: true,
          });
        }
        offset = end;
        continue;
      }
      const raw = transcript.slice(offset, offset + 2);
      const action = raw === "\x1b7"
        ? "save-cursor"
        : raw === "\x1b8"
        ? "restore-cursor"
        : raw === "\x1bD"
        ? "index"
        : raw === "\x1bE"
        ? "next-line"
        : raw === "\x1bM"
        ? "reverse-index"
        : "unexpected-escape";
      appendOperation({
        offset,
        raw,
        action,
        ...(action === "unexpected-escape" ? { unexpected: true } : {}),
      });
      offset += Math.min(2, transcript.length - offset);
      continue;
    }
    if (code === 0x0d || code === 0x0a || code === 0x09 || code === 0x08) {
      appendOperation({
        offset,
        raw: transcript[offset] ?? "",
        action: code === 0x0d
          ? "carriage-return"
          : code === 0x0a
          ? "line-feed"
          : code === 0x09
          ? "tab"
          : "backspace",
      });
      offset += 1;
      continue;
    }
    if (code === 0x07) {
      appendOperation({ offset, raw: "\x07", action: "bell" });
      offset += 1;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      appendOperation({
        offset,
        raw: transcript[offset] ?? "",
        action: "unexpected-control-character",
        unexpected: true,
      });
      offset += 1;
      continue;
    }
    const point = transcript.codePointAt(offset);
    if (point === undefined) break;
    const value = String.fromCodePoint(point);
    source += value;
    offset += value.length;
  }
  appendDueResizes(transcript.length);
  return { source, operations };
}

function csiEnd(value: string, from: number): number | undefined {
  for (let index = from; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return undefined;
}

/** Return the exclusive end of an OSC envelope. */
function oscEnd(value: string, from: number): number | undefined {
  for (let index = from; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x07) return index + 1;
    if (value[index] === "\x1b" && value[index + 1] === "\\") {
      return index + 2;
    }
  }
  return undefined;
}

function csiOperation(raw: string, offset: number): ScreenOperation {
  const final = raw.at(-1) ?? "";
  const body = raw.slice(2, -1);
  if (body === "?25" && (final === "h" || final === "l")) {
    return {
      offset,
      raw,
      action: final === "h" ? "show-cursor" : "hide-cursor",
    };
  }
  if (body === "?1049" && (final === "h" || final === "l")) {
    return {
      offset,
      raw,
      action: final === "h" ? "enter-alternate-screen" : "leave-alternate-screen",
    };
  }
  if (body === "?2004" && (final === "h" || final === "l")) {
    return {
      offset,
      raw,
      action: final === "h" ? "enable-bracketed-paste" : "disable-bracketed-paste",
    };
  }
  if (!/^\d*(?:;\d*)*$/u.test(body)) {
    return { offset, raw, action: "unexpected-csi", unexpected: true };
  }
  const parameters = body === ""
    ? []
    : body.split(";").map((part) => part === "" ? 0 : Number(part));
  const action = ({
    A: "cursor-up",
    B: "cursor-down",
    C: "cursor-forward",
    D: "cursor-back",
    E: "cursor-next-line",
    F: "cursor-previous-line",
    G: "cursor-column",
    H: "cursor-position",
    f: "cursor-position",
    J: "erase-display",
    K: "erase-line",
    d: "cursor-row",
    s: "save-cursor",
    u: "restore-cursor",
  } as Readonly<Record<string, string>>)[final];
  return action === undefined
    ? { offset, raw, action: "unexpected-csi", unexpected: true }
    : { offset, raw, action, parameters };
}

class DeskScreen {
  #columns: number;
  #rows: number;
  #cells: MutableCell[][];
  #row = 0;
  #column = 0;
  #saved: { row: number; column: number } | undefined;
  #visible = true;
  #alternateScreen = false;
  #clearCount = 0;
  readonly #controls: DeskFrameControl[] = [];
  readonly #unexpected: DeskFrameControl[] = [];
  readonly #wraps: DeskImplicitWrap[] = [];

  constructor(geometry: PtyGeometry) {
    this.#columns = geometry.columns;
    this.#rows = geometry.rows;
    this.#cells = Array.from({ length: geometry.rows }, () => []);
  }

  get columns(): number {
    return this.#columns;
  }

  get rows(): number {
    return this.#rows;
  }

  apply(operation: ScreenOperation): void {
    if (operation.action === "resize") {
      const geometry = operation.geometry;
      if (geometry !== undefined) this.#resize(geometry);
      return;
    }
    const record = {
      offset: operation.offset,
      raw: operation.raw,
      action: operation.action,
    };
    this.#controls.push(record);
    if (operation.unexpected === true) this.#unexpected.push(record);
    const value = (index: number, fallback: number): number => {
      const received = operation.parameters?.[index];
      return received === undefined || received === 0 ? fallback : received;
    };
    switch (operation.action) {
      case "carriage-return":
        this.#column = 0;
        break;
      case "line-feed":
      case "index":
        this.#lineFeed();
        break;
      case "next-line":
        this.#column = 0;
        this.#lineFeed();
        break;
      case "reverse-index":
        this.#row = Math.max(0, this.#row - 1);
        break;
      case "tab":
        this.#column = Math.min(
          this.#columns,
          this.#column + (8 - this.#column % 8),
        );
        break;
      case "backspace":
        this.#column = Math.max(0, this.#column - 1);
        break;
      case "cursor-up":
        this.#row = Math.max(0, this.#row - value(0, 1));
        break;
      case "cursor-down":
        this.#row = Math.min(this.#rows - 1, this.#row + value(0, 1));
        break;
      case "cursor-forward":
        this.#column = Math.min(this.#columns, this.#column + value(0, 1));
        break;
      case "cursor-back":
        this.#column = Math.max(0, this.#column - value(0, 1));
        break;
      case "cursor-next-line":
        this.#row = Math.min(this.#rows - 1, this.#row + value(0, 1));
        this.#column = 0;
        break;
      case "cursor-previous-line":
        this.#row = Math.max(0, this.#row - value(0, 1));
        this.#column = 0;
        break;
      case "cursor-column":
        this.#column = Math.min(this.#columns, value(0, 1) - 1);
        break;
      case "cursor-row":
        this.#row = Math.min(this.#rows - 1, value(0, 1) - 1);
        break;
      case "cursor-position":
        this.#row = Math.min(this.#rows - 1, value(0, 1) - 1);
        this.#column = Math.min(this.#columns, value(1, 1) - 1);
        break;
      case "erase-display":
        this.#eraseDisplay(value(0, 0));
        break;
      case "erase-line":
        this.#eraseLine(value(0, 0));
        break;
      case "save-cursor":
        this.#saved = { row: this.#row, column: this.#column };
        break;
      case "restore-cursor":
        if (this.#saved !== undefined) {
          this.#row = this.#saved.row;
          this.#column = this.#saved.column;
        }
        break;
      case "hide-cursor":
        this.#visible = false;
        break;
      case "show-cursor":
        this.#visible = true;
        break;
      case "enter-alternate-screen":
        this.#alternateScreen = true;
        this.#cells = Array.from({ length: this.#rows }, () => []);
        this.#row = 0;
        this.#column = 0;
        break;
      case "leave-alternate-screen":
        this.#alternateScreen = false;
        break;
      default:
        break;
    }
  }

  write(
    value: string,
    style: TerminalSpanStyle | undefined,
    link: string | undefined,
  ): void {
    for (const { segment } of SEGMENTER.segment(value)) {
      const width = graphemeWidth(segment);
      if (width === 0) {
        const prior = this.#cells[this.#row]?.[Math.max(0, this.#column - 1)];
        if (prior !== undefined && !("continuation" in prior)) {
          this.#cells[this.#row]?.splice(Math.max(0, this.#column - 1), 1, {
            ...prior,
            text: `${prior.text}${segment}`,
          });
        }
        continue;
      }
      if (this.#column + width > this.#columns) {
        this.#wraps.push({
          row: this.#row + 1,
          column: this.#column + 1,
          text: segment,
        });
        this.#column = 0;
        this.#lineFeed();
      }
      if (width > this.#columns) {
        this.#wraps.push({ row: this.#row + 1, column: 1, text: segment });
        continue;
      }
      const row = this.#cells[this.#row];
      if (row === undefined) continue;
      row[this.#column] = {
        text: segment,
        width,
        ...(style === undefined ? {} : { style }),
        ...(link === undefined ? {} : { link }),
      };
      for (let extra = 1; extra < width; extra += 1) {
        row[this.#column + extra] = { continuation: true };
      }
      this.#column += width;
    }
  }

  frame(name: string): DeskVisibleFrame {
    const lines = this.#cells.map((row, index) => frameRow(row, index + 1));
    while (lines.at(-1)?.text === "") lines.pop();
    const focusMarkers = lines.flatMap((line) => {
      const markers: { row: number; column: number }[] = [];
      let from = 0;
      while (true) {
        const at = line.text.indexOf("› [●]", from);
        if (at < 0) break;
        markers.push({
          row: line.row,
          column: measureText(line.text.slice(0, at)) + 1,
        });
        from = at + 1;
      }
      return markers;
    });
    return {
      name,
      columns: this.#columns,
      rows: this.#rows,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      focusMarkers,
      controls: [...this.#controls],
      unexpectedControls: [...this.#unexpected],
      implicitWraps: [...this.#wraps],
      clearCount: this.#clearCount,
      cursor: {
        row: this.#row + 1,
        column: Math.min(this.#columns, this.#column + 1),
        visible: this.#visible,
      },
      alternateScreen: this.#alternateScreen,
    };
  }

  #lineFeed(): void {
    this.#row += 1;
    if (this.#row < this.#rows) return;
    this.#cells.shift();
    this.#cells.push([]);
    this.#row = this.#rows - 1;
  }

  #eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.#cells = Array.from({ length: this.#rows }, () => []);
      this.#clearCount += 1;
      return;
    }
    if (mode === 1) {
      for (let row = 0; row < this.#row; row += 1) this.#cells[row] = [];
      const current = this.#cells[this.#row] ?? [];
      for (let column = 0; column <= this.#column; column += 1) {
        current[column] = undefined;
      }
      return;
    }
    const current = this.#cells[this.#row] ?? [];
    for (let column = this.#column; column < current.length; column += 1) {
      current[column] = undefined;
    }
    for (let row = this.#row + 1; row < this.#rows; row += 1) {
      this.#cells[row] = [];
    }
  }

  #eraseLine(mode: number): void {
    const row = this.#cells[this.#row] ?? [];
    if (mode === 2) {
      this.#cells[this.#row] = [];
      return;
    }
    if (mode === 1) {
      for (let column = 0; column <= this.#column; column += 1) {
        row[column] = undefined;
      }
      return;
    }
    for (let column = this.#column; column < row.length; column += 1) {
      row[column] = undefined;
    }
  }

  #resize(geometry: PtyGeometry): void {
    assertGeometry(geometry);
    this.#columns = geometry.columns;
    this.#rows = geometry.rows;
    this.#cells = this.#cells.slice(0, geometry.rows);
    while (this.#cells.length < geometry.rows) this.#cells.push([]);
    for (const row of this.#cells) row.length = Math.min(row.length, geometry.columns);
    this.#row = Math.min(this.#row, geometry.rows - 1);
    this.#column = Math.min(this.#column, geometry.columns);
  }
}

function frameRow(cells: readonly MutableCell[], row: number): DeskFrameRow {
  let lastColumn = -1;
  for (let column = 0; column < cells.length; column += 1) {
    const cell = cells[column];
    if (
      cell !== undefined && !("continuation" in cell) &&
      cell.text.trimEnd() !== ""
    ) {
      lastColumn = column + cell.width - 1;
    }
  }
  if (lastColumn < 0) {
    return { row, text: "", columns: 0, focused: false, spans: [] };
  }
  const spans: DeskFrameSpan[] = [];
  let text = "";
  let column = 0;
  while (column <= lastColumn) {
    const cell = cells[column];
    if (cell !== undefined && "continuation" in cell) {
      column += 1;
      continue;
    }
    const part = cell === undefined ? " " : cell.text;
    const width = cell === undefined ? 1 : cell.width;
    const style = cell === undefined ? undefined : cell.style;
    const link = cell === undefined ? undefined : cell.link;
    const roles = styleRoles(style, link);
    text += part;
    const previous = spans.at(-1);
    if (
      previous !== undefined && previous.endColumn === column &&
      sameStyle(previous.style, style) && previous.link === link &&
      previous.roles.join("\0") === roles.join("\0")
    ) {
      spans[spans.length - 1] = {
        ...previous,
        text: `${previous.text}${part}`,
        endColumn: column + width,
      };
    } else {
      spans.push({
        text: part,
        startColumn: column + 1,
        endColumn: column + width,
        ...(style === undefined ? {} : { style }),
        ...(link === undefined ? {} : { link }),
        roles,
      });
    }
    column += width;
  }
  return {
    row,
    text,
    columns: measureText(text),
    focused: text.includes("› [●]"),
    spans,
  };
}

function styleRoles(
  style: TerminalSpanStyle | undefined,
  link: string | undefined,
): string[] {
  if (style === undefined && link === undefined) return [];
  return [
    style?.bold === true ? "emphasis" : undefined,
    style?.dim === true ? "muted" : undefined,
    style?.italic === true ? "italic" : undefined,
    style?.underline === true ? "underline" : undefined,
    style?.strikethrough === true ? "strikethrough" : undefined,
    style?.color !== undefined ? "foreground" : undefined,
    style?.background !== undefined ? "background" : undefined,
    link !== undefined ? "link" : undefined,
  ].filter((role): role is string => role !== undefined);
}

function sameStyle(
  left: TerminalSpanStyle | undefined,
  right: TerminalSpanStyle | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface ChildOptions {
  readonly resultPath: string;
  readonly resizeDir: string;
  readonly command: string;
  readonly args: readonly string[];
}

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function childOptions(args: readonly string[]): ChildOptions {
  const separator = args.indexOf("--");
  const resultPath = argument(args, "--result");
  const resizeDir = argument(args, "--resize-dir");
  const command = separator < 0 ? undefined : args[separator + 1];
  if (
    !args.includes("--child") || resultPath === undefined ||
    resizeDir === undefined || command === undefined
  ) {
    throw new TypeError(
      "Desk child harness needs --result, --resize-dir, and -- <command>",
    );
  }
  return {
    resultPath,
    resizeDir,
    command,
    args: args.slice(separator + 2),
  };
}

async function stty(args: readonly string[]): Promise<string> {
  const output = await new Deno.Command("stty", {
    args: [...args],
    stdin: "inherit",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr).trim());
  }
  return new TextDecoder().decode(output.stdout).trim();
}

function consoleGeometry(): PtyGeometry {
  const size = Deno.consoleSize();
  return { columns: size.columns, rows: size.rows };
}

function lineModeRestored(before: string, after: string): boolean {
  const enabled = (description: string, name: string): boolean =>
    description.split(/\s+/u).includes(name);
  return ["icanon", "echo", "isig", "iexten", "opost"].every((name) =>
    enabled(before, name) === enabled(after, name) && enabled(after, name)
  );
}

async function resizeTerminal(
  child: Deno.ChildProcess,
  geometry: PtyGeometry,
): Promise<void> {
  assertGeometry(geometry);
  await stty([
    "cols",
    String(geometry.columns),
    "rows",
    String(geometry.rows),
  ]);
  try {
    Deno.kill(child.pid, "SIGWINCH");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Resolve the child-to-parent completion marker for one resize request. */
function resizeAcknowledgementPath(
  resizeDir: string,
  requestName: string,
  outcome: "applied" | "error",
): string {
  return join(resizeDir, `${requestName.slice(0, -".json".length)}.${outcome}`);
}

/** Wait for the child to apply or reject a published terminal resize. */
async function waitForResizeAcknowledgement(
  resizeDir: string,
  requestName: string,
): Promise<void> {
  const appliedPath = resizeAcknowledgementPath(
    resizeDir,
    requestName,
    "applied",
  );
  const errorPath = resizeAcknowledgementPath(
    resizeDir,
    requestName,
    "error",
  );
  await waitUntil(async () => {
    if (await targetExists(errorPath)) {
      throw new Error(`Desk child rejected resize request ${requestName}`);
    }
    return await targetExists(appliedPath);
  }, `Desk child to apply resize request ${requestName}`, {
    timeoutMs: RESIZE_ACK_TIMEOUT_MS,
    intervalMs: RESIZE_ACK_POLL_MS,
  });
}

/** Publish one child-side resize outcome after the kernel operation settles. */
async function acknowledgeResize(
  resizeDir: string,
  requestName: string,
  outcome: "applied" | "error",
): Promise<void> {
  await Deno.writeTextFile(
    resizeAcknowledgementPath(resizeDir, requestName, outcome),
    "",
    { createNew: true },
  );
}

async function applyResizeRequests(
  resizeDir: string,
  seen: Set<string>,
  child: Deno.ChildProcess,
  applied: PtyGeometry[],
): Promise<void> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(resizeDir)) {
    if (entry.isFile && /^\d{4}\.json$/u.test(entry.name)) names.push(entry.name);
  }
  for (const name of names.sort()) {
    if (seen.has(name)) continue;
    try {
      const parsed = decodeWith(
        PARTIAL_PTY_GEOMETRY_SCHEMA,
        await Deno.readTextFile(join(resizeDir, name)),
      );
      if (parsed.columns === undefined || parsed.rows === undefined) {
        throw new TypeError(`invalid Desk resize request ${name}`);
      }
      const geometry: PtyGeometry = {
        columns: parsed.columns,
        rows: parsed.rows,
      };
      await resizeTerminal(child, geometry);
      applied.push(geometry);
      await acknowledgeResize(resizeDir, name, "applied");
      seen.add(name);
    } catch (error) {
      await acknowledgeResize(resizeDir, name, "error");
      throw error;
    }
  }
}

async function watchResizeRequests(
  resizeDir: string,
  child: Deno.ChildProcess,
  applied: PtyGeometry[],
  watcher: Deno.FsWatcher,
): Promise<void> {
  const seen = new Set<string>();
  await applyResizeRequests(resizeDir, seen, child, applied);
  try {
    for await (const _event of watcher) {
      await applyResizeRequests(resizeDir, seen, child, applied);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.BadResource)) {
      throw error;
    }
  } finally {
    watcher.close();
  }
}

async function runChildHarness(options: ChildOptions): Promise<number> {
  const before = await stty(["-g"]);
  const beforeDescription = await stty(["-a"]);
  const initialSize = consoleGeometry();
  const child = new Deno.Command(options.command, {
    args: [...options.args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const applied: PtyGeometry[] = [];
  const watcher = Deno.watchFs(options.resizeDir);
  let resizeError: string | undefined;
  const resizeTask = watchResizeRequests(
    options.resizeDir,
    child,
    applied,
    watcher,
  ).catch((error: unknown) => {
    resizeError = error instanceof Error ? error.message : String(error);
  });
  const status = await child.status;
  watcher.close();
  await resizeTask;
  const after = await stty(["-g"]);
  const afterDescription = await stty(["-a"]);
  const evidence: ChildTerminalEvidence = {
    code: status.code,
    before,
    after,
    beforeDescription,
    afterDescription,
    restored: lineModeRestored(beforeDescription, afterDescription),
    exactStateRestored: before === after,
    initialSize,
    finalSize: consoleGeometry(),
    resizes: applied,
    childPid: child.pid,
    childExited: true,
    ...(resizeError === undefined ? {} : { resizeError }),
  };
  await Deno.writeTextFile(
    options.resultPath,
    `${JSON.stringify(evidence)}\n`,
  );
  return status.code;
}

if (import.meta.main) {
  Deno.exit(await runChildHarness(childOptions(Deno.args)));
}
