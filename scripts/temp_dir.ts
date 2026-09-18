/** Declared ownership for command-scoped tooling scratch directories. */

/** One secure prefix and cleanup contract for a tooling scratch directory. */
export interface ToolTempDirPolicy {
  /** Why this command-scoped directory exists. */
  readonly purpose: string;
  /** Prefix passed to Deno's securely randomized directory creator. */
  readonly prefix: `discern-${string}-`;
  /** Optional fixed parent required by the tool's execution contract. */
  readonly parent?: string;
  /** Whether one call may supply the parent needed by its filesystem contract. */
  readonly allowCallerParent?: boolean;
  /** Whether teardown removes content recursively. */
  readonly recursiveCleanup: boolean;
  /** Keep failed-work evidence only when this policy explicitly says so. */
  readonly preserveOnFailure: boolean;
}

/**
 * Every ephemeral directory owned by a standalone repository tool.
 *
 * The object key is the stable kind id used at call sites and in diagnostics.
 * These directories end with their callback; retained runtime artifacts and
 * test fixtures use their own lifetime authorities.
 */
export const TOOL_TEMP_DIR_KINDS = {
  "agent-surface-stage": {
    purpose: "agent-copy prose staged for lexical checks",
    prefix: "discern-agent-copy-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "canon-editor-prose": {
    purpose: "one editor draft staged for Vale with its real register styles",
    prefix: "discern-canon-editor-prose-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "test-reports": {
    purpose: "complete native reports from one partitioned test suite",
    prefix: "discern-test-reports-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "coverage-profile": {
    purpose: "raw coverage profiles collected for one measurement",
    prefix: "discern-coverage-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "fta-analysis": {
    purpose: "exact authored-source projection for one pinned FTA analysis",
    prefix: "discern-fta-analysis-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "install-fixture-capture": {
    purpose: "scratch repository set up once to capture an install fixture",
    prefix: "discern-install-fixture-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "map-prose-stage": {
    purpose: "frontmatter-blanked Map prose staged for Vale",
    prefix: "discern-prose-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "manual-build-stage": {
    purpose: "validated manual assembled beside its atomic build destination",
    prefix: "discern-manual-stage-",
    allowCallerParent: true,
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "manual-prose-stage": {
    purpose: "frontmatter-blanked product manual staged for Vale",
    prefix: "discern-manual-prose-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "release-smoke": {
    purpose: "compiled-release smoke-test project",
    prefix: "discern-release-smoke-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "site-design-system": {
    purpose: "local design-system preview configuration",
    prefix: "discern-site-design-system-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "site-prose-stage": {
    purpose: "public-site prose staged for Vale",
    prefix: "discern-site-prose-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "terminal-capture": {
    purpose: "compiled binary used by one terminal capture",
    prefix: "discern-terminal-capture-",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
  "terminal-fixture-binary": {
    purpose: "compiled binary used to refresh terminal fixtures",
    prefix: "discern-terminal-binary-",
    parent: "/tmp",
    recursiveCleanup: true,
    preserveOnFailure: false,
  },
} as const satisfies Readonly<Record<string, ToolTempDirPolicy>>;

export type ToolTempDirKind = keyof typeof TOOL_TEMP_DIR_KINDS;

/** Filesystem and reporting seams injected only by lifecycle tests. */
export interface ToolTempDirOperations {
  readonly makeTempDir: (
    options: { readonly dir?: string; readonly prefix: string },
  ) => Promise<string>;
  readonly remove: (
    path: string,
    options: { readonly recursive: boolean },
  ) => Promise<void>;
  readonly report: (message: string) => void;
}

/** Optional operation replacements for deterministic lifecycle tests. */
export type ToolTempDirOperationOverrides = Partial<ToolTempDirOperations>;

/** Per-use placement permitted only by a registry row that opts in. */
export interface ToolTempDirUseOptions {
  readonly parent?: string;
}

type ToolTempDirCallbackOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: unknown; readonly ok: false };

/** A callback succeeded, but its owned scratch directory could not be removed. */
export class ToolTempDirCleanupError extends Error {
  /** Stable kind whose cleanup failed. */
  readonly kind: string;
  /** Exact securely created directory that cleanup attempted. */
  readonly path: string;

  constructor(
    kind: string,
    path: string,
    purpose: string,
    options: { readonly cause: unknown },
  ) {
    super(
      `tool temp cleanup failed for '${kind}' at ${path} (${purpose}): ${
        errorText(options.cause)
      }`,
      options,
    );
    this.name = "ToolTempDirCleanupError";
    this.kind = kind;
    this.path = path;
  }
}

const DEFAULT_OPERATIONS: ToolTempDirOperations = {
  makeTempDir: async (options) => await Deno.makeTempDir(options),
  remove: async (path, options) => await Deno.remove(path, options),
  report: (message) => console.error(message),
};

/** Preserve Error messages while still reporting thrown non-Error values. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fail early when a registry member cannot safely name a temp directory. */
function assertToolTempDirPolicies(
  kinds: Readonly<Record<string, ToolTempDirPolicy>>,
): void {
  const prefixes = new Set<string>();
  for (const [kind, policy] of Object.entries(kinds)) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(kind)) {
      throw new TypeError(
        `tool temp kind '${kind}' is not a stable kebab-case id`,
      );
    }
    if (policy.purpose.trim().length < 12 || /[\r\n]/.test(policy.purpose)) {
      throw new TypeError(
        `tool temp kind '${kind}' needs a specific one-line purpose`,
      );
    }
    if (!/^discern-[a-z0-9]+(?:-[a-z0-9]+)*-$/.test(policy.prefix)) {
      throw new TypeError(`tool temp kind '${kind}' has an unsafe prefix`);
    }
    if (prefixes.has(policy.prefix)) {
      throw new TypeError(`tool temp prefix '${policy.prefix}' is not unique`);
    }
    prefixes.add(policy.prefix);
    if (policy.parent !== undefined && policy.parent.trim() === "") {
      throw new TypeError(`tool temp kind '${kind}' has an empty parent`);
    }
    if (policy.parent !== undefined && policy.allowCallerParent === true) {
      throw new TypeError(
        `tool temp kind '${kind}' cannot fix and delegate its parent`,
      );
    }
  }
}

