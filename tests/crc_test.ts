import { assertEquals } from "@std/assert";
import { cksum, cksumString } from "../src/shared/crc.ts";

// POSIX cksum parity vectors captured from the shell engine — see
// tests/fixtures/parity/worktree-identity.json. These pin Risk R1: the TS cksum
// must reproduce the shell's exactly, or every worktree's port/site/db shifts.
const VECTORS: ReadonlyArray<readonly [string, number]> = [
  ["", 4294967295],
  ["a", 1220704766],
  ["ab", 2072780115],
  ["wt-feature", 3223225200],
  ["feature-x", 1344881967],
  [
    "this-is-a-very-long-worktree-id-that-exceeds-the-site-label-limit-x",
    316377843,
  ],
];

Deno.test("cksumString reproduces the POSIX cksum parity vectors", () => {
  for (const [input, crc] of VECTORS) {
    assertEquals(cksumString(input), crc, `cksum(${JSON.stringify(input)})`);
  }
});

Deno.test("empty input is 0xFFFFFFFF (POSIX cksum, not zlib crc32)", () => {
  assertEquals(cksum(new Uint8Array()), 0xffffffff);
});

Deno.test("derived dev-server port lands in the 13000-14999 band", () => {
  // port_for_id: 13000 + cksum(id) % 2000. Spot-check a pinned case.
  assertEquals(13000 + (cksumString("wt-feature") % 2000), 14200);
});
