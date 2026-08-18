/**
 * The **governing policy**: which checkpoints apply to this effort, resolved
 * from the configuration at the effort's MERGE-BASE with the trunk — never
 * the branch's own edits, never the live trunk tip. A branch adding, removing,
 * or weakening `[checkpoints]` tables therefore changes nothing for its own
 * gate; the edit takes effect for other efforts only after it lands. The
 * merge-base commit is the **policy identity**, reported separately from any
 * subject: `discern update` advances it together with a tree change, so
 * outcomes stay reproducible, and an unrelated advance moves the identity
 * without staling a single declaration.
 *
 * Resolution is deliberately LENIENT where the live loader is strict: the
 * governing config is history, not the file under the author's hands, so an
 * entry that cannot be resolved (an unknown scope, a missing criterion, a
 * config that does not load) drops out with an advisory instead of wedging
 * the effort — checkpoints FAIL OPEN on every uncertainty.
 *
 * `resolveCheckpoints` is the pure half: entry fields override a shipped
 * built-in seed's, scope selectors resolve through the same glob resolver the
 * scope classifier uses, `unless_changed` entries naming a configured scope
 * expand to its globs, and registered source-path references expand against
 * the SAME governing config — so a definition means one thing, computed in
 * one place.
 */

import { type DiscernConfig, parseConfig } from "../../shared/config_schema.ts";
import {
  BUILT_IN_CHECKPOINTS,
  type BuiltInCheckpointSeed,
  DEFAULT_CHECKPOINT_MODE,
} from "../../shared/checkpoints.ts";
import { criterionById } from "../../shared/criteria.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { expandSourcePathReferences } from "../../shared/source_path_references.ts";
import { runGit } from "../../shared/subprocess.ts";
import { resolvedScopePaths } from "../scopes/scopes.ts";
import type { ResolvedCheckpoint } from "./types.ts";

/** The governing policy for one effort. */
export interface GoverningPolicy {
  /** The merge-base commit whose config governs — the policy identity.
   * Undefined when it could not be resolved (the caller fails open). */
  policyCommit?: string;
  checkpoints: ResolvedCheckpoint[];
  /** Plain-language accounts of anything that could not govern. */
  advisories: string[];
}

/** Resolve every `[checkpoints.<id>]` entry of `config` (pure). `seeds`
 * defaults to the shipped built-in membership; tests inject synthetic seeds so
 * the resolution path is provable before (and independent of) the shipped
 * set. */
export function resolveCheckpoints(
  config: DiscernConfig,
  seeds: Readonly<Record<string, BuiltInCheckpointSeed>> = BUILT_IN_CHECKPOINTS,
): { checkpoints: ResolvedCheckpoint[]; advisories: string[] } {
  const checkpoints: ResolvedCheckpoint[] = [];
  const advisories: string[] = [];
  for (const [id, entry] of Object.entries(config.checkpoints)) {
    const seed = seeds[id];
    const seedCriterion = seed === undefined
      ? undefined
      : criterionById(seed.criterion);

    const criterion = entry.criterion !== undefined &&
        entry.criterion.trim() !== ""
      ? entry.criterion
      : seedCriterion?.criterion;
    if (criterion === undefined) {
      advisories.push(
        `checkpoint '${id}' names no shipped checkpoint and defines no criterion; it does not govern this run.`,
      );
      continue;
    }

    // The selector is ONE slot (`scope` xor `paths`): an entry that sets either
    // half replaces the seed's whole selector. Merging per field would pair an
    // entry's `paths` with a seed's `scope` and silently resolve the seed's
    // side, discarding the override.
    const entrySetsSelector = entry.scope !== undefined ||
      entry.paths !== undefined;
    const scope = entrySetsSelector ? entry.scope : seed?.scope;
    const paths = entrySetsSelector ? entry.paths : seed?.paths;
    if (entry.scope !== undefined && entry.paths !== undefined) {
      advisories.push(
        `checkpoint '${id}' sets both scope and paths; it does not govern this run.`,
      );
      continue;
    }
    let selector: ResolvedCheckpoint["selector"];
    if (scope !== undefined) {
      if (config.scopes[scope] === undefined) {
        advisories.push(
          `checkpoint '${id}' selects unknown scope '${scope}'; it does not govern this run.`,
        );
        continue;
      }
      selector = { scope, globs: resolvedScopePaths(config, scope) };
    } else if (paths !== undefined) {
      selector = {
        globs: paths.map((glob) => expandSourcePathReferences(glob, config)),
      };
    }

    const unlessChanged = (entry.unless_changed ?? seed?.unless_changed ?? [])
      .flatMap(
        (item) =>
          config.scopes[item] !== undefined
            ? resolvedScopePaths(config, item)
            : [expandSourcePathReferences(item, config)],
      );

    const teach = entry.teach ?? seedCriterion?.teach;
    const reference = seedCriterion?.reference;
    const when = entry.when !== undefined && entry.when.trim() !== ""
      ? entry.when
      : undefined;
    const minChangedFiles = entry.min_changed_files ?? seed?.min_changed_files;
    checkpoints.push({
      id,
      mode: entry.mode ?? seed?.mode ?? DEFAULT_CHECKPOINT_MODE,
      criterion,
      ...(teach === undefined ? {} : { teach }),
      ...(reference === undefined ? {} : { reference }),
      ...(selector === undefined ? {} : { selector }),
      unlessChanged,
      ...(minChangedFiles === undefined ? {} : { minChangedFiles }),
      deletionDominant: entry.deletion_dominant ?? seed?.deletion_dominant ??
        false,
      similarNewFile: entry.similar_new_file ?? seed?.similar_new_file ??
        false,
      ...(when === undefined ? {} : { when }),
    });
  }
  return { checkpoints, advisories };
}

