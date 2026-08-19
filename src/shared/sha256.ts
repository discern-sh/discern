/**
 * SHA-256 over UTF-8 text, as lowercase hex — the one spelling of the
 * digest-to-hex conversion the engine's identity computations share (engine
 * self-shim identities, checkpoint definition hashes and subject
 * fingerprints). Distinct from `crc.ts`: the POSIX cksum there is a pinned
 * LEGACY identity for worktree ports/names; new identities that must not
 * collide use this digest.
 */

/** Lowercase hex SHA-256 of `text`'s UTF-8 bytes. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
