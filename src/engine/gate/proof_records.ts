import {
  type CompletionProofPointer,
  CompletionProofPointerSchema,
} from "../../shared/completion_proof.ts";
/** Registered JSON codecs for Gate-local durable evidence. */

import { z } from "@zod/zod";
import type { GateMode } from "../../shared/checkpoint_drops.ts";
import { migrateProofEmbeddedCandidate } from "../completion/candidate.ts";
import {
  canonicalProof,
  type Proof,
  TolerantProofSchema,
} from "../../shared/result_schemas.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

const GateProofFileSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.gateProof.version),
  head: z.string().min(1),
  mode: z.enum(["strict", "report"]),
  proof: z.unknown().optional(),
  evidence: z.string().min(1).optional(),
  completion: CompletionProofPointerSchema.optional(),
});

export interface GateProofFile {
  readonly version: typeof ON_DISK_FORMATS.gateProof.version;
  readonly head: string;
  readonly mode: GateMode;
  readonly proof?: Proof;
  readonly evidence?: string;
  readonly completion?: CompletionProofPointer;
}

export type GateProofFileRead =
  | { readonly status: "recorded"; readonly record: GateProofFile }
  | { readonly status: "missing"; readonly reason: string }
  | { readonly status: "newer"; readonly reason: string }
  | { readonly status: "malformed"; readonly reason: string };

/** Decode only the registered JSON format. The private-era text marker has no
 * migration path: it is a cache miss and a fresh strict `done` must replace it. */
export function parseGateProofFile(content: string): GateProofFileRead {
  if (content.trim() === "") {
    return { status: "missing", reason: "Proof file was empty" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {
      status: "missing",
      reason: "unversioned gate Proof requires a fresh `discern done`",
    };
  }
  const version = inspectOnDiskRecordVersion("gateProof", decoded);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("gateProof", version.found),
    };
  }
  if (version.status !== "current") {
    return {
      status: "malformed",
      reason: "Gate Proof does not carry the registered format version",
    };
  }
  const parsed = GateProofFileSchema.safeParse(decoded);
  if (!parsed.success) {
    return { status: "malformed", reason: "Gate Proof JSON is malformed" };
  }
  // A marker written before the source-list shape embeds the singular
  // candidate; the retained evidence must keep reading after the migration.
  const proof = parsed.data.proof === undefined
    ? undefined
    : TolerantProofSchema.safeParse(
      migrateProofEmbeddedCandidate(parsed.data.proof),
    );
  return {
    status: "recorded",
    record: {
      version: ON_DISK_FORMATS.gateProof.version,
      head: parsed.data.head,
      ...(parsed.data.completion === undefined
        ? {}
        : { completion: parsed.data.completion }),
      mode: parsed.data.mode,
      ...(proof === undefined || !proof.success
        ? {}
        : { proof: canonicalProof(proof.data) }),
      ...(parsed.data.evidence === undefined
        ? {}
        : { evidence: parsed.data.evidence }),
    },
  };
}

/** What the last completed Gate run judged. */
export interface LastGateRun {
  readonly version: typeof ON_DISK_FORMATS.lastGateRun.version;
  readonly head: string;
  readonly tree?: string;
  readonly passed: boolean;
  readonly evidence?: string;
  readonly mode?: GateMode;
}

const LastGateRunSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.lastGateRun.version),
  head: z.string().min(1),
  tree: z.string().optional(),
  passed: z.boolean(),
  evidence: z.string().optional(),
  mode: z.enum(["strict", "report"]).optional(),
});

export type LastGateRunRead =
  | { readonly status: "recorded"; readonly run: LastGateRun }
  | { readonly status: "missing" }
  | { readonly status: "newer" | "malformed"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

/** Decode one registered last-run record without allowing absent versions. */
export function parseLastGateRun(raw: string): LastGateRunRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { status: "malformed", reason: "last-gate-run is not valid JSON" };
  }
  const version = inspectOnDiskRecordVersion("lastGateRun", parsed);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("lastGateRun", version.found),
    };
  }
  if (version.status !== "current") {
    return {
      status: "malformed",
      reason: "last-gate-run does not carry the registered format version",
    };
  }
  const record = LastGateRunSchema.safeParse(parsed);
  if (!record.success) {
    return {
      status: "malformed",
      reason: "last-gate-run fields are malformed",
    };
  }
  return {
    status: "recorded",
    run: {
      version: ON_DISK_FORMATS.lastGateRun.version,
      head: record.data.head,
      passed: record.data.passed,
      ...(record.data.tree !== undefined ? { tree: record.data.tree } : {}),
      ...(record.data.evidence !== undefined
        ? { evidence: record.data.evidence }
        : {}),
      ...(record.data.mode !== undefined ? { mode: record.data.mode } : {}),
    },
  };
}
