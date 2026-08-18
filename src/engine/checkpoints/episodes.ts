/**
 * Checkpoint **episodes** — the effort-scoped record that a checkpoint fired,
 * and the **declarations** an agent binds to them. The store lives in the
 * per-worktree Git administrative area (the registered `checkpointEpisodes`
 * entry, beside the gate's own markers), so it survives session restarts and
 * disappears with the worktree.
 *
 * An episode is the ONLY thing a declaration can act on: recording one for a
 * checkpoint with no episode is an error, which is what forces the
 * criterion-serving moment — checkpoint ids are public config, and the
 * episode, not secrecy, gates the act. A declaration is one exhaustive
 * conclusion: `met`, or `unmet` with its required rationale; both bind to the
 * definition hash and subject fingerprint they judged. The unmet rationale is
 * OPAQUE EVIDENCE — validated for shape before any write (trimmed, one
 * paragraph, 1–500 characters, no control characters), never interpreted as
 * policy, and rendered only through standard escaping boundaries.
 *
 * Every operation is idempotent per (checkpoint, subject, declaration
 * evidence): reconciling an unchanged subject carries the episode untouched,
 * re-recording identical evidence changes nothing (the original timestamp
 * stands), and changed evidence replaces the conclusion in place. A store
 * that cannot be parsed reads as `invalid` so the caller can FAIL OPEN;
 * a write over one rebuilds from empty (`recovered`), which at worst asks
 * for a fresh declaration — the conservative direction.
 */

import { dirname } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";

/** The store's on-disk schema version (one line of JSON). */
const EPISODES_STORE_VERSION = 1;

/** Bounds of a trimmed unmet rationale. */
export const UNMET_RATIONALE_MAX_LENGTH = 500;

/** The agent's recorded conclusion for one checkpoint, bound to its subject. */
export type CheckpointDeclaration =
  | {
    conclusion: "met";
    definitionHash: string;
    subject: string;
    declaredAt: string;
  }
  | {
    conclusion: "unmet";
    /** The validated rationale — opaque evidence, never policy. */
    why: string;
    definitionHash: string;
    subject: string;
    declaredAt: string;
  };

/** One checkpoint's current episode. `subject`/`definitionHash` describe what
 * the checkpoint is about NOW; the declaration (when present) records what was
 * judged, and is current only while its own binding matches the episode's. */
export interface CheckpointEpisode {
  checkpoint: string;
  definitionHash: string;
  subject: string;
  /** The matched paths behind the subject, for serving and renderings. */
  matchedPaths: readonly string[];
  openedAt: string;
  /** Set when a relevant change replaced the subject or definition. */
  reopenedAt?: string;
  declaration?: CheckpointDeclaration;
}

/** Whether an episode's declaration is current — bound to the episode's own
 * definition and subject rather than an earlier state. */
export function declarationIsCurrent(episode: CheckpointEpisode): boolean {
  const declaration = episode.declaration;
  return declaration !== undefined &&
    declaration.definitionHash === episode.definitionHash &&
    declaration.subject === episode.subject;
}

// ── rationale validation ────────────────────────────────────────────────────

/** The unmet rationale's shape check, applied BEFORE any state write. */
export type RationaleValidation =
  | { ok: true; rationale: string }
  | { ok: false; reason: string };

/**
 * Validate an unmet rationale: trim it, require one paragraph of 1–500
 * characters, and reject newlines, tabs, and every other control character.
 * The accepted value is the trimmed text — the exact bytes later surfaces
 * render (through their own escaping); nothing here interprets it.
 */
