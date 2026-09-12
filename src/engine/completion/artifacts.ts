/**
 * Attempt-owned JSON documents in common storage: the candidate review a green
 * run retains, the Proof presentation, and an emergency landing's resolution.
 * Each is published once under the common publication lock and read back
 * through its receipt, so a document is either the recorded bytes or absent.
 */
import { dirname } from "@std/path";
import type { z } from "@zod/zod";
import { atomicReplaceText } from "../../shared/atomic_write.ts";
import { readBoundedText } from "../../shared/bounded_file.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { artifactPath, openArtifactPaths } from "./artifact_paths.ts";
import { ArtifactSchema } from "./evidence.ts";

export type CompletionArtifact = z.infer<typeof ArtifactSchema>;

/** The largest document a reader accepts from common storage. */
export const COMPLETION_DOCUMENT_BYTES = 64 * 1024 * 1024;

type ArtifactSubject = Pick<
  CompletionArtifact,
  "attempt_id" | "candidate_id" | "context"
>;

/** Reject oversized documents during traversal, before JSON constructs an aggregate string. */
export function encodeCompletionDocument(value: unknown): string {
  let remaining = COMPLETION_DOCUMENT_BYTES;
  const raw = JSON.stringify(value, (key: string, item: unknown): unknown => {
    const count = (text: string): number =>
      text.length > COMPLETION_DOCUMENT_BYTES
        ? COMPLETION_DOCUMENT_BYTES + 1
        : new TextEncoder().encode(text).length;
    remaining -= count(key) + 4;
    if (typeof item === "string") remaining -= count(item) * 6;
    else if (item === null || typeof item !== "object") remaining -= 32;
    if (remaining < 0) {
      throw new Error(
        "The completion document exceeds the bounded document format; nothing was published.",
      );
    }
    return item;
  });
  if (raw === undefined) {
    throw new Error("Completion documents must have a JSON value.");
  }
  return raw;
}

/** Documents beyond the reader budget stay intact for explicit inspection. */
export async function readBoundedCompletionDocument(
  path: string,
): Promise<string> {
  const stat = await Deno.lstat(path);
  if (
    !stat.isFile || stat.isSymlink || stat.size > COMPLETION_DOCUMENT_BYTES
  ) {
    throw new Error(
      `Completion document is unsupported or exceeds the bounded reader at ${path}. Preserve its bytes; reconcile this document with a compatible reader.`,
    );
  }
  return await readBoundedText(path, COMPLETION_DOCUMENT_BYTES);
}

/** Publish complete bytes once; an existing different document remains untouched. */
export async function saveCompletionArtifact(
  root: string,
  subject: ArtifactSubject,
  name: string,
  value: unknown,
): Promise<CompletionArtifact> {
  const canonicalRoot = await Deno.realPath(root);
  const raw = encodeCompletionDocument(value);
  const artifact = ArtifactSchema.parse({
    ...subject,
    path: `environment/${name}.json`,
    digest: await sha256Hex(raw),
    bytes: new TextEncoder().encode(raw).length,
  });
  const paths = await openArtifactPaths(canonicalRoot);
  const path = await paths(artifact.attempt_id, artifact.path);
  const old = await readBoundedCompletionDocument(path).catch(
    (error: unknown) => {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    },
  );
  if (old !== undefined) {
    if (old !== raw) {
      throw new Error(
        `Completion document already contains different bytes: ${path}. Preserve it for inspection.`,
      );
    }
    return artifact;
  }
  const staging = await paths(
    artifact.attempt_id,
    `staging/${SYSTEM_SECURE_ENTROPY.uuid()}`,
  );
  await Deno.mkdir(dirname(staging), { recursive: true, mode: 0o700 });
  await atomicReplaceText(staging, raw, { mode: 0o600, sync: true });
  let existing = false;
  try {
    await withCompletionPublication(canonicalRoot, async () => {
      await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      try {
        await Deno.link(staging, path);
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        existing = true;
      }
    });
    if (existing && await readBoundedCompletionDocument(path) !== raw) {
      throw new Error(
        `Completion document already contains different bytes: ${path}. Preserve it for inspection.`,
      );
    }
  } finally {
    await Deno.remove(staging);
  }
  return artifact;
}

/** Read a document only after its receipt authenticates the bytes. */
export async function readCompletionArtifact(
  root: string,
  artifact: CompletionArtifact,
): Promise<unknown> {
  ArtifactSchema.parse(artifact);
  const path = await artifactPath(root, artifact.attempt_id, artifact.path);
  const raw = await readBoundedCompletionDocument(path);
  if (
    await sha256Hex(raw) !== artifact.digest ||
    new TextEncoder().encode(raw).length !== artifact.bytes
  ) {
    throw new Error(
      `Completion document failed its content check: ${path}. Preserve the recorded bytes for inspection.`,
    );
  }
  return JSON.parse(raw);
}
