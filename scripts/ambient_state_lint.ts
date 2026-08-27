/**
 * Deno lint plugin keeping ambient state and host timing primitives at explicit
 * operation boundaries or behind injectable capabilities.
 */

/// <reference lib="deno.unstable" />

import {
  CLOCK_PRIMITIVE_BOUNDARIES,
  type ClockPrimitiveBoundary,
} from "../src/shared/clock.ts";
import {
  JITTER_PRIMITIVE_BOUNDARIES,
  type JitterPrimitiveBoundary,
  SCHEDULER_PRIMITIVE_BOUNDARIES,
  type SchedulerPrimitiveBoundary,
} from "../src/shared/scheduler.ts";
import {
  SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
  type SecureEntropyPrimitiveBoundary,
} from "../src/shared/entropy.ts";

const PLUGIN_NAME = "discern-ambient-state";
const READ_RULE_NAME = "no-hidden-ambient-read";
const MUTATION_RULE_NAME = "no-unregistered-env-mutation";
const CLOCK_RULE_NAME = "no-unregistered-clock-read";
const SCHEDULER_RULE_NAME = "no-unregistered-scheduler-operation";
const JITTER_RULE_NAME = "no-unregistered-scheduling-jitter";
const SECURE_ENTROPY_RULE_NAME = "no-unregistered-secure-entropy";

/** The exact ambient primitive used by one operation boundary. */
export type AmbientReadPrimitive = "cwd" | "env" | `env.${string}`;

/** One exact process-state read retained at a host boundary. */
export interface AmbientReadBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly primitive: AmbientReadPrimitive;
  readonly operation: string;
  readonly reason: string;
}

/** One exact process-environment mutation retained at a host boundary. */
export interface AmbientMutationBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly primitive: "env.delete" | "env.set";
  readonly operation: string;
  readonly reason: string;
}

/** Preserve stable literal ids while checking the ambient registry shape. */
function defineAmbientReadBoundaries<
  const Boundaries extends Readonly<Record<string, AmbientReadBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Preserve stable literal ids while checking the mutation registry shape. */
function defineAmbientMutationBoundaries<
  const Boundaries extends Readonly<Record<string, AmbientMutationBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Every non-defaulted direct environment or cwd read, one row per call site. */
