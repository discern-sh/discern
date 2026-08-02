/**
 * The leaf-density standard measures the PUBLIC guidance corpus — the same
 * projection the document model serves to every published surface, never a
 * private re-derivation. Pins the three exclusions the measurement makes: a
 * `publish: false` page counts toward neither leaves nor words (it is not yet
 * part of the published corpus), underscore-prefixed subtrees stay out
 * entirely, and contributor-tier sections stay out because the manual section
 * registry withholds them from every public surface — those tiers absorb
 * material cut from public pages, so counting them would punish exactly that
 * move. Section names come from the registry itself, so a re-audienced or new
 * section auto-enrols. Without this, the metric silently drifts from the
 * projection the standard exists to budget — the script once counted by path
 * alone, and later counted contributor tiers no reader of the public manual
 * ever sees.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { MANUAL_SECTION_REGISTRY } from "../src/lib/paths.ts";

/** Resolve the configured manual directory for one published audience tier. */
function registrySection(audience: "public" | "contributor"): string {
  const section = MANUAL_SECTION_REGISTRY.find(
    (entry) => entry.audience === audience,
  );
  if (section === undefined) {
    throw new Error(`no ${audience} section in the manual section registry`);
  }
  return section.dir;
}

Deno.test("the density metric counts only public published pages, frontmatter excluded", async () => {
  const publicSection = registrySection("public");
  const contributorSection = registrySection("contributor");
  const dir = await Deno.makeTempDir({ prefix: "discern-density-" });
  try {
    await Deno.writeTextFile(
      join(dir, "README.md"),
      "# Index\n\nfour words of prose\n",
    );
    await Deno.mkdir(join(dir, publicSection));
    await Deno.writeTextFile(
      join(dir, publicSection, "published.md"),
      "---\ntitle: Published\n---\n\n# Published\n\nsix published words in this body\n",
    );
    await Deno.writeTextFile(
      join(dir, publicSection, "withheld.md"),
      `---\npublish: false\n---\n\n# Withheld\n\n${"word ".repeat(500)}\n`,
    );
    await Deno.mkdir(join(dir, contributorSection));
    await Deno.writeTextFile(
      join(dir, contributorSection, "runbook.md"),
      `# Runbook\n\n${"internal ".repeat(400)}\n`,
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
    // One leaf: published.md. Neither the withheld page, the contributor
    // section, nor _private counts, and README files are indexes, not leaves.
    assertEquals(metric("public_doc_leaves"), 1);
    // Words: README body (5: "Index" + four-word line) + published body
    // (7: "Published" + six-word line). Frontmatter contributes nothing; the
    // withheld page's 500 words, the contributor runbook's 400, and the
    // private tree's 300 never count.
    assertEquals(metric("public_doc_words"), 12);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
