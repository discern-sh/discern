/**
 * Every `DISCERN_*` environment-variable contract used by this repository.
 *
 * Definitions are the single source of truth for membership, purpose,
 * lifecycle, and public documentation. Runtime readers and writers derive
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
    description: "Inputs read by the POSIX installer.",
  },
  {
    id: "runtime-overrides",
    title: "Runtime overrides",
    description: "Per-process overrides for discern's runtime behavior.",
  },
  {
    id: "worktree-identity",
    title: "Worktree identity",
    description: "Inputs that override the identity derived for a worktree.",
  },
  {
    id: "project-scripts",
    title: "Project Scripts",
    description: "Values discern exports before running a Project Script.",
  },
  {
    id: "worktree-environment",
    title: "Worktree environment",
    description:
      "Identity values passed to resource commands or written to configured worktree env files.",
  },
  {
    id: "experimental-features",
    title: "Experimental features",
    description:
      "User-facing controls for experiments whose names and behavior remain subject to change.",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    description:
      "Fault-injection controls for testing discern's failure reporting.",
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
  {
    id: "retired",
    title: "Retired",
    description: "Old contracts still recognized for migration diagnostics.",
  },
] as const satisfies readonly DiscernEnvironmentVariableGroup[];

/** A registered purpose-group id. */
export type DiscernEnvironmentVariableGroupId =
  (typeof DISCERN_ENVIRONMENT_VARIABLE_GROUPS)[number]["id"];

/** Whether a registered environment contract remains active. */
export type DiscernEnvironmentVariableLifecycle = "live" | "retired";

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
  readonly lifecycle: DiscernEnvironmentVariableLifecycle;
  readonly documentation: DiscernEnvironmentVariableDocumentation;
}