export const AMBIENT_READ_BOUNDARIES = defineAmbientReadBoundaries({
  "canon-editor-port": {
    path: "scripts/canon_editor/server.ts",
    enclosingFunction: "startCanonEditor",
    primitive: "env.get",
    operation: "read the optional Canon Editor listening port",
    reason:
      "The standalone editor server composes its listening port from the host process before serving requests.",
  },
  "checkpoint-input-path": {
    path: "project/scripts/checkpoint_when_input.ts",
    enclosingFunction: "checkpointWhenInputFromEnvironment",
    primitive: "env.get",
    operation: "read the Gate-provided checkpoint input path",
    reason:
      "The executable checkpoint adapter reads the Gate-provided path to its invocation payload.",
  },
  "cli-install-home": {
    path: "scripts/cli_install.ts",
    enclosingFunction: "resolveCliDest",
    primitive: "env.get",
    operation: "read HOME while resolving the install destination",
    reason:
      "The standalone installer resolves its default binary destination from the operator process.",
  },
  "cli-install-path": {
    path: "scripts/cli_install.ts",
    enclosingFunction: "resolveCliDest",
    primitive: "env.get",
    operation: "read PATH while reporting destination visibility",
    reason:
      "The standalone installer reports whether its resolved destination is visible to the operator shell.",
  },
  "config-edit-plan-cwd": {
    path: "src/commands/config.ts",
    enclosingFunction: "applyEditPlan",
    primitive: "cwd",
    operation: "resolve an omitted config edit root",
    reason:
      "The config command is a CLI composition root that resolves an omitted project cwd.",
  },
  "dev-wrapper-path": {
    path: "tests/dev_wrapper_test.ts",
    enclosingFunction: "runWrapper",
    primitive: "env.get",
    operation: "preserve PATH for the wrapper child",
    reason:
      "The test harness preserves the operator PATH while constructing an isolated wrapper process.",
  },
  "docs-browser-path": {
    path: "tests/docs_test.ts",
    enclosingFunction: "fakeBrowserLauncher",
    primitive: "env.get",
    operation: "preserve PATH for the fake browser child",
    reason:
      "The documentation harness preserves the operator PATH while constructing its isolated launcher.",
  },
  "docs-root-cwd": {
    path: "src/commands/docs.ts",
    enclosingFunction: "runTree",
    primitive: "cwd",
    operation: "resolve the documentation map invocation root",
    reason:
      "The docs command anchors its tree projection at the invoking process cwd.",
  },
  "doctor-checks-cwd": {
    path: "src/commands/doctor.ts",
    enclosingFunction: "runChecks",
    primitive: "cwd",
    operation: "resolve an omitted diagnostic root",
    reason:
      "The doctor check composition root resolves an omitted project cwd before running probes.",
  },
  "doctor-command-cwd": {
    path: "src/commands/doctor.ts",
    enclosingFunction: "runDoctor",
    primitive: "cwd",
    operation: "fall back when repository discovery finds no root",
    reason:
      "The doctor command still reports useful diagnostics when root discovery falls back to the invoking cwd.",
  },
  "engine-checkpoint-fixture-path": {
    path: "tests/engine_checkpoints_gate_test.ts",
    enclosingFunction: "<module>",
    primitive: "env.get",
    operation: "preserve PATH for the checkpoint fixture child",
    reason:
      "The checkpoint integration harness preserves the operator PATH while running an isolated fixture child.",
  },
  "engine-desk-runtime-cwd": {
    path: "tests/engine_desk_runtime_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "anchor the Desk runtime probe",
    reason:
      "The integration test anchors a real runtime probe at the test process cwd.",
  },
  "engine-gate-timeout-fast-job-cwd": {
    path: "tests/engine_gate_timeout_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "run the within-budget watchdog fixture",
    reason:
      "The watchdog integration test runs its real child command from the invoking checkout.",
  },
  "engine-gate-timeout-unbounded-job-cwd": {
    path: "tests/engine_gate_timeout_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "run the disabled-watchdog fixture",
    reason:
      "The watchdog integration test runs its unbounded real child command from the invoking checkout.",
  },
  "engine-gate-timeout-zero-override-cwd": {
    path: "tests/engine_gate_timeout_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "run the zero timeout-override fixture",
    reason:
      "The timeout-override integration test runs its real child command from the invoking checkout.",
  },
  "engine-helper-path": {
    path: "tests/engine_helpers.ts",
    enclosingFunction: "engineEnv",
    primitive: "env.get",
    operation: "preserve PATH for engine fixture processes",
    reason:
      "The shared engine harness preserves the operator PATH when composing child environments.",
  },
  "engine-mcp-call-timeout": {
    path: "tests/engine_mcp_test.ts",
    enclosingFunction: "<module>",
    primitive: "env.get",
    operation: "read the MCP response timeout test override",
    reason:
      "The MCP harness inherits an explicit infrastructure timeout override from the surrounding test process.",
  },
  "engine-mcp-readiness-timeout": {
    path: "tests/engine_mcp_test.ts",
    enclosingFunction: "<module>",
    primitive: "env.get",
    operation: "read the MCP readiness timeout test override",
    reason:
      "The MCP harness inherits an explicit startup allowance override from the surrounding test process.",
  },
  "engine-setup-done-path": {
    path: "tests/engine_setup_done_test.ts",
    enclosingFunction: "withFakeAgentPath",
    primitive: "env.get",
    operation: "preserve PATH around a temporary agent executable",
    reason:
      "The setup harness preserves the operator PATH while inserting a temporary executable.",
  },
  "engine-setup-page-cwd": {
    path: "tests/engine_setup_pages_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "evaluate the setup page command from the checkout",
    reason:
      "The setup-page integration test evaluates its real command from the test process cwd.",
  },
  "feature-benefit-checkpoint-cwd": {
    path: "project/scripts/feature_benefit_currency_checkpoint.ts",
    enclosingFunction: "main",
    primitive: "cwd",
    operation: "anchor the feature-benefit Git inspection",
    reason:
      "The executable checkpoint runs its Git inspection against the invoking checkout cwd.",
  },
  "gate-execute-cwd": {
    path: "tests/gate_execute_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "bind the gate executor fixture root",
    reason:
      "The gate executor fixture deliberately binds its shared runner to the test process cwd.",
  },
  "jobs-runner-cwd": {
    path: "tests/jobs_runner_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "capture the job-runner fixture root",
    reason:
      "The job-runner harness captures one stable process cwd for all spawned fixture commands.",
  },
  "logbook-cli-ci-marker": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "cliDriverFacts",
    primitive: "env.get",
    operation: "read the conventional CI driver marker",
    reason:
      "The Logbook CLI records the process marker as advisory invocation context without retaining its value.",
  },
  "logbook-cli-operation-cwd": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "runClassifiedCliOperation",
    primitive: "cwd",
    operation: "begin a classified operation at the invoking checkout",
    reason:
      "The Logbook CLI anchors classified operation policy at the invoking process cwd.",
  },
  "logbook-cli-recording-cwd": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "recordedRun",
    primitive: "cwd",
    operation: "open the invocation recorder at the invoking checkout",
    reason:
      "The Logbook CLI opens the host-facing recorder before passing explicit roots into lower layers.",
  },
  "logbook-cli-spawned-by-marker": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "cliDriverFacts",
    primitive: "env.get",
    operation: "read the self-invocation provenance marker",
    reason:
      "The Logbook CLI records self-invocation provenance without retaining the process marker's value.",
  },
  "main-crash-cwd": {
    path: "src/main.ts",
    enclosingFunction: "exitWithCrashFrame",
    primitive: "cwd",
    operation: "locate the crash artifact from the failed process",
    reason:
      "The executable crash boundary resolves the invoking cwd before attempting its bounded artifact write.",
  },
  "mcp-ci-marker": {
    path: "src/engine/mcp/server.ts",
    enclosingFunction: "mcpDriverFacts",
    primitive: "env.get",
    operation: "read the conventional CI driver marker",
    reason:
      "The MCP server records the process marker as advisory invocation context without retaining its value.",
  },
  "mcp-dispatch-cwd": {
    path: "src/engine/mcp/server.ts",
    enclosingFunction: "dispatchToolCall",
    primitive: "cwd",
    operation: "resolve an omitted MCP project root",
    reason:
      "The MCP server resolves an omitted tool path at its host process boundary before dispatching the call.",
  },
  "preset-command-cwd": {
    path: "src/commands/preset.ts",
    enclosingFunction: "runPreset",
    primitive: "cwd",
    operation: "resolve the preset destination root",
    reason:
      "The preset command is the CLI composition root that resolves its destination from the invoking cwd.",
  },
  "preset-source-override": {
    path: "src/commands/preset.ts",
    enclosingFunction: "resolvePresetsDir",
    primitive: "env.get",
    operation: "read the development preset-source override",
    reason:
      "The preset command composes its explicit development source override at the host process boundary.",
  },
  "private-docs-checkout-root-cwd": {
    path: "project/scripts/ensure_private_docs.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "resolve the current checkout root reported by Git",
    reason:
      "The executable repository check compares the checkout cwd with Git's reported top level.",
  },
  "private-docs-git-query-cwd": {
    path: "project/scripts/ensure_private_docs.ts",
    enclosingFunction: "gitQuery",
    primitive: "cwd",
    operation: "anchor a private-docs Git query",
    reason:
      "The executable repository check runs each Git query against the invoking checkout cwd.",
  },
  "private-docs-main-root-cwd": {
    path: "project/scripts/ensure_private_docs.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "resolve Git's common directory from the checkout",
    reason:
      "The executable repository check resolves the shared Git root against the invoking cwd.",
  },
  "pty-process-path": {
    path: "tests/pty_process_test.ts",
    enclosingFunction: "fn",
    primitive: "env.get",
    operation: "preserve PATH for the pseudo-terminal child",
    reason:
      "The pseudo-terminal harness preserves the operator PATH while composing its child process.",
  },
  "public-doc-checkpoint-cwd": {
    path: "project/scripts/public_doc_checkpoint.ts",
    enclosingFunction: "main",
    primitive: "cwd",
    operation: "anchor the changed-public-document query",
    reason:
      "The executable checkpoint resolves changed public documents from the invoking checkout cwd.",
  },
  "setup-command-cwd": {
    path: "src/commands/setup.ts",
    enclosingFunction: "runSetupBegin",
    primitive: "cwd",
    operation: "resolve the setup destination root",
    reason:
      "The setup command resolves its destination at the CLI composition boundary.",
  },
  "setup-gitattributes-environment": {
    path: "src/commands/setup.ts",
    enclosingFunction: "assembleInitPlan",
    primitive: "env",
    operation: "supply process values to generated-attribute reconciliation",
    reason:
      "The setup plan composes process inputs before passing an explicit environment reader into reconciliation.",
  },
  "setup-page-tokens-environment": {
    path: "src/commands/setup.ts",
    enclosingFunction: "assembleInitPlan",
    primitive: "env",
    operation: "supply process values to generated setup tokens",
    reason:
      "The setup plan composes process inputs before rendering generated-file attribution tokens.",
  },
  "setup-verify-cwd": {
    path: "src/commands/setup_verify.ts",
    enclosingFunction: "runSetupVerify",
    primitive: "cwd",
    operation: "resolve the setup verification root",
    reason:
      "The setup verification command anchors its explicit structural probe at the invoking cwd.",
  },
  "setup-welcome-branch-cwd": {
    path: "src/commands/setup_welcome.ts",
    enclosingFunction: "runSetupWelcome",
    primitive: "cwd",
    operation: "probe for the setup branch in the invoking checkout",
    reason:
      "The setup welcome boundary inspects the invoking checkout before choosing onboarding copy.",
  },
  "setup-welcome-git-cwd": {
    path: "src/commands/setup_welcome.ts",
    enclosingFunction: "runSetupWelcome",
    primitive: "cwd",
    operation: "probe whether the invoking directory is a worktree",
    reason:
      "The setup welcome boundary runs its host Git probe against the invoking checkout cwd.",
  },
  "shell-picker-cwd-adapter": {
    path: "src/engine/worktree/shell_picker.ts",
    enclosingFunction: "cwd",
    primitive: "cwd",
    operation: "adapt the real process cwd for shell selection",
    reason:
      "The interactive shell picker owns the real-host dependency adapter supplied to its pure core.",
  },
  "site-design-system-path": {
    path: "scripts/site_local_design_system.ts",
    enclosingFunction: "main",
    primitive: "env.get",
    operation: "preserve PATH for the design-system child",
    reason:
      "The standalone design-system launcher composes the child PATH from the operator process.",
  },
  "site-development-port": {
    path: "site/dev.ts",
    enclosingFunction: "runLocalSite",
    primitive: "env.get",
    operation: "read the optional development-server port",
    reason:
      "The standalone development server composes its listening port from the host process.",
  },
  "site-production-port": {
    path: "site/main.ts",
    enclosingFunction: "<module>",
    primitive: "env.get",
    operation: "read the optional production-server port",
    reason:
      "The standalone production server composes its listening port from the host process.",
  },
  "site-specimen-port": {
    path: "site/specimens.ts",
    enclosingFunction: "runSpecimenPreview",
    primitive: "env.get",
    operation: "read the optional specimen-server port",
    reason:
      "The standalone specimen server composes its listening port from the host process.",
  },
  "subprocess-first-stdin-cwd": {
    path: "tests/subprocess_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "run the first real Git stdin fixture",
    reason:
      "The subprocess integration test exercises real cwd inheritance for one protocol-input command.",
  },
  "subprocess-second-stdin-cwd": {
    path: "tests/subprocess_test.ts",
    enclosingFunction: "<module>",
    primitive: "cwd",
    operation: "run the second real Git stdin fixture",
    reason:
      "The subprocess integration test exercises real cwd inheritance for the distinct protocol-input command.",
  },
  "terminal-capture-cwd": {
    path: "scripts/terminal_capture.ts",
    enclosingFunction: "parseOptions",
    primitive: "cwd",
    operation: "anchor terminal-capture repository discovery",
    reason:
      "The standalone capture tool anchors its repository discovery at the operator cwd.",
  },
  "uninstall-command-cwd": {
    path: "src/commands/uninstall.ts",
    enclosingFunction: "runUninstall",
    primitive: "cwd",
    operation: "resolve an omitted uninstall root",
    reason:
      "The uninstall command is a CLI composition root that resolves an omitted project cwd.",
  },
  "upgrade-command-cwd": {
    path: "src/commands/upgrade.ts",
    enclosingFunction: "runUpgrade",
    primitive: "cwd",
    operation: "resolve an omitted upgrade root",
    reason:
      "The upgrade command is a CLI composition root that resolves an omitted project cwd.",
  },
  "verb-dispatch-cwd": {
    path: "src/engine/dispatch.ts",
    enclosingFunction: "attachEngineCommands",
    primitive: "cwd",
    operation: "resolve an omitted command target",
    reason:
      "The dispatcher is the CLI process boundary that resolves command targets from the host cwd.",
  },
  "worktree-remove-helper-cwd": {
    path: "src/engine/dispatch.ts",
    enclosingFunction: "helperRemoveWorktree",
    primitive: "cwd",
    operation: "protect the invoking checkout during helper removal",
    reason:
      "The dispatcher passes the live process cwd into the bounded worktree-removal safety check.",
  },
});

