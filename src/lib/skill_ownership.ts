/**
 * Entry-level ownership inside the provider skills directories (ADR 0425).
 *
 * A provider skills directory (`.claude/skills/`, the shared `.agents/skills/`)
 * is shared ground: discern materializes its effective skill set there, and any
 * other tool may install skills beside them. discern owns exactly the entries
 * its materialization record names, plus the two control files it keeps beside
 * them — the record itself and an ignore file listing only those entries. Every
 * consumer that decides what discern owns there (materialization, the
 * tracked-artifacts check, doctor, uninstall) reads that answer from this
 * module, so no consumer can claim a whole directory again.
 */

import { join } from "@std/path";
import { allSkillsDirs } from "./providers.ts";
import { readDirIfExists, readTextIfExists } from "../shared/fs_presence.ts";
import {
  generatedArtifactMarker,
  isGeneratedArtifactMarker,
} from "../shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../shared/file_ownership.ts";
import type { EnvReader } from "../shared/env.ts";
import { runGit } from "../shared/subprocess.ts";

/**
 * discern's ownership record inside a skills directory: the entry names it
 * materialized on the last run. A dotfile, so provider skill discovery skips it.
 */
export const MATERIALIZED_MANIFEST = ".discern-materialized.json";

/**
 * The ignore file discern keeps inside each skills directory. Git reads nested
 * ignore files, so listing discern's entries here keeps them out of Git without
 * a directory-wide rule that would also hide every other tool's skills.
 */
export const SKILLS_IGNORE_FILE = ".gitignore";

/** discern's two control files, in the order the ignore file lists them. */
export const SKILLS_CONTROL_FILES: readonly string[] = Object.freeze([
  SKILLS_IGNORE_FILE,
  MATERIALIZED_MANIFEST,
]);

const IGNORE_SOURCE = ARTIFACT_PROVENANCE_SOURCES.skillsIgnore;

/**
 * The names discern materialized last run, or an empty set when the record is
 * absent or unreadable. A corrupt record owns nothing: every entry then reads as
 * foreign, which can only make discern do less, never delete the wrong thing.
 */
export async function readMaterializedNames(
  skillsDirAbs: string,
): Promise<Set<string>> {
  const text = await readTextIfExists(
    join(skillsDirAbs, MATERIALIZED_MANIFEST),
  );
  if (text === undefined) return new Set<string>();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((n): n is string => typeof n === "string"));
    }
    return new Set<string>();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: skills-materialized-manifest-decode-fallback
    return new Set<string>();
  }
}

/** Render the stable ownership-record body for one set of owned names. */
export function materializedNamesText(names: readonly string[]): string {
  return `${JSON.stringify([...names].sort(), null, 2)}\n`;
}

/** Escape one entry name as a literal pattern anchored to the skills directory.
 * No trailing slash: Git treats a symlinked (authored) skill as a file, and a
 * directory-only pattern would miss it. */
