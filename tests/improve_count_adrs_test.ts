/**
 * Guard for `countAdrs`: it recurses into subdirectories, so ADRs relocated
 * under `docs/_adr/_superseded/` (retired-but-kept history) still count toward
 * improve's "records decisions" signal. Pins the recursion so a future move
 * of more ADRs into the subfolder cannot silently shrink the count, and keeps
 * the `0000-template` seed excluded.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { countAdrs } from "../src/engine/improve/rules.ts";

Deno.test("countAdrs counts ADRs nested under _superseded/ and excludes the template", async () => {
  const root = await Deno.makeTempDir();
  try {
    const adr = join(root, "docs", "_adr");
    const superseded = join(adr, "_superseded");
    await Deno.mkdir(superseded, { recursive: true });
    await Deno.writeTextFile(join(adr, "0000-template.md"), "# template");
    await Deno.writeTextFile(join(adr, "0001-alpha.md"), "# ADR 0001");
    await Deno.writeTextFile(join(adr, "0003-gamma.md"), "# ADR 0003");
    await Deno.writeTextFile(join(superseded, "0002-beta.md"), "# ADR 0002");
    await Deno.writeTextFile(join(superseded, "0004-delta.md"), "# ADR 0004");
    // 2 current + 2 superseded = 4 real ADRs; the 0000-template seed is excluded.
    assertEquals(await countAdrs(root), 4);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("countAdrs is zero when docs/_adr is absent", async () => {
  const root = await Deno.makeTempDir();
  try {
    assertEquals(await countAdrs(root), 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