/** Exact process-environment mutations that cannot be replaced by value input. */
export const AMBIENT_MUTATION_BOUNDARIES = defineAmbientMutationBoundaries({});

/** Registries consumed by one plugin instance. */
export interface AmbientStateRegistries {
  readonly reads: Readonly<Record<string, AmbientReadBoundary>>;
  readonly mutations: Readonly<Record<string, AmbientMutationBoundary>>;
  readonly clocks: Readonly<Record<string, ClockPrimitiveBoundary>>;
  readonly schedulers: Readonly<Record<string, SchedulerPrimitiveBoundary>>;
  readonly jitters: Readonly<Record<string, JitterPrimitiveBoundary>>;
  readonly secureEntropy: Readonly<
    Record<string, SecureEntropyPrimitiveBoundary>
  >;
}

/** Return a statically named property from dot or bracket access. */
function memberName(node: Deno.lint.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return node.property.type === "Literal" &&
      typeof node.property.value === "string"
    ? node.property.value
    : undefined;
}

/** Whether a member expression is a direct static property of `Deno`. */
function isDenoMember(
  node: Deno.lint.MemberExpression,
  property: string,
): boolean {
  return node.object.type === "Identifier" && node.object.name === "Deno" &&
    memberName(node) === property;
}

/** Whether a member expression is exactly `Deno.env`. */
function isDenoEnv(node: Deno.lint.Node): boolean {
  return node.type === "MemberExpression" && isDenoMember(node, "env");
}

