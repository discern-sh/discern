/**
 * Repository-resident landing proofs.
 *
 * The gate proof marker is a worktree-local validation cache. Acceptance
 * publishes the same structured proof after the trunk fast-forward as a Git
 * note, so the evidence survives worktree cleanup without changing trunk
 * history. All writes are local; this module never fetches or pushes.
 */

import { DISCERN_MACHINE } from "../../shared/brand.ts";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { discernAttributionEnabled, type EnvReader } from "../../shared/env.ts";
import { PROOF_NOTE_PAYLOAD_TYPE } from "../../shared/public_schemas.ts";
import {
  type AcceptanceEvidenceData,
  canonicalProof,
  type DurableProofClaim,
  type Proof,
  type ProofIssuer,
  type ProofNotePayload,
  type ProofNotesFetchData,
  type ProofNoteWriteData,
  type ProofPresentation,
  TolerantProofNotePayloadSchema,
  TolerantProofNoteSchema,
  TolerantProofSchema,
} from "../../shared/result_schemas.ts";
import { splitNulRecords } from "../../shared/git_paths.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { abbreviatedObjectIdMatches } from "../../shared/tree_identity.ts";

export const PROOF_NOTES_REF = "refs/notes/discern";
export const PROOF_NOTES_SHORT_REF = "discern";
export const PROOF_NOTES_TRACKING_PREFIX = "refs/discern/remotes";

const MANAGED_REMOTE_KEY = "discern.proofNotesFetchRemote";
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Derive the private tracking ref that holds one remote's fetched proof notes. */
function fetchRef(remote: string): string {
  return `${PROOF_NOTES_TRACKING_PREFIX}/${remote}/notes`;
}

/** Render the wildcard refspec that fetches proof notes without requiring their existence. */
function fetchMapping(remote: string): string {
  return `+${PROOF_NOTES_REF}*:${fetchRef(remote)}*`;
}

/** Render the former exact proof-note refspec for upgrade cleanup. */
function legacyFetchMapping(remote: string): string {
  return `+${PROOF_NOTES_REF}:${fetchRef(remote)}`;
}

/** Prefer Git's stderr or stdout detail and fall back to its exit status. */
function gitReason(result: GitResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail === "" ? `git exited with status ${result.code}` : detail;
}

/** Read every local Git config value while distinguishing absence from command failure. */
async function configValues(
  root: string,
  key: string,
): Promise<{ values: string[]; error?: string }> {
  const result = await runGit(["config", "--local", "--get-all", key], {
    cwd: root,
  });
  if (result.success) {
    return {
      values: result.stdout.split(/\r?\n/).filter((value) => value !== ""),
    };
  }
  if (result.code === 1) {
    return { values: [] };
  }
  return { values: [], error: gitReason(result) };
}

/** Remove one literal local config value and accept that it is already absent. */
async function removeFixedConfigValue(
  root: string,
  key: string,
  value: string,
): Promise<string | undefined> {
  const result = await runGit(
    ["config", "--local", "--fixed-value", "--unset-all", key, value],
    { cwd: root },
  );
  if (result.success || result.code === 1) {
    return undefined;
  }
  return gitReason(result);
}

/** Replace one literal local config value and return Git's failure detail. */
async function replaceFixedConfigValue(
  root: string,
  key: string,
  value: string,
  previous: string,
): Promise<string | undefined> {
  const result = await runGit(
    [
      "config",
      "--local",
      "--fixed-value",
      "--replace-all",
      key,
      value,
      previous,
    ],
    { cwd: root },
  );
  return result.success ? undefined : gitReason(result);
}

/** Append a changed config key only once to the result inventory. */
function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

