/**
 * Reads the Desk performs for readers and the selected-item slot: a task's
 * review evidence for View changes, a parked branch's commits, a landing's
 * stored Proof, Project Script discovery, and a task's agent and script
 * capabilities. Each read reports its own failure instead of an empty view.
 */

import { commandEvidence } from "../../../shared/command_evidence.ts";
import type { DiscernConfig } from "../../../shared/config_schema.ts";
import { parsePorcelainZ, splitNulRecords } from "../../../shared/git_paths.ts";
import type { DeskProjectScriptInventory } from "../../project_scripts.ts";
import {
  buildAgentLaunches,
  type DeskCapabilities,
  type DeskRow,
} from "../model.ts";
import type { DeskChangesEvidence, DeskReviewFile } from "../contracts.ts";
import {
  type NumstatMagnitude,
  parseNumstat,
  reviewGitRead,
} from "../review_evidence.ts";
import { deskLiteral } from "../text.ts";
import { branchTitle } from "../desk_transitions.ts";
import type { DeskFlowContext } from "./context.ts";

/** Map a Git status token to the package FileChange vocabulary. */
function fileDisposition(token: string): DeskReviewFile["disposition"] {
  return token.includes("A") || token === "??"
    ? "added"
    : token.includes("D")
    ? "removed"
    : "updated";
}

