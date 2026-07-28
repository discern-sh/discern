/**
 * The maintained ADR index — the record lists kept between marker pairs in the
 * ADR README (`<map dir>/_adr/README.md`). Opt-in by construction: a README
 * that carries the markers is rewritten by `discern refresh` and watched for
 * drift by `status` and the gate; one without them is never touched, so an
 * existing project that has not adopted the index pays nothing.
 *
 * This module is the ONE computation of "what the index should say":
 * {@link adrIndexState} recompiles the expected README in memory from the
 * record files on disk — stateless, like the agent-file currency check — and
 * the refresh writer, the `status` advisory, and the gate's currency refusal
 * all read this single answer, so the checks can never disagree with what a
 * refresh writes. PURE: reads only; the write lives with the refresh compiler.
 */

import { join } from "@std/path";
import { normalizeMapDir } from "../shared/map_path.ts";
import { ADR_SUBDIR } from "./adr_numbers.ts";
import {
  ADR_CURRENT_RECORDS_START,
  ADR_SUPERSEDED_RECORDS_START,
  AdrIndexMarkerError,
  adrRecords,
  AdrRecordTitleError,
  discoverDocs,
  maintainAdrIndexDocument,
  renderAdrIndexBlocks,
} from "./docs.ts";

/**
 * Why an index cannot be derived. Each cause names a different artifact to
 * fix, so every consumer's remedy switches on it rather than pointing the
 * reader at the wrong file:
 * - `record` — a record file's first heading defeats title derivation; the
 *   remedy is editing that record (`issue` names it).
 * - `markers` — the README carries a start marker whose end marker is gone;
 *   the remedy is repairing the README's marker pair (the record files may
 *   all be fine).
 * - `error` — the derivation itself failed unexpectedly (an unreadable file,
 *   a denied read); the remedy is whatever underlying problem `issue` reports.
 */
export type AdrIndexInvalidCause = "record" | "markers" | "error";

/** How the maintained ADR index stands against the records on disk. */
export type AdrIndexState =
  /** No README, or a README with no marker pair — the index is not adopted. */
  | { kind: "absent" }
  /** The maintained lists already match the record files. */
  | { kind: "current"; path: string }
  /** A refresh would rewrite the lists — `expected` is what it writes. */
  | { kind: "stale"; path: string; current: string; expected: string }
  /** The index cannot be derived. A refresh cannot clear this; `cause` says
   * which artifact needs fixing and `issue` names it. */
  | {
    kind: "invalid";
    path: string;
    cause: AdrIndexInvalidCause;
    issue: string;
  };

/** The maintained README's project-relative path for a configured map dir. */
export function adrIndexPath(mapDir: string): string {
  return `${normalizeMapDir(mapDir)}${ADR_SUBDIR}/README.md`;
}

/**
 * Compare the ADR README on disk against the index a refresh would write.
 * `mapDir` is the configured `[map].dir`, relative to `root`.
 */
export async function adrIndexState(
  root: string,
  mapDir: string,
): Promise<AdrIndexState> {
  const rel = adrIndexPath(mapDir);
  const abs = join(root, rel);
  let current: string;
  try {
    current = await Deno.readTextFile(abs);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { kind: "absent" };
    }
    throw err;
  }
  if (
    !current.includes(ADR_CURRENT_RECORDS_START) &&
    !current.includes(ADR_SUPERSEDED_RECORDS_START)
  ) {
    return { kind: "absent" };
  }
  try {
    const tree = await discoverDocs({
      cwd: root,
      dir: join(root, normalizeMapDir(mapDir), ADR_SUBDIR),
      includeInternal: true,
    });
    const records = tree === undefined ? [] : adrRecords(tree.entries);
    const blocks = await renderAdrIndexBlocks(records);
    const { text } = maintainAdrIndexDocument(current, blocks);
    return text === current
      ? { kind: "current", path: rel }
      : { kind: "stale", path: rel, current, expected: text };
  } catch (err) {
    return {
      kind: "invalid",
      path: rel,
      cause: err instanceof AdrRecordTitleError
        ? "record"
        : err instanceof AdrIndexMarkerError
        ? "markers"
        : "error",
      issue: err instanceof Error ? err.message : String(err),
    };
  }
}
