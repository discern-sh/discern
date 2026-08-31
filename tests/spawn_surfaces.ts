/**
 * Exact registry of direct subprocess construction boundaries.
 *
 * Every production or repository-tooling `new Deno.Command(...)` site is one
 * row naming its path, enclosing function, operation, and reason. Constructors
 * inside `src/shared/subprocess.ts` are marked as the shared capability; every
 * other row is a registered exception whose population is held by the falling
 * `subprocess_spawn_boundaries` Standard. The structural guard checks both
 * directions, so an unknown constructor and a stale registry row both fail.
 *
 * Engine paths additionally enroll in {@link SPAWN_INTERRUPT_CONTRACTS}. That
 * separate per-home fact records whether a signal delivered to the engine must
 * be proven by an end-to-end surface or is a bounded, reviewed exemption.
 */

/** What a boundary may hand to `Deno.Command`. */
export type SpawnBinary = "git" | "sh" | "other";

/** Whether the constructor implements the shared funnel or remains outside it. */
export type SpawnBoundaryRole = "shared-capability" | "registered-boundary";

/** One exact direct subprocess constructor. */
export interface SubprocessSpawnBoundary {
  /** Repository-relative authored source path. */
  readonly path: string;
  /** Stable nearest named function or `<module>` for a top-level constructor. */
  readonly enclosingFunction: string;
  /** Concise account of the child operation. */
  readonly operation: string;
  /** Why this constructor cannot use the shared Git or buffered-shell funnel. */
  readonly reason: string;
  /** Binary class used by the Git and shell funnel guards. */
  readonly may: readonly SpawnBinary[];
  /** Shared implementation or an exception counted by the Standard. */
  readonly role: SpawnBoundaryRole;
}

