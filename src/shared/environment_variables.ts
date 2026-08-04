/**
 * Every `DISCERN_*` environment-variable name used by this repository.
 *
 * This registry is the single source of truth for membership. Runtime readers
 * and writers derive their keys from it. Shell, workflow, config, documentation,
 * and fixture uses are held to it by the environment-variable enrolment guard.
 * `DISCERN_RESOURCE_<NAME>` represents the generated resource-handle family.
 */

/** Every live or intentionally recognized `DISCERN_*` environment contract. */
export const DISCERN_ENVIRONMENT_VARIABLES = {
  // Remote installer inputs.
  repository: "DISCERN_REPO",
  version: "DISCERN_VERSION",
  binaryDirectory: "DISCERN_BIN_DIR",

  // Runtime inputs and identity selectors.
  home: "DISCERN_HOME",
  trunk: "DISCERN_TRUNK",
  noAttribution: "DISCERN_NO_ATTRIBUTION",
  projectSlug: "DISCERN_PROJECT_SLUG",
  worktreeBranchPrefix: "DISCERN_WORKTREE_BRANCH_PREFIX",
  worktreeId: "DISCERN_WORKTREE_ID",
  crashProbe: "DISCERN_CRASH_PROBE",

  // Project Script and worktree exports.
  root: "DISCERN_ROOT",
  toml: "DISCERN_TOML",
  scripts: "DISCERN_SCRIPTS",
  scriptsDirectory: "DISCERN_SCRIPTS_DIR",
  worktreePort: "DISCERN_WORKTREE_PORT",
  worktree: "DISCERN_WORKTREE",
  resource: "DISCERN_RESOURCE_<NAME>",

  // Development, experiment, and repository-local controls.
  presetsDirectory: "DISCERN_PRESETS_DIR",
  templatesDirectory: "DISCERN_TEMPLATES_DIR",
  docsDirectory: "DISCERN_DOCS_DIR",
  experimentalMcpPreload: "DISCERN_EXPERIMENTAL_MCP_PRELOAD",
  gateTestReporter: "DISCERN_GATE_TEST_REPORTER",
  ciAsset: "DISCERN_ASSET",

  // Internal process markers and source-engine re-entry values.
  deskSession: "DISCERN_DESK_SESSION",
  testSlot: "DISCERN_TEST_SLOT",
  setupDeno: "DISCERN_SETUP_DENO",
  setupConfig: "DISCERN_SETUP_CONFIG",
  setupMain: "DISCERN_SETUP_MAIN",

  // Test-process coordination and timeout controls.
  testMcpReadinessTimeoutMs: "DISCERN_TEST_MCP_READINESS_TIMEOUT_MS",
  testMcpTimeoutMs: "DISCERN_TEST_MCP_TIMEOUT_MS",
  testAcceptanceJournal: "DISCERN_TEST_ACCEPTANCE_JOURNAL",
  testEffortGrant: "DISCERN_TEST_EFFORT_GRANT",
  testMainRefLock: "DISCERN_TEST_MAIN_REF_LOCK",
  testWorktree: "DISCERN_TEST_WORKTREE",
  testAcceptPaused: "DISCERN_TEST_ACCEPT_PAUSED",
  testAcceptRelease: "DISCERN_TEST_ACCEPT_RELEASE",

  // Retired contract still recognized by doctor for a targeted migration hint.
  retiredProjectScriptLibrary: "DISCERN_LIB",
} as const satisfies Readonly<Record<string, `DISCERN_${string}`>>;

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
