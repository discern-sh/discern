import { withinGitDiscoveryScope } from "../../shared/git_discovery.ts";
import {
  completionPublicationPath,
  invalidateCompletionPublication,
} from "../completion/publication_witness.ts";
/** Immutable attempt manifests survive checkout disposal; payload work precedes publication. */
import { withRecoveryStorage } from "./storage_lifetime.ts";
import { dirname } from "@std/path";
import { atomicReplaceText } from "../../shared/atomic_write.ts";
import { readBoundedExecutionDocument } from "./artifact_read.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import { StartedChildSchema } from "./artifact_contracts.ts";
import { ArtifactSchema } from "../completion/evidence.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import type { EnvironmentArtifact } from "./types.ts";
import { openArtifactPaths } from "../completion/artifact_paths.ts";

import { encodeExecutionDocument } from "./document_encoding.ts";
export { EXECUTION_DOCUMENT_BYTES } from "./snapshot_schema.ts";

type ArtifactSubject = Pick<
  EnvironmentArtifact,
  "attempt_id" | "candidate_id" | "context"
>;

/** Publish recovery bytes with their machine-crash durability barrier. */
export async function saveEnvironmentArtifact(
  root: string,
  subject: ArtifactSubject,
  name: string,
  value: unknown,
  beforePublish?: () => Promise<void>,
): Promise<EnvironmentArtifact> {
  return await publishEnvironmentArtifact(
    root,
    subject,
    name,
    value,
    true,
    beforePublish,
  );
}

/** These facts describe processes, never restoration bytes or publication authority. */
export type ExecutionChildReceipt =
  | { readonly kind: "enrolled" | "settled"; readonly key: string }
  | { readonly kind: "planned"; readonly key: string; readonly token: string }
  | {
    readonly kind: "started";
    readonly key: string;
    readonly pid: number;
    readonly isolated: boolean;
  };

/** Atomic visibility survives process death; a machine restart kills every child.
 * Missing or corrupt start evidence remains uncertain under the lifetime reader.
 * See ADR 0387 for the separate durability of recovery artifacts.
 */
export async function saveExecutionChildReceipt(
  root: string,
  subject: ArtifactSubject,
  receipt: ExecutionChildReceipt,
): Promise<void> {
  const value = receipt.kind === "planned"
    ? { token: RecordIdSchema.parse(receipt.token) }
    : receipt.kind === "started"
    ? StartedChildSchema.parse({ pid: receipt.pid, isolated: receipt.isolated })
    : true;
  await publishEnvironmentArtifact(
    root,
    subject,
    `children/${receipt.kind}-${RecordIdSchema.parse(receipt.key)}`,
    value,
    false,
  );
}

/** Publish complete bytes once; an existing different artifact remains untouched. */
async function publishEnvironmentArtifact(
  root: string,
  subject: ArtifactSubject,
  name: string,
  value: unknown,
  sync: boolean,
  beforePublish?: () => Promise<void>,
): Promise<EnvironmentArtifact> {
  const canonicalRoot = await Deno.realPath(root);
  return await withinGitDiscoveryScope(() =>
    withRecoveryStorage(canonicalRoot, async (storageCommon) => {
      const raw = encodeExecutionDocument(value);
      const artifact = ArtifactSchema.parse({
        ...subject,
        path: `environment/${name}.json`,
        digest: await sha256Hex(raw),
        bytes: new TextEncoder().encode(raw).length,
      });
      const paths = await openArtifactPaths(canonicalRoot, storageCommon);
      const path = await paths(artifact.attempt_id, artifact.path);
      const recheckPublication = async (common?: string): Promise<string> => {
        await beforePublish?.();
        const destination =
          await (await openArtifactPaths(canonicalRoot, common))(
            artifact.attempt_id,
            artifact.path,
          );
        if (destination !== path) {
          throw new Error(
            "Artifact storage moved before publication; retain the checkout and reconcile its repository ownership.",
          );
        }
        return destination;
      };
      const old = await readBoundedExecutionDocument(path).catch(
        (error: unknown) => {
          if (error instanceof Deno.errors.NotFound) return undefined;
          throw error;
        },
      );
      if (old !== undefined) {
        if (old !== raw) {
          throw new Error(
            `Attempt artifact already contains different bytes: ${path}. Preserve it for recovery.`,
          );
        }
        await withCompletionPublication(canonicalRoot, recheckPublication);
        return artifact;
      }
      const staging = await paths(
        artifact.attempt_id,
        `staging/${SYSTEM_SECURE_ENTROPY.uuid()}`,
      );
      await Deno.mkdir(dirname(staging), { recursive: true, mode: 0o700 });
      await atomicReplaceText(staging, raw, { mode: 0o600, sync });
      let existing = false;
      try {
        await withCompletionPublication(canonicalRoot, async (common) => {
          const destination = await recheckPublication(common);
          await invalidateCompletionPublication(
            await completionPublicationPath(canonicalRoot, common),
          );
          await Deno.mkdir(dirname(destination), {
            recursive: true,
            mode: 0o700,
          });
          try {
            await Deno.link(staging, destination);
          } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            existing = true;
          }
        });
        if (existing && await readBoundedExecutionDocument(path) !== raw) {
          throw new Error(
            `Attempt artifact already contains different bytes: ${path}. Preserve it for recovery.`,
          );
        }
      } finally {
        await Deno.remove(staging);
      }
      return artifact;
    })
  );
}
