/**
 * POSIX `cksum` CRC-32 — the exact checksum GNU/BSD `cksum` produces: polynomial
 * 0x04C11DB7, MSB-first (un-reflected), with the byte *length* fed through after
 * the data and a final one's-complement. This is deliberately NOT the common
 * zlib/ISO CRC-32 (which is reflected and init 0xFFFFFFFF) — the two disagree for
 * every input (the empty string is 0xFFFFFFFF here, 0 in zlib).
 *
 * LOAD-BEARING (Risk R1): a worktree's dev-server port, site tail hash, and db
 * name all derive from this exact checksum (see engine/worktree/identity.ts). A
 * mismatch silently shifts every existing worktree's identity. Pinned against
 * vectors captured from the shell engine in
 * tests/fixtures/parity/worktree-identity.json.
 */

/** The 256-entry lookup table for polynomial 0x04C11DB7 (un-reflected). */
const TABLE: Uint32Array = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) {
      c = (c & 0x80000000) ? ((c << 1) ^ 0x04c11db7) : (c << 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

/** POSIX cksum CRC of raw bytes. Returns an unsigned 32-bit integer. */
export function cksum(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  }
  // Feed the byte length, low byte first, until it is zero (the POSIX rule that
  // distinguishes cksum from a plain CRC-32). Empty input feeds nothing, so the
  // crc stays 0 and one's-complements to 0xFFFFFFFF.
  for (let n = bytes.length; n > 0; n = Math.floor(n / 256)) {
    crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ (n & 0xff)) & 0xff]!) >>> 0;
  }
  return (~crc) >>> 0;
}

const ENCODER = new TextEncoder();

/** POSIX cksum CRC of a string's UTF-8 bytes (no trailing newline added). */
export function cksumString(s: string): number {
  return cksum(ENCODER.encode(s));
}
