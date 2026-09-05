/** Strict manual projection rejects invalid physical sources before publication. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { discoverDocs } from "../src/lib/docs.ts";
import {
  buildManualProjection,
  MANUAL_FRONT_DOORS_END,
  MANUAL_FRONT_DOORS_START,
  MANUAL_PAGE_MAX_BYTES,
  ManualProjectionError,
  resolveManualLink,
} from "../src/lib/manual.ts";
import { MANUAL_SECTION_REGISTRY } from "../src/shared/manual.ts";
import { withTempDir } from "./helpers.ts";

/** Each page owns a distinct id and search name in a minimal valid corpus. */
function page(id: string, body = "Fixture body."): string {
  return `---\nid: ${id}\ntitle: ${id}\ndescription: A synthetic manual page with a description long enough for the strict publication contract.\norder: 0\npublish: true\nkind: reference\naliases: ["${id} alias"]\n---\n\n# ${id}\n\n${body}\n`;
}

Deno.test("manual projection diagnoses oversize, invalid UTF-8, and replaced source types", async () => {
  await withTempDir(async (root) => {
    const manual = join(root, "manual");
    await Deno.mkdir(manual);
    for (const section of MANUAL_SECTION_REGISTRY) {
      await Deno.mkdir(join(manual, section.dir));
      await Deno.writeTextFile(
        join(manual, section.dir, "README.md"),
        page(`${section.slug}-index`),
      );
    }
    const first = MANUAL_SECTION_REGISTRY[0];
    assert(first !== undefined);
    await Deno.writeTextFile(
      join(manual, "README.md"),
      page(
        "root-index",
        `${MANUAL_FRONT_DOORS_START}\n\n- [Start](${first.dir}/README.md)\n\n${MANUAL_FRONT_DOORS_END}`,
      ),
    );
    const tree = await discoverDocs({ cwd: root, dir: manual });
    assert(tree !== undefined);
    await buildManualProjection(tree.entries);
    const path = join(manual, first.dir, "README.md");
    const original = await Deno.readFile(path);
    for (
      const [bytes, message] of [
        [new Uint8Array(MANUAL_PAGE_MAX_BYTES + 1), "exceeds the"],
        [new Uint8Array([0xff, 0xfe]), "is not valid UTF-8"],
        [
          new TextEncoder().encode("# Missing metadata\n"),
          "must open with a complete frontmatter block",
        ],
      ] as const
    ) {
      await Deno.writeFile(path, bytes);
      const error = await assertRejects(
        () => buildManualProjection(tree.entries),
        ManualProjectionError,
      );
      assertStringIncludes(
        error.issues.join("\n"),
        `${first.dir}/README.md: ${message}`,
      );
    }
    await Deno.remove(path);
    await Deno.mkdir(path);
    const directory = await assertRejects(
      () => buildManualProjection(tree.entries),
      ManualProjectionError,
    );
    assertStringIncludes(
      directory.issues.join("\n"),
      "manual sources must be regular files",
    );
    await Deno.remove(path);
    const target = join(root, "external.md");
    await Deno.writeFile(target, original);
    await Deno.symlink(target, path);
    const linked = await assertRejects(
      () => buildManualProjection(tree.entries),
      ManualProjectionError,
    );
    assertStringIncludes(
      linked.issues.join("\n"),
      "manual sources must not be symbolic links",
    );
    assertEquals(await Deno.readFile(target), original);
  });
});

Deno.test("manual links refuse external or escaping destinations and normalize corpus-relative paths", () => {
  for (
    const destination of [
      "/absolute",
      "#anchor",
      "https://example.test",
      "../escape.md",
      "..",
      "guide.md?query",
      "guide.md#anchor",
    ]
  ) {
    assertEquals(
      resolveManualLink("README.md", destination),
      undefined,
      destination,
    );
  }
  assertEquals(
    resolveManualLink("00-start/README.md", "../10-guides/"),
    "10-guides/README.md",
  );
  assertEquals(
    resolveManualLink("00-start/README.md", "./next.MD"),
    "00-start/next.MD",
  );
});
