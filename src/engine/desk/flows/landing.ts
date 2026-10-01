/**
 * Landing, queueing, and landing permission: each reviewed in session from
 * the lifecycle core's own preview, then run with the terminal. Queueing
 * without permission asks the grant question as its own review first;
 * granting never queues or lands by itself, and offers those as a separate
 * next decision.
 */

import {
  DESK_ACTION_LABELS,
  labelName,
} from "../../../shared/desk_vocabulary.ts";
import {
  buildDeskRows,
  deskExceptionArgvs,
  deskObservation,
} from "../model.ts";
import type { DeskFlowStep, DeskPrepared } from "../flow_types.ts";
import type { EnginePlan } from "../../../shared/result.ts";
import type { SubmissionRevision } from "../../../shared/result_schemas.ts";
import {
  type DeskFlowContext,
  failedWith,
  offerCommand,
  offerContent,
  offerFor,
  resultPlan,
  reviewedAction,
  stepOffer,
  stepRow,
  succeeded,
  verifyTask,
} from "./context.ts";

type ActionStep = Extract<DeskFlowStep, { readonly kind: "action" }>;

/** Land: the acceptance preview, then the landing with its reviewed revision. */
export async function prepareAccept(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const { row, offer } = stepOffer(context, step, "accept");
  const ctx = await context.runtime.lifecycle(row.entry.path);
  const preview = await context.runtime.acceptPlan(ctx);
  const trunk = context.config.repository.trunk;
  const cliModel = context.cliModel;
  return reviewedAction(context, row, offer, {
    plan: resultPlan(preview),
    doing: `Landing ${row.task.name}`,
    run: async (command) => {
      const result = await context.runtime.accept(ctx, {
        confirmed: true,
        ...(preview.data?.revision === undefined
          ? {}
          : { expected: preview.data.revision }),
        ...(cliModel === undefined ? {} : { cliModel }),
      });
      return result !== undefined && !result.ok
        ? failedWith(command, `${row.task.name} didn't land`, result)
        : `Landed ${row.task.name} on ${trunk}`;
    },
  });
}

/** What queueing would record, and whether a grant must come first. */
interface SubmitPreview {
  readonly plan: EnginePlan | undefined;
  readonly revision: SubmissionRevision;
  readonly needsAuthority: boolean;
}

/** The queue-only preview: what joins the queue, and whether a grant comes first. */
async function submitPreview(
  context: DeskFlowContext,
  path: string,
): Promise<SubmitPreview> {
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

/** Queue for landing: the queue preview, then either the grant question or the queue entry. */
export async function prepareSubmit(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const { row, offer } = stepOffer(context, step, "submit");
  const { plan, revision, needsAuthority } = await submitPreview(
    context,
    row.entry.path,
  );
  const prepared = reviewedAction(context, row, offer, {
    plan,
    doing: `Queueing ${row.task.name} for landing`,
    run: async (command) => {
      const result = await context.runtime.submit(row.entry.path, {
        expected: revision,
      });
      return result.ok
        ? result.message ?? `Queued ${row.task.name}`
        : failedWith(command, `${row.task.name} wasn't queued`, result);
    },
  });
  return needsAuthority
    ? {
      ...prepared,
      confirm: { kind: "review", step: { ...step, stage: "grant" } },
    }
    : prepared;
}

/** The grant a queue entry asks for first; Keep queues nothing. */
export async function prepareSubmitGrant(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const row = stepRow(context, step);
  const grant = offerFor(row, "grant");
  const submit = offerFor(row, "submit");
  const { revision } = await submitPreview(context, row.entry.path);
  const plan = await context.runtime.grantEffortPlan(
    row.entry.path,
    row.entry.branch,
  );
  const command = offerCommand(submit);
  return {
    content: offerContent(grant, plan, {
      lines: [{
        mark: "changes",
        text: "Then queues this version for landing",
      }],
    }),
    confirm: {
      kind: "apply",
      handoff:
        `Pre-authorizing and queueing ${row.task.name} · output continues below`,
      apply: async () => {
        await verifyTask(context, row, "submit");
        resultPlan(
          await context.runtime.submit(row.entry.path, {
            dryRun: true,
            expected: revision,
          }),
        );
        await context.runtime.grantEffort(row.entry.path, row.entry.branch);
        const result = await context.runtime.submit(row.entry.path, {
          expected: revision,
        });
        return result.ok
          ? succeeded(command, result.message ?? `Queued ${row.task.name}`)
          : failedWith(command, `${row.task.name} wasn't queued`, result);
      },
    },
  };
}

/** Pre-authorize: the grant's plan, then the grant and a separate next decision. */
export async function prepareGrant(
  context: DeskFlowContext,
  step: ActionStep,
): Promise<DeskPrepared> {
  const { row, offer } = stepOffer(context, step, "grant");
  return reviewedAction(context, row, offer, {
    plan: await context.runtime.grantEffortPlan(
      row.entry.path,
      row.entry.branch,
    ),
    doing: `Pre-authorizing ${row.task.name}`,
    run: async (command) => {
      await context.runtime.grantEffort(row.entry.path, row.entry.branch);
      const followUp = await grantedOffers(
        context,
        row.entry.path,
        row.entry.branch,
      );
      return {
        ...succeeded(command, `Pre-authorized ${row.task.name}`),
        ...(followUp ? { next: { ...step, stage: "granted" as const } } : {}),
      };
    },
  });
}

/** Whether the granted task can now land or join the queue. */
async function grantedOffers(
  context: DeskFlowContext,
  path: string,
  branch: string,
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
  ).find((row) => row.entry.path === path && row.entry.branch === branch);
  return granted?.decision.actions.some((offer) =>
    (offer.action === "accept" || offer.action === "submit") &&
    offer.availability === "enabled"
  ) ?? false;
}

/** After a grant: land now, queue, or leave it; nothing happens by default. */
export function prepareGranted(
  context: DeskFlowContext,
  step: ActionStep,
): DeskPrepared {
  const row = stepRow(context, step);
  const land = row.decision.actions.find((offer) => offer.action === "accept");
  const queue = row.decision.actions.find((offer) => offer.action === "submit");
  return {
    content: {
      title: `Pre-authorized ${row.task.name}. What next?`,
      lines: [
        {
          mark: "keeps",
          text: "Nothing lands or joins the queue until you choose",
        },
        {
          mark: "changes",
          text: `${labelName(DESK_ACTION_LABELS.accept)} lands it now; ${
            labelName(DESK_ACTION_LABELS.submit)
          } lands it with the next landing`,
        },
      ],
      footnote: "Done leaves it pre-authorized and not queued.",
      safeLabel: "Done",
      confirmLabel: "Done",
      alternatives: [
        ...(land?.availability === "enabled"
          ? [{
            id: "land",
            label: land.label,
            ...(land.key === undefined ? {} : { key: land.key }),
            step: {
              ...step,
              action: "accept" as const,
              stage: "review" as const,
            },
          }]
          : []),
        ...(queue?.availability === "enabled"
          ? [{
            id: "queue",
            label: queue.label,
            step: {
              ...step,
              action: "submit" as const,
              stage: "review" as const,
            },
          }]
          : []),
      ],
    },
  };
}
