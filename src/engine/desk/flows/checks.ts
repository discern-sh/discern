/**
 * Run checks and Update from main: each reviewed in session from its core's
 * own dry-run plan, held to its binding, then run with the terminal. A
 * failure becomes a result sheet that says what stopped and what is
 * unchanged.
 */

import { WorktreeGitError } from "../../worktree/lifecycle.ts";
import { failureSheet } from "../review.ts";
import {
  type DeskFlow,
  failedWith,
  offerCommand,
  rebound,
  resultPlan,
  reviewOffer,
  stepOffer,
  succeeded,
} from "./context.ts";

/** Run checks: the gate's own dry-run plan, then the gate. */
const DONE_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "done", async (row) => {
      const cliModel = context.cliModel;
      if (cliModel === undefined) {
        throw new Error(
          "Running checks from the desk needs the live CLI model.",
        );
      }
      const plan = resultPlan(
        await context.runtime.donePlan(row.entry.path, cliModel),
      );
      return {
        ...(plan === undefined ? {} : { plan }),
        handoff: `Running checks on ${row.task.name}`,
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "done");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "done");
    const cliModel = context.cliModel;
    if (cliModel === undefined) {
      throw new Error("Running checks from the desk needs the live CLI model.");
    }
    const command = offerCommand(offer);
    const result = await context.runtime.done(row.entry.path, cliModel);
    return result.ok
      ? succeeded(command, `Checks passed on ${row.task.name} · Proof recorded`)
      : failedWith(context, step, "done", result, command);
  },
};

/** Update from main: the update's dry-run plan, then the merge. */
const UPDATE_FLOW: DeskFlow = {
  review: (context, step) =>
    reviewOffer(context, step, "update", async (row) => {
      const ctx = await context.runtime.lifecycle(row.entry.path);
      const plan = resultPlan(await context.runtime.updatePlan(ctx));
      return {
        ...(plan === undefined ? {} : { plan }),
        handoff:
          `Updating ${row.task.name} from ${context.config.repository.trunk}`,
      };
    }),
  apply: async (context, step, expected) => {
    const changed = await rebound(context, step, expected, "update");
    if (changed !== undefined) return changed;
    const { row, offer } = stepOffer(context, step, "update");
    const command = offerCommand(offer);
    const trunk = context.config.repository.trunk;
    try {
      await context.runtime.update(
        await context.runtime.lifecycle(row.entry.path),
        {},
      );
    } catch (error) {
      if (!(error instanceof WorktreeGitError)) throw error;
      const title = `${row.task.name} wasn't updated`;
      return {
        command,
        ok: false,
        message: { tone: "danger", text: title },
        result: {
          ...failureSheet(title, error.message, command),
          taskId: step.kind === "action" ? step.taskId : "",
        },
      };
    }
    return succeeded(command, `Updated ${row.task.name} from ${trunk}`);
  },
};

/** The checks family's flows, by registry action. */
export const CHECKS_FLOWS = {
  done: DONE_FLOW,
  update: UPDATE_FLOW,
} as const satisfies Readonly<Record<string, DeskFlow>>;
