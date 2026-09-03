/**
 * The **declaration-evidence identity** — one hash over everything the open question
 * store currently claims, so gate markers can bind to the agent's recorded
 * judgments the same way they bind to the tree.
 *
 * The material covers, per checkpoint in sorted order: the open question's own
 * definition hash and subject fingerprint, and the declaration's conclusion,
 * rationale, and the {definition hash, subject} pair it judged. Timestamps
 * stay OUT: identity answers "is the recorded evidence the same claim", and a
 * re-recorded identical claim is the same evidence (matching the store's own
 * idempotence rule). An empty or missing store hashes to the stable
 * empty-material identity, so "no checkpoint has ever fired" is one value on
 * every machine.
 *
 * A store that cannot be READ yields `unavailable`, and every consumer FAILS
 * OPEN: the rerun guard does not refuse, and a recorded proof stays honored —
 * an uncertain identity is never treated as a changed one.
 */

import { sha256Hex } from "../../shared/sha256.ts";
import {
  type CheckpointDeclaration,
  type OpenQuestion,
  readOpenQuestions,
} from "./open_questions.ts";

/** Version tag mixed into the evidence material: bump when the shape changes,
 * so two engine versions can never read the same bytes as the same evidence. */
const EVIDENCE_MATERIAL_VERSION = "checkpoint-evidence/v1";

/** How computing the identity went. `unavailable` is the fail-open cue. */
export type EvidenceIdentity =
  | { status: "ok"; identity: string }
  | { status: "unavailable"; reason: string };

/** One declaration's identity material — the claim, never its timestamp. */
function declarationMaterial(
  declaration: CheckpointDeclaration | undefined,
): string {
  if (declaration === undefined) {
    return "-";
  }
  const why = declaration.conclusion === "unmet" ? declaration.why : "";
  return [
    declaration.conclusion,
    declaration.definitionHash,
    declaration.subject,
    why,
  ].join("\u0000");
}

/** The full material for one openQuestion entry. */
function openQuestionMaterial(openQuestion: OpenQuestion): string {
  return [
    openQuestion.checkpoint,
    openQuestion.definitionHash,
    openQuestion.subject,
    declarationMaterial(openQuestion.declaration),
  ].join("\u0000");
}

/** Hash a set of openQuestions into one evidence identity (pure half). */
export async function evidenceIdentityOf(
  openQuestions: Readonly<Record<string, OpenQuestion>>,
): Promise<string> {
  const lines = Object.values(openQuestions)
    .map(openQuestionMaterial)
    .sort();
  return await sha256Hex(
    `${EVIDENCE_MATERIAL_VERSION}\n${lines.join("\n")}`,
  );
}

/**
 * Compute the worktree's current declaration-evidence identity from its
 * open question store. A missing store is the stable empty identity. An invalid
 * or unreadable store is unavailable: callers may continue fail-open, but must
 * preserve that the evidence identity could not be checked.
 */
export async function declarationEvidenceIdentity(
  cwd: string,
): Promise<EvidenceIdentity> {
  const read = await readOpenQuestions(cwd);
  switch (read.status) {
    case "ok":
      return {
        status: "ok",
        identity: await evidenceIdentityOf(read.openQuestions),
      };
    case "missing":
      return { status: "ok", identity: await evidenceIdentityOf({}) };
    case "invalid":
      return {
        status: "unavailable",
        reason: "the checkpoint open-question record did not parse",
      };
    case "newer":
    case "unavailable":
      return { status: "unavailable", reason: read.reason };
  }
}
