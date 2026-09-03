/** Registered JSON codecs for Gate-local durable evidence. */

import { z } from "@zod/zod";
import type { GateMode } from "../../shared/checkpoint_drops.ts";
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
});

export interface GateProofFile {
  readonly version: typeof ON_DISK_FORMATS.gateProof.version;
  readonly head: string;
  readonly mode: GateMode;
  readonly proof?: Proof;
  readonly evidence?: string;
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
    return { status: "missing", reason: "proof file was empty" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {
      status: "missing",
      reason: "unversioned Gate Proof requires a fresh `discern done`",
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
  const proof = parsed.data.proof === undefined
    ? undefined
    : TolerantProofSchema.safeParse(parsed.data.proof);
  return {
    status: "recorded",
    record: {
      version: ON_DISK_FORMATS.gateProof.version,
      head: parsed.data.head,
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
  if (
    version.status !== "current" || parsed === null ||
    typeof parsed !== "object" || Array.isArray(parsed)
  ) {
    return {
      status: "malformed",
      reason: "last-gate-run does not carry the registered format version",
    };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.head !== "string" || typeof record.passed !== "boolean") {
    return {
      status: "malformed",
      reason: "last-gate-run fields are malformed",
    };
  }
  if (record.tree !== undefined && typeof record.tree !== "string") {
    return { status: "malformed", reason: "last-gate-run tree is malformed" };
  }
  if (record.evidence !== undefined && typeof record.evidence !== "string") {
    return {
      status: "malformed",
      reason: "last-gate-run evidence is malformed",
    };
  }
  if (
    record.mode !== undefined && record.mode !== "strict" &&
    record.mode !== "report"
  ) {
    return { status: "malformed", reason: "last-gate-run mode is malformed" };
  }
  return {
    status: "recorded",
    run: {
      version: ON_DISK_FORMATS.lastGateRun.version,
      head: record.head,
      passed: record.passed,
      ...(record.tree !== undefined ? { tree: record.tree } : {}),
      ...(record.evidence !== undefined ? { evidence: record.evidence } : {}),
      ...(record.mode !== undefined ? { mode: record.mode } : {}),
    },
  };
}