/** Whether an unknown lint value is a traversable syntax node. */
function isNode(value: unknown): value is Deno.lint.Node {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && Array.isArray(record.range);
}

/** Return the lint runtime's attached parent when one exists. */
function parentNode(node: Deno.lint.Node): Deno.lint.Node | undefined {
  const parent = (node as unknown as Record<string, unknown>).parent;
  return isNode(parent) ? parent : undefined;
}

/** Classify one `Deno.env` member access without double-reporting its inner node. */
function envOperation(
  node: Deno.lint.MemberExpression,
): "delete" | "read" | "set" | undefined {
  if (isDenoEnv(node)) {
    const parent = parentNode(node);
    if (parent?.type === "MemberExpression" && parent.object === node) {
      return undefined;
    }
    return "read";
  }
  if (!isDenoEnv(node.object)) return undefined;
  const operation = memberName(node);
  return operation === "delete" || operation === "set" ? operation : "read";
}

/** Classify the exact direct process-state read represented by one member. */
function ambientReadPrimitive(
  node: Deno.lint.MemberExpression,
): AmbientReadPrimitive | undefined {
  if (isDenoEnv(node)) {
    const parent = parentNode(node);
    if (parent?.type === "MemberExpression" && parent.object === node) {
      return undefined;
    }
    return "env";
  }
  if (!isDenoEnv(node.object)) return undefined;
  const operation = memberName(node);
  if (
    operation === undefined || operation === "delete" || operation === "set"
  ) {
    return undefined;
  }
  return `env.${operation}`;
}

