/**
 * The spawn-surface registry: the single source of truth for every file under
 * `src/` permitted to construct `Deno.Command`, and for the interrupt contract
 * each one owes.
 *
 * The invariant the registry carries: for every engine surface that spawns a
 * potentially long-running child, a signal delivered to the engine's PID must
 * stop and reap the child's whole process tree. Each home therefore declares
 * either the interrupt E2E `surfaces` that prove it black-box (the scenario
 * table in `engine_interrupt_surfaces_test.ts` is typed over the declared
 * union, so a declared surface without a scenario fails `deno check`), or a
 * written `exempt` justification a reviewer can audit.
 *
 * Enrollment is forced from both ends:
 *   - `engine_subprocess_ssot_test.ts` scans `src/` for every constructor site
 *     (any binary — a variable name evades a literal-`"sh"` regex, not the
 *     constructor scan) and fails on a file missing here or a stale `sites`
 *     count, so a fourth spawner cannot exist unregistered;
 *   - registering it forces the interrupt choice above, so the same spawner
 *     cannot join without either an interrupt E2E or a reviewed exemption.
 */

/** What a home may hand to `Deno.Command`: git, the shell, or another binary. */
export type SpawnBinary = "git" | "sh" | "other";

/** One file permitted to construct `Deno.Command`, and its contracts. */
export interface SpawnHome {
  /** Repo-relative path (forward slashes) of the permitted file. */
  readonly home: string;
  /** Exact number of `new Deno.Command(…)` sites the file is expected to hold —
   * a new site in an already-sanctioned home still forces a registry edit. */
  readonly sites: number;
  /** The binaries this home may spawn; drives the git/sh funnel guards. */
  readonly may: readonly SpawnBinary[];
  /** The interrupt contract: E2E-proven surfaces, or a justified exemption. */
  readonly interrupt:
    | { readonly surfaces: readonly string[] }
    | { readonly exempt: string };
}

export const SPAWN_HOMES = [
  {
    home: "src/shared/subprocess.ts",
    sites: 3,
    may: ["git", "sh"],
    interrupt: {
      exempt:
        "runGit runs engine-authored, self-terminating git subcommands and " +
        "commandExists a `command -v` probe — both bounded, neither carries " +
        "operator-supplied lifecycle work. runShell is buffered and has no " +
        "engine caller today; route it through the owned-child supervision " +
        "boundary and declare an interrupt surface here before pointing an " +
        "operator command at it.",
    },
  },
  {
    home: "src/shared/discern_commit.ts",
    sites: 1,
    may: ["git"],
    interrupt: {
      exempt:
        "the attributed, pathspec-limited commit of a discern-composed diff — " +
        "a bounded git write that exits on its own.",
    },
  },
  {
    home: "src/shared/third_party_codegen.ts",
    sites: 1,
    may: ["other"],
    interrupt: {
      exempt:
        "`deno info --json` over the repo graph — a bounded, engine-authored " +
        "read that exits on its own.",
    },
  },
  {
    home: "src/commands/docs.ts",
    sites: 1,
    may: ["sh", "other"],
    interrupt: {
      exempt: "the docs pager runs on the user's terminal in discern's own " +
        "foreground process group, so terminal-generated interrupts already " +
        "reach it, and it lives exactly as long as the reader wants it.",
    },
  },
  {
    home: "src/lib/open_browser.ts",
    sites: 1,
    may: ["other"],
    interrupt: {
      exempt:
        "the OS browser launcher is a single foreground `open`/`xdg-open` " +
        "handoff: terminal-generated interrupts reach the launcher in " +
        "discern's process group, while the browser it opens deliberately " +
        "outlives the CLI.",
    },
  },
  {
    home: "src/engine/owned_child.ts",
    sites: 1,
    may: ["other"],
    interrupt: {
      surfaces: [
        "project-script",
        "queue",
        "with-gotchas",
        "desk-interactive",
      ],
    },
  },
  {
    home: "src/engine/jobs/command.ts",
    sites: 1,
    may: ["sh"],
    interrupt: { surfaces: ["gate-job"] },
  },
  {
    home: "src/engine/worktree/shell.ts",
    sites: 1,
    may: ["sh"],
    interrupt: { surfaces: ["worktree-setup"] },
  },
  {
    home: "src/engine/mcp/version_check.ts",
    sites: 1,
    may: ["other"],
    interrupt: {
      exempt:
        "the `discern --version` handshake probe — bounded, exits immediately.",
    },
  },
] as const satisfies readonly SpawnHome[];

/**
 * The interrupt-E2E surface ids declared across the registry, as a literal
 * union. The scenario table in `engine_interrupt_surfaces_test.ts` is a
 * `Record` over this union, so declaring a surface without writing its
 * scenario — or orphaning a scenario — fails the gate's type check.
 */
export type InterruptSurface = Extract<
  (typeof SPAWN_HOMES)[number]["interrupt"],
  { readonly surfaces: readonly string[] }
>["surfaces"][number];

/** Every declared interrupt surface id, in registry order (with duplicates,
 * so the uniqueness guard can see a collision). */
export function declaredInterruptSurfaces(): string[] {
  return SPAWN_HOMES.flatMap((entry) =>
    "surfaces" in entry.interrupt ? [...entry.interrupt.surfaces] : []
  );
}

/** The homes permitted to spawn `binary`, for the funnel guards. */
export function homesThatMaySpawn(binary: SpawnBinary): Set<string> {
  const homes: readonly SpawnHome[] = SPAWN_HOMES;
  return new Set(
    homes.filter((entry) => entry.may.includes(binary))
      .map((entry) => entry.home),
  );
}
