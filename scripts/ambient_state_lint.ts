/**
 * Deno lint plugin keeping process environment and cwd reads at explicit host
 * boundaries or in injectable default-parameter expressions.
 */

/// <reference lib="deno.unstable" />

const PLUGIN_NAME = "discern-ambient-state";
const READ_RULE_NAME = "no-hidden-ambient-read";
const MUTATION_RULE_NAME = "no-unregistered-env-mutation";

/** One module whose host-facing role requires direct ambient reads. */
export interface AmbientReadBoundary {
  readonly path: string;
  readonly reason: string;
}

/** One exact process-environment mutation retained at a host boundary. */
export interface AmbientMutationBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: "delete" | "set";
  readonly reason: string;
}

/** Host-facing modules allowed to read process environment or cwd directly. */
export const AMBIENT_READ_BOUNDARIES = [
  {
    path: "project/scripts/checkpoint_when_input.ts",
    reason:
      "The executable checkpoint adapter reads the Gate-provided path to its invocation payload.",
  },
  {
    path: "project/scripts/ensure_private_docs.ts",
    reason:
      "The executable repository check compares the checkout cwd with Git's shared root.",
  },
  {
    path: "project/scripts/feature_benefit_currency_checkpoint.ts",
    reason:
      "The executable checkpoint runs its Git inspection against the invoking checkout cwd.",
  },
  {
    path: "project/scripts/public_doc_checkpoint.ts",
    reason:
      "The executable checkpoint resolves changed public documents from the invoking checkout cwd.",
  },
  {
    path: "scripts/canon_editor/server.ts",
    reason:
      "The standalone editor server composes its listening port from the host process.",
  },
  {
    path: "scripts/cli_install.ts",
    reason:
      "The standalone installer resolves its destination and PATH report from the operator process.",
  },
  {
    path: "scripts/site_local_design_system.ts",
    reason:
      "The standalone design-system launcher composes the child PATH from the operator process.",
  },
  {
    path: "scripts/terminal_capture.ts",
    reason:
      "The standalone capture tool anchors its repository discovery at the operator cwd.",
  },
  {
    path: "site/dev.ts",
    reason:
      "The standalone development server composes its listening port from the host process.",
  },
  {
    path: "site/main.ts",
    reason:
      "The standalone production server composes its listening port from the host process.",
  },
  {
    path: "site/specimens.ts",
    reason:
      "The standalone specimen server composes its listening port from the host process.",
  },
  {
    path: "src/commands/config.ts",
    reason:
      "The config command is a CLI composition root that resolves an omitted project cwd.",
  },
  {
    path: "src/commands/docs.ts",
    reason:
      "The docs command is a CLI composition root for the pager environment and project cwd.",
  },
  {
    path: "src/commands/doctor.ts",
    reason:
      "The doctor command is a CLI composition root that resolves an omitted project cwd.",
  },
  {
    path: "src/commands/preset.ts",
    reason:
      "The preset command is a CLI composition root for its source override and destination cwd.",
  },
  {
    path: "src/commands/setup.ts",
    reason:
      "The setup command composes process inputs before passing resolved settings into its phases.",
  },
  {
    path: "src/commands/setup_verify.ts",
    reason:
      "The setup verification command anchors its explicit structural probe at the invoking cwd.",
  },
  {
    path: "src/commands/setup_welcome.ts",
    reason:
      "The setup welcome boundary inspects the invoking checkout before choosing onboarding copy.",
  },
  {
    path: "src/commands/uninstall.ts",
    reason:
      "The uninstall command is a CLI composition root that resolves an omitted project cwd.",
  },
  {
    path: "src/commands/upgrade.ts",
    reason:
      "The upgrade command is a CLI composition root that resolves an omitted project cwd.",
  },
  {
    path: "src/engine/dispatch.ts",
    reason:
      "The dispatcher is the CLI process boundary that resolves command targets from the host cwd.",
  },
  {
    path: "src/engine/logbook/cli.ts",
    reason:
      "The Logbook CLI composes automation markers and checkout roots for its pure reporting core.",
  },
  {
    path: "src/engine/mcp/server.ts",
    reason:
      "The MCP server composes client process markers and cwd before invoking root-aware tool cores.",
  },
  {
    path: "src/engine/worktree/shell_picker.ts",
    reason:
      "The interactive shell picker owns the real-host dependency adapter supplied to its pure core.",
  },
  {
    path: "src/main.ts",
    reason:
      "The executable entry point resolves the process cwd before dispatching an explicit root.",
  },
  {
    path: "tests/dev_wrapper_test.ts",
    reason:
      "The test harness preserves the operator PATH while constructing an isolated wrapper process.",
  },
  {
    path: "tests/docs_test.ts",
    reason:
      "The test harness preserves the operator PATH while constructing an isolated pager process.",
  },
  {
    path: "tests/engine_checkpoints_gate_test.ts",
    reason:
      "The test harness preserves the operator PATH while running a checkpoint fixture child.",
  },
  {
    path: "tests/engine_desk_runtime_test.ts",
    reason:
      "The integration test anchors a real runtime probe at the test process cwd.",
  },
  {
    path: "tests/engine_gate_timeout_test.ts",
    reason:
      "The integration test anchors deliberately stalled child commands at the test process cwd.",
  },
  {
    path: "tests/engine_helpers.ts",
    reason:
      "The shared engine harness preserves the operator PATH when composing child environments.",
  },
  {
    path: "tests/engine_mcp_test.ts",
    reason:
      "The MCP harness inherits its explicit timeout controls from the surrounding test process.",
  },
  {
    path: "tests/engine_setup_done_test.ts",
    reason:
      "The setup harness preserves the operator PATH while inserting a temporary executable.",
  },
  {
    path: "tests/engine_setup_pages_test.ts",
    reason:
      "The setup-page integration test evaluates its real command from the test process cwd.",
  },
  {
    path: "tests/gate_execute_test.ts",
    reason:
      "The gate executor fixture deliberately binds its shared runner to the test process cwd.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    reason:
      "The job-runner harness captures one stable process cwd for all spawned fixture commands.",
  },
  {
    path: "tests/pty_process_test.ts",
    reason:
      "The pseudo-terminal harness preserves the operator PATH while composing its child process.",
  },
  {
    path: "tests/subprocess_test.ts",
    reason:
      "The subprocess integration tests exercise real cwd inheritance at the process boundary.",
  },
] as const satisfies readonly AmbientReadBoundary[];

