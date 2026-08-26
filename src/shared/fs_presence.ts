/**
 * Filesystem presence reads with explicit absence and suppression semantics.
 *
 * Every helper treats only `NotFound` as absence. Other failures propagate so
 * callers cannot silently reinterpret unreadable state as a missing value.
 */

/** A text-file reader seam for callers that already inject filesystem effects. */
export type TextFileReader = (path: string) => Promise<string>;

/** True when any directory entry exists, following only `NotFound` to false. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** True when `path` resolves to a regular file, following only `NotFound` to false. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** True when `path` resolves to a directory, following only `NotFound` to false. */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** True when `path` resolves to any target, following only `NotFound` to false. */
export async function targetExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Read UTF-8 text when present, mapping only `NotFound` to `undefined`. */
export async function readTextIfExists(
  path: string,
  readTextFile: TextFileReader = Deno.readTextFile,
): Promise<string | undefined> {
  try {
    return await readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Read bytes when present, mapping only `NotFound` to `undefined`. */
export async function readBytesIfExists(
  path: string,
): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Read entry metadata without following symlinks, mapping only `NotFound` to absence. */
export async function lstatIfExists(
  path: string,
): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Read followed-target metadata, mapping only `NotFound` to absence. */
export async function statIfExists(
  path: string,
): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Resolve a canonical path when present, mapping only `NotFound` to absence. */
export async function realPathIfExists(
  path: string,
): Promise<string | undefined> {
  try {
    return await Deno.realPath(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Read a symlink target when present, mapping only `NotFound` to absence. */
export async function readLinkIfExists(
  path: string,
): Promise<string | undefined> {
  try {
    return await Deno.readLink(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Read every directory entry when present, mapping only `NotFound` to absence. */
export async function readDirIfExists(
  path: string,
): Promise<Deno.DirEntry[] | undefined> {
  try {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(path)) entries.push(entry);
    return entries;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}
