/**
 * The **proof marker** — a tiny per-worktree file recording the commit `done`
 * last validated GREEN over a CLEAN tree, so `accept` can prove the exact tree it
 * is about to land already passed the gate WITHOUT re-running it (ADR 0067).
 *
 * It lives where the worktree-ready sentinel does: a single file in the per-worktree
 * git admin dir, resolved via `git rev-parse --git-path discern/gate-proof`
 * (`.git/worktrees/<name>/discern/gate-proof`). It is therefore worktree-local
 * (never shared across branches), never tracked or committed (it sits inside
 * `.git`), and self-cleaning (it vanishes with the worktree). Its first line is the
 * validated HEAD sha — PINNED before the gate run began and re-verified unmoved at
 * stamp time ({@link ValidatedTreePin}), so it can only ever name a commit whose
 * tree the gate actually read; the rest is the rendered **proof** — the line and
 * the page markdown finish emitted for that tree — the review-moment summary
 * `status` and `accept` surface without re-running the gate.
 *
 * The proof is honored ONLY while it still names the current HEAD AND the tree is
 * clean — so any new commit (the merge `update` creates), amend, or uncommitted
 * edit silently invalidates it and `accept` falls back to running the gate. It is a
 * fast-path cache for "this tree already passed", never a substitute for the gate: a
 * failing run clears it, and accept re-runs `done` whenever it is absent or stale.
 *
 * `done` is its usual author, but `standards --pin` also carries an honored vouch
 * forward onto the commit it makes: that commit changes only `[standards]` limits,
 * and each changed limit is tighter while still held by the just-taken or same-HEAD
 * reused measurement. The pin therefore still passes both standards halves in the
 * gate, so the vouch stays truthful and `accept` need not re-run the whole gate for
 * a re-pin (see {@link carryProofForwardAcrossPin}).
 *
 * The standard **measurement proof** is its sibling on the same model: a green
 * `standards` check over a clean tree records every standard's measured value against
 * the validated HEAD, so a `standards --pin` on that same clean HEAD can reuse the
 * values instead of re-running every (slow) measurement. Same admin-dir home, same
 * identity rule (exact HEAD + clean tree, so any commit or edit silently invalidates
 * it), same fail-closed posture (a red check clears it; a pin that cannot honor it
 * simply measures fresh). Only the measurements are cacheable — the never-loosen
 * comparison reads main, which can advance while HEAD stands still, so the pin
 * re-checks that half live.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { declarationEvidenceIdentity } from "../checkpoints/evidence.ts";
import {
  type CheckpointDrop,
  type GateMode,
  policyCheckpointDrop,
  uniqueCheckpointDrops,
} from "../../shared/checkpoint_drops.ts";
import {
  GIT_ADMIN_STATE,
  gitAdminStatePath,
  VALIDATION_ADMIN_STATE_KEYS,
  type ValidationAdminStateKey,
} from "../../shared/git_admin_state.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { decodeJson } from "../../shared/runtime_decode.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  atomicReplaceJson,
  atomicReplaceText,
} from "../../shared/atomic_write.ts";
import {
  abbreviatedObjectIdMatches,
  workingStateFingerprint,
} from "../../shared/tree_identity.ts";
import {
  type PlannedWriteTarget,
  preflightPlannedWrites,
  type WritePreflightFailure,
} from "../../shared/write_preflight.ts";
import {
  canonicalProof,
  type GateData,
  type GateProofCheckData,
  type GateStandard,
  type Proof,
  TolerantProofSchema,
} from "../../shared/result_schemas.ts";

type AdminStatePaths = Readonly<
  Record<ValidationAdminStateKey, string | undefined>
>;
type GateProofRecordData = NonNullable<GateData["gate_proof"]>;

/** Brand for a successful, real write probe. Proof writers require this token,
 * making "probe before persist" a compile-time rule at every call site. */
declare const ADMIN_STATE_WRITE_AUTHORITY: unique symbol;
export interface AdminStateWriteAuthority {
  readonly root: string;
  readonly paths: AdminStatePaths;
  readonly [ADMIN_STATE_WRITE_AUTHORITY]: true;
}

export type AdminStateWritePreflight =
  | { ok: true; authority: AdminStateWriteAuthority }
  | WritePreflightFailure;

/** This worktree's gate proof path. */
function proofPath(cwd: string): Promise<string | undefined> {
  return gitAdminStatePath(cwd, "gateProof");
}

/** Prove the real create/write/rename/remove authority every validation-state
 * writer may need later. Existing marker files are also opened for write, without
 * changing them, so a read-only old proof fails now rather than at stamp time. */
