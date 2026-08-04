/** The canonical text mark and the repository's first-contact wordmark. */

import { assertEquals } from "@std/assert";
import {
  DISCERN_DOCS_URL,
  DISCERN_MARK,
  DISCERN_WORDMARK,
} from "../src/shared/brand.ts";

Deno.test("the project mark is U+25EE and the README opens with its wordmark", async () => {
  assertEquals(DISCERN_MARK.codePointAt(0), 0x25ee);
  assertEquals([...DISCERN_MARK].length, 1);
  assertEquals(DISCERN_WORDMARK, "◮ discern");
  assertEquals(DISCERN_DOCS_URL, "https://discern.sh/docs");

  const readme = await Deno.readTextFile(
    new URL("../README.md", import.meta.url),
  );
  assertEquals(readme.split("\n", 1)[0], `# ${DISCERN_WORDMARK}`);
});
