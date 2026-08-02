/**
 * The ADR numbering module: what counts as a record file, and duplicate
 * detection across the whole `_adr/` tree — `_superseded/` included, because a
 * retired record keeps its number and reusing it is the same defect as two
 * active records colliding.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { adrNumberOf, duplicateAdrNumbers } from "../src/lib/adr_numbers.ts";

Deno.test("adrNumberOf: reads the number from a record basename, at any depth", () => {
  assertEquals(adrNumberOf("map/_adr/0184-receipt-line.md"), "0184");
  assertEquals(adrNumberOf("map/_adr/_superseded/0002-side-gates.md"), "0002");
  assertEquals(adrNumberOf("0000-template.md"), "0000");
});

Deno.test("adrNumberOf: non-record files carry no number", () => {
  assertEquals(adrNumberOf("map/_adr/README.md"), undefined);
  assertEquals(adrNumberOf("map/_adr/0184-missing-extension"), undefined);
  assertEquals(adrNumberOf("map/_adr/123-three-digits.md"), undefined);
  assertEquals(adrNumberOf("map/_adr/0184.md"), undefined);
});

/** Create minimal map/_adr files so numbering tests vary only their filenames. */
async function scaffoldAdrs(
  dir: string,
  files: string[],
): Promise<void> {
  for (const file of files) {
    const path = join(dir, "map", "_adr", file);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, "# record\n");
  }
}

Deno.test("duplicateAdrNumbers: groups records sharing a number, README ignored", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await scaffoldAdrs(dir, [
      "README.md",
      "0001-first.md",
      "0002-second.md",
      "0002-second-again.md",
    ]);
    assertEquals(await duplicateAdrNumbers(dir, "map"), [
      {
        number: "0002",
        paths: [
          "map/_adr/0002-second-again.md",
          "map/_adr/0002-second.md",
        ],
      },
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("duplicateAdrNumbers: a superseded record's number cannot be reused", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await scaffoldAdrs(dir, [
      "0009-newcomer.md",
      "_superseded/0009-retired.md",
    ]);
    assertEquals(await duplicateAdrNumbers(dir, "map"), [
      {
        number: "0009",
        paths: [
          "map/_adr/0009-newcomer.md",
          "map/_adr/_superseded/0009-retired.md",
        ],
      },
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("duplicateAdrNumbers: unique numbers and a missing record tree are both clean", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await duplicateAdrNumbers(dir, "map"), []);
    await scaffoldAdrs(dir, ["0001-first.md", "0002-second.md"]);
    assertEquals(await duplicateAdrNumbers(dir, "map"), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