export async function preflightAdminStateWrites(
  cwd: string,
): Promise<AdminStateWritePreflight> {
  const paths = {} as Record<ValidationAdminStateKey, string | undefined>;
  // A pre-Git/setup checkout has no admin-state target to persist. Preserve the
  // gate's established no-Git behavior with a non-applicable authority token;
  // once Git says this IS a worktree, failure to resolve or write its paths is a
  // genuine denial and must fail before slow work.
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd });
  if (!inside.success || inside.stdout.trim() !== "true") {
    for (const key of VALIDATION_ADMIN_STATE_KEYS) {
      paths[key] = undefined;
    }
    return {
      ok: true,
      authority: { root: cwd, paths } as AdminStateWriteAuthority,
    };
  }
  const targets: PlannedWriteTarget[] = [];
  for (const key of VALIDATION_ADMIN_STATE_KEYS) {
    const path = await gitAdminStatePath(cwd, key);
    if (path === undefined) {
      return {
        ok: false,
        path: cwd,
        description: "its Git-admin validation state",
        reason: `Git could not resolve ${GIT_ADMIN_STATE[key].path}`,
      };
    }
    paths[key] = path;
    try {
      await Deno.mkdir(dirname(path), { recursive: true });
    } catch (error) {
      return {
        ok: false,
        path: dirname(path),
        description: "its Git-admin validation state",
        reason: failureReason(error),
      };
    }
    targets.push({
      kind: "directory-entry",
      path: dirname(path),
      description: "its Git-admin validation state",
    });
    try {
      const info = await Deno.stat(path);
      if (info.isFile) {
        targets.push({
          kind: "existing-file",
          path,
          description: "its Git-admin validation state",
        });
      } else {
        return {
          ok: false,
          path,
          description: "its Git-admin validation state",
          reason: "the planned marker path exists but is not a regular file",
        };
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        return {
          ok: false,
          path,
          description: "its Git-admin validation state",
          reason: failureReason(error),
        };
      }
    }
  }
  const probed = await preflightPlannedWrites(targets);
  if (!probed.ok) {
    return probed;
  }
  return {
    ok: true,
    authority: {
      root: cwd,
      paths,
    } as AdminStateWriteAuthority,
  };
}

/** Resolve the worktree-local validation marker through the admin-state registry. */
function authorityPath(
  cwd: string,
  authority: AdminStateWriteAuthority,
  file: ValidationAdminStateKey,
): string | undefined {
  return authority.root === cwd ? authority.paths[file] : undefined;
}

/** Current HEAD sha at `cwd`, or `undefined` when it cannot be read. */
async function headSha(cwd: string): Promise<string | undefined> {
  const r = await runGit(["rev-parse", "HEAD"], { cwd });
  const sha = r.stdout.trim();
  return r.success && sha !== "" ? sha : undefined;
}

/**
 * Every path `git status --porcelain` reports at `cwd` — staged, unstaged, AND
 * untracked, both sides of a rename — sorted for stable output. This is the strict
 * dirt accept refuses to land, so a proof refusal can NAME what blocks it instead
 * of sending the agent on a diagnosis loop. `undefined` when git can't answer.
 */
async function worktreeStatusPaths(
  cwd: string,
): Promise<string[] | undefined> {
  const r = await runGit(["status", "--porcelain", "-z"], { cwd });
  if (!r.success) {
    return undefined;
  }
  const paths = new Set<string>();
  for (const entry of parsePorcelainZ(r.stdout)) {
    if (entry.origPath !== undefined) {
      paths.add(entry.origPath);
    }
    paths.add(entry.path);
  }
  return [...paths].sort();
}

/**
 * Whether the worktree at `cwd` is FULLY clean — `git status --porcelain` empty (no
 * staged, unstaged, OR untracked changes). This is the strict notion accept
 * requires before landing, so the proof vouches for exactly what would land. A
 * failed status reads as NOT clean, so an unreadable tree never earns a proof or a
 * fast-path skip (fail-closed). Exported so the proof renderer applies the SAME
 * clean rule before building a proof for the committed tree.
 */
export async function isWorktreeFullyClean(cwd: string): Promise<boolean> {
  return (await worktreeStatusPaths(cwd))?.length === 0;
}

/** How many dirty paths a proof-refusal reason names before eliding the rest. */
const DIRTY_PATHS_SHOWN = 6;

/** Render a dirty-path list for a refusal reason: the first few paths, the rest
 * counted — empty when there is nothing to name (an unreadable status). */
function describeDirtyPaths(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const shown = paths.slice(0, DIRTY_PATHS_SHOWN).join(", ");
  const more = paths.length > DIRTY_PATHS_SHOWN
    ? `, and ${paths.length - DIRTY_PATHS_SHOWN} more`
    : "";
  return ` — uncommitted: ${shown}${more}`;
}

/** Summarize the first failed step or diagnostic that prevents a proof. */
function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Brand for {@link ValidatedTreePin} — declared, never emitted, not exported, so
 * only this module can mint a pin. */
declare const VALIDATED_TREE_PIN: unique symbol;

/**
 * The tree identity a validation run is about to read, captured BEFORE the run
 * begins: the HEAD sha and full cleanliness at that moment. Every proof stamp
 * requires one and re-verifies it at stamp time — so a vouch can only ever name
 * a commit whose tree the validated work actually read (a commit made mid-run
 * moves HEAD past the pin, and the stamp is refused instead of vouching blind).
 *
 * Deliberately only constructible via {@link pinValidatedTree} (the brand makes
 * the type nominal): a caller cannot hand-roll a pin from a sha it happens to
 * hold — it must sample the tree, and must do so before the work it wants
 * vouched, which is the whole invariant.
 */
export interface ValidatedTreePin {
  /** HEAD at capture time, or `undefined` when it could not be read. */
  readonly head: string | undefined;
  /** Whether the tree was FULLY clean at capture time. */
  readonly clean: boolean;
  /** The paths dirty at capture time (empty when clean or unreadable) — so a
   * refusal to stamp can NAME what blocked it. */
  readonly dirtyPaths: readonly string[];
  readonly [VALIDATED_TREE_PIN]: true;
}

/** Sample the tree at `cwd` NOW — call this before the validation work runs. */
export async function pinValidatedTree(cwd: string): Promise<ValidatedTreePin> {
  const dirty = await worktreeStatusPaths(cwd);
  const dirtyPaths: readonly string[] = dirty ?? [];
  return {
    head: await headSha(cwd),
    clean: dirty !== undefined && dirty.length === 0,
    dirtyPaths,
  } as ValidatedTreePin;
}

