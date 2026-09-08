/** Bounded complete reads shared by producer protocols and recovery artifacts. */
/** Bound protocol memory while retaining original output for reproduction. */
export const BOUNDED_CAPTURE_BYTES = 16 * 1024 * 1024;

/** Read bounded bytes only when the regular file stays unchanged through EOF. */
export async function readBoundedFile(
  path: string,
  limit = BOUNDED_CAPTURE_BYTES,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("Capture requires a finite nonnegative byte bound.");
  }
  const observed = await Deno.lstat(path);
  if (!observed.isFile || observed.isSymlink || observed.size > limit) {
    throw new Error("capture exceeds its byte bound or is not a regular file");
  }
  const file = await Deno.open(path, { read: true });
  try {
    const before = await file.stat();
    if (
      !before.isFile || before.size > limit || before.ino !== observed.ino ||
      before.dev !== observed.dev
    ) {
      throw new Error(
        "producer capture exceeds its byte bound or is not a file",
      );
    }
    const bytes = new Uint8Array(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes.subarray(length));
      if (read === null) break;
      if (read === 0) throw new Error("producer capture read made no progress");
      length += read;
    }
    const after = await file.stat();
    const current = await Deno.lstat(path);
    if (
      current.isSymlink || current.ino !== before.ino ||
      current.dev !== before.dev ||
      length !== before.size || after.size !== before.size ||
      after.mtime?.getTime() !== before.mtime?.getTime() ||
      after.ctime?.getTime() !== before.ctime?.getTime()
    ) throw new Error("producer capture changed while being read");
    return bytes.slice(0, length);
  } finally {
    file.close();
  }
}

/** Decode only complete, stable UTF-8; invalid bytes never become replacement text. */
export async function readBoundedText(
  path: string,
  limit = BOUNDED_CAPTURE_BYTES,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedFile(path, limit),
  );
}
