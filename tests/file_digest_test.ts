/**
 * A file's content digest covers its bytes. Hashing decoded text maps every
 * invalid sequence to the same replacement character, so two different files
 * could share a digest; a reviewed script bound to such a digest could then
 * change unseen. The guard refuses that spelling everywhere it could recur.
 */

import { assert, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { fileSha256Hex } from "../src/shared/sha256.ts";
import { withTempDir } from "./helpers.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("files that differ only in bytes that aren't text have different digests", async () => {
  await withTempDir(async (dir) => {
    const first = join(dir, "first.sh");
    const second = join(dir, "second.sh");
    await Deno.writeFile(first, new Uint8Array([0x23, 0x21, 0xff, 0x0a]));
    await Deno.writeFile(second, new Uint8Array([0x23, 0x21, 0xfe, 0x0a]));
    assertNotEquals(await fileSha256Hex(first), await fileSha256Hex(second));
  });
});

Deno.test("no module digests a file's decoded text", async () => {
  const files = await structuralGuardScope({
    guard: "tests/file_digest_test.ts#decoded-file-digest",
    universe: "authored-ts",
  });
  const decoded = /sha256Hex\(\s*await\s+Deno\.readTextFile\(/u;
  const offenders: string[] = [];
  for (const file of files) {
    if (decoded.test(await Deno.readTextFile(join(REPO_ROOT, file)))) {
      offenders.push(file);
    }
  }
  assert(
    offenders.length === 0,
    `digest a file's bytes with fileSha256Hex: ${offenders.join(", ")}`,
  );
});
