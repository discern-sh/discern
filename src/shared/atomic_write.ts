/**
 * One replace-write policy for small durable files.
 *
 * Bytes are written completely to a create-new UUID sibling before one rename
 * replaces the target. A process interruption before the rename leaves the old
 * target intact (and may leave an orphan sibling); after a successful atomic
 * rename, readers see the complete replacement. `sync: true` flushes the temp
 * file before the rename. The rename and its parent-directory entry are not
 * fsynced here, so survival across host or power failure still depends on the
 * filesystem's rename and directory-durability guarantees.
 */

import { dirname, join } from "@std/path";

const ATOMIC_TEMP_PREFIX = ".discern-atomic-write-";
const ATOMIC_TEMP_SUFFIX = ".tmp";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Filesystem policy that every atomic replacement caller must choose. */
export interface AtomicReplaceOptions {
  /** Creation permissions, filtered through the process umask. */
  readonly mode: number;
  /** Flush the completed temporary file before replacing the target. */
  readonly sync: boolean;
  /** Reapply `mode` exactly after creation when placement requires fixed bits. */
  readonly exactMode?: boolean;
}

/** JSON formatting policy layered over the shared byte replacement. */
export interface AtomicReplaceJsonOptions extends AtomicReplaceOptions {
  /** JSON indentation passed to `JSON.stringify`; omitted means compact JSON. */
  readonly space?: string | number;
  /** Whether the durable JSON record ends with a newline. */
  readonly trailingNewline: boolean;
}

/** Advance through partial operating-system writes until every byte is staged. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (written === 0) {
      throw new Error("atomic replacement made no progress while writing");
    }
    offset += written;
  }
}

/** Remove an abandoned sibling without obscuring the replacement failure. */
async function removeAbandonedTemp(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // The temp was never created, was already removed, or cannot be cleaned up.
  }
}

/** Identify a temporary filename owned by this replacement policy. */
export function isAtomicReplaceTempName(name: string): boolean {
  if (
    !name.startsWith(ATOMIC_TEMP_PREFIX) ||
    !name.endsWith(ATOMIC_TEMP_SUFFIX)
  ) {
    return false;
  }
  return UUID_PATTERN.test(
    name.slice(ATOMIC_TEMP_PREFIX.length, -ATOMIC_TEMP_SUFFIX.length),
  );
}

/**
 * Atomically replace `path` with `bytes` through a create-new temporary sibling.
 *
 * The caller owns parent-directory creation and chooses both file mode and file
 * synchronization explicitly. This function intentionally makes no
 * parent-directory fsync promise.
 */
export async function atomicReplaceBytes(
  path: string,
  bytes: Uint8Array,
  options: AtomicReplaceOptions,
): Promise<void> {
  const temp = join(
    dirname(path),
    `${ATOMIC_TEMP_PREFIX}${crypto.randomUUID()}${ATOMIC_TEMP_SUFFIX}`,
  );
  try {
    const file = await Deno.open(temp, {
      createNew: true,
      write: true,
      mode: options.mode,
    });
    try {
      await writeAll(file, bytes);
      if (options.exactMode === true) {
        await Deno.chmod(temp, options.mode);
      }
      if (options.sync) {
        await file.sync();
      }
    } finally {
      file.close();
    }
    await Deno.rename(temp, path);
  } catch (error) {
    await removeAbandonedTemp(temp);
    throw error;
  }
}

/** Encode text as UTF-8 and replace the target through the byte capability. */
export async function atomicReplaceText(
  path: string,
  text: string,
  options: AtomicReplaceOptions,
): Promise<void> {
  await atomicReplaceBytes(path, new TextEncoder().encode(text), options);
}

/** Serialize JSON with the caller's exact layout and replace it atomically. */
export async function atomicReplaceJson(
  path: string,
  value: unknown,
  options: AtomicReplaceJsonOptions,
): Promise<void> {
  const json = JSON.stringify(value, null, options.space);
  if (json === undefined) {
    throw new TypeError(
      "atomic JSON replacement requires a serializable value",
    );
  }
  await atomicReplaceText(
    path,
    options.trailingNewline ? `${json}\n` : json,
    options,
  );
}
