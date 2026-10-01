/**
 * Landing, queueing, and landing permission: Land, Queue for landing,
 * Pre-authorize, and Revoke pre-authorization. Each is reviewed in session
 * from the lifecycle core's own preview, then run with the terminal.
 *
 * Landing permission is written only through the runtime seams declared
 * here, which the Desk's private production runtime fills: this module holds
 * no writer itself, so an agent's CLI and MCP surfaces can only read a grant.
 * Queueing without permission asks the grant question first, and Keep there
 * queues nothing; granting never queues or lands by itself, and offers those
 * as a separate next decision.
 */

import type {
  AcceptPreviewData,
  SubmissionRevision,
} from "../../../shared/result_schemas.ts";
import type { EffortGrantWrite } from "../../worktree/effort_grant_writer.ts";
import type { EnginePlan } from "../../../shared/result.ts";
import {
  buildDeskRows,
  deskExceptionArgvs,
  deskObservation,
  type DeskRow,
} from "../model.ts";
import { taskTitleOf } from "../desk_transitions.ts";
import type { DeskPlanFacts } from "../review_facts.ts";
import type {
  DeskExpected,
  DeskFlowStep,
  DeskOutcome,
  DeskReviewAlternative,
} from "../flow_types.ts";
import { reviewFor } from "../review.ts";
import {
  actionTarget,
  type DeskFlow,
  type DeskFlowContext,
  failedWith,
  offerCommand,
  offerFor,
  rebound,
  resultPlan,
  reviewOffer,
  stepOffer,
  stepRow,
  succeeded,
} from "./context.ts";

/** The runtime seams that read and write landing permission. */
export interface DeskLandingPermission {
  grantEffortPlan(
    path: string,
    branch: string,
  ): EnginePlan | Promise<EnginePlan>;
  grantEffort(
    path: string,
    branch: string,
  ): EffortGrantWrite | Promise<EffortGrantWrite>;
  clearEffortGrantPlan(path: string): EnginePlan | Promise<EnginePlan>;
  clearEffortGrant(path: string): boolean | Promise<boolean>;
}

/** Who approves a landing, from the preview's authority facts. */
function authorityFact(
  authority: AcceptPreviewData["authority"],
): NonNullable<DeskPlanFacts["authority"]> {
  if (authority.kind === "authorized") {
    return authority.source === "standing-grant"
      ? {
        kind: "standing",
        ...(authority.scopes === undefined ? {} : { scopes: authority.scopes }),
      }
      : { kind: "pre-authorized" };
  }
  return authority.covered_paths > 0
    ? { kind: "partial", covered: authority.covered_paths }
    : { kind: "conversation" };
}

/** The landing preview's facts in the Desk's terms. */
export function landingFacts(
  context: DeskFlowContext,
  preview: AcceptPreviewData | undefined,
): DeskPlanFacts {
  if (preview === undefined) return {};
  const lands = preview.lands;
  const exception = preview.variances !== undefined ||
      preview.standard_approvals !== undefined
    ? {
      variances: preview.variances ?? [],
      standardApprovals: preview.standard_approvals ?? 0,
    }
    : undefined;
  return {
    lands: {
      sha: lands.head,
      ...(lands.commits === undefined ? {} : { commits: lands.commits }),
      files: lands.files,
      insertions: lands.insertions,
      deletions: lands.deletions,
    },
    ...(preview.integrates === undefined ? {} : {
      integrates: preview.integrates.behind === undefined
        ? {}
        : { behind: preview.integrates.behind },
    }),
    authority: authorityFact(preview.authority),
    queueWalk: preview.queue_walk.map((queued) => ({
      title: taskTitleOf(context.state, queued.branch),
      branch: queued.branch,
    })),
    ...(preview.landing_in_progress === undefined ? {} : {
      landingInProgress: {
        title: taskTitleOf(context.state, preview.landing_in_progress.branch),
      },
    }),
    ...(preview.ignored_roots === undefined
      ? {}
      : { ignoredRoots: preview.ignored_roots }),
    endsGrant: preview.ends_grant,
    leavesQueue: preview.leaves_queue,
    ...(exception === undefined ? {} : { exception }),
    ...(preview.stale_declarations === undefined
      ? {}
      : { staleDeclarations: preview.stale_declarations }),
  };
}