/** Combine committed name-status and uncommitted porcelain into one path set. */
function reviewFiles(
  nameStatus: string,
  porcelain: string,
  numstat: Map<string, NumstatMagnitude>,
): DeskReviewFile[] {
  const files = new Map<string, DeskReviewFile>();
  const nameStatusFields = splitNulRecords(nameStatus);
  for (let index = 0; index + 1 < nameStatusFields.length; index += 2) {
    const token = nameStatusFields[index] ?? "M";
    const path = nameStatusFields[index + 1];
    if (path === undefined || path === "") continue;
    const magnitude = numstat.get(path);
    files.set(path, {
      path,
      disposition: fileDisposition(token),
      ...(magnitude?.added === undefined ? {} : { added: magnitude.added }),
      ...(magnitude?.removed === undefined
        ? {}
        : { removed: magnitude.removed }),
      uncommitted: false,
    });
  }
  for (const entry of parsePorcelainZ(porcelain)) {
    const previous = files.get(entry.path);
    files.set(entry.path, {
      path: entry.path,
      disposition: fileDisposition(entry.status),
      ...(previous?.added === undefined ? {} : { added: previous.added }),
      ...(previous?.removed === undefined ? {} : { removed: previous.removed }),
      uncommitted: true,
    });
  }
  return [...files.values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

/** Gather a complete read-only review of one task's checkout. */
export async function readChanges(
  context: DeskFlowContext,
  row: DeskRow,
): Promise<DeskChangesEvidence> {
  const { runtime } = context;
  const trunk = context.config.repository.trunk;
  const cwd = row.entry.path;
  const [proof, editorResult, commits, numstat, names, porcelain] =
    await Promise.all([
      runtime.proof(cwd),
      runtime.editor(cwd),
      reviewGitRead(
        runtime,
        cwd,
        ["log", "--format=%h %s", "--no-decorate", `${trunk}..HEAD`],
        "Commit history could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["diff", "--numstat", "-z", "--no-renames", `${trunk}...HEAD`],
        "Diffstat could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["diff", "--name-status", "-z", "--no-renames", `${trunk}...HEAD`],
        "Changed paths could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["status", "--porcelain=v1", "-z"],
        "Uncommitted paths could not be read",
      ),
    ]);
  const magnitudes = parseNumstat(numstat.output);
  const summed = [...magnitudes.values()].reduce<
    { added: number; removed: number }
  >(
    (total, value) => ({
      added: total.added + (value.added ?? 0),
      removed: total.removed + (value.removed ?? 0),
    }),
    { added: 0, removed: 0 },
  );
  const proofData = proof.proof_data;
  return {
    trunk,
    proof,
    commits: commits.output,
    files: reviewFiles(names.output, porcelain.output, magnitudes),
    insertions: proofData?.insertions ?? summed.added,
    deletions: proofData?.deletions ?? summed.removed,
    failures: [commits, numstat, names, porcelain].flatMap((read) =>
      read.failure === undefined ? [] : [read.failure]
    ),
    diffCommand: commandEvidence([
      "git",
      "diff",
      "--no-ext-diff",
      "--color=always",
      `${trunk}...HEAD`,
    ]),
    ...(editorResult.editor === undefined
      ? {}
      : { editor: editorResult.editor }),
    ...(editorResult.reason === undefined
      ? {}
      : { editorUnavailableReason: editorResult.reason }),
  };
}

/** A parked branch's commits beyond the trunk and the files they change. */
export async function readBranchCommits(
  context: DeskFlowContext,
  branch: string,
): Promise<{ markdown: string }> {
  const trunk = context.config.repository.trunk;
  const logArgs = ["log", "--oneline", "--decorate", `${trunk}..${branch}`];
  const diffArgs = ["diff", "--stat", `${trunk}...${branch}`];
  const [commits, diffstat] = await Promise.all([
    context.runtime.git(logArgs, context.root),
    context.runtime.git(diffArgs, context.root),
  ]);
  for (const result of [commits, diffstat]) {
    if (!result.success) {
      throw new Error(
        `Git could not read ${branch}: ${
          result.stderr.trim() || "no diagnostic"
        }`,
      );
    }
  }
  return {
    markdown: [
      `# ${deskLiteral(branchTitle(branch, context.state.data))}`,
      `Commits on ${deskLiteral(branch)} that are not on ${
        deskLiteral(trunk)
      }.`,
      "## Commits",
      deskLiteral(commits.stdout.trim() || "No commits ahead of the trunk."),
      `\`${commandEvidence(["git", ...logArgs])}\``,
      "## Changed files",
      deskLiteral(diffstat.stdout.trim() || "No changed files."),
      `\`${commandEvidence(["git", ...diffArgs])}\``,
    ].join("\n\n"),
  };
}

/** The Proof a recent landing recorded, in words. */
export async function readLandedProof(
  context: DeskFlowContext,
  ref: string,
): Promise<{ markdown: string }> {
  const task = context.state.data?.recent_completed_tasks?.find((candidate) =>
    `landed:${candidate.branch}@${candidate.completed_at}` === ref
  );
  if (task?.head === undefined) {
    throw new Error("This landing recorded no revision to read.");
  }
  const resolved = await context.runtime.git(
    ["rev-parse", "--verify", `${task.head}^{commit}`],
    context.root,
  );
  if (!resolved.success) {
    throw new Error(
      resolved.stderr.trim() || "The recorded revision could not be resolved.",
    );
  }
  const record = await context.runtime.landedProof(
    context.root,
    resolved.stdout.trim(),
  );
  if (record.status !== "valid") {
    throw new Error(
      `Stored record: ${record.status}.${
        "reason" in record ? ` ${record.reason}` : ""
      }${
        record.status === "unsupported"
          ? ` This build cannot read format ${record.format}.`
          : ""
      }`,
    );
  }
  return {
    markdown: [
      record.proof.markdown,
      ...(record.acceptance === undefined ? [] : [
        "## Landing evidence",
        [
          `Consent: ${deskLiteral(record.acceptance.consent.source)}${
            record.acceptance.consent.scopes === undefined
              ? ""
              : ` (${deskLiteral(record.acceptance.consent.scopes.join(", "))})`
          }.`,
          `Checkpoint exceptions: ${record.acceptance.variances.length}.`,
          `Approved standard changes: ${record.acceptance.standard_proposals.length}.`,
        ].join("  \n"),
      ]),
    ].join("\n\n"),
  };
}

/** One checkout's Project Scripts, or why none can run. */
export async function scriptInventory(
  context: DeskFlowContext,
  directory: string,
  config?: DiscernConfig,
): Promise<DeskProjectScriptInventory> {
  const discovery = await context.runtime.scripts(
    directory,
    config ?? await context.runtime.loadConfig(directory),
  );
  if ("directory" in discovery) return discovery;
  return {
    directory,
    scripts: discovery,
    ...(discovery.length === 0
      ? { unavailableReason: "No Project Scripts are available here." }
      : {}),
  };
}

/** A task's configured agents and its Project Scripts. */
export async function readCapabilities(
  context: DeskFlowContext,
  row: DeskRow,
): Promise<DeskCapabilities> {
  let config: DiscernConfig;
  try {
    config = await context.runtime.loadConfig(row.entry.path);
  } catch (error) {
    // discern-best-effort: desk-worktree-config-fallback
    const detail = error instanceof Error ? error.message : String(error);
    return {
      scripts: [],
      agentLaunches: [],
      capabilityError:
        `Task configuration at ${row.entry.path}/discern.toml could not be read (${detail}). Repair the file and refresh the desk.`,
    };
  }
  const [detected, inventory] = await Promise.all([
    context.runtime.detectAgents(),
    scriptInventory(context, row.entry.path, config),
  ]);
  return {
    scripts: inventory.scripts,
    ...(inventory.unavailableReason === undefined
      ? {}
      : { scriptsUnavailableReason: inventory.unavailableReason }),
    agentLaunches: buildAgentLaunches(config, detected),
  };
}