/** Bind a green gate result to HEAD, config, plan, trunk, and measured standards. */
function proofRecord(
  status: GateProofRecordData["status"],
  fields: Omit<GateProofRecordData, "status"> = {},
): GateProofRecordData {
  return { status, ...fields };
}

/**
 * Record the outcome of a `done` run into the proof marker. `pin` is the tree
 * identity captured BEFORE the run began ({@link pinValidatedTree}); a stamp names
 * the PINNED sha, and only after re-verifying the tree still matches it — the
 * proof must vouch only for the exact tree the gate actually read:
 *
 * - GREEN over a CLEAN tree that matches the pin → stamp the validated HEAD (the
 *   vouch accept honors), plus the structured proof and its two renderings
 *   when the run rendered one, so `status` and `accept` can surface and publish
 *   the review summary without re-running the gate.
 * - GREEN but HEAD moved since the pin (a commit landed mid-run) → stamp nothing:
 *   the run validated the pinned tree, not the commit now at HEAD. Any prior vouch
 *   is left untouched (still truthful at its own sha).
 * - FAILED gate → clear any proof (fail-closed: a tree the gate just rejected must
 *   not stay vouched; clearing also closes the rare flake/environment-drift case where
 *   a clean HEAD's gate result turns failing with the tree unchanged).
 * - GREEN but DIRTY (at pin time or now) → leave the file untouched: it cannot vouch
 *   for clean HEAD, but a prior clean vouch (at its own sha) is still truthful, and
 *   accept's HEAD-match + clean check keeps it honest.
 *
 * The caller must first acquire `authority` with
 * {@link preflightAdminStateWrites}, before its slow work begins. The writer stays
 * best-effort against a later TOCTOU/filesystem hiccup, which is returned visibly
 * rather than retroactively changing the already-computed quality verdict.
 */
export async function recordGateOutcome(
  cwd: string,
  authority: AdminStateWriteAuthority,
  passed: boolean,
  pin: ValidatedTreePin,
  proof?: Proof,
  /** The declaration-evidence identity the vouch binds to, when known —
   * changing a conclusion or rationale then stales this proof the same way a
   * new commit would. */
  evidence?: string,
  mode: GateMode = "strict",
): Promise<GateProofRecordData> {
  const path = authorityPath(cwd, authority, "gateProof");
  if (path === undefined) {
    return proofRecord("unavailable", {
      reason: "could not resolve the gate proof path",
    });
  }

  if (passed) {
    if (pin.head === undefined) {
      return proofRecord("unavailable", {
        path,
        reason: "could not read HEAD when the run began",
      });
    }
    const headNow = await headSha(cwd);
    if (headNow === undefined) {
      return proofRecord("unavailable", {
        path,
        reason: "could not read HEAD",
      });
    }
    if (headNow !== pin.head) {
      return proofRecord("skipped_head_moved", {
        path,
        reason:
          `HEAD moved while the run was underway (validated ${pin.head}, now ${headNow})`,
      });
    }
    if (!pin.clean) {
      return proofRecord("skipped_dirty", {
        path,
        reason: `the worktree was not clean when the run began${
          describeDirtyPaths(pin.dirtyPaths)
        }`,
      });
    }
    const dirtyNow = await worktreeStatusPaths(cwd);
    if (dirtyNow === undefined || dirtyNow.length > 0) {
      return proofRecord("skipped_dirty", {
        path,
        reason: `the worktree is not clean${
          describeDirtyPaths(dirtyNow ?? [])
        }`,
      });
    }
    if (mode === "report") {
      const prior = await inspectGateProof(cwd);
      if (
        prior.status === "honored" && prior.recorded === pin.head &&
        prior.proof_data?.mode !== "report"
      ) {
        return proofRecord("recorded", { path });
      }
    }
    try {
      // Marker format: the sha, then (when the run rendered a proof) its
      // compatibility `line: ` component, structured form, declaration
      // evidence identity, and page markdown. Markers that omit any
      // component also parse.
      const data = proof === undefined
        ? ""
        : `data: ${JSON.stringify(proof)}\n`;
      const line = proof?.line === undefined || proof.line === ""
        ? ""
        : `line: ${proof.line}\n`;
      const evidenceLine = evidence === undefined
        ? ""
        : `evidence: ${evidence}\n`;
      const modeLine = proof?.mode === "report" || mode === "report"
        ? "mode: report\n"
        : "";
      const body = proof?.markdown === undefined || proof.markdown === ""
        ? `${pin.head}\n${modeLine}${evidenceLine}`
        : `${pin.head}\n${modeLine}${line}${data}${evidenceLine}\n${proof.markdown.trim()}\n`;
      await Deno.writeTextFile(path, body);
      return proofRecord("recorded", { path });
    } catch (error) {
      return proofRecord("record_failed", {
        path,
        reason: failureReason(error),
      });
    }
  }

  try {
    await Deno.remove(path);
    return proofRecord("cleared", { path });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return proofRecord("cleared", { path });
    }
    return proofRecord("clear_failed", {
      path,
      reason: failureReason(error),
    });
  }
}

/**
 * The refusal slug `done` serves when it is asked to re-run on the exact tree
 * it last judged without the explicit `--rerun` request. Gate-owned, not part of
 * the consent-gated class: that class refuses unconditionally until an owner's
 * consent arrives, while this gate fires only when the tree is unchanged and is
 * satisfied by the caller's own attestation that the rerun is deliberate.
 */
export const UNCHANGED_TREE_RERUN_SLUG = "unchanged_tree_rerun";

/** What the last completed gate run judged: the tree identity it ended on and
 * the verdict it reached. */
