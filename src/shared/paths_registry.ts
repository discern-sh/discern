/**
 * The discern **paths registry** — the single source of truth for every
 * configurable source path (ADR 0102). Each entry defines one authored-surface
 * location: its config key (when it has one), its prescriptive default, the
 * previous default a migration may need to carry, and a one-line description.
 *
 * Everything else derives from this table: the Zod schema's path `.default()`s
 * (`config_schema.ts`), the resolver helpers (`lib/paths.ts`), setup's seeding,
 * the migration, codegen, and the leakage guards. Adding a path means adding one
 * entry here — every satellite either auto-enrols or fails the gate. A path
 * default written as a literal anywhere else in `src/**` is a defect.
 */

import type { FileOwnershipDeclaration } from "./file_ownership.ts";

/** One configurable source path: where it is keyed, where it defaults, and what
 * lives there. */
export interface SourcePathEntry {
  /** The dotted config key that points it elsewhere, or `null` for a fixed
   * namespace location with no key (the brief — ADR 0102: it is setup-time
   * input, not an ongoing convention, so it gains a key only when a real need
   * appears). */
  readonly key: string | null;
  /** The prescriptive default. Most authored sources live under `discern/`; the
   * project map has its own root `map/` home so it cannot collide with a host
   * project's human documentation. Directories carry their canonical shape
   * (`[map].dir` keeps its trailing
   * slash; the skills/scripts dirs do not), matching what the schema defaults
   * and the shipped template write. */
  readonly defaultPath: string;
  /** The previous default a migration carries forward. It never seeds anything new. */
  readonly legacyPath: string;
  /** Whether the write-surface contract admits one file or a directory tree. */
  readonly pathKind: "file" | "directory";
  /** How the write target is selected from config. */
  readonly resolution: "configured" | "guidance-seed" | "default";
  /** This authored path's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** One-line description of what lives at the path. */
  readonly description: string;
}

/** The visible namespace directory most authored sources default into (ADR 0099).
 * `discern.toml` and the project map stay at the root. */
export const NAMESPACE_DIR = "discern/";

/** The source-path names, in display order. The single source of truth for the
 * path vocabulary; {@link SOURCE_PATHS} is pinned to it at compile time. */
export const SOURCE_PATH_NAMES = [
  "guidance",
  "map",
  "skills",
  "scripts",
  "todo",
  "brief",
] as const;

/** One configurable source path's name. */
export type SourcePathName = (typeof SOURCE_PATH_NAMES)[number];

/**
 * The registry. The `Record<SourcePathName, …>` annotation pins its keys to
 * {@link SOURCE_PATH_NAMES} at compile time, so the name list and the table can
 * never drift.
 */
export const SOURCE_PATHS: Readonly<Record<SourcePathName, SourcePathEntry>> = {
  guidance: {
    key: "guidance.sources",
    defaultPath: "discern/guidance.md",
    legacyPath: "guidance.md",
    pathKind: "file",
    resolution: "guidance-seed",
    ownership: { "project-owned": true },
    description:
      "The project's guidance source discern compiles into the agent files.",
  },
  map: {
    key: "map.dir",
    defaultPath: "map/",
    legacyPath: "discern/docs/",
    pathKind: "directory",
    resolution: "configured",
    ownership: { "project-owned": true },
    description:
      "The project map — the agent-maintained documentation tree discern scaffolds, validates, and browses.",
  },
  skills: {
    key: "skills.dir",
    defaultPath: "discern/skills",
    legacyPath: "skills",
    pathKind: "directory",
    resolution: "configured",
    ownership: { "project-owned": true },
    description: "Where the project's authored skills live.",
  },
  scripts: {
    key: "scripts.dir",
    defaultPath: "discern/scripts",
    legacyPath: "discern/recipes",
    pathKind: "directory",
    resolution: "configured",
    ownership: { "project-owned": true },
    description: "Where the project's own executable scripts live.",
  },
  todo: {
    key: "project.todo",
    defaultPath: "discern/TODO.md",
    legacyPath: "TODO.md",
    pathKind: "file",
    resolution: "configured",
    ownership: { "project-owned": true },
    description:
      "The deferred-work ledger — the running TODO list agents read and maintain.",
  },
  brief: {
    key: null,
    defaultPath: "discern/brief.md",
    legacyPath: "brief.md",
    pathKind: "file",
    resolution: "default",
    ownership: { "project-owned": true },
    description:
      "The project brief captured at setup — authored intent, read by the setup instructions.",
  },
};

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
