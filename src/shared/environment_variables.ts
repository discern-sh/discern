import { DISCERN_REPOSITORY_SLUG } from "./product_identity.ts";

/**
 * Every `DISCERN_*` environment-variable contract used by this repository.
 *
 * Definitions are the single source of truth for membership, purpose, and
 * public documentation. Runtime readers and writers derive
 * their keys from them. Shell, workflow, config, documentation, and fixture
 * uses are held to them by the environment-variable enrolment guards.
 * `DISCERN_RESOURCE_<NAME>` represents the generated resource-handle family.
 */

/** One purpose group in the environment-variable reference. */
export interface DiscernEnvironmentVariableGroup {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/** Purpose groups in public reference order, followed by internal groups. */
export const DISCERN_ENVIRONMENT_VARIABLE_GROUPS = [
  {
    id: "installation",
    title: "Installation",
    description:
      "You can set these when you run the install script, to change what it downloads and where it puts discern.",
  },
  {
    id: "runtime-overrides",
    title: "Runtime overrides",
    description:
      "You can set these to change how discern behaves, for one command or for your whole session.",
  },
  {
    id: "worktree-identity",
    title: "Worktree identity",
    description:
      "You can set these to replace the names discern works out for a worktree.",
  },
  {
    id: "project-scripts",
    title: "Project Scripts",
    description:
      "discern sets these for a project script each time it runs one, from `discern scripts` or the desk. It removes any other `DISCERN_*` variables from the script's environment.",
  },
  {
    id: "checkpoint-commands",
    title: "Checkpoint commands",
    description:
      "discern sets these for a checkpoint's `when` command while it runs.",
  },
  {
    id: "worktree-environment",
    title: "Worktree environment",
    description:
      "discern gives these to a worktree's resource commands or writes them into its env files, as each entry describes. It only writes into env files that already exist.",
  },
  {
    id: "experimental-features",
    title: "Experimental features",
    description:
      "You can set these to try an experiment. Their names and behavior may change in any release.",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    description:
      "Fault-injection and fault-capture controls for diagnosing discern's behavior.",
  },
  {
    id: "repository-development",
    title: "Repository development",
    description: "Overrides used while developing and testing discern itself.",
  },
  {
    id: "process-internals",
    title: "Process internals",
    description: "Markers shared between discern-owned processes.",
  },
  {
    id: "test-controls",
    title: "Test controls",
    description: "Coordination values used only by discern's test suite.",
  },
] as const satisfies readonly DiscernEnvironmentVariableGroup[];

/** A registered purpose-group id. */
export type DiscernEnvironmentVariableGroupId =
  (typeof DISCERN_ENVIRONMENT_VARIABLE_GROUPS)[number]["id"];

/** Public reference copy or the reason a contract stays internal. */
export type DiscernEnvironmentVariableDocumentation =
  | {
    readonly public: true;
    readonly description: string;
  }
  | {
    readonly public: false;
    readonly reason: string;
  };

/** One environment-variable contract and its documentation policy. */
export interface DiscernEnvironmentVariableDefinition {
  readonly name: `DISCERN_${string}`;
  readonly group: DiscernEnvironmentVariableGroupId;
  readonly documentation: DiscernEnvironmentVariableDocumentation;
}

/** Every supported `DISCERN_*` environment contract. */
export const DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS = {
  repository: {
    name: "DISCERN_REPO",
    group: "installation",
    documentation: {
      public: true,
      description:
        `The GitHub repository, as \`owner/repo\`, whose releases the install script downloads. Default: \`${DISCERN_REPOSITORY_SLUG}\`.`,
    },
  },
  version: {
    name: "DISCERN_VERSION",
    group: "installation",
    documentation: {
      public: true,
      description:
        "The release the install script downloads, with or without a leading `v`. Default: `latest`.",
    },
  },
  binaryDirectory: {
    name: "DISCERN_BIN_DIR",
    group: "installation",
    documentation: {
      public: true,
      description:
        "The folder the install script puts discern in, created if it doesn't exist. Without it, the script uses a writable `/usr/local/bin` on macOS, and otherwise `~/.local/bin`, then a writable `/usr/local/bin`.",
    },
  },

  trunk: {
    name: "DISCERN_TRUNK",
    group: "runtime-overrides",
    documentation: {
      public: true,
      description:
        "Use a different trunk than `[repository].trunk` while it's set; an empty value is ignored. discern also sets it for each project script, to the trunk in use.",
    },
  },
  noAttribution: {
    name: "DISCERN_NO_ATTRIBUTION",
    group: "runtime-overrides",
    documentation: {
      public: true,
      description:
        "Set it to any non-empty value to leave discern's name off what it writes. Generated-file markers drop discern's name and web address, commits discern makes drop its co-author line, and Proof notes use your Git identity instead of discern's. Keep it set the same way for every command, or `discern upgrade --check` reports the markers as out of date.",
    },
  },

  projectSlug: {
    name: "DISCERN_PROJECT_SLUG",
    group: "worktree-identity",
    documentation: {
      public: true,
      description:
        "Use this slug instead of `[project].slug` in a worktree's site, database, and resource names. discern converts it to lowercase and turns other characters into dashes; the `@project_slug@` token keeps the configured slug.",
    },
  },
  worktreeBranchPrefix: {
    name: "DISCERN_WORKTREE_BRANCH_PREFIX",
    group: "worktree-identity",
    documentation: {
      public: true,
      description:
        "Use this prefix instead of `[repository].branch_prefix` for worktree branch names. An empty value means no prefix.",
    },
  },
  worktreeId: {
    name: "DISCERN_WORKTREE_ID",
    group: "worktree-identity",
    documentation: {
      public: true,
      description:
        "Give a worktree a chosen id, which its port, site, database, and resource names follow. Set it in the environment, where it applies to the worktree the command runs in, or on a line in that worktree's env files. It starts with a letter or digit and continues with letters, digits, dots, dashes, or underscores, up to 81 characters; discern converts it to lowercase and turns dots and underscores into dashes.",
    },
  },

  root: {
    name: "DISCERN_ROOT",
    group: "project-scripts",
    documentation: {
      public: true,
      description: "Absolute path of the project root.",
    },
  },
  toml: {
    name: "DISCERN_TOML",
    group: "project-scripts",
    documentation: {
      public: true,
      description: "Absolute path of the `discern.toml` in use.",
    },
  },
  scriptsDirectory: {
    name: "DISCERN_SCRIPTS_DIR",
    group: "project-scripts",
    documentation: {
      public: true,
      description:
        "Absolute path of the project scripts folder, `[scripts].dir`.",
    },
  },
  checkpointInput: {
    name: "DISCERN_CHECKPOINT_INPUT",
    group: "checkpoint-commands",
    documentation: {
      public: true,
      description:
        "Absolute path of a JSON file that describes the change for the checkpoint's `when` command. It holds facts about the changed files, but not their contents, in the versioned format the [checkpoint `when` protocol](proof-and-checkpoint-formats.md#checkpoint-when-protocol) describes. The file exists only while the command runs.",
    },
  },

  worktreePort: {
    name: "DISCERN_WORKTREE_PORT",
    group: "worktree-environment",
    documentation: {
      public: true,
      description:
        "The worktree's stable development port. discern writes it into the worktree's env file when `[worktree].export_port = true`; `discern identity --port` prints it either way.",
    },
  },
  worktree: {
    name: "DISCERN_WORKTREE",
    group: "worktree-environment",
    documentation: {
      public: true,
      description:
        "The worktree's resource handle, a stable name made from the project slug and worktree id. discern gives it to every resource command, and writes it into the env files when a resource has a `create` or `destroy` command.",
    },
  },
  resource: {
    name: "DISCERN_RESOURCE_<NAME>",
    group: "worktree-environment",
    documentation: {
      public: true,
      description:
        "The stable name of one declared resource. Each resource command gets its own resource's variable, and discern writes them into the env files alongside `DISCERN_WORKTREE`. `<NAME>` is the resource's name in uppercase, with each run of other characters turned into one underscore and any at the ends removed.",
    },
  },

  experimentalMcpPreload: {
    name: "DISCERN_EXPERIMENTAL_MCP_PRELOAD",
    group: "experimental-features",
    documentation: {
      public: true,
      description:
        "Set it to `1` to have coding agents that support it load discern's MCP tools at startup instead of on first use. discern applies it whenever it writes agents' MCP settings, as `discern refresh` does. Use the same setting when you run `discern done`, which checks those settings against what a refresh would write.",
    },
  },
  experimentalAwaitCallSeconds: {
    name: "DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS",
    group: "experimental-features",
    documentation: {
      public: true,
      description:
        "Limit each await to this many whole seconds; it can only shorten the usual limit. It applies to every agent `discern_await` call and to `discern await` without `--timeout`. An explicit `--timeout` on the command line still applies in full.",
    },
  },

  crashProbe: {
    name: "DISCERN_CRASH_PROBE",
    group: "diagnostics",
    documentation: {
      public: false,
      reason: "Injects deterministic failures for discern's crash-path tests.",
    },
  },
  interactionTrace: {
    name: "DISCERN_INTERACTION_TRACE",
    group: "diagnostics",
    documentation: {
      public: false,
      reason:
        "Appends per-request terminal-interaction sizing evidence to the named file for viewport-fault diagnosis.",
    },
  },

  home: {
    name: "DISCERN_HOME",
    group: "repository-development",
    documentation: {
      public: false,
      reason:
        "Overrides the source checkout used by discern's repository-local development wrapper.",
    },
  },
  templatesDirectory: {
    name: "DISCERN_TEMPLATES_DIR",
    group: "repository-development",
    documentation: {
      public: false,
      reason: "Overrides bundled template discovery in source and test runs.",
    },
  },
  docsDirectory: {
    name: "DISCERN_DOCS_DIR",
    group: "repository-development",
    documentation: {
      public: false,
      reason: "Overrides bundled manual discovery in source and test runs.",
    },
  },
  gateTestReporter: {
    name: "DISCERN_GATE_TEST_REPORTER",
    group: "repository-development",
    documentation: {
      public: false,
      reason:
        "Selects the reporter for discern's own repository gate test command.",
    },
  },
  deskSession: {
    name: "DISCERN_DESK_SESSION",
    group: "process-internals",
    documentation: {
      public: false,
      reason: "Prevents a desk-launched process from opening a nested desk.",
    },
  },
  testSlot: {
    name: "DISCERN_TEST_SLOT",
    group: "process-internals",
    documentation: {
      public: false,
      reason:
        "Marks a child process whose test-run concurrency slot is already accounted for.",
    },
  },
  spawnedBy: {
    name: "DISCERN_SPAWNED_BY",
    group: "process-internals",
    documentation: {
      public: false,
      reason:
        "Carries the parent invocation id into automated child processes, so the logbook records nested discern runs as self-invocations.",
    },
  },
  operationLockDelegation: {
    name: "DISCERN_OPERATION_LOCK_DELEGATION",
    group: "process-internals",
    documentation: {
      public: false,
      reason:
        "Delegates an OS-backed operation-lock lease to a discern child process so nested built-in commands cannot deadlock their parent.",
    },
  },
  setupDeno: {
    name: "DISCERN_SETUP_DENO",
    group: "process-internals",
    documentation: {
      public: false,
      reason: "Carries the Deno executable into a source-engine re-entry.",
    },
  },
  setupConfig: {
    name: "DISCERN_SETUP_CONFIG",
    group: "process-internals",
    documentation: {
      public: false,
      reason: "Carries the config path into a source-engine re-entry.",
    },
  },
  setupMain: {
    name: "DISCERN_SETUP_MAIN",
    group: "process-internals",
    documentation: {
      public: false,
      reason: "Carries the source entrypoint into a source-engine re-entry.",
    },
  },

  testMcpReadinessTimeoutMs: {
    name: "DISCERN_TEST_MCP_READINESS_TIMEOUT_MS",
    group: "test-controls",
    documentation: {
      public: false,
      reason: "Bounds MCP readiness waits in the repository test suite.",
    },
  },
  testMcpTimeoutMs: {
    name: "DISCERN_TEST_MCP_TIMEOUT_MS",
    group: "test-controls",
    documentation: {
      public: false,
      reason: "Bounds MCP request waits in the repository test suite.",
    },
  },
  testMainRefLock: {
    name: "DISCERN_TEST_MAIN_REF_LOCK",
    group: "test-controls",
    documentation: {
      public: false,
      reason: "Passes a main-ref lock fixture path between test processes.",
    },
  },
  testWorktree: {
    name: "DISCERN_TEST_WORKTREE",
    group: "test-controls",
    documentation: {
      public: false,
      reason: "Passes a worktree fixture path between test processes.",
    },
  },
  testAcceptPaused: {
    name: "DISCERN_TEST_ACCEPT_PAUSED",
    group: "test-controls",
    documentation: {
      public: false,
      reason: "Coordinates an acceptance pause between test processes.",
    },
  },
  testAcceptRelease: {
    name: "DISCERN_TEST_ACCEPT_RELEASE",
    group: "test-controls",
    documentation: {
      public: false,
      reason: "Coordinates an acceptance release between test processes.",
    },
  },
} as const satisfies Readonly<
  Record<string, DiscernEnvironmentVariableDefinition>
>;

/** Names keyed like their source definitions, preserving every literal value. */
type EnvironmentVariableNames<
  Definitions extends Readonly<
    Record<string, Pick<DiscernEnvironmentVariableDefinition, "name">>
  >,
> = {
  readonly [Key in keyof Definitions]: Definitions[Key]["name"];
};

/** Derive the name-only compatibility API from full definitions. */
function environmentVariableNames<
  const Definitions extends Readonly<
    Record<string, Pick<DiscernEnvironmentVariableDefinition, "name">>
  >,
>(definitions: Definitions): EnvironmentVariableNames<Definitions> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([key, definition]) => [
        key,
        definition.name,
      ]),
    ),
  ) as EnvironmentVariableNames<Definitions>;
}