export interface LastGateRun {
  /** HEAD at the end of the run (full sha). */
  readonly head: string;
  /** Working-state fingerprint, absent when the tree was clean
   * ({@link workingStateFingerprint}). */
  readonly tree?: string;
  /** Whether the gate passed. */
  readonly passed: boolean;
  /** The declaration-evidence identity at the end of the run, when known —
   * a changed conclusion or rationale makes the next invocation a different
   * run, so the rerun guard must not refuse it. */
  readonly evidence?: string;
  /** Report runs never trigger strict unchanged-tree refusal. */
  readonly mode?: GateMode;
}

/** A tree identity `done` can compare against a {@link LastGateRun}. */
export type TreeIdentity = Pick<LastGateRun, "head" | "tree">;

/**
 * Sample the tree identity at `cwd` NOW: HEAD, plus the working-state
 * fingerprint when uncommitted changes exist. `undefined` whenever git cannot answer —
 * an unreadable tree never earns a refusal or a marker (fail-open: the rerun
 * precondition is a guard against certainty, and an uncertain identity is not
 * the certain case).
 */
export async function currentTreeIdentity(
  cwd: string,
): Promise<TreeIdentity | undefined> {
  const head = await headSha(cwd);
  if (head === undefined) {
    return undefined;
  }
  const dirty = await worktreeStatusPaths(cwd);
  if (dirty === undefined) {
    return undefined;
  }
  if (dirty.length === 0) {
    return { head };
  }
  const tree = await workingStateFingerprint(cwd);
  return tree === undefined ? undefined : { head, tree };
}

/** Whether two sampled identities name the same exact tree. */
export function sameTreeIdentity(a: TreeIdentity, b: TreeIdentity): boolean {
  return a.head === b.head && (a.tree ?? null) === (b.tree ?? null);
}

/**
 * Record what this `done` run judged into the last-run marker: the tree
 * identity at the END of the run (the fix stage may have rewritten files, and
 * the verdict belongs to the tree the check/test jobs actually read) plus the
 * verdict. Written on EVERY completed run — green or red, clean or dirty —
 * because the rerun precondition needs the red runs the proof marker
 * deliberately forgets. Best-effort: an unreadable identity clears the marker
 * instead of leaving a stale claim, and a write failure changes nothing about
 * the run's verdict.
 */
export async function recordLastGateRun(
  cwd: string,
  authority: AdminStateWriteAuthority,
  passed: boolean,
  evidence?: string,
  mode: GateMode = "strict",
): Promise<void> {
  const path = authorityPath(cwd, authority, "lastGateRun");
  if (path === undefined) {
    return;
  }
  const identity = await currentTreeIdentity(cwd);
  await bestEffort("proof-last-gate-run-record", async () => {
    if (identity === undefined) {
      await Deno.remove(path);
      return;
    }
    await Deno.writeTextFile(
      path,
      `${
        JSON.stringify({
          ...identity,
          passed,
          ...(mode === "report" ? { mode } : {}),
          ...(evidence === undefined ? {} : { evidence }),
        })
      }\n`,
    );
  });
}

/**
 * Read the last-run marker for the worktree at `cwd`, `undefined` when absent
 * or unreadable — either way the rerun precondition simply does not fire. A
 * marker naming a different tree is returned as-is; identity comparison is the
 * caller's job ({@link sameTreeIdentity}).
 */
export async function inspectLastGateRun(
  cwd: string,
): Promise<LastGateRun | undefined> {
  const path = await gitAdminStatePath(cwd, "lastGateRun");
  if (path === undefined) {
    return undefined;
  }
  const raw = await readTextIfExists(path);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.head !== "string" || typeof record.passed !== "boolean") {
    return undefined;
  }
  if (record.tree !== undefined && typeof record.tree !== "string") {
    return undefined;
  }
  if (record.evidence !== undefined && typeof record.evidence !== "string") {
    return undefined;
  }
  if (
    record.mode !== undefined && record.mode !== "strict" &&
    record.mode !== "report"
  ) {
    return undefined;
  }
  return {
    head: record.head,
    passed: record.passed,
    ...(record.tree !== undefined ? { tree: record.tree } : {}),
    ...(record.evidence !== undefined ? { evidence: record.evidence } : {}),
    ...(record.mode !== undefined ? { mode: record.mode } : {}),
  };
}

/**
 * Inspect why the current worktree's gate proof can or cannot be honored.
 * This is the verbose sibling of {@link gateProofHonored}: accept includes the
 * result in its JSON/MCP envelope so a skipped vs re-run validation decision is
 * visible even when the human logger is suppressed. An HONORED record also carries
 * the stored proof markdown (when the recording finish rendered one) — the
 * summary an agent relays at the review moment without re-running the gate.
 */