export function validateUnmetRationale(raw: string): RationaleValidation {
  const rationale = raw.trim();
  if (rationale.length === 0) {
    return {
      ok: false,
      reason: "an unmet declaration needs a rationale (1-500 characters).",
    };
  }
  if (rationale.length > UNMET_RATIONALE_MAX_LENGTH) {
    return {
      ok: false,
      reason:
        `the rationale is ${rationale.length} characters; keep it one paragraph of at most ${UNMET_RATIONALE_MAX_LENGTH}.`,
    };
  }
  // Beside the control characters: the format class (Cf — bidi overrides and
  // zero-width characters can make displayed text diverge from recorded
  // text) and the Unicode line/paragraph separators (Zl, Zp — they break the
  // one-paragraph shape without being Cc).
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(rationale)) {
    return {
      ok: false,
      reason:
        "the rationale must be one paragraph: no newlines, tabs, or other control or invisible formatting characters.",
    };
  }
  return { ok: true, rationale };
}

// ── the store ───────────────────────────────────────────────────────────────

/** How reading the episode store went. `invalid` and `unavailable` are the
 * caller's fail-open cues; `missing` is simply "no checkpoint has fired". */
export type EpisodesRead =
  | { status: "ok"; episodes: Record<string, CheckpointEpisode> }
  | { status: "missing" }
  | { status: "invalid"; reason: string }
  | { status: "unavailable"; reason: string };

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one persisted declaration, or undefined for a mis-shaped one. */
function parseDeclaration(value: unknown): CheckpointDeclaration | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { conclusion, definitionHash, subject, declaredAt } = value;
  if (
    typeof definitionHash !== "string" || typeof subject !== "string" ||
    typeof declaredAt !== "string"
  ) {
    return undefined;
  }
  if (conclusion === "met") {
    return { conclusion, definitionHash, subject, declaredAt };
  }
  if (conclusion === "unmet" && typeof value.why === "string") {
    return { conclusion, why: value.why, definitionHash, subject, declaredAt };
  }
  return undefined;
}

/** Parse one persisted episode, or undefined for a mis-shaped one. */
function parseEpisode(
  checkpoint: string,
  value: unknown,
): CheckpointEpisode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { definitionHash, subject, matchedPaths, openedAt } = value;
  if (
    typeof definitionHash !== "string" || typeof subject !== "string" ||
    typeof openedAt !== "string" || !Array.isArray(matchedPaths) ||
    !matchedPaths.every((p): p is string => typeof p === "string")
  ) {
    return undefined;
  }
  const episode: CheckpointEpisode = {
    checkpoint,
    definitionHash,
    subject,
    matchedPaths,
    openedAt,
  };
  if (typeof value.reopenedAt === "string") {
    episode.reopenedAt = value.reopenedAt;
  }
  if (value.declaration !== undefined) {
    const declaration = parseDeclaration(value.declaration);
    if (declaration === undefined) {
      return undefined;
    }
    episode.declaration = declaration;
  }
  return episode;
}

/** Parse the store's text, or undefined when any part is mis-shaped. */
function parseStore(
  raw: string,
): Record<string, CheckpointEpisode> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.version !== EPISODES_STORE_VERSION) {
    return undefined;
  }
  if (!isRecord(value.episodes)) {
    return undefined;
  }
  const episodes: Record<string, CheckpointEpisode> = {};
  for (const [checkpoint, entry] of Object.entries(value.episodes)) {
    const episode = parseEpisode(checkpoint, entry);
    if (episode === undefined) {
      return undefined;
    }
    episodes[checkpoint] = episode;
  }
  return episodes;
}

/** Read this worktree's episode store. */
export async function readEpisodes(cwd: string): Promise<EpisodesRead> {
  const path = await gitAdminStatePath(cwd, "checkpointEpisodes");
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the checkpoint-episode path",
    };
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing" };
    }
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const episodes = parseStore(raw);
  return episodes === undefined
    ? {
      status: "invalid",
      reason: "the checkpoint-episode record did not parse",
    }
    : { status: "ok", episodes };
}