/** Land: the acceptance preview, then the landing of its reviewed revision. */
const ACCEPT_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "accept", async (row) => {
      const ctx = await context.runtime.lifecycle(row.entry.path);
      const preview = await context.runtime.acceptPlan(ctx);
      const plan = resultPlan(preview);
      const facts = landingFacts(context, preview.data?.preview);
      return {
        ...(plan === undefined ? {} : { plan }),
        facts,
        core: {
          kind: "accept",
          ...(preview.data?.revision === undefined
            ? {}
            : { revision: preview.data.revision }),
        },
        bound: {
          "queue-walk": (facts.queueWalk ?? []).map((queued) => queued.branch)
            .join(" "),
        },
        running: `Landing ${row.task.name}`,
        follows: (facts.queueWalk ?? []).map((queued) => ({
          branch: queued.branch,
          title: queued.title,
        })),
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "accept");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "accept");
    const command = offerCommand(offer);
    const ctx = await context.runtime.lifecycle(row.entry.path);
    const revision = expected.core?.kind === "accept"
      ? expected.core.revision
      : undefined;
    const cliModel = context.cliModel;
    const result = await context.runtime.accept(ctx, {
      confirmed: true,
      ...(revision === undefined ? {} : { expected: revision }),
      ...(cliModel === undefined ? {} : { cliModel }),
    });
    if (result !== undefined && !result.ok) {
      return failedWith(context, step, "accept", result, command);
    }
    // The queue walk lands what followed it; say which landed too.
    const walked = (result?.data?.landings ?? []).filter((landing) =>
      !landing.selected && landing.status === "landed"
    ).map((landing) => taskTitleOf(context.state, landing.branch));
    return succeeded(
      command,
      [
        `Landed ${row.task.name} on ${context.config.repository.trunk}`,
        ...walked.map((title) => `${title} landed too`),
      ].join(" · "),
    );
  },
};

/** What queueing would record, and whether a grant must come first. */
async function submitPreview(
  context: DeskFlowContext,
  path: string,
): Promise<{
  readonly plan: EnginePlan | undefined;
  readonly revision: SubmissionRevision;
  readonly needsAuthority: boolean;
}> {
  const preview = await context.runtime.submit(path, { dryRun: true });
  const plan = resultPlan(preview);
  const revision = preview.data?.revision;
  const submission = preview.data?.submission;
  if (revision === undefined || submission === undefined) {
    throw new Error("The submission plan returned no revision.");
  }
  return {
    plan,
    revision,
    needsAuthority: submission.authority.kind !== "authorized",
  };
}

/**
 * Queue for landing: the queue preview. Without landing permission the
 * review asks the grant question first; Allow records it and asks the queue
 * question next, and Keep queues nothing.
 */
const SUBMIT_FLOW: DeskFlow = {
  review: async (context, step) => {
    const { row, offer } = stepOffer(context, step, "submit");
    const { plan, revision, needsAuthority } = await submitPreview(
      context,
      row.entry.path,
    );
    if (needsAuthority) {
      return reviewFor(actionTarget(context, row, offerFor(row, "grant")), {
        plan: await context.runtime.grantEffortPlan(
          row.entry.path,
          row.entry.branch,
        ),
        facts: { revision: revision.head },
        lead: [{
          mark: "warning",
          text: `${offer.label} asks this first; Keep queues nothing`,
          source: { kind: "status", field: "landing_authority" },
        }],
        running: `Pre-authorizing ${row.task.name}`,
      });
    }
    return reviewFor(actionTarget(context, row, offer), {
      ...(plan === undefined ? {} : { plan }),
      facts: { revision: revision.head },
      core: { kind: "submit", revision },
      running: `Queueing ${row.task.name} for landing`,
    });
  },
  apply: async (context, step, expected) => {
    const action = expected.core?.kind === "submit" ? "submit" : "grant";
    const changed = await rebound(context, step, expected, action);
    if (changed !== undefined) return changed;
    const row = stepRow(context, step);
    if (expected.core?.kind !== "submit") {
      await context.runtime.grantEffort(row.entry.path, row.entry.branch);
      return {
        ...succeeded(
          offerCommand(offerFor(row, "grant")),
          `Pre-authorized ${row.task.name}`,
        ),
        next: step,
      };
    }
    const command = offerCommand(offerFor(row, "submit"));
    const result = await context.runtime.submit(row.entry.path, {
      expected: expected.core.revision,
    });
    return result.ok
      ? succeeded(command, result.message ?? `Queued ${row.task.name}`)
      : failedWith(context, step, "submit", result, command);
  },
};