/** Leave safe Git arguments bare and single-quote every other value. */
function shellArgument(value: string): string {
  return /^[A-Za-z0-9._/@%+=:,~-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Give the exact removal command for an unmarked legacy proof-note refspec. */
function legacyMappingError(
  remote: string,
  key: string,
  mapping: string,
): string {
  return `${key} contains an older proof-note mapping without discern's ` +
    `ownership marker. This mapping makes \`git fetch ${
      shellArgument(remote)
    }\` fail whenever the remote has no proof note. Remove it with ` +
    `\`git config --local --fixed-value --unset-all ${shellArgument(key)} ${
      shellArgument(mapping)
    }\`, then run \`discern refresh\` again.`;
}

/** One planned local Git-config mutation owned by proof-note fetch transport. */
export interface ProofNotesFetchOperation {
  readonly kind: "add" | "remove" | "replace";
  readonly key: string;
  readonly value: string;
  readonly previous?: string | undefined;
  readonly remote: string;
  readonly addedKeys: readonly string[];
  readonly removedKeys: readonly string[];
  readonly failurePrefix: string;
  /** A failed mapping add removes the marker this plan just added. */
  readonly rollback?: ProofNotesFetchOperation | undefined;
}

/** One remote is the partial-failure boundary for its planned config effects. */
export interface ProofNotesFetchBoundaryPlan {
  readonly remote: string;
  readonly operations: readonly ProofNotesFetchOperation[];
}

/** Complete read-only proof-note fetch reconciliation. */
export interface ProofNotesFetchPlan {
  readonly mode: "local" | "fetch";
  readonly remotes: readonly string[];
  readonly boundaries: readonly ProofNotesFetchBoundaryPlan[];
  readonly errors: readonly string[];
}

/** Construct one local Git-config plan operation. */
function proofNotesOperation(
  fields:
    & Omit<
      ProofNotesFetchOperation,
      "addedKeys" | "removedKeys"
    >
    & {
      readonly addedKeys?: readonly string[];
      readonly removedKeys?: readonly string[];
    },
): ProofNotesFetchOperation {
  return {
    ...fields,
    addedKeys: fields.addedKeys ?? [],
    removedKeys: fields.removedKeys ?? [],
  };
}

/** Plan removal of every discern-owned proof-note value for one remote. */
async function planManagedRemoteRemoval(
  root: string,
  remote: string,
): Promise<{ operations: ProofNotesFetchOperation[]; errors: string[] }> {
  const key = `remote.${remote}.fetch`;
  const current = await configValues(root, key);
  if (current.error !== undefined) {
    return {
      operations: [],
      errors: [`could not read ${key}: ${current.error}`],
    };
  }
  const operations: ProofNotesFetchOperation[] = [];
  for (const mapping of [fetchMapping(remote), legacyFetchMapping(remote)]) {
    if (!current.values.includes(mapping)) {
      continue;
    }
    operations.push(proofNotesOperation({
      kind: "remove",
      key,
      value: mapping,
      remote,
      removedKeys: [key],
      failurePrefix: `could not remove ${key}`,
    }));
  }
  operations.push(proofNotesOperation({
    kind: "remove",
    key: MANAGED_REMOTE_KEY,
    value: remote,
    remote,
    failurePrefix: `could not clear discern's proof-note marker for ${remote}`,
  }));
  return { operations, errors: [] };
}

/** Project a proof-note plan into the stable result data shape. */
export function proofNotesFetchPlanData(
  plan: ProofNotesFetchPlan,
): ProofNotesFetchData {
  const added: string[] = [];
  const removed: string[] = [];
  for (const boundary of plan.boundaries) {
    for (const operation of boundary.operations) {
      for (const key of operation.addedKeys) pushUnique(added, key);
      for (const key of operation.removedKeys) pushUnique(removed, key);
    }
  }
  return {
    mode: plan.mode,
    status: plan.errors.length > 0
      ? "failed"
      : plan.mode === "local"
      ? "local"
      : plan.remotes.length === 0
      ? "no_remote"
      : added.length > 0 || removed.length > 0
      ? "wired"
      : "unchanged",
    remotes: [...plan.remotes],
    added,
    removed,
    errors: [...plan.errors],
  };
}

/**
 * Compute every proof-note fetch Git-config effect without writing. The plan is
 * grouped per remote so one unreadable or failed remote never blinds the rest.
 */
export async function planProofNotesFetch(
  root: string,
  mode: "local" | "fetch",
): Promise<ProofNotesFetchPlan> {
  const repository = await runGit(["rev-parse", "--git-dir"], { cwd: root });
  if (!repository.success) {
    return { mode, remotes: [], boundaries: [], errors: [] };
  }

  const managedRead = await configValues(root, MANAGED_REMOTE_KEY);
  if (managedRead.error !== undefined) {
    return {
      mode,
      remotes: [],
      boundaries: [],
      errors: [
        `could not read discern's proof-note markers: ${managedRead.error}`,
      ],
    };
  }
  const managed = new Set(managedRead.values);
  const remoteRun = await runGit(["remote"], { cwd: root });
  if (!remoteRun.success) {
    return {
      mode,
      remotes: [],
      boundaries: [],
      errors: [`could not list Git remotes: ${gitReason(remoteRun)}`],
    };
  }
  const remotes = remoteRun.stdout.split(/\r?\n/).filter((value) =>
    value !== ""
  )
    .sort();
  const remoteSet = new Set(remotes);
  const boundaries: ProofNotesFetchBoundaryPlan[] = [];
  const errors: string[] = [];

  for (const remote of [...managed].filter((name) => !remoteSet.has(name))) {
    const planned = await planManagedRemoteRemoval(root, remote);
    boundaries.push({ remote, operations: planned.operations });
    errors.push(...planned.errors);
    managed.delete(remote);
  }

  if (mode === "local") {
    for (const remote of managed) {
      const planned = await planManagedRemoteRemoval(root, remote);
      boundaries.push({ remote, operations: planned.operations });
      errors.push(...planned.errors);
    }
    return { mode, remotes, boundaries, errors };
  }

  for (const remote of remotes) {
    const key = `remote.${remote}.fetch`;
    const mapping = fetchMapping(remote);
    const legacyMapping = legacyFetchMapping(remote);
    const current = await configValues(root, key);
    if (current.error !== undefined) {
      errors.push(`could not read ${key}: ${current.error}`);
      continue;
    }
    const operations: ProofNotesFetchOperation[] = [];
    const mappingCount = current.values.filter((value) => value === mapping)
      .length;
    const hasLegacyMapping = current.values.includes(legacyMapping);
    if (!managed.has(remote) && hasLegacyMapping) {
      errors.push(legacyMappingError(remote, key, legacyMapping));
      continue;
    }

    if (managed.has(remote)) {
      if (hasLegacyMapping && mappingCount === 0) {
        operations.push(proofNotesOperation({
          kind: "replace",
          key,
          value: mapping,
          previous: legacyMapping,
          remote,
          addedKeys: [key],
          removedKeys: [key],
          failurePrefix:
            `could not migrate ${key} to an optional proof-note mapping`,
        }));
        boundaries.push({ remote, operations });
        continue;
      }
      if (hasLegacyMapping) {
        operations.push(proofNotesOperation({
          kind: "remove",
          key,
          value: legacyMapping,
          remote,
          removedKeys: [key],
          failurePrefix:
            `could not remove the older proof-note mapping from ${key}`,
        }));
      }
      if (mappingCount > 1) {
        operations.push(proofNotesOperation({
          kind: "replace",
          key,
          value: mapping,
          previous: mapping,
          remote,
          addedKeys: [key],
          failurePrefix:
            `could not normalize discern's proof-note mapping in ${key}`,
        }));
      }
      if (mappingCount > 0) {
        if (operations.length > 0) boundaries.push({ remote, operations });
        continue;
      }
    } else if (mappingCount > 0) {
      continue;
    }

    let rollback: ProofNotesFetchOperation | undefined;
    if (!managed.has(remote)) {
      const marker = proofNotesOperation({
        kind: "add",
        key: MANAGED_REMOTE_KEY,
        value: remote,
        remote,
        failurePrefix: `could not mark ${key} as discern-managed`,
      });
      operations.push(marker);
      rollback = proofNotesOperation({
        kind: "remove",
        key: MANAGED_REMOTE_KEY,
        value: remote,
        remote,
        failurePrefix: `could not roll back discern's marker for ${remote}`,
      });
    }
    operations.push(proofNotesOperation({
      kind: "add",
      key,
      value: mapping,
      remote,
      addedKeys: [key],
      failurePrefix: `could not add ${key}`,
      ...(rollback === undefined ? {} : { rollback }),
    }));
    boundaries.push({ remote, operations });
  }
  return { mode, remotes, boundaries, errors };
}

/** Apply one planned proof-note Git-config mutation. */
export async function applyProofNotesFetchOperation(
  root: string,
  operation: ProofNotesFetchOperation,
): Promise<string | undefined> {
  if (operation.kind === "remove") {
    return await removeFixedConfigValue(
      root,
      operation.key,
      operation.value,
    );
  }
  if (operation.kind === "replace") {
    return await replaceFixedConfigValue(
      root,
      operation.key,
      operation.value,
      operation.previous ?? operation.value,
    );
  }
  const result = await runGit(
    ["config", "--local", "--add", operation.key, operation.value],
    { cwd: root },
  );
  return result.success ? undefined : gitReason(result);
}

/** Apply a proof-note fetch plan without re-reading discovery state. */
export async function applyProofNotesFetchPlan(
  root: string,
  plan: ProofNotesFetchPlan,
): Promise<ProofNotesFetchData> {
  const added: string[] = [];
  const removed: string[] = [];
  const errors = [...plan.errors];
  for (const boundary of plan.boundaries) {
    for (const operation of boundary.operations) {
      const error = await applyProofNotesFetchOperation(root, operation);
      if (error !== undefined) {
        errors.push(`${operation.failurePrefix}: ${error}`);
        if (operation.rollback !== undefined) {
          const rollbackError = await applyProofNotesFetchOperation(
            root,
            operation.rollback,
          );
          if (rollbackError !== undefined) {
            errors.push(
              `${operation.rollback.failurePrefix}: ${rollbackError}`,
            );
          }
        }
        break;
      }
      for (const key of operation.addedKeys) pushUnique(added, key);
      for (const key of operation.removedKeys) pushUnique(removed, key);
    }
  }
  return {
    mode: plan.mode,
    status: errors.length > 0
      ? "failed"
      : plan.mode === "local"
      ? "local"
      : plan.remotes.length === 0
      ? "no_remote"
      : added.length > 0 || removed.length > 0
      ? "wired"
      : "unchanged",
    remotes: [...plan.remotes],
    added,
    removed,
    errors,
  };
}

/**
 * Reconcile the opt-in fetch transport. The trailing wildcard makes the source
 * optional: Git accepts a zero-ref match, while an absent exact positive refspec
 * makes ordinary fetch fail. Only mappings this function marked are migrated or
 * removed. No push key is read or written.
 */
export async function reconcileProofNotesFetch(
  root: string,
  mode: "local" | "fetch",
): Promise<ProofNotesFetchData> {
  return await applyProofNotesFetchPlan(
    root,
    await planProofNotesFetch(root, mode),
  );
}

/** Whether fetch transport reconciliation completed without an error. */
export function proofNotesFetchSucceeded(
  result: Pick<ProofNotesFetchData, "errors">,
): boolean {
  return result.errors.length === 0;
}

/** Project only stable structured facts into the durable proof claim. */
function canonicalProofClaim(proof: Proof): DurableProofClaim {
  return {
    branch: proof.branch,
    trunk: proof.trunk,
    head: proof.head,
    files_total: proof.files_total,
    insertions: proof.insertions,
    deletions: proof.deletions,
    ...(proof.mode === undefined ? {} : { mode: proof.mode }),
    ...(proof.checkpoint_drops === undefined ? {} : {
      checkpoint_drops: proof.checkpoint_drops.map((drop) => ({ ...drop })),
    }),
    ...(proof.standard_proposals === undefined ? {} : {
      standard_proposals: proof.standard_proposals.map((proposal) => ({
        ...proposal,
        evidence_paths: [...proposal.evidence_paths],
      })),
    }),
  };
}

/** Keep human renderings separate from the structured proof claim. */
function canonicalProofPresentation(proof: Proof): ProofPresentation {
  return {
    line: proof.line,
    markdown: proof.markdown,
  };
}

/** Project acceptance evidence onto its canonical payload block: the consent
 * source (scopes only for a standing grant) plus each authorized variance in
 * a fixed key order. */
function canonicalAcceptanceEvidence(
  acceptance: AcceptanceEvidenceData,
): AcceptanceEvidenceData {
  return {
    consent: {
      source: acceptance.consent.source,
      ...(acceptance.consent.scopes === undefined
        ? {}
        : { scopes: [...acceptance.consent.scopes] }),
    },
    variances: acceptance.variances.map((variance) => ({
      checkpoint: variance.checkpoint,
      definition_hash: variance.definition_hash,
      subject: variance.subject,
      why: variance.why,
    })),
    standard_proposals: acceptance.standard_proposals.map((proposal) => ({
      ...proposal,
      evidence_paths: [...proposal.evidence_paths],
    })),
  };
}

/** The UTF-8 JSON text placed byte-for-byte inside the DSSE payload. Fixed key
 * order makes today's unsigned writer deterministic; DSSE verification later
 * consumes the decoded bytes without reserializing this object. */
export function canonicalProofNotePayload(
  proof: Proof,
  commit: string,
  acceptance?: AcceptanceEvidenceData,
): string {
  const payload: ProofNotePayload = {
    subject: { commit },
    proof: canonicalProofClaim(proof),
    presentation: canonicalProofPresentation(proof),
    ...(acceptance === undefined
      ? {}
      : { acceptance: canonicalAcceptanceEvidence(acceptance) }),
  };
  return JSON.stringify(payload);
}

/** One deterministic DSSE-compatible boundary for a structured proof note.
 * Current notes use discern's empty-array unsigned extension. */
export function canonicalProofNote(
  proof: Proof,
  commit: string,
  acceptance?: AcceptanceEvidenceData,
): string {
  const payload = UTF8_ENCODER.encode(
    canonicalProofNotePayload(proof, commit, acceptance),
  );
  return JSON.stringify({
    payloadType: PROOF_NOTE_PAYLOAD_TYPE,
    payload: encodeBase64(payload),
    signatures: [],
  }) + "\n";
}

/** A durable note's parsed content, before its commit binding is checked:
 * a readable proof (`subject` present for the current format, absent for a
 * legacy bare note), or an explicit refusal naming a format identity this
 * binary does not know. Malformed content parses to `undefined`, as before. */
type ParsedProofNote =
  | {
    kind: "proof";
    proof: Proof;
    subject?: string;
    issuer?: ProofIssuer;
    brief?: string;
  }
  | { kind: "unsupported"; format: string };

/** Project the durable reader's tolerant issuer block onto the strict runtime
 * shape, dropping any additive fields a newer writer recorded. */
function knownIssuerFields(
  issuer: NonNullable<
    ReturnType<typeof TolerantProofNotePayloadSchema.parse>["issuer"]
  >,
): ProofIssuer {
  return {
    ...(issuer.name !== undefined ? { name: issuer.name } : {}),
    ...(issuer.email !== undefined ? { email: issuer.email } : {}),
    ...(issuer.key !== undefined ? { key: issuer.key } : {}),
  };
}

/** Rebuild the runtime proof from current split payloads or pre-split local
 * envelopes, dropping every unknown durable field from the live result. */
function proofFromProofPayload(
  payload: ReturnType<typeof TolerantProofNotePayloadSchema.parse>,
): Proof | undefined {
  const line = payload.presentation?.line ?? payload.proof.line;
  const markdown = payload.presentation?.markdown ?? payload.proof.markdown;
  if (line === undefined || markdown === undefined) {
    return undefined;
  }
  return {
    branch: payload.proof.branch,
    trunk: payload.proof.trunk,
    head: payload.proof.head,
    files_total: payload.proof.files_total,
    insertions: payload.proof.insertions,
    deletions: payload.proof.deletions,
    ...(payload.proof.mode === undefined ? {} : { mode: payload.proof.mode }),
    ...(payload.proof.checkpoint_drops === undefined ? {} : {
      checkpoint_drops: payload.proof.checkpoint_drops.map((drop) => ({
        ...drop,
      })),
    }),
    line,
    markdown,
  };
}

/** DSSE permits standard and URL-safe Base64. The durable reader also accepts
 * either alphabet without padding. Reject mixed alphabets and bad padding. */
function decodeDsseBase64(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/u.test(value)) {
    return undefined;
  }
  const standardAlphabet = /[+/]/u.test(value);
  const urlSafeAlphabet = /[-_]/u.test(value);
  if (standardAlphabet && urlSafeAlphabet) {
    return undefined;
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    return decodeBase64(normalized);
  } catch {
    return undefined;
  }
}

/** Decode the envelope once and parse the same bytes a future verifier checks. */
function parseProofNotePayload(
  encoded: string,
): ReturnType<typeof TolerantProofNotePayloadSchema.parse> | undefined {
  const bytes = decodeDsseBase64(encoded);
  if (bytes === undefined) {
    return undefined;
  }
  let content: string;
  try {
    content = UTF8_DECODER.decode(bytes);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const payload = TolerantProofNotePayloadSchema.safeParse(parsed);
  return payload.success ? payload.data : undefined;
}

/**
 * Parse one note body. `payloadType` is the in-band format identity: the current
 * type reads the envelope and decoded payload tolerantly, any other type is
 * reported as unsupported, and a bare 8-field proof remains legacy unsigned.
 */
function parseProofNote(content: string): ParsedProofNote | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  if (!("payloadType" in parsed)) {
    const legacy = TolerantProofSchema.safeParse(parsed);
    return legacy.success
      ? { kind: "proof", proof: canonicalProof(legacy.data) }
      : undefined;
  }
  const payloadType: unknown = (parsed as { payloadType: unknown }).payloadType;
  if (payloadType !== PROOF_NOTE_PAYLOAD_TYPE) {
    return {
      kind: "unsupported",
      format: typeof payloadType === "string"
        ? payloadType
        : JSON.stringify(payloadType) ?? String(payloadType),
    };
  }
  const envelope = TolerantProofNoteSchema.safeParse(parsed);
  if (!envelope.success) {
    return undefined;
  }
  const payload = parseProofNotePayload(envelope.data.payload);
  if (payload === undefined) {
    return undefined;
  }
  const proof = proofFromProofPayload(payload);
  if (proof === undefined) {
    return undefined;
  }
  return {
    kind: "proof",
    proof,
    subject: payload.subject.commit,
    ...(payload.issuer !== undefined
      ? { issuer: knownIssuerFields(payload.issuer) }
      : {}),
    ...(payload.brief !== undefined ? { brief: payload.brief } : {}),
  };
}

/** List fetched proof-note tracking refs in stable order. */
async function proofTrackingRefs(root: string): Promise<string[]> {
  const result = await runGit(
    [
      "for-each-ref",
      "--format=%(refname)",
      `${PROOF_NOTES_TRACKING_PREFIX}/`,
    ],
    { cwd: root },
  );
  if (!result.success) {
    return [];
  }
  return result.stdout.split(/\r?\n/).filter((ref) =>
    ref.startsWith(`${PROOF_NOTES_TRACKING_PREFIX}/`) &&
    ref.endsWith("/notes")
  ).sort();
}

/** Supply discern's Git note author identity only when attribution is enabled. */
function notesIdentity(
  env: EnvReader,
): Record<string, string> | undefined {
  if (!discernAttributionEnabled(env)) {
    return undefined;
  }
  return {
    GIT_AUTHOR_NAME: DISCERN_MACHINE.name,
    GIT_AUTHOR_EMAIL: DISCERN_MACHINE.email,
    GIT_COMMITTER_NAME: DISCERN_MACHINE.name,
    GIT_COMMITTER_EMAIL: DISCERN_MACHINE.email,
  };
}

/**
 * Merge already-fetched proof histories, then attach one proof to the
 * landed commit. Every failure is returned as data; the caller has already
 * moved the trunk and must never roll it back for this record.
 */
export async function writeProofNote(
  root: string,
  commit: string,
  proof: Proof | undefined,
  env: EnvReader = Deno.env,
  /** Structured acceptance evidence — the consent source plus every
   * owner-authorized variance — recorded inside the DSSE payload boundary. */
  acceptance?: AcceptanceEvidenceData,
): Promise<ProofNoteWriteData> {
  if (proof === undefined) {
    return {
      status: "missing_proof",
      ref: PROOF_NOTES_REF,
      commit,
      merged_refs: [],
      reason: "the validated gate marker carried no structured proof",
    };
  }
  if (proof.mode === "report") {
    return {
      status: "record_failed",
      ref: PROOF_NOTES_REF,
      commit,
      merged_refs: [],
      reason:
        "the Proof reports checkpoint review and cannot become landing evidence",
    };
  }
  // The write-side half of the subject cross-check: never publish a durable
  // record whose display commit contradicts the commit it is attached to.
  if (!abbreviatedObjectIdMatches(proof.head, commit)) {
    return {
      status: "record_failed",
      ref: PROOF_NOTES_REF,
      commit,
      merged_refs: [],
      reason:
        `the proof names ${proof.head}, which does not match the landed commit ${commit}`,
    };
  }

  const identity = notesIdentity(env);
  const mergedRefs: string[] = [];
  for (const ref of await proofTrackingRefs(root)) {
    const merge = await runGit(
      ["notes", `--ref=${PROOF_NOTES_SHORT_REF}`, "merge", ref],
      {
        cwd: root,
        ...(identity === undefined ? {} : { env: identity }),
      },
    );
    if (!merge.success) {
      await runGit(
        ["notes", `--ref=${PROOF_NOTES_SHORT_REF}`, "merge", "--abort"],
        { cwd: root },
      );
      return {
        status: "record_failed",
        ref: PROOF_NOTES_REF,
        commit,
        merged_refs: mergedRefs,
        reason: `could not merge ${ref}: ${gitReason(merge)}`,
      };
    }
    mergedRefs.push(ref);
  }

  const body = canonicalProofNote(proof, commit, acceptance);
  const existing = await runGit(
    ["notes", `--ref=${PROOF_NOTES_SHORT_REF}`, "show", commit],
    { cwd: root },
  );
  if (existing.success) {
    const parsed = parseProofNote(existing.stdout);
    if (parsed?.kind === "unsupported") {
      return {
        status: "record_failed",
        ref: PROOF_NOTES_REF,
        commit,
        merged_refs: mergedRefs,
        reason:
          `the landed commit already carries a proof note in a format this discern does not know (${parsed.format})`,
      };
    }
    // Note identity is the annotated subject plus the stable proof claim. A
    // retry may render different Markdown, line text, or timing telemetry, but
    // notes are records and must never be rewritten merely for presentation.
    // Legacy bare notes imply the commit they annotate as their subject.
    const comparableClaim = (value: Proof): string =>
      JSON.stringify(canonicalProofClaim(value));
    if (
      parsed !== undefined &&
      comparableClaim(parsed.proof) === comparableClaim(proof) &&
      (parsed.subject === undefined || parsed.subject === commit)
    ) {
      return {
        status: "already_present",
        ref: PROOF_NOTES_REF,
        commit,
        merged_refs: mergedRefs,
      };
    }
    return {
      status: "record_failed",
      ref: PROOF_NOTES_REF,
      commit,
      merged_refs: mergedRefs,
      reason: "the landed commit already has a different proof note",
    };
  }
  if (existing.code !== 1) {
    return {
      status: "record_failed",
      ref: PROOF_NOTES_REF,
      commit,
      merged_refs: mergedRefs,
      reason: `could not inspect the landed proof note: ${gitReason(existing)}`,
    };
  }

  const written = await runGit(
    [
      "notes",
      `--ref=${PROOF_NOTES_SHORT_REF}`,
      "add",
      "-F",
      "-",
      commit,
    ],
    {
      cwd: root,
      stdin: body,
      ...(identity === undefined ? {} : { env: identity }),
    },
  );
  if (!written.success) {
    return {
      status: "record_failed",
      ref: PROOF_NOTES_REF,
      commit,
      merged_refs: mergedRefs,
      reason: gitReason(written),
    };
  }
  return {
    status: "recorded",
    ref: PROOF_NOTES_REF,
    commit,
    merged_refs: mergedRefs,
  };
}

export interface LandedProofNote {
  readonly commit: string;
  readonly ref: string;
  readonly proof: Proof;
  /** The payload's issuer assertion, when present. This read path does not
   * verify a signature or bind the assertion to a trusted identity. */
  readonly issuer?: ProofIssuer;
  /** The durable record's signed-intent reference, when it carries one. */
  readonly brief?: string;
}

/**
 * What one commit's durable proof lookup found: a bound, readable proof
 * (`valid` is structural and subject validity, not signature verification);
 * an explicit refusal for a record in a newer format this binary cannot read
 * (never a silent miss — the evidence exists, the reader is too old); or
 * nothing at all.
 */
export type LandedProofReading =
  | ({ readonly status: "valid" } & LandedProofNote)
  | {
    readonly status: "unsupported";
    readonly commit: string;
    readonly ref: string;
    readonly format: string;
  }
  | { readonly status: "missing" };

/** Resolve a commit's fan-out note path and read its blob from one tracking ref. */
async function noteContentFromTrackingRef(
  root: string,
  ref: string,
  commit: string,
): Promise<string | undefined> {
  const paths = await notePathsFromRef(root, ref);
  const path = paths.get(commit);
  if (path === undefined) {
    return undefined;
  }
  const blob = await runGit(["show", `${ref}:${path}`], { cwd: root });
  return blob.success ? blob.stdout : undefined;
}

/** Object id → tree path for every note carried by one notes ref. */
async function notePathsFromRef(
  root: string,
  ref: string,
): Promise<Map<string, string>> {
  const tree = await runGit(
    ["ls-tree", "-r", "-z", "--format=%(path)", ref],
    { cwd: root },
  );
  if (!tree.success) {
    return new Map();
  }
  const paths = new Map<string, string>();
  for (const path of splitNulRecords(tree.stdout)) {
    const object = path.replaceAll("/", "");
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(object)) {
      paths.set(object, path);
    }
  }
  return paths;
}

