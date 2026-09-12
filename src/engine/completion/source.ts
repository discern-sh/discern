/** The source tip a run proves, read once into immutable coordinates. */
import { sha256Hex } from "../../shared/sha256.ts";
import { runGit } from "../../shared/subprocess.ts";
import { readTrunkConfig } from "../gate/standard_limits.ts";
import { type Candidate, CandidateSchema } from "./candidate.ts";
import { type SourceRevision, SourceRevisionSchema } from "./identity.ts";
import type { CompletionRecord } from "./records.ts";
import {
  type PublicationFence,
  readCompletionRecord,
  writeCompletionRecord,
} from "./store.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";

/** Trim one Git value or throw its stderr. */
export async function gitValue(
  root: string,
  args: readonly string[],
): Promise<string> {
  const result = await runGit([...args], { cwd: root });
  if (!result.success) {
    throw new Error(
      result.stderr || "Git could not establish the completion subject.",
    );
  }
  return result.stdout.trim();
}

/** Resolve a mutable source branch once into immutable commit and tree coordinates. */
export async function observeSource(
  root: string,
  effort: string,
  branch: string,
): Promise<SourceRevision> {
  const head = await gitValue(root, [
    "rev-parse",
    "--verify",
    `${branch}^{commit}`,
  ]);
  return SourceRevisionSchema.parse({
    effort_id: effort,
    branch,
    head,
    tree: await gitValue(root, ["rev-parse", `${head}^{tree}`]),
  });
}

/** Two observations name the same source when every coordinate agrees. */
export function sameSource(a: SourceRevision, b: SourceRevision): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Two composition inputs agree when every entry agrees, in order. */
export function sameSources(
  a: readonly SourceRevision[],
  b: readonly SourceRevision[],
): boolean {
  return a.length === b.length &&
    a.every((source, index) => {
      const other = b[index];
      return other !== undefined && sameSource(source, other);
    });
}

/** The trunk's committed configuration identity at one immutable commit.
 * Identity digests the committed bytes: an unparseable committed config still
 * has an exact identity, and the gate's own policy checks report what it means. */
export async function predecessorPolicyIdentity(
  root: string,
  predecessor: string,
): Promise<string> {
  const read = await readTrunkConfig(root, predecessor);
  if (read.kind === "unreadable") {
    throw new Error(read.reason);
  }
  return await sha256Hex(read.kind === "absent" ? "absent-config" : read.text);
}

/** The recorded candidate for exactly these sources, predecessor, policy, and requirement set. */
export function recordedCandidate(
  records: readonly CompletionRecord[],
  subject: Pick<
    Candidate,
    "sources" | "predecessor" | "policy" | "requirement_set"
  >,
): Extract<CompletionRecord, { kind: "candidate" }> | undefined {
  return records.filter((
    record,
  ): record is Extract<CompletionRecord, { kind: "candidate" }> =>
    record.kind === "candidate" &&
    sameSources(record.data.sources, subject.sources) &&
    record.data.predecessor === subject.predecessor &&
    record.data.policy === subject.policy &&
    record.data.requirement_set === subject.requirement_set
  ).sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** Record the candidate under the attempt that observed it; it never implies readiness. */
export async function retainCandidate(
  root: string,
  id: string,
  candidate: Candidate,
  fence: PublicationFence,
): Promise<void> {
  CandidateSchema.parse(candidate);
  if (candidate.attempt_id !== fence.attempt_id) {
    throw new Error("Candidate names another attempt.");
  }
  const attempt = await readCompletionRecord(root, {
    kind: "attempt",
    id: fence.attempt_id,
  });
  if (
    attempt.kind !== "recorded" || attempt.record.kind !== "attempt" ||
    attempt.record.data.identity.candidate_id !== id
  ) throw new Error("Candidate belongs to another attempt identity.");
  const written = await writeCompletionRecord(
    root,
    {
      version: ON_DISK_FORMATS.completionRecord.version,
      kind: "candidate",
      id,
      revision: 1,
      data: candidate,
    },
    null,
    fence,
  );
  if (written.kind !== "written") {
    throw new Error(
      `Candidate publication ${written.kind}; observe the records and run again.`,
    );
  }
}
