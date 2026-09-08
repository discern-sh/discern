/** Declared non-replacement uses of Deno's rename primitives. */

/** One intentional rename identified by stable source and function names. */
export interface RegisteredRename {
  readonly path: string;
  readonly enclosingFunction: string;
  /** Why this move cannot use the durable-state replacement capability. */
  readonly reason: string;
}

/** Every authored Deno rename whose purpose is not durable-state replacement. */
export const REGISTERED_RENAMES = [
  {
    path: "src/engine/execution/workspace.ts",
    enclosingFunction: "restore",
    reason:
      "Git index restoration streams a verified payload into Git's exclusive index.lock and publishes that exact lock file; the small-file writer cannot preserve this lock protocol.",
  },
  {
    path: "tests/completion_public_diagnostics_test.ts",
    enclosingFunction:
      'Deno.test("E11 dirty deletion and rename retain public diagnostics without completion records")',
    reason:
      "The fixture renames an authored input to verify dirty diagnostics observe the new file and omit the deleted path without publishing Proof.",
  },
  {
    path: "tests/engine_effort_grant_test.ts",
    enclosingFunction:
      'Deno.test("old one-shot claims can only settle their existing transaction")',
    reason:
      "The fixture moves a v1 standing grant into its claimed transaction path to exercise recovery without issuing current authority.",
  },
  {
    path: "scripts/build.ts",
    enclosingFunction: "stageBundledManual",
    reason:
      "Build staging publishes one complete validated manual directory assembled on the destination filesystem.",
  },
  {
    path: "scripts/cli_install.ts",
    enclosingFunction: "writeExecutableSync",
    reason:
      "The signal handler must restore the executable synchronously before process exit.",
  },
  {
    path: "scripts/coverage_profiles.ts",
    enclosingFunction: "pruneAndShardProfiles",
    reason:
      "Sharding relocates immutable raw coverage profiles between owned scratch directories, replacing nothing.",
  },
  {
    path: "scripts/vale_toolchain.ts",
    enclosingFunction: "reclaimStaleLock",
    reason:
      "Stale-lock recovery claims the complete lock directory under a unique name before removal.",
  },
  {
    path: "scripts/vale_toolchain.ts",
    enclosingFunction: "ensureVale",
    reason:
      "Provisioning publishes a complete content-addressed directory while holding its exclusive install lock.",
  },
  {
    path: "src/engine/logbook/store.ts",
    enclosingFunction: "detachLogbook",
    reason:
      "Reset and archive move the complete active directory into recovery before cleanup.",
  },
  {
    path: "src/engine/worktree/effort_grant_cleanup.ts",
    enclosingFunction: "claimEffortGrant",
    reason:
      "Acceptance claims exclusive grant ownership by moving the standing marker to its claim path.",
  },
  {
    path: "src/lib/migrations.ts",
    enclosingFunction: "rename",
    reason:
      "Installation migration relocates an existing path rather than replacing durable file bytes.",
  },
  {
    path: "src/shared/self_shim.ts",
    enclosingFunction: "writeShimAside",
    reason:
      "Content-addressed shim convergence tolerates a same-content rename race across processes.",
  },
  {
    path: "src/shared/write_preflight.ts",
    enclosingFunction: "probeDirectoryEntry",
    reason:
      "The preflight deliberately exercises rename authority with a disposable probe entry.",
  },
  {
    path: "tests/engine_done_json_surfaces_test.ts",
    enclosingFunction:
      'Deno.test("done --json: two ADR records claiming one number fail the adr_numbers check; renumbering fixes it")',
    reason:
      "The fixture renumbers one ADR file to prove the duplicate-number diagnostic clears.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("orphan sweep apply keeps a dir that gained work after the scan")',
    reason:
      "The fixture moves a checkout to construct an orphan that changes after the scan.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("removeWorktreeSafely refuses a symlink substituted for the registered path")',
    reason:
      "The fixture parks and restores a checkout around a symlink-substitution safety check.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("worktree prune does not let an orphan env file assert destructive ownership")',
    reason:
      "The fixture relocates a checkout whose environment file carries forged ownership evidence.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("worktree prune keeps a dirty orphaned dir at the configured worktree root")',
    reason:
      "The fixture relocates a dirty checkout to model an orphan that prune must preserve.",
  },
  {
    path: "tests/engine_worktree_prune_test.ts",
    enclosingFunction:
      'Deno.test("worktree prune reclaims a clean fully-orphaned dir at the configured worktree root")',
    reason:
      "The fixture relocates a merged checkout to model an orphan that prune may reclaim.",
  },
  {
    path: "tests/fixtures/desk_tty_harness.ts",
    enclosingFunction: "effect",
    reason:
      "The executable fixture publishes a complete terminal-resize request to its child process.",
  },
  {
    path: "tests/temp_dir.ts",
    enclosingFunction: "withTempDir",
    reason:
      "The test temp-directory capability relocates a callback-owned root to its requested canonical path.",
  },
] as const satisfies readonly RegisteredRename[];
