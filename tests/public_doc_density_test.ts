/**
 * The leaf-density standard measures the PUBLISHED corpus — the same corpus
 * the document model projects, never a private re-derivation. Pins the two
 * exclusions the measurement makes: a `publish: false` page counts toward
 * neither leaves nor words (it is not yet part of the published corpus), and
 * underscore-prefixed subtrees stay out entirely. Without this, the metric
 * silently drifts from the projection the standard exists to budget — the
 * script once counted by path alone, and the first unpublished page skewed
 * the density of a corpus it was never part of.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

Deno.test("the density metric counts only published pages, frontmatter excluded", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-density-" });
  try {
    await Deno.writeTextFile(
      join(dir, "README.md"),
      "# Index\n\nfour words of prose\n",
    );
    await Deno.mkdir(join(dir, "10-section"));
    await Deno.writeTextFile(
      join(dir, "10-section", "published.md"),
      "---\ntitle: Published\n---\n\n# Published\n\nsix published words in this body\n",
    );
    await Deno.writeTextFile(
      join(dir, "10-section", "withheld.md"),
      `---\npublish: false\n---\n\n# Withheld\n\n${"word ".repeat(500)}\n`,
    );
    await Deno.mkdir(join(dir, "_private"));
    await Deno.writeTextFile(
      join(dir, "_private", "notes.md"),
      `# Notes\n\n${"secret ".repeat(300)}\n`,
    );

    const script = new URL("../scripts/public_doc_density.ts", import.meta.url);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", script.pathname, dir],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(result.stdout);
    assertEquals(
      result.code,
      0,
      new TextDecoder().decode(result.stderr),
    );

    const metric = (name: string): number =>
      Number(stdout.match(new RegExp(`DISCERN_METRIC ${name} (\\d+)`))?.[1]);
    // One leaf: published.md. Neither the withheld page nor _private counts,
    // and README files are indexes, not leaves.
    assertEquals(metric("public_doc_leaves"), 1);
    // Words: README body (5: "Index" + four-word line) + published body
    // (7: "Published" + six-word line). Frontmatter contributes nothing; the
    // withheld page's 500 words and the private tree's 300 never count.
    assertEquals(metric("public_doc_words"), 12);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