/** Whether `node` is a direct call to `Deno.cwd`. */
function isDenoCwdCall(node: Deno.lint.CallExpression): boolean {
  return node.callee.type === "MemberExpression" &&
    isDenoMember(node.callee, "cwd");
}

/** Whether the child range lies wholly within the parent range. */
function containsRange(
  parent: { readonly range: readonly [number, number] },
  child: { readonly range: readonly [number, number] },
): boolean {
  return parent.range[0] <= child.range[0] && parent.range[1] >= child.range[1];
}

/** Function parameters for the executable function forms that can own defaults. */
function functionParameters(
  node: Deno.lint.Node,
): readonly Deno.lint.Parameter[] | undefined {
  switch (node.type) {
    case "ArrowFunctionExpression":
    case "FunctionDeclaration":
    case "FunctionExpression":
      return node.params;
    default:
      return undefined;
  }
}

/**
 * Whether an ambient read is inside the right-hand side of a function parameter
 * default, including defaults nested inside object or array binding patterns.
 */
function isDefaultParameterRead(node: Deno.lint.Node): boolean {
  let current: Deno.lint.Node | undefined = node;
  let defaultValue: Deno.lint.AssignmentPattern | undefined;
  while (current !== undefined) {
    if (
      current.type === "AssignmentPattern" &&
      containsRange(current.right, node)
    ) {
      defaultValue = current;
    }
    const parameters = functionParameters(current);
    if (parameters !== undefined) {
      const parameterDefault = defaultValue;
      if (parameterDefault === undefined) return false;
      return parameters.some((parameter) =>
        containsRange(parameter, parameterDefault)
      );
    }
    current = parentNode(current);
  }
  return false;
}