/** Every direct production-and-tooling subprocess constructor. */
export const SUBPROCESS_SPAWN_BOUNDARIES = [
  {
    path: "scripts/binary_size.ts",
    enclosingFunction: "<module>",
    operation: "compile the release binary before measuring its size",
    reason:
      "the build process needs Deno-specific permissions and captures the compiler result directly",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/build.ts",
    enclosingFunction: "compileTarget",
    operation: "compile one release target",
    reason:
      "the release builder streams a Deno compile with target-specific permissions and environment",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/build.ts",
    enclosingFunction: "verifyDarwinSignature",
    operation: "verify a macOS release signature",
    reason:
      "codesign is a platform-specific release verifier with its own captured diagnostic contract",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/guards.ts",
    enclosingFunction: "runGuardFile",
    operation: "run one Canon Editor guard test",
    reason:
      "Canon Editor launches the Deno test entrypoint with editor-owned output and timeout handling",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/guards.ts",
    enclosingFunction: "metricProbe",
    operation: "measure a Canon Editor Standard probe",
    reason:
      "the editor invokes the source CLI in a fresh Deno process and consumes its machine result",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/locate.ts",
    enclosingFunction: "openUrl",
    operation: "open the Canon Editor URL in the platform browser",
    reason:
      "the platform opener is an operating-system handoff that deliberately outlives the helper",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/locate.ts",
    enclosingFunction: "openInIde",
    operation: "open a registry location in the maintainer IDE",
    reason:
      "the IDE launcher is a local graphical handoff with product-specific arguments",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/pipeline.ts",
    enclosingFunction: "spawnSnapshot",
    operation: "render a fresh Canon Editor snapshot",
    reason:
      "the editor isolates registry evaluation in a new Deno process before accepting its JSON snapshot",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/pipeline.ts",
    enclosingFunction: "formatTs",
    operation: "format an edited TypeScript registry",
    reason:
      "the transactional editor runs Deno fmt against a staged file and owns rollback of its bytes",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/canon_editor/pipeline.ts",
    enclosingFunction: "mapProseGate",
    operation: "run the Map prose gate for an editor transaction",
    reason:
      "the editor invokes the repository Map prose task with transaction-specific environment and diagnostics",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/cli_install.ts",
    enclosingFunction: "capture",
    operation: "capture an installer or CLI command",
    reason:
      "the install helper accepts a caller-selected executable and exact Deno command options",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/coverage.ts",
    enclosingFunction: "denoCommand",
    operation: "run a Deno coverage subprocess or detach its profile remover",
    reason:
      "coverage owns profile directories, command permissions, and raw subprocess output for its report pipeline",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/release_smoke.ts",
    enclosingFunction: "run",
    operation: "smoke-test a staged release command",
    reason:
      "the release smoke harness runs a caller-selected binary with isolated environment and captured bytes",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/site_local_design_system.ts",
    enclosingFunction: "capturedCommand",
    operation: "run a local design-system helper command",
    reason:
      "the site helper launches a Deno task with repository-tooling permissions and returns its exact capture",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/use_compiled_build.ts",
    enclosingFunction: "buildHostBinary",
    operation: "compile the host development binary",
    reason:
      "the development installer drives Deno compile with the complete binary permission contract",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/vale_toolchain.ts",
    enclosingFunction: "runExactVale",
    operation: "run the content-verified Vale executable",
    reason:
      "the provisioner must invoke the exact cached binary and preserve Vale-specific environment and output",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "scripts/vale_toolchain.ts",
    enclosingFunction: "extractVale",
    operation: "extract a verified Vale release archive",
    reason:
      "tar is a platform tool applied to a verified archive with extraction-specific arguments and diagnostics",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "site/dev.ts",
    enclosingFunction: "runSiteBuild",
    operation: "rebuild the development site",
    reason:
      "the development server starts the site build in a fresh Deno process and publishes its captured failure",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "site/page-src/format-generated.ts",
    enclosingFunction: "formatGeneratedText",
    operation: "format generated site text",
    reason:
      "the site generator invokes Deno fmt as a byte-transform protocol over piped standard input and output",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "site/specimens.ts",
    enclosingFunction: "buildSpecimenPreview",
    operation: "build one isolated site specimen",
    reason:
      "the specimen server launches the site builder with route-specific environment and captured diagnostics",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "runGit",
    operation: "run an ordinary Git command",
    reason:
      "this constructor is the shared Git capability that centralizes binary resolution, capture, bounds, and failure data",
    may: ["git"],
    role: "shared-capability",
  },
  {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "runShell",
    operation: "run a buffered shell command",
    reason:
      "this constructor is the shared buffered-shell capability and owns its output and failure conventions",
    may: ["sh"],
    role: "shared-capability",
  },
  {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "commandExists",
    operation: "probe whether one command resolves",
    reason:
      "this constructor is the shared command-existence capability built on the canonical shell convention",
    may: ["sh"],
    role: "shared-capability",
  },
  {
    path: "src/shared/discern_commit.ts",
    enclosingFunction: "commitDiscernChanges",
    operation: "create an attributed discern commit",
    reason:
      "commit authority requires pathspec-limited input and descendant quiescence that the generic Git runner refuses",
    may: ["git"],
    role: "registered-boundary",
  },
  {
    path: "src/shared/deno_metadata.ts",
    enclosingFunction: "denoMetadata",
    operation: "read Deno resolver and type metadata",
    reason:
      "repository tooling consumes the exact Deno info and types protocols from bounded read-only queries",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "src/lib/pager.ts",
    enclosingFunction: "pageThrough",
    operation: "run the selected external pager",
    reason:
      "the explicitly selected pager inherits the terminal and may be a user-selected executable rather than a buffered command",
    may: ["sh", "other"],
    role: "registered-boundary",
  },
  {
    path: "src/lib/open_browser.ts",
    enclosingFunction: "runBrowserCommand",
    operation: "hand a documentation URL to the platform browser",
    reason:
      "the operating-system launcher is a foreground handoff whose browser deliberately outlives the CLI",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "src/engine/owned_child.ts",
    enclosingFunction: "runOwnedChild",
    operation: "run an operator-selected supervised child",
    reason:
      "owned children require interactive streams, detached groups, cancellation, and reaping beyond buffered-shell semantics",
    may: ["other"],
    role: "registered-boundary",
  },
  {
    path: "src/engine/jobs/command.ts",
    enclosingFunction: "spawnJob",
    operation: "run a Gate job",
    reason:
      "Gate jobs require live prefixed streaming, cancellation, output bounds, and detached process-group supervision",
    may: ["sh"],
    role: "registered-boundary",
  },
  {
    path: "src/engine/worktree/shell.ts",
    enclosingFunction: "runShellRouted",
    operation: "run a worktree lifecycle command",
    reason:
      "lifecycle commands reserve machine stdout and require owned-child supervision plus logger-routed diagnostics",
    may: ["sh"],
    role: "registered-boundary",
  },
  {
    path: "src/engine/mcp/version_check.ts",
    enclosingFunction: "defaultProbeVersion",
    operation: "probe a candidate discern executable version",
    reason:
      "the MCP handshake invokes an exact executable path with a short timeout and protocol-specific capture",
    may: ["other"],
    role: "registered-boundary",
  },
] as const satisfies readonly SubprocessSpawnBoundary[];