export async function inspectGateProof(
  cwd: string,
): Promise<GateProofCheckData> {
  const path = await proofPath(cwd);
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "could not resolve the gate proof path",
    };
  }
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing", path };
    }
    return { status: "read_failed", path, reason: failureReason(error) };
  }
  // First line: the validated HEAD sha. Then, when present: `line: `,
  // `data: `, and `evidence: ` components in any order, followed by the proof
  // page Markdown. A marker may omit any component; absent pieces are simply
  // empty.
  const newline = content.indexOf("\n");
  const recorded = (newline < 0 ? content : content.slice(0, newline)).trim();
  let rest = newline < 0 ? "" : content.slice(newline + 1);
  let proofData: Proof | undefined;
  let line = "";
  let recordedEvidence: string | undefined;
  let recordedMode: GateMode = "strict";
  while (
    rest.startsWith("data: ") || rest.startsWith("line: ") ||
    rest.startsWith("evidence: ") || rest.startsWith("mode: ")
  ) {
    const eol = rest.indexOf("\n");
    if (rest.startsWith("data: ")) {
      const raw = eol < 0
        ? rest.slice("data: ".length)
        : rest.slice("data: ".length, eol);
      try {
        const parsed: unknown = JSON.parse(raw);
        const validated = TolerantProofSchema.safeParse(parsed);
        if (validated.success) {
          proofData = canonicalProof(validated.data);
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        // A malformed structured component does not invalidate the validation
        // vouch. Acceptance honors the commit and reports that no structured
        // proof was available to publish.
      }
    } else if (rest.startsWith("mode: ")) {
      const mode = (eol < 0
        ? rest.slice("mode: ".length)
        : rest.slice("mode: ".length, eol)).trim();
      if (mode === "report") {
        recordedMode = "report";
      }
    } else if (rest.startsWith("evidence: ")) {
      recordedEvidence = (eol < 0
        ? rest.slice("evidence: ".length)
        : rest.slice("evidence: ".length, eol)).trim();
    } else {
      line = (eol < 0 ? rest.slice("line: ".length) : rest.slice(
        "line: ".length,
        eol,
      )).trim();
    }
    rest = eol < 0 ? "" : rest.slice(eol + 1);
  }
  const markdown = rest.trim();
  const proofDrops = proofData?.checkpoint_drops ?? [];
  if (recorded === "") {
    return { status: "missing", path, reason: "proof file was empty" };
  }
  const head = await headSha(cwd);
  if (head === undefined) {
    return {
      status: "unavailable",
      path,
      recorded,
      reason: "could not read HEAD",
    };
  }
  if (head !== recorded) {
    return { status: "stale", path, recorded, head };
  }
  if (!(await isWorktreeFullyClean(cwd))) {
    return { status: "dirty", path, recorded, head };
  }
  if (
    proofData !== undefined &&
    !abbreviatedObjectIdMatches(proofData.head, recorded)
  ) {
    return {
      status: "read_failed",
      path,
      recorded,
      head,
      reason:
        `the structured Proof names ${proofData.head}, which does not identify its recorded commit ${recorded}`,
    };
  }
  if (proofData !== undefined && line !== "" && proofData.line !== line) {
    return {
      status: "read_failed",
      path,
      recorded,
      head,
      reason: "the structured Proof and stored Proof line disagree",
    };
  }
  if (
    proofData !== undefined && markdown !== "" &&
    proofData.markdown.trim() !== markdown
  ) {
    return {
      status: "read_failed",
      path,
      recorded,
      head,
      reason: "the structured Proof and stored Proof page disagree",
    };
  }
  if (recordedMode === "report" || proofData?.mode === "report") {
    return {
      status: "report_only",
      path,
      recorded,
      head,
      reason:
        "checkpoint review was reported, not enforced; run `discern done` without `--ci` before acceptance",
      ...(markdown === "" ? {} : { proof: markdown }),
      ...(line === "" ? {} : { proof_line: line }),
      ...(proofData === undefined ? {} : { proof_data: proofData }),
      ...(proofDrops.length === 0 ? {} : { checkpoint_drops: [...proofDrops] }),
    };
  }
  // The vouch also binds to the declaration evidence it was recorded with: a
  // changed conclusion or rationale stales it even at an unchanged HEAD. A
  // marker without the component (an older writer) skips the comparison, and
  // an UNREADABLE store fails open — an uncertain identity is never treated
  // as a changed one.
  if (recordedEvidence !== undefined) {
    const evidenceNow = await declarationEvidenceIdentity(cwd);
    if (
      evidenceNow.status === "ok" && evidenceNow.identity !== recordedEvidence
    ) {
      return {
        status: "stale",
        path,
        recorded,
        head,
        reason:
          "the checkpoint declarations changed since this proof was recorded",
      };
    }
    if (evidenceNow.status === "unavailable") {
      const currentDrop: CheckpointDrop = policyCheckpointDrop(
        "declaration_evidence_unavailable",
        `the current checkpoint declaration evidence could not be read (${evidenceNow.reason}); the recorded Proof remains honored without comparing it.`,
        proofData?.checkpoints?.policy,
      );
      const checkpointDrops = uniqueCheckpointDrops([
        ...proofDrops,
        currentDrop,
      ]);
      return {
        status: "honored",
        path,
        recorded,
        head,
        ...(markdown === "" ? {} : { proof: markdown }),
        ...(line === "" ? {} : { proof_line: line }),
        ...(proofData === undefined ? {} : { proof_data: proofData }),
        checkpoint_drops: checkpointDrops,
      };
    }
  }
  return {
    status: "honored",
    path,
    recorded,
    head,
    ...(markdown === "" ? {} : { proof: markdown }),
    ...(line === "" ? {} : { proof_line: line }),
    ...(proofData === undefined ? {} : { proof_data: proofData }),
    ...(proofDrops.length === 0 ? {} : { checkpoint_drops: [...proofDrops] }),
  };
}

/**
 * Whether a proof proves the worktree's CURRENT (HEAD, clean) state already passed
 * `done` — accept's fast path. True only when a proof exists, names exactly the
 * current HEAD, and the tree is clean; any new commit, amend, or uncommitted edit
 * makes this false, so accept falls back to running the gate. Never throws.
 */
export async function gateProofHonored(cwd: string): Promise<boolean> {
  return (await inspectGateProof(cwd)).status === "honored";
}

/** Exact pre-transaction Gate Proof bytes, including an explicitly absent file. */
export interface GateProofSnapshot {
  readonly path: string | undefined;
  readonly content: string | undefined;
}