/** Whether the granted task can now land or join the queue. */
async function grantedOffers(
  context: DeskFlowContext,
  row: DeskRow,
): Promise<boolean> {
  const refreshed = (await context.runtime.status(context.root)).data;
  if (refreshed === undefined) return false;
  const granted = buildDeskRows(
    refreshed.fleet ?? [],
    new Map(),
    new Map(),
    deskObservation(refreshed, {
      trunk: context.config.repository.trunk,
      nowMs: context.runtime.now(),
      exceptionArgvs: await deskExceptionArgvs(refreshed),
    }),
  ).find((candidate) =>
    candidate.entry.path === row.entry.path &&
    candidate.entry.branch === row.entry.branch
  );
  return granted?.decision.actions.some((offer) =>
    (offer.action === "accept" || offer.action === "submit") &&
    offer.availability === "enabled"
  ) ?? false;
}

/** After a grant: land now, queue, or leave it; nothing happens by default. */
function grantedReview(
  context: DeskFlowContext,
  step: DeskFlowStep,
): ReturnType<DeskFlow["review"]> {
  const row = stepRow(context, step);
  const grant = row.decision.actions.find((offer) => offer.action === "grant");
  const alternatives = row.decision.actions.flatMap(
    (offer): DeskReviewAlternative[] =>
      (offer.action === "accept" || offer.action === "submit") &&
        offer.availability === "enabled"
        ? [{
          id: offer.action,
          label: offer.label,
          ...(offer.key === undefined ? {} : { key: offer.key }),
          intent: {
            kind: "action",
            action: offer.action,
            id: step.kind === "action" ? step.taskId : "",
          },
        }]
        : [],
  );
  return Promise.resolve(
    reviewFor(
      actionTarget(context, row, grant ?? offerFor(row, "revoke_grant")),
      {
        question: `Pre-authorized ${row.task.name}. What next?`,
        lead: [{
          mark: "keeps",
          text: "Nothing lands or joins the queue until you choose",
          source: { kind: "status", field: "landing_authority" },
        }],
        noConfirm: true,
        safeLabel: "Done",
        footnote: "Done leaves it pre-authorized and not queued.",
        alternatives,
      },
    ),
  );
}

/** Pre-authorize: the grant's plan, then the grant and a separate next decision. */
const GRANT_FLOW: DeskFlow = {
  review: (context, step) =>
    step.stage === "granted"
      ? grantedReview(context, step)
      : reviewOffer(context, step, "grant", async (row) => ({
        plan: await context.runtime.grantEffortPlan(
          row.entry.path,
          row.entry.branch,
        ),
        running: `Pre-authorizing ${row.task.name}`,
      })),
  apply: async (context, step, expected): Promise<DeskOutcome> => {
    const changed = await rebound(context, step, expected, "grant");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "grant");
    await context.runtime.grantEffort(row.entry.path, row.entry.branch);
    return {
      ...succeeded(offerCommand(offer), `Pre-authorized ${row.task.name}`),
      ...(await grantedOffers(context, row)
        ? { next: { ...step, stage: "granted" as const } }
        : {}),
    };
  },
};

/** Revoke pre-authorization: the cleanup's plan, then the cleanup. */
const REVOKE_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "revoke_grant", async (row) => ({
      plan: await context.runtime.clearEffortGrantPlan(row.entry.path),
      running: `Revoking pre-authorization for ${row.task.name}`,
    })),
  apply: async (context, step, expected: DeskExpected) => {
    const changed = await rebound(context, step, expected, "revoke_grant");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "revoke_grant");
    await context.runtime.clearEffortGrant(row.entry.path);
    return succeeded(
      offerCommand(offer),
      `Revoked pre-authorization for ${row.task.name}`,
    );
  },
};

/** The landing family's flows, by registry action. */
export const LANDING_FLOWS = {
  accept: ACCEPT_FLOW,
  submit: SUBMIT_FLOW,
  grant: GRANT_FLOW,
  revoke_grant: REVOKE_FLOW,
} as const satisfies Readonly<Record<string, DeskFlow>>;
