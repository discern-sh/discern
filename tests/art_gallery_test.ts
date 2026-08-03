/** Contract coverage for the maintainer-facing terminal-art gallery task. */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl } from "@std/path";
import { renderArtGallery } from "../scripts/art.ts";
import { DISCERN_ART_VARIANTS } from "../src/shared/brand_art.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const DECODER = new TextDecoder();

Deno.test("the art gallery enrolls every registered variant in order", () => {
  const expected = Object.entries(DISCERN_ART_VARIANTS)
    .map(([name, variant]) => `[${name}]\n${variant.render()}`)
    .join("\n\n");

  assertEquals(renderArtGallery(), expected);
});

Deno.test("deno task art prints the complete plain-text gallery", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "art"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = DECODER.decode(result.stderr);

  assertEquals(result.code, 0, stderr);
  assertEquals(DECODER.decode(result.stdout), `${renderArtGallery()}\n`);
});