/** Whether a parsed note is bound to the commit that carries it. The current
 * format's authority is the full-oid subject, with the display head kept
 * coherent; a legacy note's strongest binding is its abbreviated head. */
function boundToCommit(
  parsed: ParsedProofNote & { kind: "proof" },
  commit: string,
): boolean {
  if (parsed.subject !== undefined) {
    return parsed.subject === commit &&
      abbreviatedObjectIdMatches(parsed.proof.head, commit);
  }
  return abbreviatedObjectIdMatches(parsed.proof.head, commit);
}

/**
 * Read one commit's durable proof, preferring local truth. A readable bound
 * proof on any ref wins; otherwise a record in an unknown newer format is
 * reported as `unsupported` rather than dropped (ADR 0242).
 */
export async function readProofNoteAt(
  root: string,
  commit: string,
): Promise<LandedProofReading> {
  if (commit === "") {
    return { status: "missing" };
  }
  let unsupported: LandedProofReading | undefined;
  const refs = [PROOF_NOTES_REF, ...await proofTrackingRefs(root)];
  for (const ref of refs) {
    const content = ref === PROOF_NOTES_REF
      ? await runGit(
        ["notes", `--ref=${PROOF_NOTES_SHORT_REF}`, "show", commit],
        { cwd: root },
      ).then((shown) => shown.success ? shown.stdout : undefined)
      : await noteContentFromTrackingRef(root, ref, commit);
    if (content === undefined) {
      continue;
    }
    const parsed = parseProofNote(content);
    if (parsed === undefined) {
      continue;
    }
    if (parsed.kind === "unsupported") {
      unsupported ??= {
        status: "unsupported",
        commit,
        ref,
        format: parsed.format,
      };
      continue;
    }
    if (boundToCommit(parsed, commit)) {
      return {
        status: "valid",
        commit,
        ref,
        proof: parsed.proof,
        ...(parsed.issuer !== undefined ? { issuer: parsed.issuer } : {}),
        ...(parsed.brief !== undefined ? { brief: parsed.brief } : {}),
      };
    }
  }
  return unsupported ?? { status: "missing" };
}

