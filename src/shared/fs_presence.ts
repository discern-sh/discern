/**
 * Filesystem presence reads with explicit absence and suppression semantics.
 *
 * The ordinary helpers treat only `NotFound` as absence. Callers whose result is
 * genuinely advisory must opt into {@link bestEffortFsRead}, name why detail may
 * be lost, and state the value returned when any filesystem read fails.
 */

/** A text-file reader seam for callers that already inject filesystem effects. */
export type TextFileReader = (path: string) => Promise<string>;

/** The explicit policy required when a filesystem read may suppress any error. */
export interface BestEffortFsReadPolicy<T> {
  /** Value returned when the read fails, making the consequence visible. */
  readonly onFailure: T;
  /** Why this observation is non-critical and may lose the failure detail. */
  readonly reason: string;
}

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

/**
 * Run one non-critical filesystem read, returning the caller's named consequence
 * when it fails. The reason is required and validated so suppression is never an
 * invisible ambient default.
 */
export async function bestEffortFsRead<T>(
  read: () => Promise<T>,
  policy: BestEffortFsReadPolicy<T>,
): Promise<T> {
  if (policy.reason.trim() === "") {
    throw new TypeError("a best-effort filesystem read requires a reason");
  }
  try {
    return await read();
  } catch {
    return policy.onFailure;
  }
}
