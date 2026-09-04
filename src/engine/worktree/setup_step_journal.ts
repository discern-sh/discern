/**
 * Durable interruption evidence for one-shot worktree setup steps.
 *
 * A configured command is written `running` before invocation and `completed`
 * only after a zero exit. Automatic setup skips completed identities and never
 * replays a running identity: an arbitrary shell command can leave no local
 * proof of whether its external effect completed, so only an explicit owner
 * decision can resolve that state.
 */

import { dirname } from "@std/path";
import { z } from "@zod/zod";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { decodeJson } from "../../shared/runtime_decode.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

/** The automatic replay state of one configured setup step. */
export type SetupStepState = "not_started" | "running" | "completed";

/** Stable identity and current state for one configured command. */
export interface SetupStepJournalEntry {
  readonly id: string;
  readonly command: string;
  readonly occurrence: number;
  readonly state: SetupStepState;
}

/** The atomically replaced journal envelope. */
export interface SetupStepJournal {
  readonly version: typeof ON_DISK_FORMATS.setupStepJournal.version;
  readonly steps: readonly SetupStepJournalEntry[];
}

/** A validated journal read. */
export type SetupStepJournalRead =
  | { readonly status: "missing"; readonly path: string }
  | {
    readonly status: "recorded";
    readonly path: string;
    readonly journal: SetupStepJournal;
  };

/** A bounded refusal that leaves the standing journal intact. */
export class SetupStepJournalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SetupStepJournalError";
  }
}

/** Injectable interruption seams used by deterministic protocol tests. */
export interface SetupStepRunHooks {
  readonly afterRunning?: (step: SetupStepJournalEntry) => void | Promise<void>;
  readonly afterCommand?: (step: SetupStepJournalEntry) => void | Promise<void>;
  readonly afterCompleted?: (
    step: SetupStepJournalEntry,
  ) => void | Promise<void>;
}

/** The commands this pass ran and skipped. */
export interface SetupStepRunResult {
  readonly ran: readonly string[];
  readonly skipped: readonly string[];
}

/** One explicit decision for an ambiguous running step. */
export type SetupStepRecoveryDecision = "mark-complete" | "retry";

/** Outcome of one idempotent recovery decision. */
export type SetupStepRecoveryResult =
  | { readonly kind: "changed"; readonly step: SetupStepJournalEntry }
  | { readonly kind: "already-completed"; readonly step: SetupStepJournalEntry }
  | {
    readonly kind: "already-retryable";
    readonly step: SetupStepJournalEntry;
  };

const STEP_ID = /^step-[0-9a-f]{24}$/u;
const StepSchema = z.strictObject({
  id: z.string().regex(STEP_ID),
  command: z.string().min(1),
  occurrence: z.number().int().positive(),
  state: z.enum(["not_started", "running", "completed"]),
});
const JournalSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.setupStepJournal.version),
  steps: z.array(StepSchema),
});
const ENCODER = new TextEncoder();

/** Whether a CLI-supplied recovery identity has the stable journal shape. */
export function isSetupStepId(value: string): boolean {
  return STEP_ID.test(value);
}

/** Resolve the registered journal path or refuse without running a command. */
async function journalPath(cwd: string): Promise<string> {
  const path = await gitAdminStatePath(cwd, "worktreeSetupSteps");
  if (path === undefined) {
    throw new SetupStepJournalError(
      "Git could not resolve discern's worktree setup-step journal. No setup step ran. Retry inside the intended linked worktree.",
    );
  }
  return path;
}

/** Ensure the journal carries no duplicate identities. */
function validateUniqueIds(journal: SetupStepJournal, path: string): void {
  const ids = new Set<string>();
  for (const step of journal.steps) {
    if (ids.has(step.id)) {
      throw new SetupStepJournalError(
        `discern found duplicate setup-step identity ${step.id} in ${path}. ` +
          "No setup step ran. Repair or remove the invalid journal only after inspecting it, then retry.",
      );
    }
    ids.add(step.id);
  }
}

