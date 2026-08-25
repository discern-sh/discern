/**
 * Effect policy for built-in command paths.
 *
 * This registry answers a different question from Logbook recording: it names
 * what an invocation can affect, which exclusion boundary it must hold, and
 * what preview contract applies. The live CLI-tree parity guard makes this
 * total over top-level, nested, and hidden command paths.
 */

/** The semantic kinds of work a command may perform. */
export const OPERATION_EFFECT_CLASSES = [
  "observation",
  "discern-checkout-mutation",
  "discern-common-mutation",
  "project-command",
  "external-setup",
] as const;

/** One operation effect class. */
export type OperationEffectClass = (typeof OPERATION_EFFECT_CLASSES)[number];

/** The exclusion boundary an invocation must hold while it performs effects. */
export type OperationLockBoundary =
  | "none"
  | "checkout"
  | "common"
  | "common-and-checkout";

/** What a future preview guard must require from this command path. */
export type OperationPreviewObligation =
  | "none"
  | "disclose"
  | "required";

/** Invocation facts that can select the effectful form of a mixed command. */
export interface OperationInvocationFacts {
  /** Long flag names without their leading dashes or values. */
  readonly flags?: readonly string[];
  /** Whether a command-group runner received the child/target operand. */
  readonly hasOperands?: boolean;
  /** A plan-only invocation never needs an exclusion lock. */
  readonly dryRun?: boolean;
}

/** A condition under which a mixed command needs its declared lock. */
export interface OperationLockCondition {
  /** At least one named flag must be present. */
  readonly anyFlags?: readonly string[];
  /** None of these flags may be present. */
  readonly unlessFlags?: readonly string[];
  /** Operand presence must equal this value. */
  readonly hasOperands?: boolean;
}

/** One command path's durable effect policy. */
export interface OperationEffectPolicy {
  readonly effects: readonly OperationEffectClass[];
  readonly lock: OperationLockBoundary;
  /** Mixed read/write paths acquire only for their effectful invocation form. */
  readonly lockWhen?: OperationLockCondition;
  /** Installer/setup entry points use a path-keyed fallback before Git exists. */
  readonly allowWithoutRepository?: boolean;
  readonly preview: OperationPreviewObligation;
}

/** Build one immutable policy while preserving literal field types. */
function policy(
  effects: readonly OperationEffectClass[],
  lock: OperationLockBoundary,
  preview: OperationPreviewObligation,
  options: Pick<
    OperationEffectPolicy,
    "lockWhen" | "allowWithoutRepository"
  > = {},
): OperationEffectPolicy {
  return { effects, lock, preview, ...options };
}

const OBSERVATION = policy(["observation"], "none", "none");
const CHECKOUT_REQUIRED = policy(
  ["discern-checkout-mutation"],
  "checkout",
  "required",
);
const PROJECT_COMMAND = policy(
  ["project-command"],
  "checkout",
  "disclose",
);
const EXTERNAL_CHECKOUT_REQUIRED = policy(
  ["discern-checkout-mutation", "external-setup"],
  "checkout",
  "required",
);
const EXTERNAL_CHECKOUT_DISCLOSE = policy(
  ["discern-checkout-mutation", "project-command", "external-setup"],
  "checkout",
  "disclose",
);
const COMMON_REQUIRED = policy(
  ["discern-common-mutation"],
  "common",
  "required",
);
const EXTERNAL_COMMON_REQUIRED = policy(
  ["discern-common-mutation", "external-setup"],
  "common",
  "required",
);

/**
 * Every registered CLI command path. Command groups are present because their
 * bare invocations are live behavior too. Mixed paths keep every possible
 * effect in `effects`; `lockWhen` preserves concurrency for their observational
 * form without pretending the writer form is read-only.
 */
