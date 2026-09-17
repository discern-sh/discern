/** CLI and MCP validate the explicit emergency exchange through one argument contract. */
import type { AcceptData } from "../../shared/result_schemas.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptRequest } from "../worktree/accept.ts";
import {
  ACCEPT_ACTIONS,
  EMERGENCY_ACCEPT_ACTION,
  QUEUE_ACCEPT_ACTION,
} from "../../shared/verbs.ts";
import type { EmergencyOptions } from "./action.ts";

type EmergencyArguments =
  | {
    readonly kind: "options";
    readonly value: { emergency?: EmergencyOptions; queueOnly?: true };
  }
  | { readonly kind: "refusal"; readonly result: DiscernResult<AcceptData> };

/** Require the explicit action before interpreting emergency fields; ordinary consent stays separate. */
export function emergencyArguments(
  action: string | undefined,
  fields: {
    readonly [
      K in
        | "reason"
        | "approvalToken"
        | "recover"
        | "confirmed"
        | "dryRun"
        | "prepare"
        | "preparationReceipt"
        | "met"
    ]?: EmergencyOptions[K] | undefined;
  },
): EmergencyArguments {
  let message: string | undefined;
  if (
    action !== undefined &&
    !ACCEPT_ACTIONS.includes(action as (typeof ACCEPT_ACTIONS)[number])
  ) {
    message =
      "Use accept for ordinary landing, accept queue to record the proven revision without landing, or accept emergency for the explicit exception exchange.";
  } else if (
    action !== EMERGENCY_ACCEPT_ACTION &&
    (fields.reason !== undefined || fields.approvalToken !== undefined ||
      fields.recover !== undefined || fields.prepare !== undefined ||
      fields.preparationReceipt !== undefined)
  ) {
    // `met` stays out of this refusal: an ordinary landing accepts it as the
    // integration-judgment continuation, while emergency preparation keeps
    // its own pairing rule below.
    message =
      "Emergency fields require the explicit accept emergency action (MCP action: emergency). Prepare that plan before requesting approval.";
  }
  if (action === EMERGENCY_ACCEPT_ACTION) {
    message ??= emergencyOptionError(fields);
  }
  if (message !== undefined) {
    return {
      kind: "refusal",
      result: {
        ok: false,
        verb: "accept",
        error: "invalid_arguments",
        message,
      },
    };
  }
  return {
    kind: "options",
    value: action === QUEUE_ACCEPT_ACTION
      ? { queueOnly: true }
      : action === EMERGENCY_ACCEPT_ACTION
      ? {
        emergency: {
          ...(fields.prepare === undefined ? {} : { prepare: fields.prepare }),
          ...(fields.preparationReceipt === undefined
            ? {}
            : { preparationReceipt: fields.preparationReceipt }),
          ...(fields.met === undefined ? {} : { met: fields.met }),
          ...(fields.reason === undefined ? {} : { reason: fields.reason }),
          ...(fields.approvalToken === undefined
            ? {}
            : { approvalToken: fields.approvalToken }),
          ...(fields.recover === undefined ? {} : { recover: fields.recover }),
          confirmed: fields.confirmed === true,
          dryRun: fields.dryRun === true,
        },
      }
      : {},
  };
}

/** How the ordinary accept declaration flags resolved. */
type AcceptDeclarationArguments =
  | { readonly kind: "ok"; readonly unmet?: { id: string; why: string } }
  | { readonly kind: "refusal"; readonly result: DiscernResult<AcceptData> };

/** Validate the CLI's --unmet/--why pairing and their exclusion from the
 * emergency exchange; emergency preparation records met conclusions only. */
export function acceptDeclarationArguments(
  emergency: boolean,
  unmet: string | undefined,
  why: string | undefined,
  compositionReceipt?: string,
): AcceptDeclarationArguments {
  const refuse = (message: string): AcceptDeclarationArguments => ({
    kind: "refusal",
    result: { ok: false, verb: "accept", error: "invalid_arguments", message },
  });
  if (
    emergency &&
    (unmet !== undefined || why !== undefined ||
      compositionReceipt !== undefined)
  ) {
    return refuse(
      "--unmet, --why, and --composition-receipt answer an ordinary landing's served integration question; emergency preparation records met conclusions only.",
    );
  }
  if ((unmet === undefined) !== (why === undefined)) {
    return refuse(
      unmet === undefined
        ? "--why belongs to --unmet <id>; pass both or neither."
        : '--unmet <id> requires its rationale: pass --why "<rationale>".',
    );
  }
  return unmet !== undefined && why !== undefined
    ? { kind: "ok", unmet: { id: unmet, why } }
    : { kind: "ok" };
}

/** Assemble the ordinary landing request's field set from parsed CLI
 * options — one builder, so the dispatcher stays a thin wire. */
export function acceptRequestFields(
  o: {
    readonly target?: string | undefined;
    readonly queueOnly?: boolean | undefined;
    readonly dryRun?: boolean | undefined;
    readonly confirmed?: boolean | undefined;
    readonly variance?: string[] | undefined;
    readonly approveStandard?: string[] | undefined;
    readonly met?: string[] | undefined;
    readonly compositionReceipt?: string | undefined;
  },
  unmet: { id: string; why: string } | undefined,
): Omit<AcceptRequest, "cliModel" | "signal"> {
  return {
    ...(o.target === undefined ? {} : { target: o.target }),
    ...(o.queueOnly ? { queueOnly: true } : {}),
    dryRun: o.dryRun ?? false,
    confirmed: o.confirmed ?? false,
    variance: o.variance ?? [],
    approveStandard: o.approveStandard ?? [],
    met: o.met ?? [],
    ...(unmet === undefined ? {} : { unmet }),
    ...(o.compositionReceipt === undefined
      ? {}
      : { compositionReceipt: o.compositionReceipt }),
  };
}

/** Preparation, owner confirmation, and transition recovery are separate invocations. */
export function emergencyOptionError(options: {
  readonly prepare?: boolean | undefined;
  readonly preparationReceipt?: string | undefined;
  readonly met?: readonly string[] | undefined;
  readonly confirmed?: boolean | undefined;
  readonly approvalToken?: string | undefined;
  readonly recover?: string | undefined;
}): string | undefined {
  if (
    options.prepare &&
    (options.preparationReceipt !== undefined || options.confirmed ||
      options.approvalToken !== undefined || options.recover !== undefined)
  ) {
    return "Emergency preparation cannot be combined with a receipt, confirmation, or transition recovery. Prepare first, then review a separate integration plan.";
  }
  if (!options.prepare && options.met !== undefined) {
    return "Checkpoint declarations require accept emergency --prepare. They cannot accompany integration or recovery.";
  }
  if (
    options.preparationReceipt !== undefined && options.recover !== undefined
  ) {
    return "A preparation receipt belongs to a new plan; interrupted transitions use only their recorded recovery authority.";
  }
  return undefined;
}
