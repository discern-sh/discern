/**
 * The live, configured authored-source paths for discern's own checkout.
 *
 * Repository-wide guards scan these sources as they exist in this project, so
 * they must follow discern.toml rather than repeat the shipped defaults. Tests
 * of fresh-project defaults belong to the paths-registry and installer suites.
 *
 * This module also owns the Git-derived source universes used by repo-wide
 * structural sweeps: `AUTHORED_TS_FILES` for TypeScript-only checks and
 * `AUTHORED_DENO_FILES` for checks spanning every JavaScript/TypeScript source
 * extension Deno lints. A new authored tree widens matching guards at once.
 */

import { dirname, fromFileUrl, join, relative } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { isHostMetadataPath } from "../src/shared/host_metadata.ts";
import {
  resolveInstructionSources,
  resolveMapDir,
  resolveRepositoryManualDir,
  resolveScriptsDir,
  resolveSkillsDir,
  resolveTodoPath,
} from "../src/lib/paths.ts";
import { fileExists } from "../src/shared/fs_presence.ts";

export const REPO_ROOT: string = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
);

export interface RepoAuthoredPaths {
  instructions: string[];
  map: string;
  mapRel: string;
  manual: string;
  manualRel: string;
  scripts: string;
  scriptsRel: string;
  skills: string;
  todo: string;
}

const config = await loadConfig(REPO_ROOT);
const map = resolveMapDir(REPO_ROOT, config).abs;
const manual = resolveRepositoryManualDir(REPO_ROOT).abs;
const scripts = resolveScriptsDir(REPO_ROOT, config).abs;

export const REPO_AUTHORED_PATHS: RepoAuthoredPaths = {
  instructions: await resolveInstructionSources(REPO_ROOT, config),
  map,
  mapRel: relative(REPO_ROOT, map),
  manual,
  manualRel: relative(REPO_ROOT, manual),
  scripts,
  scriptsRel: relative(REPO_ROOT, scripts),
  skills: resolveSkillsDir(REPO_ROOT, config).abs,
  todo: resolveTodoPath(REPO_ROOT, config).abs,
};

/**
 * Trees whose TypeScript is inert test data rather than authored program text.
 * Fixtures may deliberately embody the patterns repo-wide guards ban — the same
 * boundary deno.json's fmt/lint/test excludes draw around them.
 */
const NON_AUTHORED_PREFIXES = ["tests/fixtures/"];

/** Git-derived file enumeration shared by every scan universe below: tracked
 * plus untracked-but-not-ignored files matching `patterns`, which keeps build
 * products and vendored trees (`dist/`, `node_modules/`, …) out because the
 * gitignore already names them. */
export interface GitListedRepoFilesOptions {
  /** Include inert TypeScript fixture data that authored-code universes omit. */
  readonly includeTestFixtures?: boolean;
}

/** Enumerate Git-known files once for canonical and specialized universes. */
export async function gitListedRepoFiles(
  root: string,
  patterns: readonly string[],
  options: GitListedRepoFilesOptions = {},
): Promise<string[]> {
  const { success, stdout, stderr } = await new Deno.Command("git", {
    args: [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...patterns,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) {
    throw new Error(
      `git ls-files failed under ${root}: ${new TextDecoder().decode(stderr)}`,
    );
  }
  const listed = new TextDecoder()
    .decode(stdout)
    .split("\0")
    .filter((rel) => rel.length > 0)
    .filter((rel) => !isHostMetadataPath(rel))
    .filter((rel) =>
      options.includeTestFixtures === true ||
      !NON_AUTHORED_PREFIXES.some((p) => rel.startsWith(p))
    );
  const present: string[] = [];
  for (const rel of listed) {
    // A file can stay in Git's index after deletion from the working tree;
    // guards read file contents, so enumerate only what exists on disk.
    if (await fileExists(join(root, rel))) present.push(rel);
  }
  return present.sort();
}

/**
 * Every authored TypeScript source under `root`, repo-relative and sorted.
 *
 * This is the scan universe for repo-wide structural guards: derive a sweep's
 * file set from here — never from a hand-kept root list — so a new authored
 * tree (say `tools/`) enrols in every guard the moment its first file exists.
 */
export async function authoredTsFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await gitListedRepoFiles(root, ["*.ts", "*.tsx"]);
}

/** Every authored source extension accepted by `deno lint`. */
export async function authoredDenoFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await gitListedRepoFiles(root, [
    "*.ts",
    "*.tsx",
    "*.mts",
    "*.cts",
    "*.js",
    "*.jsx",
    "*.mjs",
    "*.cjs",
  ]);
}

/** The authored-TypeScript universe of this checkout, enumerated once. */
export const AUTHORED_TS_FILES: string[] = await authoredTsFiles();

/** The authored JavaScript/TypeScript universe Deno lints, enumerated once. */
export const AUTHORED_DENO_FILES: string[] = await authoredDenoFiles();

/** The top-level trees holding authored TypeScript, derived from the universe. */
export const AUTHORED_TS_ROOTS: string[] = [
  ...new Set(AUTHORED_TS_FILES.map((rel) => rel.split("/")[0] ?? rel)),
].sort();

/**
 * Every tracked Markdown file under `root`, repo-relative and sorted — the
 * scan universe for repo-wide Markdown sweeps, enumerated the same way as the
 * TypeScript universe so a new tree of pages enrols the moment its first file
 * exists. Generated Markdown outputs (compiled agent files, codegen'd map
 * pages) are deliberately IN the universe: a sweep checks bytes wherever they
 * live, so a generator emitting a defective page fails the gate exactly like
 * a hand edit.
 */
export async function trackedMarkdownFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await gitListedRepoFiles(root, ["*.md"]);
}

/** The tracked-Markdown universe of this checkout, enumerated once. */
export const TRACKED_MD_FILES: string[] = await trackedMarkdownFiles();

/**
 * Extensions whose files hold genuine binary payloads — the only exemption
 * from the text universe. Grounded in what the repo tracks (images, Wasm
 * plugins, and compressed evidence); a new binary format must enrol here by name, so a stray
 * binary landing under a text extension still fails byte-level guards.
 */
const BINARY_EXTENSIONS = [".png", ".wasm", ".gz"];

/** Enumerate text-contract files, optionally including inert test fixtures. */
export async function gitListedTextFiles(
  root: string,
  options: GitListedRepoFilesOptions = {},
): Promise<string[]> {
  const listed = await gitListedRepoFiles(root, [], options);
  return listed.filter(
    (rel) => !BINARY_EXTENSIONS.some((ext) => rel.endsWith(ext)),
  );
}

/**
 * Every tracked or authored file that is text by contract — the whole
 * enumeration minus {@link BINARY_EXTENSIONS} — for guards about bytes
 * rather than language: any file here must stay readable by POSIX text
 * tools. Enumerated like the other universes, so a new tree or format
 * enrols the moment its first file exists.
 */
export async function authoredTextFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await gitListedTextFiles(root);
}

/** The authored-text universe of this checkout, enumerated once. */
export const AUTHORED_TEXT_FILES: string[] = await authoredTextFiles();

/** Whether `rel` is the configured map subtree named by `segments`. */
export function isRepoMapPath(rel: string, ...segments: string[]): boolean {
  const prefix = join(REPO_AUTHORED_PATHS.mapRel, ...segments);
  return rel === prefix || rel.startsWith(`${prefix}/`);
}