/**
 * Find a validated landing for `branch` on the trunk ancestry added after
 * `sinceCommit`. This is the durable bridge across an `await` continuation gap:
 * acceptance writes the proof note before deleting the worktree and branch.
 */
export async function findLandedProofNoteForBranch(
  root: string,
  branch: string,
  trunk: string,
  sinceCommit: string,
): Promise<LandedProofNote | undefined> {
  const commits = await runGit(
    [
      "rev-list",
      "--reverse",
      `${sinceCommit}..refs/heads/${trunk}`,
    ],
    { cwd: root },
  );
  if (!commits.success) {
    return undefined;
  }
  for (
    const commit of commits.stdout.split(/\r?\n/).filter((value) =>
      value !== ""
    )
  ) {
    const landed = await readProofNoteAt(root, commit);
    if (
      landed.status === "valid" &&
      landed.proof.branch === branch &&
      landed.proof.trunk === trunk
    ) {
      const { status: _status, ...note } = landed;
      return note;
    }
  }
  return undefined;
}

/**
 * Find the newest accepted landing for a branch after acceptance deleted its
 * ref. Notes narrow the candidate set first; one trunk walk then orders and
 * ancestry-checks them without probing every commit for a note.
 */
export async function findLatestLandedProofNoteForBranch(
  root: string,
  branch: string,
  trunk: string,
): Promise<LandedProofNote | undefined> {
  const targets = new Set<string>();
  for (const ref of [PROOF_NOTES_REF, ...await proofTrackingRefs(root)]) {
    for (const target of (await notePathsFromRef(root, ref)).keys()) {
      targets.add(target);
    }
  }
  if (targets.size === 0) {
    return undefined;
  }
  const ancestry = await runGit(
    ["rev-list", `refs/heads/${trunk}`],
    { cwd: root },
  );
  if (!ancestry.success) {
    return undefined;
  }
  for (
    const commit of ancestry.stdout.split(/\r?\n/).filter((value) =>
      value !== ""
    )
  ) {
    if (!targets.has(commit)) {
      continue;
    }
    const landed = await readProofNoteAt(root, commit);
    if (
      landed.status === "valid" &&
      landed.proof.branch === branch &&
      landed.proof.trunk === trunk
    ) {
      const { status: _status, ...note } = landed;
      return note;
    }
  }
  return undefined;
}

/** Read the configured trunk tip's durable proof, preferring local truth. */
export async function readLandedProofNote(
  root: string,
  trunk: string,
): Promise<LandedProofReading> {
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${trunk}^{commit}`],
    { cwd: root },
  );
  return tip.success
    ? await readProofNoteAt(root, tip.stdout.trim())
    : { status: "missing" };
}
