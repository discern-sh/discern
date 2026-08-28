/** Permanent zero-debt guard for declarations kept alive only by `export`. */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  configuredLocalImports,
  configuredPublicModules,
  DEAD_EXPORT_EXTERNAL_ROOTS,
  deadExportsInFiles,
  deadExportsInSources,
  type DeadExportSource,
} from "../scripts/dead_exports_lib.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

Deno.test("dead-export census distinguishes dead declarations from every conservative reachability root", () => {
  const sources: DeadExportSource[] = [
    {
      path: "dead.ts",
      source: "export function orphan(): number { return 1; }",
    },
    {
      path: "local.ts",
      source:
        "export function locallyUsed(): number { return 1; }\nlocallyUsed();",
    },
    { path: "named.ts", source: "export const imported = 1;" },
    {
      path: "named_consumer.ts",
      source: 'import { imported } from "./named.ts";\nvoid imported;',
    },
    {
      path: "typed.ts",
      source: "export interface ImportedType { value: string }",
    },
    {
      path: "typed_consumer.ts",
      source:
        'import type { ImportedType } from "./typed.ts";\ntype Alias = ImportedType;',
    },
    { path: "namespace.ts", source: "export const selectedAtRuntime = 1;" },
    {
      path: "namespace_consumer.ts",
      source: 'import * as values from "./namespace.ts";\nvoid values;',
    },
    { path: "dynamic.ts", source: "export const dynamicallySelected = 1;" },
    {
      path: "dynamic_consumer.ts",
      source: 'await import("./dynamic.ts");',
    },
    { path: "facade_source.ts", source: "export const facadeValue = 1;" },
    {
      path: "facade.ts",
      source: 'export { facadeValue } from "./facade_source.ts";',
    },
    { path: "public.ts", source: "export const externalApi = 1;" },
    { path: "types/public.d.ts", source: "export type ExternalType = string;" },
  ];

  assertEquals(
    deadExportsInSources(sources, { publicModules: new Set(["public.ts"]) }),
    [{ file: "dead.ts", line: 1, name: "orphan", kind: "value" }],
  );
});

Deno.test("dead-export census enrolls every direct declaration kind", () => {
  const source = [
    "export const value = 1;",
    "export function fn(): void {}",
    "export class ClassName {}",
    "export enum EnumName { One }",
    "export namespace NamespaceName {}",
    "export interface InterfaceName {}",
    "export type TypeName = string;",
    "export default function defaultEntry(): void {}",
  ].join("\n");
  assertEquals(
    deadExportsInSources([{ path: "kinds.ts", source }]).map((finding) => ({
      name: finding.name,
      kind: finding.kind,
    })),
    [
      { name: "value", kind: "value" },
      { name: "fn", kind: "value" },
      { name: "ClassName", kind: "value" },
      { name: "EnumName", kind: "value" },
      { name: "NamespaceName", kind: "value" },
      { name: "InterfaceName", kind: "type" },
      { name: "TypeName", kind: "type" },
    ],
  );
});

Deno.test("dead-export census resolves local Deno import-map entries and public exports", () => {
  const config = JSON.stringify({
    exports: { ".": "./src/public.ts" },
    imports: { "#shared/": "./src/shared/" },
  });
  assertEquals(configuredLocalImports(config), {
    "#shared/": "./src/shared/",
  });
  assertEquals(configuredPublicModules(config), new Set(["src/public.ts"]));
  assertEquals(
    deadExportsInSources([
      { path: "src/shared/value.ts", source: "export const live = 1;" },
      {
        path: "src/consumer.ts",
        source: 'import { live } from "#shared/value.ts";\nvoid live;',
      },
      { path: "src/public.ts", source: "export const external = 1;" },
    ], {
      imports: configuredLocalImports(config),
      publicModules: configuredPublicModules(config),
    }),
    [],
  );
});

Deno.test("the authored repository has no declaration kept alive only by export", async () => {
  const files = await structuralGuardScope({
    guard: "tests/dead_exports_test.ts#zero-dead-direct-exports",
    universe: "authored-deno",
  });
  for (const path of Object.keys(DEAD_EXPORT_EXTERNAL_ROOTS)) {
    assert(files.includes(path), `stale dead-export external root: ${path}`);
  }
  const findings = await deadExportsInFiles(
    REPO_ROOT,
    files,
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  );
  assertEquals(findings, []);
});