/** Persist one complete journal replacement through the shared atomic writer. */
async function writeJournal(
  path: string,
  journal: SetupStepJournal,
): Promise<void> {
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
    await atomicReplaceJson(path, journal, {
      mode: 0o600,
      exactMode: true,
      sync: true,
      space: 2,
      trailingNewline: true,
    });
  } catch (error) {
    throw new SetupStepJournalError(
      `discern could not atomically replace the worktree setup-step journal at ${path}. ` +
        `No later setup step ran. ${
          error instanceof Error ? error.message : String(error)
        }`,
      { cause: error },
    );
  }
}

/** Parse and validate JSON before treating its untrusted shape as journal data. */
function decodeJournal(
  text: string,
  path: string,
): SetupStepJournal {
  const version = inspectOnDiskJsonVersion("setupStepJournal", text);
  if (version.status === "newer") {
    throw new SetupStepJournalError(
      `${
        newerOnDiskFormatMessage("setupStepJournal", version.found)
      } No setup step ran.`,
    );
  }
  let journal: SetupStepJournal;
  try {
    journal = decodeJson(
      JournalSchema,
      text,
      `worktree setup-step journal at ${path}`,
    );
  } catch (error) {
    throw new SetupStepJournalError(
      `discern rejected the worktree setup-step journal at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }. No setup step ran. Inspect the invalid record before deciding whether to repair or remove it.`,
      { cause: error },
    );
  }
  validateUniqueIds(journal, path);
  return journal;
}

