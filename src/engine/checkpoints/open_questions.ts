/**
 * Checkpoint **open questions** — the effort-scoped record that a checkpoint fired,
 * and the **declarations** an agent binds to them. The store lives in the
 * per-worktree Git administrative area (the registered `checkpointOpenQuestions`
 * entry, beside the gate's own markers), so it survives session restarts and
 * disappears with the worktree.
 *
 * An open question is the ONLY thing a declaration can act on: recording one for a
 * checkpoint with no open question is an error, which is what forces the
 * question-serving moment — checkpoint ids are public config, and the
 * open question, not secrecy, gates the act. A declaration is one exhaustive
 * conclusion: `met`, or `unmet` with its required rationale; both bind to the
 * definition hash and subject fingerprint they judged. The unmet rationale is
 * OPAQUE EVIDENCE — validated for shape before any write (trimmed, one
 * paragraph, 1–500 characters, no control characters), never interpreted as
 * policy, and rendered only through standard escaping boundaries.
 *
 * Every operation is idempotent per (checkpoint, subject, declaration
 * evidence): reconciling an unchanged subject carries the open question untouched,
 * re-recording identical evidence changes nothing (the original timestamp
 * stands), and changed evidence replaces the conclusion in place. A store
 * that cannot be parsed reads as `invalid` so the caller can FAIL OPEN;
 * a write over one rebuilds from empty (`recovered`), which at worst asks
 * for a fresh declaration — the conservative direction.
 */

import { dirname } from "@std/path";
import { isRelatedCheckpointKind } from "../../shared/checkpoints.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import type { RelatedCheckpointPath } from "./types.ts";

/** The store's on-disk schema version (one line of JSON). */
const QUESTIONS_STORE_VERSION = 1;

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

/** One checkpoint's current openQuestion. `subject`/`definitionHash` describe what
 * the checkpoint is about NOW; the declaration (when present) records what was
 * judged, and is current only while its own binding matches the open question's. */
export interface OpenQuestion {
  checkpoint: string;
  definitionHash: string;
  subject: string;
  /** The matched paths behind the subject, for serving and renderings. */
  matchedPaths: readonly string[];
  /** Typed related evidence whose identity also binds the subject. */
  relatedPaths: readonly RelatedCheckpointPath[];
  openedAt: string;
  /** Set when a relevant change replaced the subject or definition. */
  reopenedAt?: string;
  declaration?: CheckpointDeclaration;
}

/** Whether an openQuestion's declaration is current — bound to the openQuestion's own
 * definition and subject rather than an earlier state. */
export function declarationIsCurrent(openQuestion: OpenQuestion): boolean {
  const declaration = openQuestion.declaration;
  return declaration !== undefined &&
    declaration.definitionHash === openQuestion.definitionHash &&
    declaration.subject === openQuestion.subject;
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

/** How reading the openQuestion store went. `invalid` and `unavailable` are the
 * caller's fail-open cues; `missing` is simply "no checkpoint has fired". */
export type OpenQuestionsRead =
  | { status: "ok"; openQuestions: Record<string, OpenQuestion> }
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

/** Parse one persisted openQuestion, or undefined for a mis-shaped one. */
function parseOpenQuestion(
  checkpoint: string,
  value: unknown,
): OpenQuestion | undefined {
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
  const relatedPaths = value.relatedPaths === undefined
    ? []
    : parseRelatedPaths(value.relatedPaths);
  if (relatedPaths === undefined) {
    return undefined;
  }
  const openQuestion: OpenQuestion = {
    checkpoint,
    definitionHash,
    subject,
    matchedPaths,
    relatedPaths,
    openedAt,
  };
  if (typeof value.reopenedAt === "string") {
    openQuestion.reopenedAt = value.reopenedAt;
  }
  if (value.declaration !== undefined) {
    const declaration = parseDeclaration(value.declaration);
    if (declaration === undefined) {
      return undefined;
    }
    openQuestion.declaration = declaration;
  }
  return openQuestion;
}

/** Parse typed related evidence; missing is handled as the additive empty
 * value by the caller so existing worktree state stays readable. */
function parseRelatedPaths(
  value: unknown,
): RelatedCheckpointPath[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RelatedCheckpointPath[] = [];
  for (const item of value) {
    if (
      !isRecord(item) || !isRelatedCheckpointKind(item.kind) ||
      typeof item.forPath !== "string" || typeof item.path !== "string"
    ) {
      return undefined;
    }
    out.push({ kind: item.kind, forPath: item.forPath, path: item.path });
  }
  return out;
}

/** Parse the store's text, or undefined when any part is mis-shaped. */
function parseStore(
  raw: string,
): Record<string, OpenQuestion> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.version !== QUESTIONS_STORE_VERSION) {
    return undefined;
  }
  if (!isRecord(value.openQuestions)) {
    return undefined;
  }
  const openQuestions: Record<string, OpenQuestion> = {};
  for (const [checkpoint, entry] of Object.entries(value.openQuestions)) {
    const openQuestion = parseOpenQuestion(checkpoint, entry);
    if (openQuestion === undefined) {
      return undefined;
    }
    openQuestions[checkpoint] = openQuestion;
  }
  return openQuestions;
}

/** Read this worktree's openQuestion store. */
export async function readOpenQuestions(
  cwd: string,
): Promise<OpenQuestionsRead> {
  const path = await gitAdminStatePath(cwd, "checkpointOpenQuestions");
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the checkpoint open-question path",
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
  const openQuestions = parseStore(raw);
  return openQuestions === undefined
    ? {
      status: "invalid",
      reason: "the checkpoint open-question record did not parse",
    }
    : { status: "ok", openQuestions };
}