function ignorePattern(name: string): string {
  if (/[\r\n]/.test(name)) {
    throw new Error(
      `skill entry name ${
        JSON.stringify(name)
      } contains a line break, so no ignore rule can name it`,
    );
  }
  const escaped = name
    .replace(/[\\*?[]/g, (char) => `\\${char}`)
    .replace(/ +$/, (spaces) => spaces.replaceAll(" ", "\\ "));
  return `/${escaped}`;
}

/** The exact rule lines discern's ignore file carries for `names`. */
function skillsIgnoreRuleLines(names: readonly string[]): string[] {
  return [
    ...SKILLS_CONTROL_FILES,
    ...[...new Set(names)].sort(),
  ].map(ignorePattern);
}

/**
 * Render discern's ignore file for one skills directory: its provenance marker,
 * then one anchored rule per control file and per owned entry. Entries discern
 * does not own get no rule, so Git reports them like any other project file.
 */
export function renderSkillsIgnore(
  names: readonly string[],
  env: EnvReader = Deno.env,
): string {
  return [
    generatedArtifactMarker(IGNORE_SOURCE, env),
    "# Ignores only the skills discern materialized here. Other entries in",
    "# this directory stay visible to Git.",
    ...skillsIgnoreRuleLines(names),
    "",
  ].join("\n");
}

/** Whether `text` is an ignore file discern wrote: it opens with discern's marker. */
export function isDiscernSkillsIgnore(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return isGeneratedArtifactMarker(first, IGNORE_SOURCE);
}

/**
 * Whether discern's ignore file already carries exactly the rules for `names`.
 * Compares rules, not bytes, so a marker rendered under another attribution
 * setting never reads as drift.
 */
export function skillsIgnoreMatches(
  text: string,
  names: readonly string[],
): boolean {
  const actual = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const expected = skillsIgnoreRuleLines(names);
  return actual.length === expected.length &&
    actual.every((line, index) => line === expected[index]);
}

/** One directory entry, typed for removal and reporting. */
export interface SkillsDirEntry {
  readonly name: string;
  /** A real directory (a copied skill); a symlink or file is removed as itself. */
  readonly isDirectory: boolean;
}

/** Who owns each entry of one skills directory present on disk. */
export interface SkillsDirOwnership {
  /** Project-relative skills directory. */
  readonly dirRel: string;
  /** Entries the ownership record names. */
  readonly owned: readonly SkillsDirEntry[];
  /** discern's control files that are present. */
  readonly control: readonly string[];
  /** Every other entry, including an ignore file discern did not write. */
  readonly foreign: readonly SkillsDirEntry[];
}

/** Classify one skills directory's entries by the ownership record, or
 * `undefined` when the directory is absent. Reads only. */
export async function surveySkillsDir(
  root: string,
  dirRel: string,
): Promise<SkillsDirOwnership | undefined> {
  const abs = join(root, dirRel);
  const entries = await readDirIfExists(abs);
  if (entries === undefined) return undefined;
  const recorded = await readMaterializedNames(abs);
  const owned: SkillsDirEntry[] = [];
  const control: string[] = [];
  const foreign: SkillsDirEntry[] = [];
  for (const entry of entries) {
    const typed = {
      name: entry.name,
      isDirectory: entry.isDirectory && !entry.isSymlink,
    };
    if (entry.name === MATERIALIZED_MANIFEST) {
      control.push(entry.name);
    } else if (entry.name === SKILLS_IGNORE_FILE) {
      const text = entry.isFile
        ? await readTextIfExists(join(abs, entry.name))
        : undefined;
      if (text !== undefined && isDiscernSkillsIgnore(text)) {
        control.push(entry.name);
      } else {
        foreign.push(typed);
      }
    } else if (recorded.has(entry.name)) {
      owned.push(typed);
    } else {
      foreign.push(typed);
    }
  }
  const byName = (a: SkillsDirEntry, b: SkillsDirEntry): number =>
    a.name.localeCompare(b.name);
  return {
    dirRel,
    owned: owned.sort(byName),
    control: control.sort(),
    foreign: foreign.sort(byName),
  };
}

/** Survey every provider skills directory present on disk. Covers every known
 * agent, not just configured ones: a record left by a since-removed agent still
 * says what discern placed there. */
export async function surveySkillsDirs(
  root: string,
): Promise<SkillsDirOwnership[]> {
  const surveys: SkillsDirOwnership[] = [];
  for (const dirRel of allSkillsDirs()) {
    const survey = await surveySkillsDir(root, dirRel);
    if (survey !== undefined) surveys.push(survey);
  }
  return surveys;
}

/** Project-relative paths discern owns in one surveyed directory: each owned
 * entry and each present control file. */
export function discernOwnedSkillPaths(survey: SkillsDirOwnership): string[] {
  return [
    ...survey.owned.map((entry) => entry.name),
    ...survey.control,
  ].map((name) => `${survey.dirRel}/${name}`);
}

/** A foreign skills-directory entry that an ignore rule hides from Git. */
export interface HiddenForeignSkillEntry {
  readonly path: string;
  /** The matching rule as `<file>:<line>: <pattern>`. */
  readonly rule: string;
}

/** Where Git's ignore rules disagree with entry ownership. */
export interface SkillsIgnorePosture {
  /** Entries discern did not place that an ignore rule hides, so fresh clones
   * and worktrees will not carry them and new files beneath them are skipped. */
  readonly hiddenForeign: readonly HiddenForeignSkillEntry[];
  /** discern's entries and control files that no ignore rule covers. */
  readonly visibleOwned: readonly string[];
}

/**
 * Ask Git which surveyed entries its ignore rules match, independent of the
 * index, and report each mismatch with ownership. `undefined` when Git cannot
 * answer (not a repository, or Git failed).
 */
export async function skillsIgnorePosture(
  root: string,
  surveys: readonly SkillsDirOwnership[],
): Promise<SkillsIgnorePosture | undefined> {
  const owned = surveys.flatMap(discernOwnedSkillPaths);
  const foreign = new Set(
    surveys.flatMap((survey) =>
      survey.foreign.map((entry) => `${survey.dirRel}/${entry.name}`)
    ),
  );
  const paths = [...owned, ...foreign];
  if (paths.length === 0) return { hiddenForeign: [], visibleOwned: [] };
  const run = await runGit(
    [
      "check-ignore",
      "--stdin",
      "-z",
      "--verbose",
      "--non-matching",
      "--no-index",
    ],
    { cwd: root, stdin: paths.map((path) => `${path}\0`).join("") },
  );
  // check-ignore exits 0 when some path matched and 1 when none did.
  if (run.code !== 0 && run.code !== 1) return undefined;
  const fields = run.stdout.split("\0");
  const hiddenForeign: HiddenForeignSkillEntry[] = [];
  const matched = new Set<string>();
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [source = "", line = "", pattern = "", path = ""] = fields.slice(
      index,
      index + 4,
    );
    if (pattern === "" || pattern.startsWith("!")) continue;
    matched.add(path);
    if (foreign.has(path)) {
      hiddenForeign.push({ path, rule: `${source}:${line}: ${pattern}` });
    }
  }
  return {
    hiddenForeign,
    visibleOwned: owned.filter((path) => !matched.has(path)),
  };
}
