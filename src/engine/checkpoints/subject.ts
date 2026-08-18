/**
 * Checkpoint **subjects** — what a declaration is about, made precise enough
 * that reopening is relevance-sensitive:
 *
 *   - the **definition hash** covers the canonical RESOLVED definition (every
 *     trigger field with scopes and references already expanded, the mode, the
 *     criterion/teach/reference prose, and the `when` command text), so a
 *     changed definition reopens its episode without dragging the merge-base
 *     commit into every subject;
 *   - the **subject fingerprint** covers the definition hash plus each sorted
 *     matched path's state: the path, its merge-base mode and blob (or
 *     absence), and its CURRENT working-tree mode and blob (or absence).
 *
 * Current content is identified by git's own content addressing — dirty and
 * untracked files hash through `git hash-object`, which applies the same
 * clean filters as a commit would — so an untouched file carries the same
 * blob id on both sides, an unrelated branch edit or trunk update moves
 * nothing, and any edit to matched content moves the fingerprint. Renames
 * stay a deletion plus an addition (two path states), and the policy identity
 * (the merge-base commit) deliberately stays OUT of the material: it may move
 * independently without staling every declaration.
 *
 * State that cannot be read — a broken ref, an unreadable file — returns an
 * `error`, and the caller fails open; a declaration must never bind to a
 * subject the engine only guessed at.
 */

