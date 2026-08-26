/** Reasoned authority modules permitted to create raw temporary directories. */

/**
 * The complete raw-creator exception set across test, tooling, and runtime
 * lifetimes. Each module owns secure creation for its own declared lifetime;
 * the repo-wide guard rejects every other caller and every stale entry here.
 */
export const TEMP_DIR_CREATOR_AUTHORITIES = new Map<string, string>([
  [
    "scripts/temp_dir.ts",
    "Standalone repository tools own callback-scoped scratch directories through one kind registry.",
  ],
  [
    "src/shared/temp_artifacts.ts",
    "Runtime directory artifacts survive a command and expire through the registered retention sweep.",
  ],
  [
    "tests/temp_dir.ts",
    "Tests and executable fixtures use callback- or suite-scoped ownership with test-specific teardown.",
  ],
]);
