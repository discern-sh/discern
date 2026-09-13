/**
 * Effect policy for built-in command paths.
 *
 * This registry answers a different question from Logbook recording: it names
 * what an invocation can affect, which exclusion boundary it must hold, which
 * Git-write authority it must prove, and what preview contract applies. The
 * live CLI-tree parity guard makes this total over top-level, nested, and hidden
 * command paths.
 */

/** The semantic kinds of work a command may perform. */
export const OPERATION_EFFECT_CLASSES = [
  "observation",
  "discern-checkout-mutation",
  "discern-common-mutation",
  "discern-git-mutation",
  "project-command",
  "external-setup",
] as const;

/** One operation effect class. */
export type OperationEffectClass = (typeof OPERATION_EFFECT_CLASSES)[number];

/** The exclusion boundaries an invocation may hold while it performs effects. */
export const OPERATION_LOCK_BOUNDARIES = [
  "none",
  // The driver acquires concrete locks for each effect phase.
  "phased",
  "checkout",
  "common",
  "common-and-checkout",
  // The landing serializer plus the author's checkout; the short common
  // publication boundary joins per phase, never for the whole landing.
  "acceptance-and-checkout",
] as const;

/** One operation exclusion boundary. */
export type OperationLockBoundary = (typeof OPERATION_LOCK_BOUNDARIES)[number];

/** What the preview guard requires from this command path. */
export type OperationPreviewObligation =
  | "none"
  | "disclose"
  | "required";

/** How one invocation proves the predictable Git writes discern itself owns. */
export type OperationGitWriteAuthority =
  | "none"
  | "opaque"
  | "boundary-plan"
  | "boundary-plus-effect-plan";

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
  /** This command may write before a discern project root exists. */
  readonly lockWithoutProject?: boolean;
  readonly preview: OperationPreviewObligation;
  /** Centrally boundary-planned, optionally with a command's exact effect plan. */
  readonly gitWriteAuthority: OperationGitWriteAuthority;
}

/** Build one immutable policy while preserving literal field types. */
function policy(
  effects: readonly OperationEffectClass[],
  lock: OperationLockBoundary,
  preview: OperationPreviewObligation,
  options: Partial<
    Pick<
      OperationEffectPolicy,
      "lockWhen" | "lockWithoutProject" | "gitWriteAuthority"
    >
  > = {},
): OperationEffectPolicy {
  const ownsGitWrites = effects.includes("discern-git-mutation");
  const hasOpaqueEffects = effects.some((effect) =>
    effect === "project-command" || effect === "external-setup"
  );
  const gitWriteAuthority: OperationGitWriteAuthority = ownsGitWrites
    ? "boundary-plan"
    : hasOpaqueEffects
    ? "opaque"
    : "none";
  return {
    effects,
    lock,
    preview,
    ...options,
    gitWriteAuthority: options.gitWriteAuthority ?? gitWriteAuthority,
  };
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
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "phased",
    "required",
  ),
  await: OBSERVATION,
  checkpoints: OBSERVATION,
  config: OBSERVATION,
  "config array": OBSERVATION,
  "config explain": OBSERVATION,
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
    {
      lockWhen: { anyFlags: ["output"] },
      lockWithoutProject: true,
    },
  ),
  doctor: OBSERVATION,
  done: policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
    ],
    "checkout",
    "required",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
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
  "patterns seal": policy(
    ["discern-common-mutation", "discern-git-mutation"],
    "common",
    "required",
  ),
  "patterns archives": OBSERVATION,
  "patterns reset": policy(
    ["discern-common-mutation", "discern-git-mutation"],
    "common",
    "required",
  ),
  prepare: policy(
    ["discern-checkout-mutation", "project-command", "external-setup"],
    "checkout",
    "disclose",
  ),
  progress: OBSERVATION,
  queue: policy(
    ["project-command"],
    "none",
    "disclose",
  ),
  refresh: policy(
    ["discern-checkout-mutation", "external-setup"],
    "checkout",
    "required",
  ),
  scripts: policy(
    ["observation", "project-command"],
    "checkout",
    "disclose",
    { lockWhen: { hasOperands: true } },
  ),
  // The parent welcome is observation-only; the adjacent `setup begin` entry
  // retains the complete common/check-out/Git authority boundary for scaffolding.
  setup: OBSERVATION,
  "setup accept": policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "discern-git-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  "setup begin": policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "discern-git-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
    {
      lockWithoutProject: true,
      gitWriteAuthority: "boundary-plus-effect-plan",
    },
  ),
  "setup done": policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "common-and-checkout",
    "disclose",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  "setup step": OBSERVATION,
  "setup verify": OBSERVATION,
  skills: OBSERVATION,
  "skills eject": EXTERNAL_CHECKOUT_REQUIRED,
  "skills list": OBSERVATION,
  standards: policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
    ],
    "checkout",
    "required",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  "standards propose": policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
    ],
    "checkout",
    "required",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  start: policy(
    [
      "discern-common-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "common",
    "required",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  status: OBSERVATION,
  test: PROJECT_COMMAND,
  tidy: policy(
    ["discern-checkout-mutation"],
    "checkout",
    "required",
  ),
  triangle: OBSERVATION,
  uninstall: policy(
    [
      "discern-checkout-mutation",
      "discern-common-mutation",
      "discern-git-mutation",
      "external-setup",
    ],
    "common-and-checkout",
    "required",
  ),
  update: policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "checkout",
    "required",
  ),
  upgrade: policy(
    ["discern-checkout-mutation", "external-setup"],
    "checkout",
    "required",
    { lockWhen: { unlessFlags: ["check"] } },
  ),
  worktree: OBSERVATION,
  "worktree drop": policy(
    ["discern-common-mutation", "discern-git-mutation", "external-setup"],
    "common",
    "required",
  ),
  "worktree park": policy(
    ["discern-common-mutation", "discern-git-mutation", "external-setup"],
    "common",
    "required",
  ),
  "worktree ensure": policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "checkout",
    "disclose",
  ),
  "worktree rename": policy(
    ["discern-checkout-mutation", "discern-git-mutation"],
    "checkout",
    "required",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  "worktree hook": OBSERVATION,
  "worktree hook create": policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "checkout",
    "disclose",
    { gitWriteAuthority: "boundary-plus-effect-plan" },
  ),
  "worktree hook remove": policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "checkout",
    "disclose",
  ),
  "worktree prune": policy(
    ["discern-common-mutation", "discern-git-mutation", "external-setup"],
    "common",
    "required",
  ),
  "worktree setup": policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "project-command",
      "external-setup",
    ],
    "checkout",
    "required",
  ),
  "worktree teardown": policy(
    [
      "discern-checkout-mutation",
      "discern-git-mutation",
      "external-setup",
    ],
    "checkout",
    "required",
  ),
  enter: OBSERVATION,
} as const satisfies Readonly<Record<string, OperationEffectPolicy>>;

/**
 * Command paths whose canonical policy requires a faithful preview. The
 * operation registry, not the current CLI flags, owns this membership.
 */
export function previewRequiredOperationPaths(
  policies: Readonly<Record<string, OperationEffectPolicy>> = OPERATION_EFFECTS,
): string[] {
  return Object.entries(policies)
    .filter(([, policy]) => policy.preview === "required")
    .map(([path]) => path)
    .sort();
}

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