/** Persist every byte, retrying partial writes and rejecting a zero-byte write. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (written === 0) {
      throw new Error("short write while recording checkpoint open questions");
    }
    offset += written;
  }
}

/** Persist the whole store as one line of JSON — written to a same-directory
 * temp file, synced, then atomically renamed into place (the acceptance
 * journal's durability pattern), so an interrupted write can garble only the
 * abandoned temp, never the standing store of recorded judgments. */
async function writeOpenQuestions(
  path: string,
  openQuestions: Record<string, OpenQuestion>,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    const file = await Deno.open(temp, { createNew: true, write: true });
    try {
      await writeAll(
        file,
        new TextEncoder().encode(
          `${
            JSON.stringify({ version: QUESTIONS_STORE_VERSION, openQuestions })
          }\n`,
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

/** Load the store for a write: current openQuestions, or a fresh table (with
 * `recovered` marking an unparseable store that was rebuilt from empty). */
async function loadForWrite(
  cwd: string,
): Promise<
  | {
    ok: true;
    path: string;
    openQuestions: Record<string, OpenQuestion>;
    recovered: boolean;
  }
  | { ok: false; reason: string }
> {
  const path = await gitAdminStatePath(cwd, "checkpointOpenQuestions");
  if (path === undefined) {
    return {
      ok: false,
      reason: "Git could not resolve the checkpoint open-question path",
    };
  }
  const read = await readOpenQuestions(cwd);
  switch (read.status) {
    case "ok":
      return {
        ok: true,
        path,
        openQuestions: { ...read.openQuestions },
        recovered: false,
      };
    case "missing":
      return { ok: true, path, openQuestions: {}, recovered: false };
    case "invalid":
      // Rebuild from empty: at worst a conclusion must be declared again,
      // which is the conservative direction for judgment evidence.
      return { ok: true, path, openQuestions: {}, recovered: true };
    case "unavailable":
      return { ok: false, reason: read.reason };
  }
}

// ── operations ──────────────────────────────────────────────────────────────

/** What reconciling one checkpoint's openQuestion did. */
export type ReconcileOpenQuestionResult =
  | {
    ok: true;
    openQuestion: OpenQuestion;
    outcome: "opened" | "reopened" | "carried";
    /** True when an unparseable store was rebuilt from empty on this write. */
    recovered: boolean;
    /** On a reopen, when the replaced subject was last served (its reopen or
     * open time) — the serving a declaration in this same invocation actually
     * responds to; the reopened open question's own timestamps carry the reopen
     * instant instead. */
    previousServedAt?: string;
  }
  | { ok: false; reason: string };

/**
 * Create or refresh one checkpoint's open question for the given definition hash and
 * subject — idempotent per (checkpoint, subject): an unchanged pair carries
 * the open question untouched (no write); a changed pair REOPENS it in place,
 * keeping any declaration record (it simply stops being current: its
 * binding differs from the open question's). `now` exists for deterministic tests.
 */
export async function reconcileOpenQuestion(
  cwd: string,
  next: {
    checkpoint: string;
    definitionHash: string;
    subject: string;
    matchedPaths: readonly string[];
    relatedPaths: readonly RelatedCheckpointPath[];
  },
  now: string = new Date().toISOString(),
): Promise<ReconcileOpenQuestionResult> {
  const store = await loadForWrite(cwd);
  if (!store.ok) {
    return { ok: false, reason: store.reason };
  }
  const existing = store.openQuestions[next.checkpoint];
  const relatedPaths = next.relatedPaths;
  if (
    existing !== undefined &&
    existing.definitionHash === next.definitionHash &&
    existing.subject === next.subject
  ) {
    // Same checkpoint, same subject: nothing to write. (A recovered store
    // never reaches here — it rebuilt empty, so nothing exists to match.)
    return {
      ok: true,
      openQuestion: existing,
      outcome: "carried",
      recovered: false,
    };
  }
  const openQuestion: OpenQuestion = existing === undefined
    ? {
      checkpoint: next.checkpoint,
      definitionHash: next.definitionHash,
      subject: next.subject,
      matchedPaths: [...next.matchedPaths],
      relatedPaths: [...relatedPaths],
      openedAt: now,
    }
    : {
      ...existing,
      definitionHash: next.definitionHash,
      subject: next.subject,
      matchedPaths: [...next.matchedPaths],
      relatedPaths: [...relatedPaths],
      reopenedAt: now,
    };
  store.openQuestions[next.checkpoint] = openQuestion;
  try {
    await writeOpenQuestions(store.path, store.openQuestions);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: true,
    openQuestion,
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
    openQuestion: OpenQuestion;
    /** False when identical evidence already stood (the original timestamp
     * remains — a repeat is a no-op, not a fresher claim). */
    changed: boolean;
  }
  | {
    ok: false;
    error: "no_open_question" | "invalid_rationale" | "store_unavailable";
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
 * Record one declaration against its checkpoint's ACTIVE open question. A
 * checkpoint with no open question is an error — creating an open question (a bare gate
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
  const openQuestion = store.openQuestions[checkpoint];
  if (openQuestion === undefined) {
    return {
      ok: false,
      error: "no_open_question",
      reason:
        `checkpoint '${checkpoint}' has no active open question here — a declaration records a judgment the gate asked for, so run the gate first.`,
    };
  }
  if (
    openQuestion.declaration !== undefined &&
    sameEvidence(openQuestion.declaration, normalized)
  ) {
    return { ok: true, openQuestion, changed: false };
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
  const updated: OpenQuestion = { ...openQuestion, declaration };
  store.openQuestions[checkpoint] = updated;
  try {
    await writeOpenQuestions(store.path, store.openQuestions);
  } catch (error) {
    return {
      ok: false,
      error: "store_unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, openQuestion: updated, changed: true };
}
