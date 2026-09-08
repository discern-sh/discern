/** Content-addressed recovery bytes: bounded buffers, private staging, immutable publication. */
import { removeIfExists } from "../../shared/atomic_write.ts";
import { createHash } from "crypto";
import { dirname } from "@std/path";
import { PayloadReferenceSchema } from "./snapshot_schema.ts";
export { PayloadReferenceSchema } from "./snapshot_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import {
  recoveryStoragePath,
  withRecoveryStorage,
} from "./storage_lifetime.ts";

const BUFFER_BYTES = 64 * 1024;

/** Resolve only a validated digest coordinate, never a path supplied by captured checkout data. */
export async function recoveryPayloadPath(
  root: string,
  reference: string,
): Promise<string> {
  PayloadReferenceSchema.parse(reference);
  const digest = reference.split(":")[1];
  return await recoveryStoragePath(root, `sha256/${digest}`);
}

/** Stable filesystem identity catches replacement and in-place mutation during streaming. */
function fileIdentity(info: Deno.FileInfo, immutable: boolean): string {
  return JSON.stringify([
    info.dev,
    info.ino,
    info.size,
    info.mtime,
    immutable ? null : info.ctime,
    info.mode,
  ]);
}

/** Hash or preserve a regular file with a fixed buffer; interrupted staging is never a published payload. */
export async function observeRecoveryPayload(
  root: string,
  source: string,
  limit: number,
  preserve: boolean,
  afterChunk?: () => Promise<void>,
): Promise<{ reference: string; bytes: number }> {
  return await observePayload(root, source, limit, preserve, afterChunk);
}

/** Only digest-addressed stored bytes tolerate ctime changes from atomic linking.
 * Checkout observation still rejects ctime drift; stored payloads must also
 * match their complete content receipt after this bounded read.
 */
async function observePayload(
  root: string,
  source: string,
  limit: number,
  preserve: boolean,
  afterChunk?: () => Promise<void>,
  immutable = false,
): Promise<{ reference: string; bytes: number }> {
  return await withRecoveryStorage(root, async () => {
    const expected = preserve
      ? await observeRecoveryPayload(root, source, limit, false, afterChunk)
      : undefined;
    if (expected !== undefined) {
      try {
        await verifyRecoveryPayload(root, expected.reference);
        return expected;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    const before = await Deno.lstat(source);
    if (!before.isFile || before.isSymlink) {
      throw new Error(
        `Recovery payload is not a regular file: ${source}. Preserve the checkout.`,
      );
    }
    if (before.size > limit) {
      throw new Error(
        `Capture byte limit reached at ${source}; retain the checkout for recovery.`,
      );
    }
    const staging = preserve
      ? await recoveryStoragePath(
        root,
        `staging/${SYSTEM_SECURE_ENTROPY.uuid()}`,
      )
      : undefined;
    if (staging !== undefined) {
      await Deno.mkdir(dirname(staging), { recursive: true, mode: 0o700 });
    }
    const input = await Deno.open(source, { read: true });
    let output: Deno.FsFile | undefined;
    let bytes = 0;
    const hash = createHash("sha256");
    try {
      if (
        fileIdentity(await input.stat(), immutable) !==
          fileIdentity(before, immutable)
      ) {
        throw new Error(
          "Checkout file changed before capture; preserve it for recovery.",
        );
      }
      if (staging !== undefined) {
        output = await Deno.open(staging, {
          createNew: true,
          write: true,
          mode: 0o600,
        });
      }
      const buffer = new Uint8Array(BUFFER_BYTES);
      while (true) {
        const count = await input.read(buffer);
        if (count === null) break;
        bytes += count;
        if (bytes > limit) {
          throw new Error(
            "Capture exceeded its byte bound while a file changed; retain the checkout.",
          );
        }
        const chunk = buffer.subarray(0, count);
        hash.update(chunk);
        if (output !== undefined) {
          let offset = 0;
          while (offset < count) {
            const written = await output.write(chunk.subarray(offset));
            if (written === 0) {
              throw new Error("Recovery payload write made no progress.");
            }
            offset += written;
          }
        }
        if (!preserve) await afterChunk?.();
      }
      if (
        fileIdentity(await input.stat(), immutable) !==
          fileIdentity(before, immutable) ||
        fileIdentity(await Deno.lstat(source), immutable) !==
          fileIdentity(before, immutable) ||
        bytes !== before.size
      ) {
        throw new Error(
          "Checkout changed during capture; no complete artifact authorizes cleanup.",
        );
      }
      const reference = `sha256:${hash.digest("hex")}:${bytes}`;
      if (expected !== undefined && expected.reference !== reference) {
        throw new Error(
          "Checkout changed during capture; preserve its payloads and retry after writers stop.",
        );
      }
      if (output !== undefined && staging !== undefined) {
        await output.sync();
        output.close();
        output = undefined;
        const target = await recoveryPayloadPath(root, reference);
        // The storage lease excludes reclamation. Atomic create-only linking
        // permits concurrent identical writers without a common publication lock;
        // the manifest publisher later checks the owning execution revision.
        await Deno.mkdir(dirname(target), { recursive: true, mode: 0o700 });
        try {
          await Deno.link(staging, target);
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
        await verifyRecoveryPayload(root, reference);
      }
      return { reference, bytes };
    } finally {
      input.close();
      output?.close();
      if (staging !== undefined) await removeIfExists(staging);
    }
  });
}

/** Recovery never trusts a digest-shaped filename without checking its bytes. */
export async function verifyRecoveryPayload(
  root: string,
  reference: string,
): Promise<string> {
  const path = await recoveryPayloadPath(root, reference);
  const bytes = Number(reference.split(":")[2]);
  const observed = await observePayload(
    root,
    path,
    bytes,
    false,
    undefined,
    true,
  );
  if (observed.reference !== reference) {
    throw new Error(
      `Recovery payload failed its content check: ${path}. Preserve the retained checkout and payload.`,
    );
  }
  return path;
}

/** Copy verified recovery bytes without materializing the file in memory.
 * The caller owns the private destination and its later atomic publication.
 */
export async function copyRecoveryPayload(
  root: string,
  reference: string,
  destination: string,
): Promise<void> {
  await withRecoveryStorage(root, async () => {
    const source = await verifyRecoveryPayload(root, reference);
    await Deno.copyFile(source, destination);
    const copy = await observeRecoveryPayload(
      root,
      destination,
      Number(reference.split(":")[2]),
      false,
    );
    if (copy.reference !== reference) {
      throw new Error(
        "Recovery copy failed its content check; preserve the original payload.",
      );
    }
  });
}
