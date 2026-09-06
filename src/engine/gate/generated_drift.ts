import type { ProducerBoundary } from "../validation/execute.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { join } from "@std/path";
import {
  generatedGroupForPath,
  type ResolvedGeneratedGroup,
} from "../../shared/generated_artifacts.ts";
import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import type { Diagnostic } from "../../shared/result.ts";
import { runGit } from "../../shared/subprocess.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "../scopes/scopes.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";

/** The generated paths and pending-work set observed at one Build boundary. */
export interface GeneratedBuildSnapshot {
  readonly artifacts: ReadonlyMap<string, string>;
  readonly pending: ReadonlyMap<string, string>;
}

/** One declared group whose command changed paths it owns. */
export interface GeneratedGroupDrift {
  readonly group: ResolvedGeneratedGroup;
  readonly paths: readonly string[];
}

/** Generated changes left by a green Build group. */
export interface GeneratedBuildDrift {
  readonly groups: readonly GeneratedGroupDrift[];
  readonly unownedPaths: readonly string[];
  readonly candidates: readonly ResolvedGeneratedGroup[];
}

/** Compute a lowercase SHA-256 digest for generated-file comparison. */
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Classify a path and fingerprint file bytes or symlink destinations. */
async function fingerprint(root: string, path: string): Promise<string> {
  const absolute = join(root, path);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(absolute);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return "missing";
    }
    throw error;
  }
  if (stat.isSymlink) {
    return `symlink:${await Deno.readLink(absolute)}`;
  }
  if (stat.isFile) {
    return `file:${await hashBytes(
      await Deno.readFile(absolute),
    )}`;
  }
  if (stat.isDirectory) {
    return "directory";
  }
  return "other";
}

/** Capture path-fingerprint pairs concurrently while retaining input order. */
async function fingerprintEntries(
  root: string,
  paths: readonly string[],
): Promise<readonly (readonly [string, string])[]> {
  return await Promise.all(
    paths.map(async (path) => [path, await fingerprint(root, path)] as const),
  );
}

/** Decode porcelain status, include rename sources, and remove the repository prefix. */
function pathsFromStatus(stdout: string, prefix: string): string[] {
  const paths: string[] = [];
  for (const entry of parsePorcelainZ(stdout)) {
    if (entry.origPath !== undefined) {
      paths.push(entry.origPath);
    }
    paths.push(entry.path);
  }
  return [...new Set(stripRepoPathPrefix(paths, prefix))];
}

/** Check a path against every declared glob owned by a generated group. */
function matchesGroup(path: string, group: ResolvedGeneratedGroup): boolean {
  return group.paths.some((pattern) => pathMatchesPattern(path, pattern));
}

/** Capture generated path bytes and the working-tree paths already pending. */
export async function captureGeneratedBuildSnapshot(
  root: string,
  groups: readonly ResolvedGeneratedGroup[],
): Promise<GeneratedBuildSnapshot | null> {
  if (groups.length === 0) {
    return { artifacts: new Map(), pending: new Map() };
  }
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return null;
  }
  const [listed, status] = await Promise.all([
    runGit(
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--full-name",
        "-z",
        "--",
      ],
      { cwd: root },
    ),
    runGit(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: root },
    ),
  ]);
  if (!listed.success || !status.success) {
    return null;
  }
  const candidates = stripRepoPathPrefix(
    splitNulRecords(listed.stdout),
    prefix,
  );
  const owned = candidates.filter((path) =>
    groups.some((group) => matchesGroup(path, group))
  );
  const pending = pathsFromStatus(status.stdout, prefix);
  const [artifactEntries, pendingEntries] = await Promise.all([
    fingerprintEntries(root, owned),
    fingerprintEntries(root, pending),
  ]);
  return {
    artifacts: new Map(artifactEntries),
    pending: new Map(pendingEntries),
  };
}

/** Find sorted paths whose generated fingerprints differ across build boundaries. */
function changedArtifactPaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path))
    .sort();
}

/** Attribute Build changes to declared groups and expose newly-dirty gaps. */
export function generatedBuildDrift(
  groups: readonly ResolvedGeneratedGroup[],
  before: GeneratedBuildSnapshot,
  after: GeneratedBuildSnapshot,
): GeneratedBuildDrift {
  const changed = changedArtifactPaths(before.artifacts, after.artifacts);
  const attributed = groups.flatMap((group): GeneratedGroupDrift[] => {
    const paths = changed.filter((path) => matchesGroup(path, group));
    return paths.length === 0 ? [] : [{ group, paths }];
  });
  const unownedPaths = [...after.pending]
    .filter(([path, fingerprint]) => before.pending.get(path) !== fingerprint)
    .map(([path]) => path)
    .filter((path) => generatedGroupForPath(groups, path) === undefined)
    .sort();
  return { groups: attributed, unownedPaths, candidates: groups };
}

/** Keep a diagnostic's inline path sample to 10 entries and count the remainder. */
function boundedPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 10).join(", ");
  return paths.length > 10 ? `${shown}, … (+${paths.length - 10} more)` : shown;
}

