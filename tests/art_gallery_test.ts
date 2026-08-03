/** Contract coverage for the maintainer-facing terminal-art gallery task. */

import { assert, assertEquals, assertMatch } from "@std/assert";
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

Deno.test("gallery labels and composed output stay terminal-safe", () => {
  for (const name of Object.keys(DISCERN_ART_VARIANTS)) {
    assertMatch(name, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  }

  const gallery = renderArtGallery();
  for (const character of gallery) {
    assert(
      character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
      `gallery contains terminal control ${JSON.stringify(character)}`,
    );
  }
  for (const line of gallery.split("\n")) {
    assert(
      !/\s$/u.test(line),
      `gallery line has trailing whitespace: ${JSON.stringify(line)}`,
    );
  }
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
