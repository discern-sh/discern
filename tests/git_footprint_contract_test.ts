/**
 * Frozen v1 Git-footprint contract.
 *
 * This table is deliberately hand-written. Changing any existing literal is a
 * contract-major event or requires an explicit migration; do not derive these
 * expectations from the runtime authorities they guard.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import {
  DISCERN_AUTHORED_COMMIT_SITES,
  discernCommitMessage,
} from "../src/shared/discern_commit.ts";
import {
  DISCERN_NO_ATTRIBUTION,
  discernAttributionEnabled,
} from "../src/shared/env.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_paths.ts";
import {
  GIT_CONVENTIONS,
  NO_ATTRIBUTION_EFFECTS,
} from "../src/shared/git_conventions.ts";
import { HINTS } from "../src/shared/hints.ts";
import { proofNoteAuthorEnvironment } from "../src/engine/gate/proof_notes.ts";
import { fakeEnv } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const FROZEN_V1_GIT_CONVENTIONS = {
  refs: {
    proof_notes: "refs/notes/discern",
    proof_notes_transport_reservation: "refs/notes/discern*",
    proof_notes_short: "discern",
    proof_notes_tracking_prefix: "refs/discern/remotes",
    proof_notes_tracking_reservation: "refs/discern/remotes/<remote>/notes*",
    drop_recovery_prefix: "refs/discern/recovery",
    candidate_prefix: "refs/discern/candidates",
    acceptance_transaction_prefix:
      "refs/worktree/discern/acceptance-transactions",
  },
  refspec_templates: {
    proof_notes_fetch:
      "+refs/notes/discern*:refs/discern/remotes/<remote>/notes*",
  },
  reflog_templates: {
    acceptance: "discern accept: <fast-forward|rollback> <branch>",
    acceptance_transaction:
      "discern accept transaction <id>: <fast-forward|rollback> <branch>",
    authored_commit: "discern authored commit/<uuid>",
  },
  config_keys: {
    proof_notes_fetch_remote: "discern.proofNotesFetchRemote",
    remote_fetch: "remote.<remote>.fetch",
    worktree_config_extension: "extensions.worktreeConfig",
    generated_merge_driver: "merge.discern-generated.driver",
  },
  branches: {
    worktree_prefix_default: "agent/",
    setup: "discern-setup",
    detached_fallback: "<branch>-<8-character-commit>",
  },
  worktree_root: {
    default_suffix: ".worktrees",
    default_template: "<repo>.worktrees/<name>",
  },
  managed_block: {
    begin: "# --- discern ---",
    end: "# --- /discern ---",
  },
  generated_marker_prefix: "# Generated automatically ",
  attributes: {
    generated_merge_driver: "discern-generated",
    generated_merge_assignment: "merge=discern-generated",
    markdown_diff_driver: "markdown",
    markdown_diff_assignment: "diff=markdown",
    linguist_generated: "linguist-generated",
  },
  machine: {
    name: "discern",
    email: "done@discern.sh",
    trailer: "Co-authored-by: discern <done@discern.sh>",
  },
  no_attribution_effects: {
    trigger: {
      environment_variable: "DISCERN_NO_ATTRIBUTION",
      active_when: "non-empty",
    },
    commit_trailer: { attributed: "included", unattributed: "omitted" },
    generated_marker: {
      attributed: "product-and-source",
      unattributed: "source-only",
    },
    proof_note_author: {
      attributed: "discern-machine",
      unattributed: "ambient-git-identity",
    },
    proof_record: { attributed: "recorded", unattributed: "recorded" },
  },
  bounds: {
    drop_recovery_refs: 32,
    retired_worktree_path_days: 90,
    retired_worktree_path_entries: 256,
  },
} as const;

const FROZEN_V1_GIT_ADMIN_STATE = {
  completionGrantClaims: [
    "discern/completion/grant-claims",
    "common",
    "directory",
    false,
  ],
  completionRecords: [
    "discern/completion/records",
    "common",
    "directory",
    false,
  ],
  completionPublication: [
    "discern/completion/publication.json",
    "common",
    "file",
    false,
  ],
  completionArtifacts: [
    "discern/completion/artifacts",
    "common",
    "directory",
    false,
  ],
  resources: ["discern/resources", "common", "directory", false],
  logbook: ["discern/logbook", "common", "directory", false],
  logbookArchives: [
    "discern/logbook-archives",
    "common",
    "directory",
    false,
  ],
  logbookRecovery: [
    "discern/logbook-recovery",
    "common",
    "directory",
    false,
  ],
  logbookLifecycleLock: [
    "discern/logbook-lifecycle.lock",
    "common",
    "file",
    false,
  ],
  validationHmacKey: [
    "discern/validation-hmac-key",
    "common",
    "file",
    false,
  ],
  crash: ["discern/crash", "common", "directory", false],
  testSlots: ["discern/test-slots", "common", "directory", false],
  deskTips: ["discern/desk/tips.json", "common", "file", false],
  deskPreferences: [
    "discern/desk/preferences.json",
    "common",
    "file",
    false,
  ],
  parkedTaskMetadata: [
    "discern/parked-tasks",
    "common",
    "directory",
    false,
  ],
  taskMetadata: ["discern/task-metadata.json", "worktree", "file", false],
  tempArtifactSweep: [
    "discern/temp-artifact-sweep",
    "common",
    "file",
    false,
  ],
  continuations: ["discern/continuations", "common", "directory", false],
  retiredWorktreePaths: [
    "discern/retired-worktree-paths",
    "common",
    "directory",
    false,
  ],
  dropRecoveryLock: [
    "discern/drop-recovery.lock",
    "common",
    "file",
    false,
  ],
  gateProof: ["discern/gate-proof", "worktree", "file", true],
  lastGateRun: ["discern/last-gate-run", "worktree", "file", true],
  standardMeasurements: [
    "discern/standard-measurements",
    "worktree",
    "file",
    true,
  ],
  standardMeasurementEvidence: [
    "discern/standard-measurement-evidence.json",
    "worktree",
    "file",
    true,
  ],
  standardLimitProposals: [
    "discern/standard-limit-proposals.json",
    "worktree",
    "file",
    true,
  ],
  standardLimitProposalTransaction: [
    "discern/standard-limit-proposal-transaction.json",
    "worktree",
    "file",
    true,
  ],
  ignoredBaseline: [
    "discern/ignored-baseline",
    "worktree",
    "file",
    false,
  ],
  checkpointOpenQuestions: [
    "discern/checkpoint-open-questions",
    "worktree",
    "file",
    false,
  ],
  effortGrant: ["discern/effort-grant", "worktree", "file", false],
  effortGrantClaims: [
    "discern/effort-grant-claims",
    "worktree",
    "directory",
    false,
  ],
  acceptanceTransaction: [
    "discern/acceptance-transaction.json",
    "worktree",
    "file",
    false,
  ],
  setupMachineryCommitEvidence: [
    "discern/setup-machinery-commit-evidence.json",
    "worktree",
    "file",
    false,
  ],
  worktreeSetupSteps: [
    "discern/worktree-setup-steps.json",
    "worktree",
    "file",
    false,
  ],
  worktreeReady: ["discern/worktree-ready", "worktree", "file", false],
  selfShim: ["discern/shim", "worktree", "directory", false],
} as const;

/** Project the live admin registry into the deliberately plain frozen shape. */
function projectedGitAdminState(): Record<string, readonly unknown[]> {
  return Object.fromEntries(
    Object.entries(GIT_ADMIN_STATE).map(([key, entry]) => [
      key,
      [entry.path, entry.scope, entry.kind, entry.validation],
    ]),
  );
}