/** Normalize a lint filename for suffix matching against repo-relative paths. */
function normalizedFilename(filename: string): string {
  return filename.replaceAll("\\", "/");
}

/** Whether a lint filename identifies one registered repo-relative module. */
function filenameMatches(filename: string, path: string): boolean {
  const normalized = normalizedFilename(filename);
  return normalized === path || normalized.endsWith(`/${path}`);
}

/** A stable authored name for the function surrounding one mutation. */
function enclosingFunction(node: Deno.lint.Node): string {
  let current: Deno.lint.Node | undefined = parentNode(node);
  while (current !== undefined) {
    if (current.type === "FunctionDeclaration") {
      return current.id?.name ?? "<anonymous function>";
    }
    if (current.type === "FunctionExpression") {
      if (current.id !== null) return current.id.name;
      const parent = parentNode(current);
      if (
        parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }
      if (parent?.type === "Property" && !parent.computed) {
        if (parent.key.type === "Identifier") return parent.key.name;
        if (
          parent.key.type === "Literal" &&
          typeof parent.key.value === "string"
        ) return parent.key.value;
      }
    }
    if (current.type === "ArrowFunctionExpression") {
      const parent = parentNode(current);
      if (
        parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }
      if (parent?.type === "Property" && !parent.computed) {
        if (parent.key.type === "Identifier") return parent.key.name;
        if (
          parent.key.type === "Literal" &&
          typeof parent.key.value === "string"
        ) return parent.key.value;
      }
    }
    if (current.type === "MethodDefinition" && !current.computed) {
      if (current.key.type === "Identifier") return current.key.name;
      if (
        current.key.type === "Literal" &&
        typeof current.key.value === "string"
      ) return current.key.value;
    }
    current = parentNode(current);
  }
  return "<module>";
}

/** Whether one exact ambient read is registered. */
function permitsRead(
  filename: string,
  node: Deno.lint.Node,
  primitive: AmbientReadPrimitive,
  boundaries: Readonly<Record<string, AmbientReadBoundary>>,
): boolean {
  const owner = enclosingFunction(node);
  return Object.values(boundaries).some((boundary) =>
    filenameMatches(filename, boundary.path) &&
    boundary.enclosingFunction === owner && boundary.primitive === primitive
  );
}

/** Whether one exact environment mutation is registered. */
function permitsMutation(
  filename: string,
  node: Deno.lint.MemberExpression,
  operation: "delete" | "set",
  boundaries: Readonly<Record<string, AmbientMutationBoundary>>,
): boolean {
  const owner = enclosingFunction(node);
  return Object.values(boundaries).some((boundary) =>
    filenameMatches(filename, boundary.path) &&
    boundary.enclosingFunction === owner &&
    boundary.primitive === `env.${operation}`
  );
}

