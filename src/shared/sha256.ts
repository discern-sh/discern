/**
 * SHA-256 over UTF-8 text, as lowercase hex — the one spelling of the
 * digest-to-hex conversion the engine's identity computations share (engine
 * self-shim identities, checkpoint definition hashes and subject
 * fingerprints). Distinct from `crc.ts`: the POSIX cksum there is a pinned
 * PINNED identity for worktree ports/names; new identities that must not
 * collide use this digest.
 */

/** Lowercase hex SHA-256 of `text`'s UTF-8 bytes. */
export async function sha256Hex(text: string): Promise<string> {
  return await sha256HexBytes(new TextEncoder().encode(text));
}

/** Lowercase hex SHA-256 of `bytes`, exactly as given. */
async function sha256HexBytes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Lowercase hex SHA-256 of a file's bytes. A file's content digest reads
 * bytes, never decoded text: decoding maps every invalid sequence to the
 * same replacement character, so two different files could share a digest.
 */
export async function fileSha256Hex(path: string): Promise<string> {
  return await sha256HexBytes(await Deno.readFile(path));
}