import { join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { splitNulRecords } from "../../shared/git_paths.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "../scopes/scopes.ts";
import type { ResolvedCheckpoint } from "./types.ts";

/** Version tag mixed into the definition-hash material: bump it when the
 * canonicalization changes shape, so an old and a new engine can never read
 * the same bytes as the same definition. */
const DEFINITION_MATERIAL_VERSION = "checkpoint-definition/v1";

/** Version tag mixed into the subject-fingerprint material. */
const SUBJECT_MATERIAL_VERSION = "checkpoint-subject/v1";

/** Files per `git hash-object` invocation — bounds the argv length. */
const HASH_OBJECT_BATCH = 500;

/** One side of a path's state: its git file mode and blob (content) id. */
export interface PathStateSide {
  mode: string;
  blob: string;
}

/** One matched path's state on both sides of the effort. An absent side means
 * the path does not exist there (deleted, or not yet added). */
export interface PathState {
  path: string;
  base?: PathStateSide;
  current?: PathStateSide;
}

/** The computed subject: the fingerprint a declaration binds to, plus the
 * evidence it was computed from (for renderings and the episode record). */
export interface CheckpointSubject {
  definitionHash: string;
  fingerprint: string;
  paths: readonly PathState[];
}

/** Either a computed subject or the reason it could not be computed. */
export type SubjectComputation =
  | { subject: CheckpointSubject }
  | { error: string };

/**
 * Hash the canonical resolved definition. Field presence is normalized (an
 * absent optional serializes as null) and the key order is fixed by literal
 * construction, so the same resolved definition always yields the same hash —
 * and the checkpoint's id deliberately stays out: episodes already key by id,
 * and the hash answers "did the MEANING change", not "which checkpoint".
 */
export async function checkpointDefinitionHash(
  def: ResolvedCheckpoint,
): Promise<string> {
  const material = JSON.stringify({
    criterion: def.criterion,
    deletion_dominant: def.deletionDominant,
    min_changed_files: def.minChangedFiles ?? null,
    mode: def.mode,
    reference: def.reference ?? null,
    selector_globs: def.selector === undefined ? null : [...def.selector.globs],
    similar_new_file: def.similarNewFile,
    teach: def.teach ?? null,
    unless_changed: [...def.unlessChanged],
    when: def.when ?? null,
  });
  return await sha256Hex(`${DEFINITION_MATERIAL_VERSION}\n${material}`);
}

/** Parse `git ls-tree -r -z` records (`<mode> <type> <oid>\t<path>`) into a
 * path → side map, keeping blobs and submodule links (a directory entry never
 * appears under `-r`). */
function parseLsTreeZ(stdout: string): Map<string, PathStateSide> {
  const out = new Map<string, PathStateSide>();
  for (const record of splitNulRecords(stdout)) {
    const tab = record.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const [mode, , oid] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (mode !== undefined && oid !== undefined && path !== "") {
      out.set(path, { mode, blob: oid });
    }
  }
  return out;
}

/** The git file mode for a working-tree regular file: executable or not. */
function fileMode(info: Deno.FileInfo): string {
  const mode = info.mode;
  return mode !== null && (mode & 0o111) !== 0 ? "100755" : "100644";
}

/**
 * Compute one checkpoint's subject at `root`: `definitionHash` as produced by
 * {@link checkpointDefinitionHash}, `matchedPaths` from the trigger outcome
 * (or a declared match set), and `policyBase` the effort's merge-base commit.
 * Returns an `error` when any needed state cannot be read.
 */
export async function computeSubject(
  root: string,
  definitionHash: string,
  matchedPaths: readonly string[],
  policyBase: string,
): Promise<SubjectComputation> {
  const paths = [...new Set(matchedPaths)].sort();
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return { error: "git could not locate the repository at the project root" };
  }

  // Base side: one recursive listing over exactly the matched pathspecs. A
  // pathspec matching nothing simply lists nothing (absent in base).
  const wanted = new Set(paths);
  const baseStates = new Map<string, PathStateSide>();
  if (paths.length > 0) {
    const listing = await runGit(
      [
        "ls-tree",
        "-r",
        "-z",
        policyBase,
        "--",
        ...paths.map((path) => `${prefix}${path}`),
      ],
      { cwd: root },
    );
    if (!listing.success) {
      return {
        error: `git could not read the merge-base tree: ${
          listing.stderr.trim().split("\n")[0] ?? "ls-tree failed"
        }`,
      };
    }
    for (const [path, side] of parseLsTreeZ(listing.stdout)) {
      const [rel] = stripRepoPathPrefix([path], prefix);
      // A directory pathspec would list children; keep exactly the matched paths.
      if (rel !== undefined && wanted.has(rel)) {
        baseStates.set(rel, side);
      }
    }
  }

  // Current side: identify each on-disk file by git's own content addressing.
  const currentStates = new Map<string, PathStateSide>();
  const regular: string[] = [];
  for (const path of paths) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(join(root, path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue; // absent on disk — the current side stays unset
      }
      return {
        error: `could not read the working state of ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (info.isSymlink) {
      let target: string;
      try {
        target = await Deno.readLink(join(root, path));
      } catch (error) {
        return {
          error: `could not read the symlink at ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      const hashed = await runGit(
        ["hash-object", "-t", "blob", "--stdin"],
        { cwd: root, stdin: target },
      );
      if (!hashed.success) {
        return { error: `git could not hash the symlink at ${path}` };
      }
      currentStates.set(path, { mode: "120000", blob: hashed.stdout.trim() });
      continue;
    }
    if (info.isDirectory) {
      continue; // a directory has no content identity; it reads as absent
    }
    currentStates.set(path, { mode: fileMode(info), blob: "" });
    regular.push(path);
  }
  for (let i = 0; i < regular.length; i += HASH_OBJECT_BATCH) {
    const batch = regular.slice(i, i + HASH_OBJECT_BATCH);
    const hashed = await runGit(["hash-object", "--", ...batch], {
      cwd: root,
    });
    if (!hashed.success) {
      return {
        error: `git could not hash the working content: ${
          hashed.stderr.trim().split("\n")[0] ?? "hash-object failed"
        }`,
      };
    }
    const oids = hashed.stdout.trim().split("\n");
    if (oids.length !== batch.length) {
      return { error: "git hash-object answered for the wrong file count" };
    }
    for (let j = 0; j < batch.length; j++) {
      const path = batch[j];
      const oid = oids[j];
      const side = path === undefined ? undefined : currentStates.get(path);
      if (side === undefined || oid === undefined || oid === "") {
        return { error: "git hash-object answered incompletely" };
      }
      side.blob = oid;
    }
  }

  const states: PathState[] = paths.map((path) => {
    const base = baseStates.get(path);
    const current = currentStates.get(path);
    return {
      path,
      ...(base === undefined ? {} : { base }),
      ...(current === undefined ? {} : { current }),
    };
  });
  const lines = states.map((state) => {
    const side = (s: PathStateSide | undefined): string =>
      s === undefined ? "-" : `${s.mode} ${s.blob}`;
    return `${state.path}\0${side(state.base)}\0${side(state.current)}`;
  });
  const fingerprint = await sha256Hex(
    `${SUBJECT_MATERIAL_VERSION}\n${definitionHash}\n${lines.join("\n")}`,
  );
  return { subject: { definitionHash, fingerprint, paths: states } };
}