/** Sample Gate Proof without interpreting or mutating it. */
export async function snapshotGateProof(
  cwd: string,
): Promise<GateProofSnapshot> {
  const path = await proofPath(cwd);
  return {
    path,
    content: path === undefined ? undefined : await readTextIfExists(path),
  };
}

export type GateProofRestoreOutcome =
  | { readonly kind: "restored" }
  | { readonly kind: "retained"; readonly detail: string };

/** The commit identity recorded on the first line of raw Proof bytes. */
function rawProofHead(content: string): string {
  const newline = content.indexOf("\n");
  return (newline < 0 ? content : content.slice(0, newline)).trim();
}

/**
 * Restore pre-transaction Proof after an owned marker rollback. A concurrent
 * writer wins: only absence, the original bytes, or bytes naming the exact
 * transaction-owned marker may be replaced.
 */
export async function restoreGateProofAfterOwnedRollback(
  snapshot: GateProofSnapshot,
  ownedMarkerHead: string,
): Promise<GateProofRestoreOutcome> {
  if (snapshot.path === undefined) {
    return { kind: "restored" };
  }
  const current = await readTextIfExists(snapshot.path);
  if (current === snapshot.content) {
    return { kind: "restored" };
  }
  if (current !== undefined && rawProofHead(current) !== ownedMarkerHead) {
    return {
      kind: "retained",
      detail:
        "Gate Proof changed outside this completion transaction, so discern retained it",
    };
  }
  try {
    if (snapshot.content === undefined) {
      try {
        await Deno.remove(snapshot.path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    } else {
      await atomicReplaceText(snapshot.path, snapshot.content, {
        mode: 0o600,
        sync: false,
      });
    }
    return { kind: "restored" };
  } catch (error) {
    return {
      kind: "retained",
      detail: `Gate Proof could not be restored (${failureReason(error)})`,
    };
  }
}

/**
 * Clear this worktree's Gate Proof through the same write preflight and writer
 * used by the Gate. Lifecycle callers use this when a new transaction must make
 * any earlier validation unavailable before it begins.
 */
export async function clearGateProof(
  cwd: string,
): Promise<NonNullable<GateData["gate_proof"]>> {
  const preflight = await preflightAdminStateWrites(cwd);
  if (!preflight.ok) {
    return proofRecord("unavailable", {
      path: preflight.path,
      reason: `${preflight.description}: ${preflight.reason}`,
    });
  }
  return await recordGateOutcome(
    cwd,
    preflight.authority,
    false,
    await pinValidatedTree(cwd),
  );
}

/**
 * Carry a gate proof across a `standards --pin` commit (ADR 0106).
 *
 * `standards --pin` commits ONLY `[standards.*]` limit changes. Its `pinnedLimit`
 * arithmetic only tightens a limit to one the just-taken or same-HEAD reused
 * measurement satisfies. That tightened limit also passes the
 * never-loosen comparison against the trunk, so the pin commit still passes both
 * standards halves now enforced by `done` (ADR 0133). When the pre-pin HEAD carried
 * an HONORED proof (it named that HEAD over a clean tree), re-stamp the vouch onto
 * the new clean HEAD the commit created; otherwise the moved HEAD would strand a
 * truthful pass and force `accept` to re-run the whole gate for a change that cannot
 * alter its outcome.
 *
 * Fail-closed and narrow: it forwards ONLY a vouch that genuinely held a moment ago
 * (`priorHonored`), which only the caller — the author of the commit, so the one party
 * that knows it touched nothing but standard limits — may assert. With no prior vouch it
 * does nothing (returns `undefined`), leaving the now-stale proof for `accept` to
 * re-validate. The pin is captured here, at the stamp moment: the vouched "work" is the
 * pin commit itself, which the caller just made synchronously, so the tree sampled now
 * IS the tree the vouch is about. The pin preflights `authority` before measuring;
 * the writer remains best-effort against a later point-in-time hiccup.
 */
export async function carryProofForwardAcrossPin(
  cwd: string,
  authority: AdminStateWriteAuthority,
  priorHonored: boolean,
): Promise<GateProofRecordData | undefined> {
  if (!priorHonored) {
    return undefined;
  }
  return await recordGateOutcome(
    cwd,
    authority,
    true,
    await pinValidatedTree(cwd),
  );
}

// ── the standard measurement proof ─────────────────────────────────────────────

/** The measurement proof's verdict: `honored` carries the per-standard values a pin
 * may reuse; every other status means "measure fresh" (a cache miss, never an error). */
export type StandardMeasurementsCheck =
  | {
    status: "honored";
    values: Record<string, number>;
    definitions: Record<string, string>;
    provenance: Record<string, string>;
  }
  | { status: "missing" | "stale" | "dirty" | "malformed" | "unavailable" };

/**
 * Record a green check's per-standard measured values against the HEAD pinned
 * BEFORE the measurements ran — written by a green `standards` check AND by a
 * green gate run over a clean committed tree, for a subsequent `--pin` on that
 * same clean HEAD to reuse and for the gate's input-keyed replay to baseline
 * against. Mirrors {@link recordGateOutcome}'s conditions: only a CLEAN tree
 * with a readable HEAD that still matches the pin earns a proof (a dirty check —
 * `--force` — records nothing, since the values describe a tree no pin will ever
 * see; a mid-measurement commit records nothing, since the values describe the
 * pinned tree, not the commit now at HEAD). A PARTIAL record (the gate with a
 * deferred standard) MERGES into an existing same-HEAD proof rather than
 * clobbering a fuller one, so check → done → pin still measures once.
 * `durations` (whole seconds per standard) ride along so a defer/replay decision
 * can be made from data. The caller preflights `authority` before measuring; a
 * later I/O hiccup remains best-effort. Returns whether a proof was written.
 */
export async function recordStandardMeasurements(
  cwd: string,
  authority: AdminStateWriteAuthority,
  values: Record<string, number>,
  definitions: Record<string, string>,
  pin: ValidatedTreePin,
  durations: Record<string, number> = {},
): Promise<boolean> {
  const path = authorityPath(cwd, authority, "standardMeasurements");
  if (path === undefined || pin.head === undefined || !pin.clean) {
    return false;
  }
  if (
    (await headSha(cwd)) !== pin.head || !(await isWorktreeFullyClean(cwd))
  ) {
    return false;
  }
  let written = false;
  await bestEffort("proof-standard-measurements-record", async () => {
    const existing = parseMeasurements(
      await readTextIfExists(path) ?? "",
    );
    const merged = existing !== undefined && existing.head === pin.head
      ? {
        values: { ...existing.values, ...values },
        durations: { ...existing.durations, ...durations },
        definitions: { ...existing.definitions, ...definitions },
        provenance: {
          ...existing.provenance,
          ...Object.fromEntries(
            Object.keys(values).map((name) => [name, pin.head]),
          ),
        },
      }
      : {
        values,
        durations,
        definitions,
        provenance: Object.fromEntries(
          Object.keys(values).map((name) => [name, pin.head]),
        ),
      };
    await Deno.writeTextFile(
      path,
      `${JSON.stringify({ head: pin.head, ...merged })}\n`,
    );
    written = true;
  });
  return written;
}

/**
 * Clear the measurement proof — a RED check's values must not stay reusable
 * (fail-closed, the same posture as a failed finish clearing the gate proof).
 * The caller preflights `authority`; a later hiccup remains best-effort, and a
 * missing file is already the desired state.
 */
export async function clearStandardMeasurements(
  cwd: string,
  authority: AdminStateWriteAuthority,
): Promise<void> {
  const path = authorityPath(cwd, authority, "standardMeasurements");
  if (path === undefined) {
    return;
  }
  await bestEffort("proof-standard-measurements-clear", async () => {
    await Deno.remove(path);
  });
}

// ── fresh Standard measurement evidence ────────────────────────────────────

/** A clean, exact-HEAD measurement pass, including named failures. Unlike the
 * replay cache above, this evidence is deliberately useful when a Standard is
 * red: `standards propose` needs the breached value and must distinguish a
 * missing metric or failed command from a measured regression. */
const FreshStandardMeasurementEvidenceSchema = z.strictObject({
  version: z.literal(1),
  head: z.string().min(1),
  values: z.record(z.string(), z.number().finite()),
  failed: z.array(z.string().min(1)),
});
export type FreshStandardMeasurementEvidence = z.infer<
  typeof FreshStandardMeasurementEvidenceSchema
>;

export type FreshStandardMeasurementEvidenceCheck =
  | {
    readonly status: "honored";
    readonly evidence: FreshStandardMeasurementEvidence;
  }
  | {
    readonly status:
      | "missing"
      | "stale"
      | "dirty"
      | "malformed"
      | "unavailable";
  };

/** Record only process-backed readings from this pass. Replays and deferrals do
 * not refresh proposal evidence, and a dirty or moving tree earns no record. */
export async function recordFreshStandardMeasurementEvidence(
  cwd: string,
  authority: AdminStateWriteAuthority,
  readings: readonly GateStandard[],
  pin: ValidatedTreePin,
): Promise<boolean> {
  const measured = readings.filter((reading) =>
    reading.measurement === "measured"
  );
  if (measured.length === 0) {
    return false;
  }
  const path = authorityPath(
    cwd,
    authority,
    "standardMeasurementEvidence",
  );
  if (path === undefined || pin.head === undefined || !pin.clean) {
    return false;
  }
  if (
    (await headSha(cwd)) !== pin.head || !(await isWorktreeFullyClean(cwd))
  ) {
    return false;
  }
  const evidenceHead = pin.head;
  const values: Record<string, number> = {};
  for (const reading of measured) {
    if (reading.value !== undefined && Number.isFinite(reading.value)) {
      values[reading.name] = reading.value;
    }
  }
  let written = false;
  await bestEffort("proof-fresh-standard-evidence-record", async () => {
    const existing = parseFreshStandardMeasurementEvidence(
      await readTextIfExists(path) ?? "",
    );
    const mergedValues = existing?.head === evidenceHead
      ? { ...existing.values }
      : {};
    const mergedFailed = new Set(
      existing?.head === evidenceHead ? existing.failed : [],
    );
    for (const reading of measured) {
      const value = values[reading.name];
      if (value === undefined) {
        delete mergedValues[reading.name];
        mergedFailed.add(reading.name);
      } else {
        mergedValues[reading.name] = value;
        mergedFailed.delete(reading.name);
      }
    }
    await atomicReplaceJson(
      path,
      {
        version: 1,
        head: evidenceHead,
        values: mergedValues,
        failed: [...mergedFailed].sort(),
      } satisfies FreshStandardMeasurementEvidence,
      { mode: 0o600, sync: false, trailingNewline: true },
    );
    written = true;
  });
  return written;
}

/** Parse the small proposal-evidence record without trusting persisted JSON. */
function parseFreshStandardMeasurementEvidence(
  raw: string,
): FreshStandardMeasurementEvidence | undefined {
  try {
    return decodeJson(
      FreshStandardMeasurementEvidenceSchema,
      raw,
      "fresh Standard measurement evidence",
    );
  } catch {
    // discern-best-effort: proof-fresh-standard-evidence-decode-fallback
    return undefined;
  }
}

/** Honor evidence only for the exact current clean commit. */
export async function inspectFreshStandardMeasurementEvidence(
  cwd: string,
): Promise<FreshStandardMeasurementEvidenceCheck> {
  const path = await gitAdminStatePath(cwd, "standardMeasurementEvidence");
  if (path === undefined) {
    return { status: "unavailable" };
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    return error instanceof Deno.errors.NotFound
      ? { status: "missing" }
      : { status: "unavailable" };
  }
  const evidence = parseFreshStandardMeasurementEvidence(raw);
  if (evidence === undefined) {
    return { status: "malformed" };
  }
  const currentHead = await headSha(cwd);
  if (currentHead === undefined || currentHead !== evidence.head) {
    return { status: "stale" };
  }
  if (!(await isWorktreeFullyClean(cwd))) {
    return { status: "dirty" };
  }
  return { status: "honored", evidence };
}

/**
 * Inspect whether the measurement proof can be honored: it must parse, name exactly
 * the current HEAD, and the tree must be clean — the same identity rule as the
 * gate proof, so any commit, amend, or uncommitted edit silently invalidates
 * it. Anything unreadable or mis-shaped reads as `malformed` (measure fresh), never an
 * error. Never throws.
 */
export async function inspectStandardMeasurements(
  cwd: string,
): Promise<StandardMeasurementsCheck> {
  const path = await gitAdminStatePath(cwd, "standardMeasurements");
  if (path === undefined) {
    return { status: "unavailable" };
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    return error instanceof Deno.errors.NotFound
      ? { status: "missing" }
      : { status: "unavailable" };
  }
  const parsed = parseMeasurements(raw);
  if (parsed === undefined) {
    return { status: "malformed" };
  }
  const head = await headSha(cwd);
  if (head === undefined) {
    return { status: "unavailable" };
  }
  if (head !== parsed.head) {
    return { status: "stale" };
  }
  if (!(await isWorktreeFullyClean(cwd))) {
    return { status: "dirty" };
  }
  return {
    status: "honored",
    values: parsed.values,
    definitions: parsed.definitions,
    provenance: parsed.provenance,
  };
}

/** A parsed measurement proof: the commit its values describe, the values,
 * and each measurement's recorded duration (whole seconds; may be empty — a
 * pre-durations proof still parses). */
export interface StandardMeasurements {
  head: string;
  values: Record<string, number>;
  durations: Record<string, number>;
  /** Fingerprint of the definition that gave each value meaning. */
  definitions: Record<string, string>;
  /** Original commit whose process run measured each value. */
  provenance: Record<string, string>;
}

/** A map of finite numbers, or undefined when `raw` is anything else. */
function finiteNumberMap(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    out[name] = value;
  }
  return out;
}

/** A map of non-empty strings, or undefined when persisted evidence is not
 * wholly shaped as declared. */
function stringMap(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value === "") {
      return undefined;
    }
    out[name] = value;
  }
  return out;
}