/** Stable SHA-256 identity of command text plus its duplicate occurrence. */
async function stableStepId(
  command: string,
  occurrence: number,
): Promise<string> {
  const bytes = ENCODER.encode(
    `discern-worktree-setup-step-v1\0${occurrence}\0${command}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `step-${
    [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

/** Build identities stable under unrelated reordering; duplicates use occurrence. */
export async function configuredSetupSteps(
  commands: readonly string[],
): Promise<SetupStepJournalEntry[]> {
  const occurrences = new Map<string, number>();
  const steps: SetupStepJournalEntry[] = [];
  for (const command of commands) {
    const occurrence = (occurrences.get(command) ?? 0) + 1;
    occurrences.set(command, occurrence);
    steps.push({
      id: await stableStepId(command, occurrence),
      command,
      occurrence,
      state: "not_started",
    });
  }
  return steps;
}

/** Read and validate the standing journal; absence alone means no prior state. */
export async function readSetupStepJournal(
  cwd: string,
): Promise<SetupStepJournalRead> {
  const path = await journalPath(cwd);
  let text: string | undefined;
  try {
    text = await readTextIfExists(path);
  } catch (error) {
    throw new SetupStepJournalError(
      `discern could not read the worktree setup-step journal at ${path}. ` +
        `No setup step ran. Retry after the file is readable. ${
          error instanceof Error ? error.message : String(error)
        }`,
      { cause: error },
    );
  }
  if (text === undefined) return { status: "missing", path };
  return { status: "recorded", path, journal: decodeJournal(text, path) };
}

/** Compare two journal payloads without relying on object identity. */
function sameJournal(
  left: SetupStepJournal,
  right: SetupStepJournal,
): boolean {
  if (left.steps.length !== right.steps.length) return false;
  return left.steps.every((step, index) => {
    const other = right.steps[index];
    return other !== undefined && step.id === other.id &&
      step.command === other.command && step.occurrence === other.occurrence &&
      step.state === other.state;
  });
}

/**
 * Reconcile configured identities with durable states. A removed running step
 * remains ambiguous and blocks instead of being silently discarded.
 */
function reconcileConfiguredJournal(
  configured: readonly SetupStepJournalEntry[],
  standingJournal: SetupStepJournal,
  path: string,
  newEntryState: SetupStepState = "not_started",
): SetupStepJournal {
  const expectedIds = new Set(configured.map((step) => step.id));
  const removedRunning = standingJournal.steps.find((step) =>
    step.state === "running" && !expectedIds.has(step.id)
  );
  if (removedRunning !== undefined) {
    throw new SetupStepJournalError(
      `discern found running setup step ${removedRunning.id}, but that identity is no longer present in [worktree.setup].steps. ` +
        "No setup step ran. Restore the matching configuration and make an explicit recovery decision before changing the step list.",
    );
  }

  const standing = new Map(
    standingJournal.steps.map((step) => [step.id, step]),
  );
  return {
    version: ON_DISK_FORMATS.setupStepJournal.version,
    steps: configured.map((step) => {
      const prior = standing.get(step.id);
      if (prior === undefined) return { ...step, state: newEntryState };
      if (
        prior.command !== step.command || prior.occurrence !== step.occurrence
      ) {
        throw new SetupStepJournalError(
          `discern found setup-step identity ${step.id} attached to different command evidence in ${path}. ` +
            "No setup step ran. Inspect the journal before deciding whether to repair or remove it.",
        );
      }
      return { ...step, state: prior.state };
    }),
  };
}

/** Reconcile configured commands with their durable journal, creating it when absent. */
async function configuredJournal(
  cwd: string,
  commands: readonly string[],
  missingState: SetupStepState = "not_started",
): Promise<{ path: string; journal: SetupStepJournal }> {
  const configured = await configuredSetupSteps(commands);
  const read = await readSetupStepJournal(cwd);
  if (read.status === "missing") {
    const journal: SetupStepJournal = {
      version: ON_DISK_FORMATS.setupStepJournal.version,
      steps: configured.map((step) => ({ ...step, state: missingState })),
    };
    await writeJournal(read.path, journal);
    return { path: read.path, journal };
  }

  const reconciled = reconcileConfiguredJournal(
    configured,
    read.journal,
    read.path,
    missingState,
  );
  if (!sameJournal(read.journal, reconciled)) {
    await writeJournal(read.path, reconciled);
  }
  return { path: read.path, journal: reconciled };
}

/** Replace one entry's state, preserving every other identity and order. */
async function replaceStepState(
  path: string,
  journal: SetupStepJournal,
  id: string,
  state: SetupStepState,
): Promise<{ journal: SetupStepJournal; step: SetupStepJournalEntry }> {
  let changed: SetupStepJournalEntry | undefined;
  const next: SetupStepJournal = {
    version: ON_DISK_FORMATS.setupStepJournal.version,
    steps: journal.steps.map((step) => {
      if (step.id !== id) return step;
      changed = { ...step, state };
      return changed;
    }),
  };
  if (changed === undefined) {
    throw new SetupStepJournalError(
      `discern could not find setup step ${id} in ${path}. No setup step ran. Re-run \`discern worktree setup\` to see the current recovery identity.`,
    );
  }
  await writeJournal(path, next);
  return { journal: next, step: changed };
}

/** The two bounded owner decisions served for an ambiguous running command. */
function ambiguousStepMessage(step: SetupStepJournalEntry): string {
  return `discern found setup step ${step.id} recorded as running and cannot prove whether its arbitrary shell command completed. ` +
    "This call did not replay it. After observing the command's external state, choose exactly one owner-confirmed recovery: " +
    `\`discern worktree setup --mark-step-complete ${step.id} --confirmed\` to preserve the observed effect, or ` +
    `\`discern worktree setup --retry-step ${step.id} --confirmed\` to run it again.`;
}

/**
 * Validate and reconcile the journal before setup performs any other effect.
 * A standing running record refuses here, so resource creation and env writes
 * cannot precede the owner's recovery decision on a resumed invocation.
 */
export async function preflightSetupStepJournal(
  cwd: string,
  commands: readonly string[],
  setupAlreadyComplete = false,
): Promise<void> {
  if (commands.length === 0) return;
  const prepared = await configuredJournal(
    cwd,
    commands,
    setupAlreadyComplete ? "completed" : "not_started",
  );
  const running = prepared.journal.steps.find((step) =>
    step.state === "running"
  );
  if (running !== undefined) {
    throw new SetupStepJournalError(ambiguousStepMessage(running));
  }
}

/** Run only not-started steps, persisting running before and completed after. */
export async function runJournaledSetupSteps(
  cwd: string,
  commands: readonly string[],
  runner: (step: SetupStepJournalEntry) => Promise<number>,
  hooks: SetupStepRunHooks = {},
): Promise<SetupStepRunResult> {
  if (commands.length === 0) return { ran: [], skipped: [] };
  const prepared = await configuredJournal(cwd, commands);
  let journal = prepared.journal;
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const step of [...journal.steps]) {
    if (step.state === "completed") {
      skipped.push(step.id);
      continue;
    }
    if (step.state === "running") {
      throw new SetupStepJournalError(ambiguousStepMessage(step));
    }
    const running = await replaceStepState(
      prepared.path,
      journal,
      step.id,
      "running",
    );
    journal = running.journal;
    await hooks.afterRunning?.(running.step);
    const code = await runner(running.step);
    if (code !== 0) {
      throw new SetupStepJournalError(
        `The worktree setup step failed: ${step.command} (identity ${step.id}) exited ${code} after its running state was recorded. ${
          ambiguousStepMessage(running.step)
        }`,
      );
    }
    await hooks.afterCommand?.(running.step);
    const completed = await replaceStepState(
      prepared.path,
      journal,
      step.id,
      "completed",
    );
    journal = completed.journal;
    ran.push(step.id);
    await hooks.afterCompleted?.(completed.step);
  }
  return { ran, skipped };
}

/** Apply one explicit, owner-confirmed and idempotent recovery decision. */
export async function recoverSetupStep(
  cwd: string,
  commands: readonly string[],
  stepId: string,
  decision: SetupStepRecoveryDecision,
  confirmed: boolean,
): Promise<SetupStepRecoveryResult> {
  if (!confirmed) {
    throw new SetupStepJournalError(
      `Recovering setup step ${stepId} requires --confirmed after the owner observes the command's external state. No journal state changed.`,
    );
  }
  if (!isSetupStepId(stepId)) {
    throw new SetupStepJournalError(
      `Setup step identity ${stepId} is invalid. No journal state changed. Re-run \`discern worktree setup\` to see the current recovery identity.`,
    );
  }
  const read = await readSetupStepJournal(cwd);
  if (read.status === "missing") {
    throw new SetupStepJournalError(
      `No setup-step journal records ${stepId} as running. No journal state changed. Run ordinary \`discern worktree setup\` instead.`,
    );
  }
  const configured = await configuredSetupSteps(commands);
  const journal = reconcileConfiguredJournal(
    configured,
    read.journal,
    read.path,
  );
  const step = journal.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new SetupStepJournalError(
      `Setup step ${stepId} is not configured in this worktree. No journal state changed. Re-run \`discern worktree setup\` to see the current recovery identity.`,
    );
  }
  if (step.state === "completed") {
    return { kind: "already-completed", step };
  }
  if (step.state === "not_started") {
    if (decision === "retry") {
      return { kind: "already-retryable", step };
    }
    throw new SetupStepJournalError(
      `Setup step ${stepId} is not recorded as running, so there is no observed effect to mark complete. No journal state changed. Run ordinary \`discern worktree setup\` instead.`,
    );
  }
  const nextState: SetupStepState = decision === "mark-complete"
    ? "completed"
    : "not_started";
  const changed = await replaceStepState(
    read.path,
    journal,
    stepId,
    nextState,
  );
  return { kind: "changed", step: changed.step };
}
