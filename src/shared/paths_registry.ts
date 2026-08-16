/**
 * The discern **paths registry** — the single source of truth for every
 * configurable source path (ADR 0102). Each entry defines one authored-surface
 * location: its config key (when it has one), its prescriptive default, and a
 * one-line description.
 *
 * Everything else derives from this table: the Zod schema's path `.default()`s
 * (`config_schema.ts`), the resolver helpers (`lib/paths.ts`), setup's seeding,
 * codegen, live source-path references, and the leakage guards. Adding a path
 * means adding one entry here — every satellite either auto-enrols or fails the
 * gate. A path default written as a literal anywhere else in `src/**` is a
 * defect.
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
  /** The prescriptive default. Authored sources live under `discern/`, away
   * from host-project paths. Directories carry their canonical shape
   * (`[map].dir` keeps its trailing slash; the skills/scripts dirs do not),
   * matching what the schema defaults and the shipped template write. */
  readonly defaultPath: string;
  /** Whether the write-surface contract admits one file or a directory tree. */
  readonly pathKind: "file" | "directory";
  /** How the write target is selected from config. */
  readonly resolution: "configured" | "instruction-seed" | "default";
  /** This authored path's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** Whether changes at this authored path skip the project gate by default. */
  readonly gateNeutral: boolean;
  /** One-line description of what lives at the path. */
  readonly description: string;
}

/** The visible namespace directory most authored sources default into (ADR 0099).
 * `discern.toml` stays at the root as the discovery marker. */
export const NAMESPACE_DIR = "discern/";

/** The source-path names, in display order. The single source of truth for the
 * path vocabulary; {@link SOURCE_PATHS} is pinned to it at compile time. */
export const SOURCE_PATH_NAMES = [
  "instructions",
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
  instructions: {
    key: "instructions.sources",
    defaultPath: "discern/instructions.md",
    pathKind: "file",
    resolution: "instruction-seed",
    ownership: { "project-owned": true },
    gateNeutral: true,
    description:
      "The project's instruction source, which discern compiles into the agent files.",
  },
  map: {
    key: "map.dir",
    defaultPath: "discern/map/",
    pathKind: "directory",
    resolution: "configured",
    ownership: { "project-owned": true },
    gateNeutral: true,
    description:
      "The project map — the agent-maintained documentation tree discern scaffolds, validates, and browses.",
  },
  skills: {
    key: "skills.dir",
    defaultPath: "discern/skills",
    pathKind: "directory",
    resolution: "configured",
    ownership: { "project-owned": true },
    gateNeutral: true,
    description: "Where the project's authored skills live.",
  },
  scripts: {
    key: "scripts.dir",
    defaultPath: "discern/scripts",
    pathKind: "directory",
    resolution: "configured",
    ownership: { "project-owned": true },
    gateNeutral: false,
    description: "Where the project's own executable scripts live.",
  },
  todo: {
    key: "project.todo",
    defaultPath: "discern/TODO.md",
    pathKind: "file",
    resolution: "configured",
    ownership: { "project-owned": true },
    gateNeutral: true,
    description:
      "The deferred-work ledger — the running TODO list agents read and maintain.",
  },
  brief: {
    key: null,
    defaultPath: "discern/brief.md",
    pathKind: "file",
    resolution: "default",
    ownership: { "project-owned": true },
    gateNeutral: true,
    description:
      "The project brief captured at setup — authored intent, read by the setup instructions.",
  },
};

/** One live reference derived from a configured source-path registry entry. */
export interface SourcePathReference {
  readonly name: SourcePathName;
  readonly key: string;
  readonly reference: string;
}

/** Every live source-path reference, in source-path registry order. Configured
 * members enrol automatically; other resolution modes deliberately expose no
 * reference because they do not name one stable scalar config value. */
export const SOURCE_PATH_REFERENCES: readonly SourcePathReference[] =
  SOURCE_PATH_NAMES.flatMap((name): SourcePathReference[] => {
    const entry = SOURCE_PATHS[name];
    if (entry.resolution !== "configured") return [];
    if (entry.key === null) {
      throw new Error(
        `${name}: configured source paths need a config key before they can expose a live reference`,
      );
    }
    return [{ name, key: entry.key, reference: `\${${entry.key}}` }];
  });

const SOURCE_PATH_REFERENCE_BY_NAME = new Map<SourcePathName, string>(
  SOURCE_PATH_REFERENCES.map(({ name, reference }) => [name, reference]),
);

/** The live reference for one configured registry member; absent for sources
 * whose concrete path is resolved by another rule. */
export function sourcePathReference(
  name: SourcePathName,
): string | undefined {
  return SOURCE_PATH_REFERENCE_BY_NAME.get(name);
}

/** The default path for source `name` — the ADR 0099 namespace location. */
export function sourcePathDefault(name: SourcePathName): string {
  return SOURCE_PATHS[name].defaultPath;
}

/** The glob vocabulary shared by concrete-path detection and config validation. */
export const GLOB_METACHARACTER_RE = /[*?[\]{}]/;

/** True when a configured path pattern is a concrete file path (no glob
 * metacharacters) — i.e. somewhere setup can seed a file. */
export function isConcretePath(pattern: string): boolean {
  return !GLOB_METACHARACTER_RE.test(pattern);
}

/**
 * The concrete file setup seeds the starter instructions into, given the configured
 * `[instructions].sources`: the first entry that is a plain path (no glob
 * metacharacters), else the registry default. One definition shared by the
 * seeding (`seedInstructions`) and the setup-progress checks, so "where does the
 * instruction stub live?" is answered identically everywhere.
 */
export function instructionSeedRel(sources: readonly string[]): string {
  return sources.find(isConcretePath) ?? SOURCE_PATHS.instructions.defaultPath;
}