/** Report without letting a broken reporter replace the command's real error. */
function reportSafely(
  operations: ToolTempDirOperations,
  message: string,
): void {
  try {
    operations.report(message);
  } catch (error) {
    console.error(
      `${message}; cleanup reporter also failed: ${errorText(error)}`,
    );
  }
}

/**
 * Build a callback-scoped capability from one closed kind registry.
 *
 * Production uses {@link withToolTempDir}; the factory lets lifecycle fixtures
 * plant a future registry member and inject deterministic creation, cleanup,
 * and reporting failures without adding another raw directory creator.
 */
export function createToolTempDirCapability<
  const Kinds extends Readonly<Record<string, ToolTempDirPolicy>>,
>(
  kinds: Kinds,
  overrides: ToolTempDirOperationOverrides = {},
): <T>(
  kind: Extract<keyof Kinds, string>,
  fn: (dir: string) => T | Promise<T>,
  options?: ToolTempDirUseOptions,
) => Promise<T> {
  assertToolTempDirPolicies(kinds);
  const operations: ToolTempDirOperations = {
    ...DEFAULT_OPERATIONS,
    ...overrides,
  };

  return async <T>(
    kind: Extract<keyof Kinds, string>,
    fn: (dir: string) => T | Promise<T>,
    options: ToolTempDirUseOptions = {},
  ): Promise<T> => {
    const policy = kinds[kind];
    if (policy === undefined) {
      throw new TypeError(`unknown tool temp kind '${kind}'`);
    }
    if (options.parent !== undefined) {
      if (options.parent.trim() === "") {
        throw new TypeError(
          `tool temp kind '${kind}' received an empty parent`,
        );
      }
      if (policy.allowCallerParent !== true) {
        throw new TypeError(
          `tool temp kind '${kind}' does not accept a caller parent`,
        );
      }
    }
    const parent = options.parent ?? policy.parent;
    const dir = await operations.makeTempDir({
      ...(parent === undefined ? {} : { dir: parent }),
      prefix: policy.prefix,
    });
    const cleanup: { failure?: ToolTempDirCleanupError } = {};
    let callbackFailed = false;
    let primaryFailure: unknown;
    const outcome = await (async (): Promise<
      ToolTempDirCallbackOutcome<T>
    > => {
      try {
        return { ok: true, value: await fn(dir) };
      } catch (error) {
        callbackFailed = true;
        primaryFailure = error;
        return { error, ok: false };
      } finally {
        if (callbackFailed && policy.preserveOnFailure) {
          reportSafely(
            operations,
            `retained tool temp directory for '${kind}' at ${dir} after failure (${policy.purpose}): ${
              errorText(primaryFailure)
            }`,
          );
        } else {
          try {
            await operations.remove(dir, {
              recursive: policy.recursiveCleanup,
            });
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              cleanup.failure = new ToolTempDirCleanupError(
                kind,
                dir,
                policy.purpose,
                { cause: error },
              );
              if (callbackFailed) {
                reportSafely(
                  operations,
                  `${cleanup.failure.message}; preserving primary failure: ${
                    errorText(primaryFailure)
                  }`,
                );
              }
            }
          }
        }
      }
    })();

    if (!outcome.ok) throw outcome.error;
    if (cleanup.failure !== undefined) {
      throw cleanup.failure;
    }
    return outcome.value;
  };
}

/**
 * Run one repository tool callback inside its declared scratch directory.
 * The directory has ended when the promise settles and must not escape in the
 * callback's returned value.
 */
export const withToolTempDir = createToolTempDirCapability(
  TOOL_TEMP_DIR_KINDS,
);
