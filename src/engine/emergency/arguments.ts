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

/** The owner's per-item decisions, each confirmed by its exact id or token. */
type OwnerDecisionFields = {
  readonly [K in "variance" | "approveStandard"]?:
    | readonly string[]
    | undefined;
};

/** The ordinary landing's composition receipt, which no emergency takes. */
type CompositionFields = { readonly compositionReceipt?: string | undefined };

/** Require the explicit action before interpreting emergency fields; ordinary consent stays separate. */
export function emergencyArguments(
  action: string | undefined,
  fields:
    & {
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
          | "unmet"
      ]?: EmergencyOptions[K] | undefined;
    }
    & OwnerDecisionFields
    & CompositionFields,
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
    // `met` and `unmet` stay out of this refusal: an ordinary landing accepts
    // them as the integration-judgment continuation, while emergency
    // preparation keeps its own pairing rule below.
    message =
      "Emergency fields require the explicit accept emergency action (MCP action: emergency). Prepare that plan before requesting approval.";
  }
  if (action === EMERGENCY_ACCEPT_ACTION) {
    message ??= emergencyOptionError(fields);
    if (fields.compositionReceipt !== undefined) {
      message ??=
        "--composition-receipt (MCP: composition_receipt) answers an ordinary landing's question about combined code. An emergency composes nothing, so remove it.";
    }
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
          ...(fields.unmet === undefined ? {} : { unmet: fields.unmet }),
          ...(fields.reason === undefined ? {} : { reason: fields.reason }),
          ...(fields.approvalToken === undefined
            ? {}
            : { approvalToken: fields.approvalToken }),
          ...(fields.recover === undefined ? {} : { recover: fields.recover }),
          ...(fields.variance === undefined
            ? {}
            : { variance: fields.variance }),
          ...(fields.approveStandard === undefined
            ? {}
            : { approveStandard: fields.approveStandard }),
          confirmed: fields.confirmed === true,
          dryRun: fields.dryRun === true,
        },
      }
      : {},
  };
}

/** How the CLI's --unmet/--why pair resolved. */
type AcceptDeclarationArguments =
  | { readonly kind: "ok"; readonly unmet?: { id: string; why: string } }
  | { readonly kind: "refusal"; readonly result: DiscernResult<AcceptData> };

/** Pair the CLI's --unmet with its --why rationale; ordinary and emergency
 * answers share the pair, and each route decides where it applies. */
export function acceptDeclarationArguments(
  unmet: string | undefined,
  why: string | undefined,
): AcceptDeclarationArguments {
  if ((unmet === undefined) !== (why === undefined)) {
    return {
      kind: "refusal",
      result: {
        ok: false,
        verb: "accept",
        error: "invalid_arguments",
        message: unmet === undefined
          ? "--why belongs to --unmet <id>; pass both or neither."
          : '--unmet <id> requires its rationale: pass --why "<rationale>".',
      },
    };
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
  readonly unmet?: { readonly id: string; readonly why: string } | undefined;
  readonly confirmed?: boolean | undefined;
  readonly approvalToken?: string | undefined;
  readonly recover?: string | undefined;
  readonly variance?: readonly string[] | undefined;
  readonly approveStandard?: readonly string[] | undefined;
}): string | undefined {
  if (
    (options.prepare || options.recover !== undefined) &&
    ((options.variance?.length ?? 0) > 0 ||
      (options.approveStandard?.length ?? 0) > 0)
  ) {
    return "The owner's variances and limit approvals belong to the emergency confirmation, beside --confirmed and --approval-token. Preparation and recovery take none.";
  }
  if (
    options.prepare &&
    (options.preparationReceipt !== undefined || options.confirmed ||
      options.approvalToken !== undefined || options.recover !== undefined)
  ) {
    return "Emergency preparation cannot be combined with a receipt, confirmation, or transition recovery. Prepare first, then review a separate integration plan.";
  }
  if (
    !options.prepare &&
    (options.met !== undefined || options.unmet !== undefined)
  ) {
    return "Checkpoint declarations require accept emergency --prepare. They cannot accompany integration or recovery.";
  }
  if (
    options.preparationReceipt !== undefined && options.recover !== undefined
  ) {
    return "A preparation receipt belongs to a new plan; interrupted transitions use only their recorded recovery authority.";
  }
  return undefined;
}
