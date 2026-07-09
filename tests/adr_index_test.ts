/**
 * Architectural guard for the ADR index. The `docs/_adr/README.md` index is the
 * only view of the record set most readers ever open, so an ADR missing from it
 * is invisible — exactly how 0106–0109 sat unlisted for four records. The
 * canonical set is the DIRECTORY (every `NNNN-*.md` on disk), never the index
 * itself, so a new ADR auto-enrols: write the file and this guard fails until
 * the index names it.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const ADR_DIR = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "docs",
  "_adr",
);

/** The `NNNN-slug.md` entries directly under `dir` (no template, no README). */
async function adrFiles(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && /^\d{4}-.+\.md$/.test(entry.name)) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

Deno.test("ADR index: every active ADR on disk is linked from the README index", async () => {
  const readme = await Deno.readTextFile(join(ADR_DIR, "README.md"));
  const missing = (await adrFiles(ADR_DIR))
    .filter((name) => name !== "0000-template.md")
    .filter((name) => !readme.includes(`](${name})`));
  assert(
    missing.length === 0,
    `docs/_adr/README.md must index every active ADR — add: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("ADR index: every relative link in the README resolves to a file", async () => {
  const readme = await Deno.readTextFile(join(ADR_DIR, "README.md"));
  const targets = [...readme.matchAll(/\]\(((?:_superseded\/)?[^)#]+\.md)\)/g)]
    .map((m) => m[1] ?? "")
    .filter((t) => !t.startsWith("../"));
  assert(targets.length > 0, "the index should contain ADR links");
  const dangling: string[] = [];
  for (const target of targets) {
    try {
      await Deno.stat(join(ADR_DIR, target));
    } catch {
      dangling.push(target);
    }
  }
  assert(
    dangling.length === 0,
    `docs/_adr/README.md links files that do not exist: ${dangling.join(", ")}`,
  );
});

Deno.test("ADR numbers are never reused across the active and superseded sets", async () => {
  const all = [
    ...await adrFiles(ADR_DIR),
    ...await adrFiles(join(ADR_DIR, "_superseded")),
  ].filter((name) => name !== "0000-template.md");
  const seen = new Map<string, string>();
  for (const name of all) {
    const number = name.slice(0, 4);
    const prior = seen.get(number);
    assert(
      prior === undefined,
      `ADR number ${number} is used twice: ${prior} and ${name}`,
    );
    seen.set(number, name);
  }
});