/** Explain which declared outputs a green generator left stale and how to reproduce it. */
async function groupDriftDiagnostic(
  root: string,
  drift: GeneratedGroupDrift,
): Promise<Diagnostic> {
  const { group, paths } = drift;
  const stale = paths.length === 1 ? "artifact was" : "artifacts were";
  const output = [
    `[generated.${group.name}] changed these declared paths:`,
    ...paths.map((path) => `  • ${path}`),
    "",
    `The committed ${stale} stale. Run \`${group.run}\`, review the regenerated bytes, commit the regeneration, then re-run \`discern done\`.`,
    "If the tree goes dirty again immediately after that commit, the generator is nondeterministic: the same tree did not produce the same bytes.",
  ].join("\n");
  return {
    tool: `generated:${group.name}`,
    severity: "error",
    message: `[generated.${group.name}] left ${paths.length} stale ${
      paths.length === 1 ? "artifact" : "artifacts"
    }: ${boundedPaths(paths)}`,
    reproduce_cmd: group.run,
    ...await diagnosticOutputFields(root, output),
  };
}

/** Report build outputs that no generated-group declaration owns. */
async function undercoverageDiagnostic(
  root: string,
  drift: GeneratedBuildDrift,
): Promise<Diagnostic> {
  const candidates = drift.candidates.map((group) =>
    `  • [generated.${group.name}]: ${group.run}`
  );
  const ambiguity = drift.candidates.length > 1
    ? "The Build jobs ran in parallel, so this run cannot identify which candidate group wrote each path."
    : "This run cannot prove that the lone generated candidate, rather than another Build job, wrote each path.";
  const output = [
    "Build changed paths that match no [generated.<name>].paths glob:",
    ...drift.unownedPaths.map((path) => `  • ${path}`),
    "",
    "Candidate generated groups:",
    ...candidates,
    "",
    ambiguity,
    "The generated declaration under-covers its output. Widen the responsible group's paths to own these files, commit the regeneration, then re-run `discern done`.",
  ].join("\n");
  return {
    tool: "generated-coverage",
    severity: "error",
    message:
      `The generated declaration under-covers ${drift.unownedPaths.length} build-stage path(s): ${
        boundedPaths(drift.unownedPaths)
      }`,
    reproduce_cmd: drift.candidates.length === 1
      ? drift.candidates[0]?.run ?? "discern done"
      : "discern done",
    ...await diagnosticOutputFields(root, output),
  };
}

/** Build one stale-artifact diagnostic per group plus any coverage diagnostic. */
export async function generatedBuildDriftDiagnostics(
  root: string,
  drift: GeneratedBuildDrift,
): Promise<Diagnostic[]> {
  const diagnostics = await Promise.all(
    drift.groups.map((group) => groupDriftDiagnostic(root, group)),
  );
  if (drift.unownedPaths.length > 0) {
    diagnostics.push(await undercoverageDiagnostic(root, drift));
  }
  return diagnostics;
}

/** Keep generator attribution at the Build barrier, before dependent checks can write files. */
export function createGeneratedBuildBoundary(
  root: string,
  groups: readonly ResolvedGeneratedGroup[],
  stages: ReadonlyMap<string, string>,
): {
  observer: ProducerBoundary;
  diagnostics: Diagnostic[];
  hints: FiredHint[];
} {
  const diagnostics: Diagnostic[] = [];
  const hints: FiredHint[] = [];
  let before: Promise<GeneratedBuildSnapshot | null> | undefined;
  const remaining = new Set<string>();
  let failed = false;
  return {
    diagnostics,
    hints,
    observer: {
      before: async (producer, plan): Promise<void> => {
        if (groups.length === 0 || stages.get(producer.selector) !== "build") {
          return;
        }
        if (before === undefined) {
          for (const member of plan.producers) {
            if (stages.get(member.selector) === "build") {
              remaining.add(member.selector);
            }
          }
          before = captureGeneratedBuildSnapshot(root, groups);
        }
        if (await before === null) {
          throw new Error(
            "Generated input capture is unavailable; no Build result can establish currency.",
          );
        }
      },
      after: async (producer, capture): Promise<void> => {
        if (!remaining.delete(producer.selector) || before === undefined) {
          return;
        }
        failed ||= capture.outcome !== "passed" || !capture.complete;
        if (remaining.size > 0 || failed) return;
        const initial = await before;
        const after = await captureGeneratedBuildSnapshot(root, groups);
        if (initial === null || after === null) {
          throw new Error(
            "Generated output capture is unavailable; preserve the checkout for diagnosis.",
          );
        }
        const drift = generatedBuildDrift(groups, initial, after);
        diagnostics.push(...await generatedBuildDriftDiagnostics(root, drift));
        hints.push(
          ...drift.groups.map(({ group }) =>
            fire(HINTS["gate-failure-generated-drift"], {
              group: group.name,
              run: group.run,
            })
          ),
        );
        if (drift.unownedPaths.length > 0) {
          hints.push(
            fire(HINTS["gate-failure-generated-undercoverage"], {
              groups: drift.candidates.map((group) => group.name),
            }),
          );
        }
        if (diagnostics.length > 0) {
          throw new Error(
            "Generated output changed at the Build boundary; review its owning group and commit the regeneration.",
          );
        }
      },
    },
  };
}