/**
 * Whether a resolved checkpoint is DORMANT by configuration: its selector
 * exists but expands to nothing that could ever match — every glob is the
 * empty pattern, which the shared dialect defines as matching nothing (the
 * property that lets a shipped checkpoint reference an unset scalar such as
 * the gotchas doc and stay quiet until the owner names one). A selector-less
 * checkpoint watches the whole diff, so it is never dormant.
 */
export function structurallyDormant(def: ResolvedCheckpoint): boolean {
  const selector = def.selector;
  return selector !== undefined &&
    selector.globs.every((glob) => glob === "");
}

/**
 * The configured checkpoint ids whose triggers could structurally fire — the
 * hygiene candidate set. An entry resolution drops (it cannot govern) or one
 * dormant by configuration is excluded: "configured but never fired" is a
 * scoping signal, and a checkpoint that CANNOT fire yet is not mis-scoped,
 * it is waiting for the configuration that arms it.
 */
export function firableCheckpointIds(config: DiscernConfig): string[] {
  return resolveCheckpoints(config).checkpoints
    .filter((def) => !structurallyDormant(def))
    .map((def) => def.id)
    .sort();
}

/** The effort's merge-base with the trunk, or undefined when unanswerable. */
export async function policyMergeBase(
  root: string,
  trunk: string,
): Promise<string | undefined> {
  const out = await runGit(["merge-base", trunk, "HEAD"], { cwd: root });
  const sha = out.stdout.trim();
  return out.success && sha !== "" ? sha : undefined;
}

/**
 * Load the governing policy for the effort at `root`. `config` is the LIVE
 * config (it contributes only the trunk name; the env override wins, matching
 * every other trunk consumer) — the `[checkpoints]` tables that govern come
 * from the merge-base commit via git, not from any working tree.
 */
export async function loadGoverningPolicy(
  root: string,
  config: DiscernConfig,
): Promise<GoverningPolicy> {
  const trunk = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk) ||
    config.repository.trunk;
  const policyCommit = await policyMergeBase(root, trunk);
  if (policyCommit === undefined) {
    return {
      checkpoints: [],
      advisories: [
        `the merge-base with '${trunk}' could not be resolved; no checkpoints govern this run.`,
      ],
    };
  }
  // `:./` anchors the path at this project root even when the repository's
  // top level sits above it — the same spelling the standards trunk read uses.
  const shown = await runGit(["show", `${policyCommit}:./discern.toml`], {
    cwd: root,
  });
  if (!shown.success) {
    // No config at the merge-base: a pre-adoption history is ordinary, and
    // ordinary means no checkpoints and no advisory noise.
    return { policyCommit, checkpoints: [], advisories: [] };
  }
  let parsed: ReturnType<typeof parseConfig>;
  try {
    parsed = parseConfig(shown.stdout);
  } catch {
    parsed = { config: undefined, issues: [] };
  }
  if (parsed.config === undefined) {
    return {
      policyCommit,
      checkpoints: [],
      advisories: [
        `the governing configuration at ${
          policyCommit.slice(0, 12)
        } does not load; no checkpoints govern this run.`,
      ],
    };
  }
  const resolved = resolveCheckpoints(parsed.config);
  return { policyCommit, ...resolved };
}
