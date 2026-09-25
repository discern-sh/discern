/** Manual density uses the strict published projection and prose-only bytes. */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import {
  measurePublicDocs,
  publicDocEntries,
} from "../scripts/public_doc_density_lib.ts";
import {
  MANUAL_SECTION_REGISTRY,
  type ManualKind,
} from "../src/shared/manual.ts";
import { withTempDir } from "./helpers.ts";

/** Render one strict manual fixture page with caller-selected publication. */
function page(
  id: string,
  title: string,
  kind: ManualKind,
  order: number,
  body: string,
  publish = true,
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(title)}`,
    `description: ${
      JSON.stringify(
        "A complete manual fixture description that satisfies the strict repository contract.",
      )
    }`,
    `order: ${order}`,
    `publish: ${publish}`,
    `kind: ${kind}`,
    "aliases:",
    `  - ${JSON.stringify(`${id} alias`)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/** Materialize every registered section plus measured and excluded leaves. */
async function writeFixture(root: string): Promise<string> {
  const manual = join(root, "manual");
  await Deno.mkdir(manual);
  await Deno.writeTextFile(
    join(manual, "README.md"),
    page(
      "manual-home",
      "Manual",
      "tutorial",
      0,
      "# Manual\n\n<!-- BEGIN MANUAL FRONT DOORS -->\n- [Start](00-start/README.md)\n<!-- END MANUAL FRONT DOORS -->\n\nRoot prose.",
    ),
  );
  for (const [index, section] of MANUAL_SECTION_REGISTRY.entries()) {
    await Deno.mkdir(join(manual, section.dir));
    const kind: ManualKind = index === 0
      ? "tutorial"
      : index === 1
      ? "guide"
      : index === 2
      ? "explanation"
      : index === 3
      ? "reference"
      : "troubleshooting";
    await Deno.writeTextFile(
      join(manual, section.dir, "README.md"),
      page(
        `${kind}-index`,
        `${kind} index`,
        kind,
        0,
        `# ${kind} index\n\nIndex prose.`,
      ),
    );
  }
  await Deno.writeTextFile(
    join(manual, "20-guides", "published.md"),
    page(
      "guide-published",
      "Published guide",
      "guide",
      10,
      "# Published guide\n\n## Action\n\nSix published words live in this body.\n\n```sh\ncode words never count here\n```",
    ),
  );
  await Deno.writeTextFile(
    join(manual, "20-guides", "withheld.md"),
    page(
      "guide-withheld",
      "Withheld guide",
      "guide",
      20,
      `# Withheld\n\n## Hidden topic\n\n${"hidden ".repeat(500)}`,
      false,
    ),
  );
  await Deno.writeTextFile(
    join(manual, "30-reference", "lookup.md"),
    page(
      "reference-lookup",
      "Lookup",
      "reference",
      10,
      "# Lookup\n\n## Table\n\nReference prose contributes here.",
    ),
  );
  return manual;
}

Deno.test("density excludes withheld pages, frontmatter, code, and private Map prose", async () => {
  await withTempDir(async (dir) => {
    const manual = await writeFixture(dir);
    const baseline = await measurePublicDocs(dir, manual);
    assertEquals((await publicDocEntries(dir, manual)).length, 8);
    assertEquals(baseline.leaves, 4, "two leaves plus their two H2 topics");

    await Deno.mkdir(join(dir, "project", "map", "_private"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "project", "map", "_private", "notes.md"),
      `# Private\n\n${"private ".repeat(1000)}`,
    );
    assertEquals(await measurePublicDocs(dir, manual), baseline);

    const guidePath = join(manual, "20-guides", "published.md");
    const before = await Deno.readTextFile(guidePath);
    await Deno.writeTextFile(
      guidePath,
      before.replace(
        "aliases:\n",
        `aliases:\n  - ${JSON.stringify("metadata noise ".repeat(100))}\n`,
      ).replace(
        "code words never count here",
        "code words never count here " + "code ".repeat(1000),
      ),
    );
    assertEquals(await measurePublicDocs(dir, manual), baseline);
  });
});

Deno.test("reference stays inside the complete-navigation density projection", async () => {
  await withTempDir(async (dir) => {
    const manual = await writeFixture(dir);
    const before = await measurePublicDocs(dir, manual);
    const reference = join(manual, "30-reference", "lookup.md");
    await Deno.writeTextFile(
      reference,
      (await Deno.readTextFile(reference)).replace(
        "Reference prose contributes here.",
        "Reference prose contributes here with several additional visible words.",
      ),
    );
    const after = await measurePublicDocs(dir, manual);
    assertEquals(after.leaves, before.leaves);
    assert(after.words > before.words);
  });
});