/** Exact process-environment mutations that cannot be replaced by value input. */
export const AMBIENT_MUTATION_BOUNDARIES: readonly AmbientMutationBoundary[] =
  [];

/** Registries consumed by one plugin instance. */
export interface AmbientStateRegistries {
  readonly reads: readonly AmbientReadBoundary[];
  readonly mutations: readonly AmbientMutationBoundary[];
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
      if (parent?.type === "Property" && parent.key.type === "Identifier") {
        return parent.key.name;
      }
      return "<anonymous function>";
    }
    if (current.type === "ArrowFunctionExpression") {
      const parent = parentNode(current);
      if (
        parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }
      if (parent?.type === "Property" && parent.key.type === "Identifier") {
        return parent.key.name;
      }
      return "<anonymous function>";
    }
    current = parentNode(current);
  }
  return "<module>";
}

/** Whether a module is a registered direct-read boundary. */
function permitsRead(
  filename: string,
  boundaries: readonly AmbientReadBoundary[],
): boolean {
  return boundaries.some((boundary) =>
    filenameMatches(filename, boundary.path)
  );
}

/** Whether one exact environment mutation is registered. */
function permitsMutation(
  filename: string,
  node: Deno.lint.MemberExpression,
  operation: "delete" | "set",
  boundaries: readonly AmbientMutationBoundary[],
): boolean {
  const owner = enclosingFunction(node);
  return boundaries.some((boundary) =>
    filenameMatches(filename, boundary.path) &&
    boundary.enclosingFunction === owner && boundary.operation === operation
  );
}

/** Build the ambient-state plugin against explicit registries for focused tests. */
export function ambientStatePlugin(
  registries: AmbientStateRegistries = {
    reads: AMBIENT_READ_BOUNDARIES,
    mutations: AMBIENT_MUTATION_BOUNDARIES,
  },
): Deno.lint.Plugin {
  return {
    name: PLUGIN_NAME,
    rules: {
      [READ_RULE_NAME]: {
        /** Reject hidden reads outside declared or defaulted host seams. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          const allowedModule = permitsRead(context.filename, registries.reads);
          return {
            MemberExpression(node: Deno.lint.MemberExpression): void {
              if (
                envOperation(node) !== "read" || allowedModule ||
                isDefaultParameterRead(node)
              ) return;
              context.report({
                node,
                message:
                  "Read process environment at a default parameter or a registered host-boundary module, then pass the resolved value below.",
              });
            },
            CallExpression(node: Deno.lint.CallExpression): void {
              if (
                !isDenoCwdCall(node) || allowedModule ||
                isDefaultParameterRead(node)
              ) return;
              context.report({
                node,
                message:
                  "Read the process cwd at a default parameter or a registered host-boundary module, then pass the resolved path below.",
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
    },
  };
}

export default ambientStatePlugin();