/** Return a static dotted path for an identifier/member chain. */
function staticPath(node: Deno.lint.Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression") return undefined;
  const object = staticPath(node.object);
  const property = memberName(node);
  return object === undefined || property === undefined
    ? undefined
    : `${object}.${property}`;
}

/** Whether a static path is a bare, globalThis, or Deno spelling. */
function hostPathMatches(path: string | undefined, suffix: string): boolean {
  return path === suffix || path === `globalThis.${suffix}` ||
    path === `Deno.${suffix}`;
}

/** Classify one direct clock read. */
function clockOperation(
  node: Deno.lint.CallExpression | Deno.lint.NewExpression,
): ClockPrimitiveBoundary["operation"] | undefined {
  const callee = staticPath(node.callee);
  if (node.type === "NewExpression") {
    return node.arguments.length === 0 && hostPathMatches(callee, "Date")
      ? "new Date()"
      : undefined;
  }
  if (hostPathMatches(callee, "Date.now")) return "Date.now";
  if (hostPathMatches(callee, "performance.now")) return "performance.now";
  return hostPathMatches(callee, "Date") ? "Date()" : undefined;
}

/** Classify one direct timer scheduling or cancellation operation. */
function schedulerOperation(
  node: Deno.lint.CallExpression,
): SchedulerPrimitiveBoundary["operation"] | undefined {
  const callee = staticPath(node.callee);
  for (
    const operation of [
      "clearInterval",
      "clearTimeout",
      "setInterval",
      "setTimeout",
    ] as const
  ) {
    if (hostPathMatches(callee, operation)) return operation;
  }
  return undefined;
}

/** Classify one direct non-security pseudorandom read. */
function jitterOperation(
  node: Deno.lint.CallExpression,
): JitterPrimitiveBoundary["operation"] | undefined {
  return hostPathMatches(staticPath(node.callee), "Math.random")
    ? "Math.random"
    : undefined;
}

/** Classify one direct cryptographically secure entropy operation. */
function secureEntropyOperation(
  node: Deno.lint.CallExpression,
): SecureEntropyPrimitiveBoundary["operation"] | undefined {
  const callee = staticPath(node.callee);
  for (
    const operation of [
      "crypto.getRandomValues",
      "crypto.randomUUID",
      "crypto.subtle.generateKey",
    ] as const
  ) {
    if (hostPathMatches(callee, operation)) return operation;
  }
  return undefined;
}

/** Whether the entropy law governs this product or repository-tooling module. */
function isProductionEntropyFilename(filename: string): boolean {
  const normalized = normalizedFilename(filename);
  return !/(?:^|\/)(?:tests|types)\//u.test(normalized);
}

/** Whether one exact primitive operation is registered. */
function permitsPrimitive<
  Operation extends string,
  Boundary extends {
    readonly path: string;
    readonly enclosingFunction: string;
    readonly operation: Operation;
  },
>(
  filename: string,
  node: Deno.lint.Node,
  operation: Operation,
  boundaries: Readonly<Record<string, Boundary>>,
): boolean {
  const owner = enclosingFunction(node);
  return Object.values(boundaries).some((boundary) =>
    filenameMatches(filename, boundary.path) &&
    boundary.enclosingFunction === owner && boundary.operation === operation
  );
}

/** Build one call-expression rule for an operation-exact primitive registry. */
function primitiveCallVisitor<
  Operation extends string,
  Boundary extends {
    readonly path: string;
    readonly enclosingFunction: string;
    readonly operation: Operation;
  },
>(
  context: Deno.lint.RuleContext,
  operationOf: (node: Deno.lint.CallExpression) => Operation | undefined,
  boundaries: Readonly<Record<string, Boundary>>,
  message: (operation: Operation) => string,
  governsFilename?: (filename: string) => boolean,
): Deno.lint.LintVisitor {
  return {
    CallExpression(node: Deno.lint.CallExpression): void {
      if (
        governsFilename !== undefined &&
        !governsFilename(context.filename)
      ) return;
      const operation = operationOf(node);
      if (
        operation === undefined ||
        permitsPrimitive(
          context.filename,
          node,
          operation,
          boundaries,
        )
      ) return;
      context.report({ node, message: message(operation) });
    },
  };
}

