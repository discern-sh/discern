/**
 * Architectural guard for the ADR index. The configured map's ADR README is the
 * only view of the record set most readers ever open, so an ADR missing from it
 * is invisible — exactly how 0106–0109 sat unlisted for four records. The
 * canonical set is the DIRECTORY (every `NNNN-*.md` on disk), never the index
 * itself, so a new ADR auto-enrols: write the file and this guard fails until
 * the index names it.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import {
  type AdrRecord,
  adrRecords,
  discoverDocs,
  renderAdrIndexBlocks,
  replaceAdrIndexBlocks,
} from "../src/lib/docs.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const ADR_DIR = join(REPO_AUTHORED_PATHS.map, "_adr");

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

async function adrRecordsIn(dir: string): Promise<AdrRecord[]> {
  const tree = await discoverDocs({
    cwd: dir,
    dir,
    includeInternal: true,
  });
  assert(tree !== undefined, `ADR directory does not exist: ${dir}`);
  return adrRecords(tree.entries);
}

Deno.test("ADR index: every active ADR on disk is linked from the README index", async () => {
  const readme = await Deno.readTextFile(join(ADR_DIR, "README.md"));
  const missing = (await adrFiles(ADR_DIR))
    .filter((name) => name !== "0000-template.md")
    .filter((name) => !readme.includes(`](${name})`));
  assert(
    missing.length === 0,
    `${REPO_AUTHORED_PATHS.mapRel}/_adr/README.md must index every active ADR — add: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("ADR index: generated record lists match the records on disk", async () => {
  const readme = await Deno.readTextFile(join(ADR_DIR, "README.md"));
  const blocks = await renderAdrIndexBlocks(await adrRecordsIn(ADR_DIR));
  const path = join(ADR_DIR, "README.md");
  assertEquals(
    readme,
    await canonicalGeneratedMarkdown(
      path,
      replaceAdrIndexBlocks(readme, blocks),
    ),
    `${REPO_AUTHORED_PATHS.mapRel}/_adr/README.md is stale — run ` +
      "`deno task codegen`",
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
    `${REPO_AUTHORED_PATHS.mapRel}/_adr/README.md links files that do not exist: ${
      dangling.join(", ")
    }`,
  );
});

Deno.test("ADR record: every relative Markdown-file link resolves", async () => {
  const dangling: string[] = [];
  for await (
    const entry of walk(ADR_DIR, { includeDirs: false, exts: [".md"] })
  ) {
    const text = await Deno.readTextFile(entry.path);
    for (
      const match of text.matchAll(
        /\]\((?!https?:|mailto:|#)([^)#]+\.md)(?:#[^)]*)?\)/g,
      )
    ) {
      const target = match[1] ?? "";
      try {
        await Deno.stat(join(dirname(entry.path), target));
      } catch {
        dangling.push(
          `${relative(ADR_DIR, entry.path)} -> ${target}`,
        );
      }
    }
  }
  assert(
    dangling.length === 0,
    `ADR links point at files that do not exist:\n${
      dangling.sort().join("\n")
    }`,
  );
});

interface NumberedAdrPath {
  number: string;
  path: string;
}

function duplicateAdrNumberOffenders(
  records: readonly NumberedAdrPath[],
): string[] {
  const seen = new Map<string, string>();
  const offenders: string[] = [];
  for (const record of records) {
    const prior = seen.get(record.number);
    if (prior !== undefined) {
      offenders.push(
        `ADR number ${record.number} is used twice: ${prior} and ${record.path}`,
      );
    } else {
      seen.set(record.number, record.path);
    }
  }
  return offenders;
}

Deno.test("ADR numbers are never reused across the active and superseded sets", async () => {
  const offenders = duplicateAdrNumberOffenders(
    (await adrRecordsIn(ADR_DIR)).map((record) => ({
      number: record.number,
      path: record.entry.relToDocs,
    })),
  );
  assertEquals(
    offenders,
    [],
    `ADR numbers must be unique:\n${offenders.join("\n")}`,
  );
});

Deno.test("control: a duplicate active and superseded ADR number offends", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-adr-index-control-" });
  try {
    await Deno.mkdir(join(dir, "_superseded"));
    await Deno.writeTextFile(
      join(dir, "4242-new-direction.md"),
      "# ADR 4242: A new direction\n",
    );
    await Deno.writeTextFile(
      join(dir, "_superseded", "4242-retired-direction.md"),
      "# ADR 4242: A retired direction\n",
    );
    const offenders = duplicateAdrNumberOffenders(
      (await adrRecordsIn(dir)).map((record) => ({
        number: record.number,
        path: record.entry.relToDocs,
      })),
    );
    assertEquals(
      offenders,
      [
        "ADR number 4242 is used twice: 4242-new-direction.md and " +
        "_superseded/4242-retired-direction.md",
      ],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
