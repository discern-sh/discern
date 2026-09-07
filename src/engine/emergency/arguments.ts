/** CLI and MCP validate the explicit emergency exchange through one argument contract. */
import type { AcceptData } from "../../shared/result_schemas.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { EMERGENCY_ACCEPT_ACTION } from "../../shared/verbs.ts";
import type { EmergencyOptions } from "./action.ts";

type EmergencyArguments =
  | {
    readonly kind: "options";
    readonly value: { emergency?: EmergencyOptions };
  }
  | { readonly kind: "refusal"; readonly result: DiscernResult<AcceptData> };

/** Require the explicit action before interpreting emergency fields; ordinary consent stays separate. */
export function emergencyArguments(
  action: string | undefined,
  fields: {
    readonly [
      K in "reason" | "confirmation" | "recover" | "confirmed" | "dryRun"
    ]?: EmergencyOptions[K] | undefined;
  },
): EmergencyArguments {
  let message: string | undefined;
  if (action !== undefined && action !== EMERGENCY_ACCEPT_ACTION) {
    message =
      "Use accept for ordinary landing or accept emergency for the explicit exception exchange.";
  } else if (
    action === undefined &&
    (fields.reason !== undefined || fields.confirmation !== undefined ||
      fields.recover !== undefined)
  ) {
    message =
      "Emergency fields require the explicit accept emergency action (MCP action: emergency). Prepare that plan before requesting approval.";
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
    value: action === EMERGENCY_ACCEPT_ACTION
      ? {
        emergency: {
          ...(fields.reason === undefined ? {} : { reason: fields.reason }),
          ...(fields.confirmation === undefined
            ? {}
            : { confirmation: fields.confirmation }),
          ...(fields.recover === undefined ? {} : { recover: fields.recover }),
          confirmed: fields.confirmed === true,
          dryRun: fields.dryRun === true,
        },
      }
      : {},
  };
}
