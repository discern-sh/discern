/**
 * The discern **paths registry** — the single source of truth for every
 * configurable source path (ADR 0102). Each entry defines one authored-surface
 * location: its config key (when it has one), its prescriptive default under the
 * visible `discern/` namespace (ADR 0099), the pre-namespace location the 14→15
 * migration moves from, and a one-line description.
 *
 * Everything else derives from this table: the Zod schema's path `.default()`s
 * (`config_schema.ts`), the resolver helpers (`lib/paths.ts`), setup's seeding,
 * the migration, codegen, and the leakage guards. Adding a path means adding one
 * entry here — every satellite either auto-enrols or fails the gate. A path
 * default written as a literal anywhere else in `src/**` is a defect.
 */

/** One configurable source path: where it is keyed, where it defaults, and what
 * lives there. */
export interface SourcePathEntry {
  /** The dotted config key that points it elsewhere, or `null` for a fixed
   * namespace location with no key (the brief — ADR 0102: it is setup-time
   * input, not an ongoing convention, so it gains a key only when a real need
   * appears). */
  readonly key: string | null;
  /** The prescriptive default, inside the `discern/` namespace (ADR 0099).
   * Directories carry their canonical shape (`[docs].dir` keeps its trailing
   * slash; the skills/recipes dirs do not), matching what the schema defaults
   * and the shipped template write. */
  readonly defaultPath: string;
  /** The pre-namespace default this path lived at through schema 14 — what the
   * 14→15 migration moves from. Historical, never used to seed anything new. */
  readonly legacyPath: string;
  /** One-line description of what lives at the path. */
  readonly description: string;
}

/** The visible namespace directory every source path defaults into (ADR 0099).
 * `discern.toml` itself stays at the root as the discovery marker. */
export const NAMESPACE_DIR = "discern/";

/** The source-path names, in display order. The single source of truth for the
 * path vocabulary; {@link SOURCE_PATHS} is pinned to it at compile time. */
export const SOURCE_PATH_NAMES = [
  "guidance",
  "docs",
  "skills",
  "recipes",
  "todo",
  "brief",
] as const;

/** One configurable source path's name. */
export type SourcePathName = (typeof SOURCE_PATH_NAMES)[number];

/**
 * The registry. `satisfies Record<SourcePathName, …>` pins its keys to
 * {@link SOURCE_PATH_NAMES} at compile time, so the name list and the table can
 * never drift.
 */
export const SOURCE_PATHS = {
  guidance: {
    key: "guidance.sources",
    defaultPath: "discern/guidance.md",
    legacyPath: "guidance.md",
    description:
      "The user's guideline source discern compiles into the agent files.",
  },
  docs: {
    key: "docs.dir",
    defaultPath: "discern/docs/",
    legacyPath: "docs/",
    description:
      "The agent documentation tree discern scaffolds, validates, and browses.",
  },
  skills: {
    key: "skills.dir",
    defaultPath: "discern/skills",
    legacyPath: "skills",
    description: "Where the project's authored skills live.",
  },
  recipes: {
    key: "recipes.dir",
    defaultPath: "discern/recipes",
    legacyPath: "recipes",
    description: "Where the project's own `discern` recipe commands live.",
  },
  todo: {
    key: "project.todo",
    defaultPath: "discern/TODO.md",
    legacyPath: "TODO.md",
    description:
      "The deferred-work ledger — the running TODO list agents read and maintain.",
  },
  brief: {
    key: null,
    defaultPath: "discern/brief.md",
    legacyPath: "brief.md",
    description:
      "The project brief captured at setup — authored intent, read by the setup instructions.",
  },
} as const satisfies Record<SourcePathName, SourcePathEntry>;

/** The default path for source `name` — the ADR 0099 namespace location. */
export function sourcePathDefault(name: SourcePathName): string {
  return SOURCE_PATHS[name].defaultPath;
}

/** True when a configured path pattern is a concrete file path (no glob
 * metacharacters) — i.e. somewhere setup can seed a file. */
export function isConcretePath(pattern: string): boolean {
  return !/[*?[\]{}]/.test(pattern);
}

/**
 * The concrete file setup seeds the starter guidance into, given the configured
 * `[guidance].sources`: the first entry that is a plain path (no glob
 * metacharacters), else the registry default. One definition shared by the
 * seeding (`seedGuidance`) and the setup-progress checks, so "where does the
 * guidance stub live" is answered identically everywhere.
 */
export function guidanceSeedRel(sources: readonly string[]): string {
  return sources.find(isConcretePath) ?? SOURCE_PATHS.guidance.defaultPath;
}
