/** CLI and MCP select acceptance actions through the same argument contract. */
import {
  type QueueControl,
  QueueControlSchema,
} from "../../shared/queue_control.ts";
import { emergencyArguments } from "../emergency/arguments.ts";

interface QueueArguments {
  readonly reconcile?: boolean;
  readonly control?: QueueControl;
  readonly order?: string[];
  readonly expected?: string;
  readonly target?: string;
  readonly reclaim?: string;
}

type AcceptanceArguments =
  | Extract<ReturnType<typeof emergencyArguments>, { kind: "refusal" }>
  | {
    readonly kind: "options";
    readonly value:
      & QueueArguments
      & Extract<ReturnType<typeof emergencyArguments>, { kind: "options" }>[
        "value"
      ];
  };

/** Normalize transport fields without granting authority or mutating the queue. */
export function acceptanceArguments(
  action: string | undefined,
  fields:
    & Parameters<typeof emergencyArguments>[1]
    & {
      readonly [K in Exclude<keyof QueueArguments, "control">]?:
        | QueueArguments[K]
        | undefined;
    },
): AcceptanceArguments {
  const control = QueueControlSchema.safeParse(action);
  const emergency = emergencyArguments(
    control.success ? undefined : action,
    fields,
  );
  if (emergency.kind === "refusal") return emergency;
  return {
    kind: "options",
    value: {
      ...emergency.value,
      ...(control.success ? { control: control.data } : {}),
      ...(fields.reconcile === undefined
        ? {}
        : { reconcile: fields.reconcile }),
      ...(fields.order === undefined ? {} : { order: fields.order }),
      ...(fields.expected === undefined ? {} : { expected: fields.expected }),
      ...(fields.target === undefined ? {} : { target: fields.target }),
      ...(fields.reclaim === undefined ? {} : { reclaim: fields.reclaim }),
    },
  };
}