/** Build the ambient-state plugin against explicit registries for focused tests. */
export function ambientStatePlugin(
  registries: AmbientStateRegistries = {
    reads: AMBIENT_READ_BOUNDARIES,
    mutations: AMBIENT_MUTATION_BOUNDARIES,
    clocks: CLOCK_PRIMITIVE_BOUNDARIES,
    schedulers: SCHEDULER_PRIMITIVE_BOUNDARIES,
    jitters: JITTER_PRIMITIVE_BOUNDARIES,
    secureEntropy: SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
  },
): Deno.lint.Plugin {
  return {
    name: PLUGIN_NAME,
    rules: {
      [READ_RULE_NAME]: {
        /** Reject hidden reads outside declared or defaulted host seams. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          return {
            MemberExpression(node: Deno.lint.MemberExpression): void {
              const primitive = ambientReadPrimitive(node);
              if (
                primitive === undefined || isDefaultParameterRead(node) ||
                permitsRead(context.filename, node, primitive, registries.reads)
              ) return;
              context.report({
                node,
                message:
                  `Direct ${primitive} read must be a default parameter or one exact registered host-boundary operation; pass the resolved value below.`,
              });
            },
            CallExpression(node: Deno.lint.CallExpression): void {
              if (
                !isDenoCwdCall(node) || isDefaultParameterRead(node) ||
                permitsRead(context.filename, node, "cwd", registries.reads)
              ) return;
              context.report({
                node,
                message:
                  "Direct cwd read must be a default parameter or one exact registered host-boundary operation; pass the resolved path below.",
              });
            },
          };
        },
      },
      [MUTATION_RULE_NAME]: {
        /** Reject process-global environment writes without an exact registration. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          return {
            MemberExpression(node: Deno.lint.MemberExpression): void {
              const operation = envOperation(node);
              if (
                (operation !== "delete" && operation !== "set") ||
                permitsMutation(
                  context.filename,
                  node,
                  operation,
                  registries.mutations,
                )
              ) return;
              context.report({
                node,
                message:
                  `Deno.env.${operation} mutates process-global state; remove it or register this exact host-boundary mutation.`,
              });
            },
          };
        },
      },
      [CLOCK_RULE_NAME]: {
        /** Reject host clock reads outside the system clock implementation. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          const inspect = (
            node: Deno.lint.CallExpression | Deno.lint.NewExpression,
          ): void => {
            const operation = clockOperation(node);
            if (
              operation === undefined ||
              permitsPrimitive(
                context.filename,
                node,
                operation,
                registries.clocks,
              )
            ) return;
            context.report({
              node,
              message:
                `Direct ${operation} clock read must stay inside the registered system clock; inject Clock elsewhere.`,
            });
          };
          return {
            CallExpression: inspect,
            NewExpression: inspect,
          };
        },
      },
      [SCHEDULER_RULE_NAME]: {
        /** Reject host timer calls outside the system scheduler implementation. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          return primitiveCallVisitor(
            context,
            schedulerOperation,
            registries.schedulers,
            (operation) =>
              `Direct ${operation} call must stay inside the registered system scheduler; inject Scheduler elsewhere.`,
          );
        },
      },
      [JITTER_RULE_NAME]: {
        /** Reject Math.random outside the non-security scheduling jitter seam. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          return primitiveCallVisitor(
            context,
            jitterOperation,
            registries.jitters,
            () =>
              "Direct Math.random scheduling jitter must stay inside the registered system jitter capability; inject JitterFn elsewhere.",
          );
        },
      },
      [SECURE_ENTROPY_RULE_NAME]: {
        /** Reject secure host entropy outside the elected system capability. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          return primitiveCallVisitor(
            context,
            secureEntropyOperation,
            registries.secureEntropy,
            (operation) =>
              `Direct ${operation} must stay inside the registered system SecureEntropy capability; inject SecureEntropy elsewhere.`,
            isProductionEntropyFilename,
          );
        },
      },
    },
  };
}

export default ambientStatePlugin();