/** Persist every byte, retrying partial writes and rejecting a zero-byte write. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (written === 0) {
      throw new Error("short write while recording checkpoint episodes");
    }
    offset += written;
  }
}

/** Persist the whole store as one line of JSON — written to a same-directory
 * temp file, synced, then atomically renamed into place (the acceptance
 * journal's durability pattern), so an interrupted write can garble only the
 * abandoned temp, never the standing store of recorded judgments. */
async function writeEpisodes(
  path: string,
  episodes: Record<string, CheckpointEpisode>,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    const file = await Deno.open(temp, { createNew: true, write: true });
    try {
      await writeAll(
        file,
        new TextEncoder().encode(
          `${JSON.stringify({ version: EPISODES_STORE_VERSION, episodes })}\n`,
        ),
      );
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.rename(temp, path);
  } finally {
    try {
      await Deno.remove(temp);
    } catch {
      // Already renamed into place (the ordinary case) or never created.
    }
  }
}

/** Load the store for a write: current episodes, or a fresh table (with
 * `recovered` marking an unparseable store that was rebuilt from empty). */
async function loadForWrite(
  cwd: string,
): Promise<
  | {
    ok: true;
    path: string;
    episodes: Record<string, CheckpointEpisode>;
    recovered: boolean;
  }
  | { ok: false; reason: string }
> {
  const path = await gitAdminStatePath(cwd, "checkpointEpisodes");
  if (path === undefined) {
    return {
      ok: false,
      reason: "Git could not resolve the checkpoint-episode path",
    };
  }
  const read = await readEpisodes(cwd);
  switch (read.status) {
    case "ok":
      return {
        ok: true,
        path,
        episodes: { ...read.episodes },
        recovered: false,
      };
    case "missing":
      return { ok: true, path, episodes: {}, recovered: false };
    case "invalid":
      // Rebuild from empty: at worst a conclusion must be declared again,
      // which is the conservative direction for judgment evidence.
      return { ok: true, path, episodes: {}, recovered: true };
    case "unavailable":
      return { ok: false, reason: read.reason };
  }
}

// ── operations ──────────────────────────────────────────────────────────────

/** What reconciling one checkpoint's episode did. */
export type ReconcileEpisodeResult =
  | {
    ok: true;
    episode: CheckpointEpisode;
    outcome: "opened" | "reopened" | "carried";
    /** True when an unparseable store was rebuilt from empty on this write. */
    recovered: boolean;
    /** On a reopen, when the replaced subject was last served (its reopen or
     * open time) — the serving a declaration in this same invocation actually
     * responds to; the reopened episode's own timestamps carry the reopen
     * instant instead. */
    previousServedAt?: string;
  }
  | { ok: false; reason: string };

/**
 * Create or refresh one checkpoint's episode for the given definition hash and
 * subject — idempotent per (checkpoint, subject): an unchanged pair carries
 * the episode untouched (no write); a changed pair REOPENS it in place,
 * keeping any declaration record (it simply stops being current: its
 * binding differs from the episode's). `now` exists for deterministic tests.
 */
export async function reconcileEpisode(
  cwd: string,
  next: {
    checkpoint: string;
    definitionHash: string;
    subject: string;
    matchedPaths: readonly string[];
  },
  now: string = new Date().toISOString(),
): Promise<ReconcileEpisodeResult> {
  const store = await loadForWrite(cwd);
  if (!store.ok) {
    return { ok: false, reason: store.reason };
  }
  const existing = store.episodes[next.checkpoint];
  if (
    existing !== undefined &&
    existing.definitionHash === next.definitionHash &&
    existing.subject === next.subject
  ) {
    // Same checkpoint, same subject: nothing to write. (A recovered store
    // never reaches here — it rebuilt empty, so nothing exists to match.)
    return {
      ok: true,
      episode: existing,
      outcome: "carried",
      recovered: false,
    };
  }
  const episode: CheckpointEpisode = existing === undefined
    ? {
      checkpoint: next.checkpoint,
      definitionHash: next.definitionHash,
      subject: next.subject,
      matchedPaths: [...next.matchedPaths],
      openedAt: now,
    }
    : {
      ...existing,
      definitionHash: next.definitionHash,
      subject: next.subject,
      matchedPaths: [...next.matchedPaths],
      reopenedAt: now,
    };
  store.episodes[next.checkpoint] = episode;
  try {
    await writeEpisodes(store.path, store.episodes);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: true,
    episode,
    outcome: existing === undefined ? "opened" : "reopened",
    recovered: store.recovered,
    ...(existing === undefined
      ? {}
      : { previousServedAt: existing.reopenedAt ?? existing.openedAt }),
  };
}