Deno.test("the hand-written v1 Git contract pins every convention and admin path", () => {
  assertEquals(GIT_CONVENTIONS, FROZEN_V1_GIT_CONVENTIONS);
  assertEquals(projectedGitAdminState(), FROZEN_V1_GIT_ADMIN_STATE);
});

Deno.test("DISCERN_NO_ATTRIBUTION couples trailer, marker, and note author without suppressing Proof", () => {
  const cases = [
    { value: undefined, attributed: true },
    { value: "", attributed: true },
    { value: "1", attributed: false },
    { value: "source-only", attributed: false },
  ] as const;
  for (const { value, attributed } of cases) {
    const env = fakeEnv(
      value === undefined ? {} : { [DISCERN_NO_ATTRIBUTION]: value },
    );
    assertEquals(discernAttributionEnabled(env), attributed);
    const message = discernCommitMessage({
      site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
      values: undefined,
    }, env);
    assertEquals(message.includes("done@discern.sh"), attributed);
    const marker = generatedArtifactMarker("the source registry", env);
    assertEquals(marker.includes("discern.sh"), attributed);
    assertEquals(
      proofNoteAuthorEnvironment(env),
      attributed
        ? {
          GIT_AUTHOR_NAME: "discern",
          GIT_AUTHOR_EMAIL: "done@discern.sh",
          GIT_COMMITTER_NAME: "discern",
          GIT_COMMITTER_EMAIL: "done@discern.sh",
        }
        : undefined,
    );
  }
  assertEquals(NO_ATTRIBUTION_EFFECTS.proof_record, {
    attributed: "recorded",
    unattributed: "recorded",
  });
});

Deno.test("Proof-note publication is owner-only and never an agent next action", () => {
  const hint = HINTS["accept-publish-proof-note"];
  assertEquals(hint.audience, "owner");
  assertEquals(hint.category, "owner-attention");
  const text = hint.template(hint.example);
  assertStringIncludes(text, "The owner can share");
  assertStringIncludes(text, "git push origin refs/notes/discern");
});

Deno.test("production modules obtain reserved Git literals from git_conventions.ts", async () => {
  const forbidden = [
    "refs/notes/discern",
    "refs/discern/",
    "refs/worktree/discern",
    "done@discern.sh",
    "# --- discern ---",
    "merge.discern-generated.driver",
    "extensions.worktreeConfig",
  ] as const;
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/git_footprint_contract_test.ts#reserved-git-literals",
      universe: "authored-ts",
      narrow: {
        reason:
          "The Git-literal authority governs production modules; tests and generators may carry frozen fixtures and emitted artifacts.",
        include: (path) => path.startsWith("src/"),
      },
    })
  ) {
    if (rel === "src/shared/git_conventions.ts") continue;
    const lines = (await Deno.readTextFile(join(REPO_ROOT, rel))).split("\n");
    for (const [index, line] of lines.entries()) {
      for (const literal of forbidden) {
        if (line.includes(literal)) {
          offenders.push(`${rel}:${index + 1} ${JSON.stringify(literal)}`);
        }
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `reserved Git literals bypass git_conventions.ts:\n${offenders.join("\n")}`,
  );
});