/** Parse the proof file's JSON defensively: a `head` sha string plus a `values`
 * map of finite numbers (and optional `durations`), or `undefined` for anything
 * else — the file sits on disk between runs, so its content is evidence to
 * validate, not a trusted structure. */
function parseMeasurements(
  raw: string,
): StandardMeasurements | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { head, values, durations, definitions, provenance } = data as {
    head?: unknown;
    values?: unknown;
    durations?: unknown;
    definitions?: unknown;
    provenance?: unknown;
  };
  if (typeof head !== "string" || head === "") {
    return undefined;
  }
  const parsedValues = finiteNumberMap(values);
  if (parsedValues === undefined) {
    return undefined;
  }
  const parsedDurations = durations === undefined
    ? {}
    : finiteNumberMap(durations);
  if (parsedDurations === undefined) {
    return undefined;
  }
  const parsedDefinitions = definitions === undefined
    ? {}
    : stringMap(definitions);
  const parsedProvenance = provenance === undefined
    ? {}
    : stringMap(provenance);
  if (parsedDefinitions === undefined || parsedProvenance === undefined) {
    return undefined;
  }
  return {
    head,
    values: parsedValues,
    durations: parsedDurations,
    definitions: parsedDefinitions,
    provenance: parsedProvenance,
  };
}