/** One engine spawn home's interrupt proof or bounded exemption. */
export type SpawnInterruptContract =
  | { readonly surfaces: readonly string[] }
  | { readonly exempt: string };

/** Engine-only interrupt contracts, keyed by every live `src/` spawn home. */
export const SPAWN_INTERRUPT_CONTRACTS = {
  "src/shared/subprocess.ts": {
    exempt:
      "runGit drives engine-authored Git operations; lifecycle callers opt into descendant quiescence, while runShell and commandExists are buffered probes without an operator-owned lifecycle caller",
  },
  "src/shared/discern_commit.ts": {
    exempt:
      "the attributed pathspec-limited commit runs in a detached Git group and quiesces descendants before it returns",
  },
  "src/shared/deno_metadata.ts": {
    exempt:
      "Deno's info and types queries are bounded engine-authored metadata reads that exit on their own",
  },
  "src/lib/pager.ts": {
    exempt:
      "the pager runs in the terminal foreground process group and lives exactly as long as its reader chooses",
  },
  "src/lib/open_browser.ts": {
    exempt:
      "the platform browser launcher is a foreground handoff while the opened browser deliberately outlives the CLI",
  },
  "src/engine/owned_child.ts": {
    surfaces: ["project-script", "queue", "with-gotchas", "desk-interactive"],
  },
  "src/engine/jobs/command.ts": { surfaces: ["gate-job"] },
  "src/engine/worktree/shell.ts": { surfaces: ["worktree-setup"] },
  "src/engine/mcp/version_check.ts": {
    exempt:
      "the discern version handshake is explicitly timeout-bounded and exits immediately",
  },
} as const satisfies Readonly<Record<string, SpawnInterruptContract>>;

/** Literal union that makes every declared E2E surface require a scenario. */
export type InterruptSurface = Extract<
  (typeof SPAWN_INTERRUPT_CONTRACTS)[keyof typeof SPAWN_INTERRUPT_CONTRACTS],
  { readonly surfaces: readonly string[] }
>["surfaces"][number];

/** Every interrupt surface id, retaining duplicates for the uniqueness guard. */
export function declaredInterruptSurfaces(): string[] {
  return Object.values(SPAWN_INTERRUPT_CONTRACTS).flatMap((contract) =>
    "surfaces" in contract ? [...contract.surfaces] : []
  );
}

/** Paths permitted to construct one binary class. */
export function homesThatMaySpawn(binary: SpawnBinary): Set<string> {
  const boundaries: readonly SubprocessSpawnBoundary[] =
    SUBPROCESS_SPAWN_BOUNDARIES;
  return new Set(
    boundaries.filter((entry) => entry.may.includes(binary)).map((entry) =>
      entry.path
    ),
  );
}

/** The exact registered-exception population held by the falling Standard. */
export function registeredSpawnBoundaryCount(): number {
  return SUBPROCESS_SPAWN_BOUNDARIES.filter((entry) =>
    entry.role === "registered-boundary"
  ).length;
}
