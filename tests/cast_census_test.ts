/** Contract tests for the honest TypeScript assertion census. */

import { assertEquals } from "@std/assert";
import {
  castCensusFiles,
  typeAssertionsInFiles,
  typeAssertionsInSource,
  UNSAFE_ASSERTION_KINDS,
} from "../scripts/cast_census.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("cast census: every unsafe syntax kind is distinct from safe assertions", () => {
  const source = [
    "declare const value: unknown;",
    "value as any;",
    "value as unknown as { ready: true };",
    "value as any as { ready: true };",
    "value as const;",
    "value as { ready: boolean };",
    "value as unknown;",
    '"value as any";',
    "// value as any",
  ].join("\n");
  const findings = typeAssertionsInSource(source);
  assertEquals(
    findings.map((finding) => [finding.kind, finding.line]),
    [
      ["as-any", 2],
      ["as-unknown-as", 3],
      ["as-any-as", 4],
      ["as-const", 5],
      ["typed", 6],
      ["typed", 7],
    ],
  );
  assertEquals(
    new Set(findings.slice(0, 3).map((finding) => finding.kind)),
    new Set(UNSAFE_ASSERTION_KINDS.map((definition) => definition.id)),
  );
});

Deno.test("cast census: a future authored-TypeScript root auto-enrols", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(`${root}/future-source`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/future-source/unsafe.ts`,
      "declare const value: unknown;\nvalue as any;\n",
    );
    await gitInit(root);
    const files = await castCensusFiles(root);
    assertEquals(files, ["future-source/unsafe.ts"]);
    assertEquals(
      (await typeAssertionsInFiles(root, files)).map((finding) => finding.kind),
      ["as-any"],
    );
  });
});