/**
 * The recorded measurement baselines reachable from this worktree, nearest
 * first: its OWN measurement proof, then the main checkout's (via the shared
 * git common dir) — the trunk's last recorded measurement, which gives a fresh
 * worktree a baseline before it has measured anything itself. Unlike
 * {@link inspectStandardMeasurements} (the pin's strict same-HEAD honor rule),
 * these are candidates for the gate's input-keyed replay: the CALLER must
 * verify each `head` is an ancestor of the current HEAD and that the standard's
 * declared inputs are untouched since. Best-effort: unreadable or malformed
 * files are simply absent.
 */
export async function measurementBaselines(
  cwd: string,
): Promise<StandardMeasurements[]> {
  const own = await gitAdminStatePath(cwd, "standardMeasurements");
  const common = await runGit(["rev-parse", "--git-common-dir"], { cwd });
  const commonDir = common.success ? common.stdout.trim() : "";
  const trunk = commonDir === "" ? undefined : join(
    commonDir.startsWith("/") ? commonDir : join(cwd, commonDir),
    GIT_ADMIN_STATE.standardMeasurements.path,
  );
  const paths = [own, trunk].filter((p): p is string => p !== undefined);
  const out: StandardMeasurements[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      continue; // the main checkout: its own admin file IS the common-dir file
    }
    seen.add(path);
    const raw = await readTextIfExists(path);
    if (raw === undefined) {
      continue;
    }
    const parsed = parseMeasurements(raw);
    if (parsed !== undefined) {
      out.push(parsed);
    }
  }
  return out;
}