/** Names from one purpose group, retaining the definitions' semantic keys. */
export type EnvironmentVariableNamesForGroup<
  Definitions extends Readonly<
    Record<
      string,
      Pick<DiscernEnvironmentVariableDefinition, "name" | "group">
    >
  >,
  Group extends DiscernEnvironmentVariableGroupId,
> = {
  readonly [
    Key in keyof Definitions as Definitions[Key]["group"] extends Group ? Key
      : never
  ]: Definitions[Key]["name"];
};

/** Derive a name-only subset from one registered purpose group. */
export function environmentVariableNamesForGroup<
  const Definitions extends Readonly<
    Record<
      string,
      Pick<DiscernEnvironmentVariableDefinition, "name" | "group">
    >
  >,
  const Group extends DiscernEnvironmentVariableGroupId,
>(
  definitions: Definitions,
  group: Group,
): EnvironmentVariableNamesForGroup<Definitions, Group> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions)
        .filter(([, definition]) => definition.group === group)
        .map(([key, definition]) => [key, definition.name]),
    ),
  ) as EnvironmentVariableNamesForGroup<Definitions, Group>;
}

/** Whether one concrete name belongs to a registered name or family. */
export function environmentVariableDefinitionMatches(
  definition: Pick<DiscernEnvironmentVariableDefinition, "name">,
  name: string,
): boolean {
  if (!definition.name.includes("<NAME>")) return definition.name === name;
  const [prefix, suffix] = definition.name.split("<NAME>") as [string, string];
  return name.startsWith(prefix) && name.endsWith(suffix) &&
    name.length > prefix.length + suffix.length &&
    /^[A-Z0-9_]+$/.test(
      name.slice(prefix.length, name.length - suffix.length),
    );
}