/** The evidence of a declaration, minus the timestamp — the identity the
 * idempotence contract compares. */
export type DeclarationEvidence =
  | { conclusion: "met"; definitionHash: string; subject: string }
  | {
    conclusion: "unmet";
    why: string;
    definitionHash: string;
    subject: string;
  };

/** What recording one declaration did. */
export type DeclareResult =
  | {
    ok: true;
    episode: CheckpointEpisode;
    /** False when identical evidence already stood (the original timestamp
     * remains — a repeat is a no-op, not a fresher claim). */
    changed: boolean;
  }
  | {
    ok: false;
    error: "no_episode" | "invalid_rationale" | "store_unavailable";
    reason: string;
  };

/** Whether two declaration evidence identities are the same claim. */
function sameEvidence(
  a: CheckpointDeclaration,
  b: DeclarationEvidence,
): boolean {
  if (
    a.conclusion !== b.conclusion || a.definitionHash !== b.definitionHash ||
    a.subject !== b.subject
  ) {
    return false;
  }
  return a.conclusion === "met" ||
    (b.conclusion === "unmet" && a.why === b.why);
}

/**
 * Record one declaration against its checkpoint's ACTIVE episode. A
 * checkpoint with no episode is an error — creating an episode (a bare gate
 * run finding the trigger active) is the only way a checkpoint becomes
 * declarable. An unmet rationale is validated here, before any write, however
 * the caller sourced it. Identical evidence is a no-op; different evidence
 * (the other conclusion, or a changed rationale) replaces the declaration in
 * place. `now` exists for deterministic tests.
 */
export async function recordDeclaration(
  cwd: string,
  evidence: DeclarationEvidence,
  checkpoint: string,
  now: string = new Date().toISOString(),
): Promise<DeclareResult> {
  let normalized = evidence;
  if (evidence.conclusion === "unmet") {
    const validated = validateUnmetRationale(evidence.why);
    if (!validated.ok) {
      return {
        ok: false,
        error: "invalid_rationale",
        reason: validated.reason,
      };
    }
    normalized = { ...evidence, why: validated.rationale };
  }
  const store = await loadForWrite(cwd);
  if (!store.ok) {
    return { ok: false, error: "store_unavailable", reason: store.reason };
  }
  const episode = store.episodes[checkpoint];
  if (episode === undefined) {
    return {
      ok: false,
      error: "no_episode",
      reason:
        `checkpoint '${checkpoint}' has no active episode here — a declaration records a judgment the gate asked for, so run the gate first.`,
    };
  }
  if (
    episode.declaration !== undefined &&
    sameEvidence(episode.declaration, normalized)
  ) {
    return { ok: true, episode, changed: false };
  }
  const declaration: CheckpointDeclaration = normalized.conclusion === "met"
    ? {
      conclusion: "met",
      definitionHash: normalized.definitionHash,
      subject: normalized.subject,
      declaredAt: now,
    }
    : {
      conclusion: "unmet",
      why: normalized.why,
      definitionHash: normalized.definitionHash,
      subject: normalized.subject,
      declaredAt: now,
    };
  const updated: CheckpointEpisode = { ...episode, declaration };
  store.episodes[checkpoint] = updated;
  try {
    await writeEpisodes(store.path, store.episodes);
  } catch (error) {
    return {
      ok: false,
      error: "store_unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, episode: updated, changed: true };
}
