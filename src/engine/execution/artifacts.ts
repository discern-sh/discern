import { withGitDiscoveryScope } from "../../shared/git_discovery.ts";
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
import { ArtifactSchema } from "../completion/evidence.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import type { EnvironmentArtifact } from "./types.ts";
import { openArtifactPaths } from "../completion/artifact_paths.ts";

import { encodeExecutionDocument } from "./document_encoding.ts";
export { EXECUTION_DOCUMENT_BYTES } from "./snapshot_schema.ts";

/** Publish complete bytes once; an existing different artifact remains untouched. */
export async function saveEnvironmentArtifact(
  root: string,
  subject: {
    readonly attempt_id: string;
    readonly candidate_id: string;
    readonly context: string;
  },
  name: string,
  value: unknown,
  beforePublish?: () => Promise<void>,
): Promise<EnvironmentArtifact> {
  const canonicalRoot = await Deno.realPath(root);
  return await withGitDiscoveryScope(() =>
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
      await atomicReplaceText(staging, raw, { mode: 0o600, sync: true });
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