/** Every live or intentionally recognized `DISCERN_*` environment contract. */
export const DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS = {
  repository: {
    name: "DISCERN_REPO",
    group: "installation",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "GitHub release repository the installer downloads from. Defaults to `jackwh/discern`.",
    },
  },
  version: {
    name: "DISCERN_VERSION",
    group: "installation",
    lifecycle: "live",
    documentation: {
      public: true,
      description: "Release tag the installer downloads. Defaults to `latest`.",
    },
  },
  binaryDirectory: {
    name: "DISCERN_BIN_DIR",
    group: "installation",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Install directory. Overrides the installer's automatic destination selection.",
    },
  },

  trunk: {
    name: "DISCERN_TRUNK",
    group: "runtime-overrides",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Overrides `[repository].trunk` for the current process. Project Scripts receive the resolved trunk in the same variable.",
    },
  },
  noAttribution: {
    name: "DISCERN_NO_ATTRIBUTION",
    group: "runtime-overrides",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Omits the discern co-author trailer from commits discern composes when set to a non-empty value.",
    },
  },

  projectSlug: {
    name: "DISCERN_PROJECT_SLUG",
    group: "worktree-identity",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Overrides `[project].slug` when discern derives worktree identities.",
    },
  },
  worktreeBranchPrefix: {
    name: "DISCERN_WORKTREE_BRANCH_PREFIX",
    group: "worktree-identity",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Overrides `[repository].branch_prefix` when discern derives worktree branch names.",
    },
  },
  worktreeId: {
    name: "DISCERN_WORKTREE_ID",
    group: "worktree-identity",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Sets an explicit worktree id in the process or a configured env file. Accepts letters, numbers, dots, dashes, and underscores.",
    },
  },

  root: {
    name: "DISCERN_ROOT",
    group: "project-scripts",
    lifecycle: "live",
    documentation: {
      public: true,
      description: "Absolute project root exported to a Project Script.",
    },
  },
  toml: {
    name: "DISCERN_TOML",
    group: "project-scripts",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Absolute path to the active `discern.toml` exported to a Project Script.",
    },
  },
  scripts: {
    name: "DISCERN_SCRIPTS",
    group: "project-scripts",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Absolute configured Project Scripts directory exported to a Project Script.",
    },
  },
  scriptsDirectory: {
    name: "DISCERN_SCRIPTS_DIR",
    group: "project-scripts",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Configured `[scripts].dir` value exported to a Project Script.",
    },
  },

  worktreePort: {
    name: "DISCERN_WORKTREE_PORT",
    group: "worktree-environment",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Deterministic development port written to a configured worktree env file when `[worktree].port = true`.",
    },
  },
  worktree: {
    name: "DISCERN_WORKTREE",
    group: "worktree-environment",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Generic worktree handle supplied to resource commands and written to configured env files when resources are declared.",
    },
  },
  resource: {
    name: "DISCERN_RESOURCE_<NAME>",
    group: "worktree-environment",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Stable handle for one declared resource. `<NAME>` is the resource name uppercased with non-alphanumeric runs replaced by underscores.",
    },
  },

  experimentalMcpPreload: {
    name: "DISCERN_EXPERIMENTAL_MCP_PRELOAD",
    group: "experimental-features",
    lifecycle: "live",
    documentation: {
      public: true,
      description:
        "Set to `1` for `discern refresh` to request eager discern MCP loading from configured Claude Code and GitHub Copilot integrations.",
    },
  },

  crashProbe: {
    name: "DISCERN_CRASH_PROBE",
    group: "diagnostics",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Injects deterministic failures for discern's crash-path tests.",
    },
  },

  home: {
    name: "DISCERN_HOME",
    group: "repository-development",
    lifecycle: "live",
    documentation: {
      public: false,
      reason:
        "Overrides the source checkout used by discern's repository-local development wrapper.",
    },
  },
  presetsDirectory: {
    name: "DISCERN_PRESETS_DIR",
    group: "repository-development",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Overrides bundled preset discovery in source and test runs.",
    },
  },
  templatesDirectory: {
    name: "DISCERN_TEMPLATES_DIR",
    group: "repository-development",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Overrides bundled template discovery in source and test runs.",
    },
  },
  docsDirectory: {
    name: "DISCERN_DOCS_DIR",
    group: "repository-development",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Overrides bundled manual discovery in source and test runs.",
    },
  },
  gateTestReporter: {
    name: "DISCERN_GATE_TEST_REPORTER",
    group: "repository-development",
    lifecycle: "live",
    documentation: {
      public: false,
      reason:
        "Selects the reporter for discern's own repository gate test command.",
    },
  },

  deskSession: {
    name: "DISCERN_DESK_SESSION",
    group: "process-internals",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Prevents a desk-launched process from opening a nested desk.",
    },
  },
  testSlot: {
    name: "DISCERN_TEST_SLOT",
    group: "process-internals",
    lifecycle: "live",
    documentation: {
      public: false,
      reason:
        "Marks a child process whose test-run concurrency slot is already accounted for.",
    },
  },
  setupDeno: {
    name: "DISCERN_SETUP_DENO",
    group: "process-internals",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Carries the Deno executable into a source-engine re-entry.",
    },
  },
  setupConfig: {
    name: "DISCERN_SETUP_CONFIG",
    group: "process-internals",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Carries the config path into a source-engine re-entry.",
    },
  },
  setupMain: {
    name: "DISCERN_SETUP_MAIN",
    group: "process-internals",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Carries the source entrypoint into a source-engine re-entry.",
    },
  },

  testMcpReadinessTimeoutMs: {
    name: "DISCERN_TEST_MCP_READINESS_TIMEOUT_MS",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Bounds MCP readiness waits in the repository test suite.",
    },
  },
  testMcpTimeoutMs: {
    name: "DISCERN_TEST_MCP_TIMEOUT_MS",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Bounds MCP request waits in the repository test suite.",
    },
  },
  testAcceptanceJournal: {
    name: "DISCERN_TEST_ACCEPTANCE_JOURNAL",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason:
        "Passes an acceptance-journal fixture path between test processes.",
    },
  },
  testEffortGrant: {
    name: "DISCERN_TEST_EFFORT_GRANT",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Passes an effort-grant fixture path between test processes.",
    },
  },
  testMainRefLock: {
    name: "DISCERN_TEST_MAIN_REF_LOCK",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Passes a main-ref lock fixture path between test processes.",
    },
  },
  testWorktree: {
    name: "DISCERN_TEST_WORKTREE",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Passes a worktree fixture path between test processes.",
    },
  },
  testAcceptPaused: {
    name: "DISCERN_TEST_ACCEPT_PAUSED",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Coordinates an acceptance pause between test processes.",
    },
  },
  testAcceptRelease: {
    name: "DISCERN_TEST_ACCEPT_RELEASE",
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "Coordinates an acceptance release between test processes.",
    },
  },

  retiredProjectScriptLibrary: {
    name: "DISCERN_LIB",
    group: "retired",
    lifecycle: "retired",
    documentation: {
      public: false,
      reason:
        "Doctor recognizes the retired Project Script library variable for a migration diagnostic.",
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