export const OPERATION_EFFECTS = {
  accept: policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "project-command",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
  ),
  await: OBSERVATION,
  checkpoints: OBSERVATION,
  config: OBSERVATION,
  "config array": OBSERVATION,
  "config get": OBSERVATION,
  "config has": OBSERVATION,
  "config keys": OBSERVATION,
  "config set": CHECKOUT_REQUIRED,
  "config set-job": CHECKOUT_REQUIRED,
  "config set-scope": CHECKOUT_REQUIRED,
  "config set-standard": CHECKOUT_REQUIRED,
  "config subsections": OBSERVATION,
  coupling: OBSERVATION,
  desk: OBSERVATION,
  docs: policy(
    ["observation", "discern-checkout-mutation"],
    "checkout",
    "disclose",
    { lockWhen: { anyFlags: ["output"] }, allowWithoutRepository: true },
  ),
  doctor: OBSERVATION,
  done: policy(
    ["discern-checkout-mutation", "project-command"],
    "checkout",
    "required",
  ),
  help: OBSERVATION,
  identity: OBSERVATION,
  impact: OBSERVATION,
  improvement: OBSERVATION,
  licenses: OBSERVATION,
  map: policy(
    ["observation", "discern-checkout-mutation"],
    "checkout",
    "disclose",
    { lockWhen: { anyFlags: ["output"] } },
  ),
  mcp: OBSERVATION,
  patterns: OBSERVATION,
  "patterns archive": COMMON_REQUIRED,
  "patterns archives": OBSERVATION,
  "patterns reset": COMMON_REQUIRED,
  prepare: policy(
    ["discern-checkout-mutation", "project-command", "external-setup"],
    "checkout",
    "disclose",
  ),
  preset: policy(
    ["discern-checkout-mutation", "external-setup"],
    "checkout",
    "required",
    { allowWithoutRepository: true },
  ),
  queue: policy(
    ["project-command"],
    "checkout",
    "disclose",
    { allowWithoutRepository: true },
  ),
  refresh: policy(
    ["discern-checkout-mutation", "external-setup"],
    "checkout",
    "required",
    { allowWithoutRepository: true },
  ),
  scripts: policy(
    ["observation", "project-command"],
    "checkout",
    "disclose",
    { lockWhen: { hasOperands: true }, allowWithoutRepository: true },
  ),
  setup: policy(
    [
      "observation",
      "discern-checkout-mutation",
      "discern-common-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
    {
      lockWhen: {
        anyFlags: [
          "agents",
          "allow-dirty",
          "branch-prefix",
          "brief",
          "config",
          "confirmed",
          "force",
          "map",
          "model",
          "name",
          "slug",
          "source-globs",
          "yes",
        ],
      },
      allowWithoutRepository: true,
    },
  ),
  "setup accept": policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
  ),
  "setup begin": policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
    { allowWithoutRepository: true },
  ),
  "setup done": policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "project-command",
      "external-setup",
    ],
    "common-and-checkout",
    "disclose",
  ),
  "setup step": OBSERVATION,
  "setup verify": OBSERVATION,
  skills: OBSERVATION,
  "skills eject": EXTERNAL_CHECKOUT_REQUIRED,
  "skills list": OBSERVATION,
  standards: policy(
    ["discern-checkout-mutation", "project-command"],
    "checkout",
    "required",
  ),
  start: policy(
    ["discern-common-mutation", "project-command", "external-setup"],
    "common",
    "required",
  ),
  status: OBSERVATION,
  test: PROJECT_COMMAND,
  tidy: policy(
    ["discern-checkout-mutation"],
    "checkout",
    "required",
    { allowWithoutRepository: true },
  ),
  triangle: OBSERVATION,
  uninstall: policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
    { allowWithoutRepository: true },
  ),
  update: policy(
    ["discern-checkout-mutation", "project-command", "external-setup"],
    "checkout",
    "required",
  ),
  upgrade: policy(
    ["discern-checkout-mutation", "external-setup"],
    "checkout",
    "required",
    {
      lockWhen: { unlessFlags: ["check"] },
      allowWithoutRepository: true,
    },
  ),
  worktree: OBSERVATION,
  "worktree drop": EXTERNAL_COMMON_REQUIRED,
  "worktree ensure": EXTERNAL_CHECKOUT_DISCLOSE,
  "worktree hook": OBSERVATION,
  "worktree hook create": EXTERNAL_CHECKOUT_DISCLOSE,
  "worktree hook remove": EXTERNAL_CHECKOUT_DISCLOSE,
  "worktree prune": EXTERNAL_COMMON_REQUIRED,
  "worktree setup": policy(
    ["discern-checkout-mutation", "project-command", "external-setup"],
    "checkout",
    "required",
  ),
  "worktree teardown": EXTERNAL_CHECKOUT_REQUIRED,
  worktrees: OBSERVATION,
} as const satisfies Readonly<Record<string, OperationEffectPolicy>>;

/** True when every declared condition holds for one invocation. */
function lockConditionMatches(
  condition: OperationLockCondition,
  facts: OperationInvocationFacts,
): boolean {
  const flags = new Set(facts.flags ?? []);
  if (
    condition.anyFlags !== undefined &&
    !condition.anyFlags.some((flag) => flags.has(flag))
  ) {
    return false;
  }
  if (
    condition.unlessFlags !== undefined &&
    condition.unlessFlags.some((flag) => flags.has(flag))
  ) {
    return false;
  }
  return condition.hasOperands === undefined ||
    condition.hasOperands === (facts.hasOperands ?? false);
}

/**
 * Resolve one invocation's lock requirement. Unknown command paths stay
 * unknown so the execution boundary can fail closed instead of guessing.
 */
export function operationEffectPolicy(
  command: string,
  facts: OperationInvocationFacts = {},
):
  | (OperationEffectPolicy & { readonly lock: OperationLockBoundary })
  | undefined {
  const policy = OPERATION_EFFECTS[command as keyof typeof OPERATION_EFFECTS];
  if (policy === undefined) return undefined;
  const lock = facts.dryRun === true ||
      (policy.lockWhen !== undefined &&
        !lockConditionMatches(policy.lockWhen, facts))
    ? "none"
    : policy.lock;
  return { ...policy, lock };
}