/**
 * Whether a `DISCERN_*` reference is supported inside a Project Script.
 *
 * The allowed universe is derived from the Project Script export contract plus
 * the worktree-environment family a project's own env loader may expose.
 */
export function projectScriptSupportsEnvironmentName(name: string): boolean {
  return Object.values(DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS)
    .filter((definition) =>
      definition.group === "project-scripts" ||
      definition.group === "worktree-environment"
    )
    .some((definition) =>
      environmentVariableDefinitionMatches(definition, name)
    );
}

/** The public subset of any environment-variable definition registry. */
export function publicEnvironmentVariableDefinitions(
  definitions: Readonly<Record<string, DiscernEnvironmentVariableDefinition>>,
): readonly DiscernEnvironmentVariableDefinition[] {
  return Object.freeze(
    Object.values(definitions).filter((definition) =>
      definition.documentation.public
    ),
  );
}

/** Name-only compatibility API used by runtime readers and writers. */
export const DISCERN_ENVIRONMENT_VARIABLES = environmentVariableNames(
  DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
);

/** One registered environment-variable name or family template. */
export type DiscernEnvironmentVariableName =
  (typeof DISCERN_ENVIRONMENT_VARIABLES)[
    keyof typeof DISCERN_ENVIRONMENT_VARIABLES
  ];

/** Registry members in declaration order, for guards and generated inventories. */
export const DISCERN_ENVIRONMENT_VARIABLE_NAMES:
  readonly DiscernEnvironmentVariableName[] = Object.freeze(
    Object.values(DISCERN_ENVIRONMENT_VARIABLES),
  );

/** Public definitions in declaration order, derived from the authority. */
export const DISCERN_PUBLIC_ENVIRONMENT_VARIABLE_DEFINITIONS =
  publicEnvironmentVariableDefinitions(
    DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
  );
