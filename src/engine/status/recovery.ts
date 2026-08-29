/** Independent recovery observations for one registered fleet checkout. */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { statIfExists } from "../../shared/fs_presence.ts";
import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import {
  type FleetWorktree,
  registeredWorktreeOwnershipEvidence,
} from "../worktree/git.ts";
import type { IdentitySettings } from "../worktree/identity.ts";
import { readSetupStepJournal } from "../worktree/setup_step_journal.ts";

/** Observe checkout presence without treating a permission failure as absence. */
export async function fleetFilesystem(
  path: string,
): Promise<NonNullable<StatusFleetEntry["filesystem"]>> {
  try {
    const info = await statIfExists(path);
    if (info === undefined) return { state: "missing" };
    return { state: info.isDirectory ? "directory" : "other" };
  } catch (error) {
    return {
      state: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Explain an unavailable setup identity through one manual recovery route. */
function unavailableSetup(
  command: string,
  reason: string,
): NonNullable<StatusFleetEntry["setup"]> {
  return {
    state: "unavailable",
    marker: "unavailable",
    repair: { kind: "manual", command, reason },
  };
}

/** Explain an incomplete setup through one manual recovery route. */
function manualSetup(
  command: string,
  reason: string,
): NonNullable<StatusFleetEntry["setup"]> {
  return {
    state: "incomplete",
    marker: "missing",
    repair: { kind: "manual", command, reason },
  };
}

/** Read setup ownership and decide whether the idempotent setup core may retry. */
export async function fleetSetupEvidence(
  row: FleetWorktree,
  repoRoot: string,
  settings: IdentitySettings | undefined,
  configPresent: boolean,
): Promise<NonNullable<StatusFleetEntry["setup"]>> {
  if (settings === undefined) {
    return unavailableSetup(
      "discern doctor",
      "Worktree identity settings could not be read.",
    );
  }
  const ownership = await registeredWorktreeOwnershipEvidence(
    row.path,
    repoRoot,
    settings,
  );
  if (ownership === undefined) {
    return unavailableSetup(
      "git worktree repair",
      "Git could not resolve this registration's setup marker.",
    );
  }
  if (ownership.ready) return { state: "ready", marker: "present" };
  if (!configPresent) {
    return manualSetup(
      "discern doctor",
      "The checkout does not contain discern.toml.",
    );
  }

  let cfg: DiscernConfig;
  try {
    cfg = await loadConfig(row.path);
  } catch (error) {
    return manualSetup(
      "discern doctor",
      `The task configuration could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const read = await readSetupStepJournal(row.path);
    const journal = read.status === "missing"
      ? { status: "missing" as const, path: read.path, steps: [] }
      : {
        status: "recorded" as const,
        path: read.path,
        steps: read.journal.steps.map((step) => ({
          id: step.id,
          command: step.command,
          state: step.state,
        })),
      };
    const running = journal.steps.find((step) => step.state === "running");
    if (running !== undefined) {
      return {
        state: "incomplete",
        marker: "missing",
        journal,
        repair: {
          kind: "manual",
          command:
            `discern worktree setup --retry-step ${running.id} --confirmed`,
          reason:
            `Setup step ${running.id} is recorded as running. Confirm its external state before choosing retry or mark-complete.`,
        },
      };
    }
    if (read.status === "missing" && cfg.worktree.setup.steps.length > 0) {
      return {
        state: "incomplete",
        marker: "missing",
        journal,
        repair: {
          kind: "manual",
          command: "discern worktree setup --dry-run",
          reason:
            "The ready marker and setup-step journal are missing, so prior one-shot effects cannot be verified.",
        },
      };
    }
    return {
      state: "incomplete",
      marker: "missing",
      journal,
      repair: {
        kind: "retry",
        command: "discern worktree setup",
        reason:
          "No ambiguous setup step is recorded; the setup core can retry from this state.",
      },
    };
  } catch (error) {
    return {
      state: "incomplete",
      marker: "missing",
      journal: {
        status: "unavailable",
        steps: [],
        reason: error instanceof Error ? error.message : String(error),
      },
      repair: {
        kind: "manual",
        command: "discern worktree setup --dry-run",
        reason: "The setup-step journal could not be inspected.",
      },
    };
  }
}
