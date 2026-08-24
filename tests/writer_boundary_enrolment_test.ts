/**
 * Restricted writer-module ENROLMENT guard.
 *
 * The shipped dependency graph comes from Deno's parser (`deno info --json`),
 * not source spelling. Any import, alias, re-export, dynamic import, or helper
 * wrapper still creates an edge into the capability module. Only importers
 * declared in RESTRICTED_WRITER_MODULES may hold such an edge.
 */

import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  RESTRICTED_WRITER_MODULES,
  type RestrictedWriterModule,
} from "./writer_boundaries.ts";
import { withTempDir } from "./helpers.ts";
import { type ModuleGraph, shippedModuleGraph } from "./module_graph.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Validate capability-boundary uniqueness, graph presence, and authorized importer sets. */
function writerBoundaryOffenders(
  graph: ModuleGraph,
  boundaries: readonly RestrictedWriterModule[],
): string[] {
  const offenders: string[] = [];
  const ids = new Set<string>();
  const modules = new Set<string>();
  for (const boundary of boundaries) {
    if (ids.has(boundary.id)) {
      offenders.push(`${boundary.id}: duplicate boundary id`);
    }
    ids.add(boundary.id);
    if (modules.has(boundary.module)) {
      offenders.push(`${boundary.module}: capability module enrolled twice`);
    }
    modules.add(boundary.module);
    if (!graph.modules.has(boundary.module)) {
      offenders.push(
        `${boundary.id}: capability module ${boundary.module} is absent from the shipped graph`,
      );
      continue;
    }
    const allowed = new Set<string>(boundary.allowedImporters);
    const incoming = graph.edges
      .filter((edge) => edge.to === boundary.module)
      .map((edge) => edge.from);
    for (const importer of incoming) {
      if (!allowed.has(importer)) {
        offenders.push(
          `${boundary.id}: ${importer} reaches ${boundary.module}; ` +
            boundary.authority,
        );
      }
    }
    for (const importer of allowed) {
      if (!incoming.includes(importer)) {
        offenders.push(
          `${boundary.id}: enrolled importer ${importer} no longer reaches ${boundary.module}`,
        );
      }
    }
  }
  return offenders.sort();
}

Deno.test("only enrolled shipped modules reach restricted writer capabilities", async () => {
  const graph = await shippedModuleGraph(REPO_ROOT, "src/main.ts");
  assertEquals(
    writerBoundaryOffenders(graph, RESTRICTED_WRITER_MODULES),
    [],
    "a restricted writer capability escaped its authority boundary; import it " +
      "only from the owning module, or declare a genuinely new authority " +
      "relationship in tests/writer_boundaries.ts",
  );
});

Deno.test("writer boundaries reject aliases, dynamic imports, re-exports, and helpers", async () => {
  await withTempDir(async (root) => {
    const files: Readonly<Record<string, string>> = {
      "src/entry.ts": [
        'import "./owners/setup.ts";',
        'import "./owners/desk.ts";',
        'import "./intruders/commit_alias.ts";',
        'import "./intruders/commit_dynamic.ts";',
        'import "./intruders/commit_reexport.ts";',
        'import "./intruders/commit_helper.ts";',
        'import "./intruders/grant_alias.ts";',
        'import "./intruders/grant_dynamic.ts";',
        'import "./intruders/grant_reexport.ts";',
        'import "./intruders/grant_helper.ts";',
      ].join("\n"),
      "src/capabilities/commit.ts": "export function record(): void {}\n",
      "src/capabilities/grant.ts": "export function authorize(): void {}\n",
      "src/owners/setup.ts":
        'import { record as canonical } from "../capabilities/commit.ts";\ncanonical();\n',
      "src/owners/desk.ts":
        'import { authorize as canonical } from "../capabilities/grant.ts";\ncanonical();\n',
      "src/intruders/commit_alias.ts":
        'import { record as ferry } from "../capabilities/commit.ts";\nferry();\n',
      "src/intruders/commit_dynamic.ts":
        'const { record } = await import("../capabilities/commit.ts");\nrecord();\n',
      "src/intruders/commit_reexport.ts":
        'export { record as harmless } from "../capabilities/commit.ts";\n',
      "src/intruders/commit_helper.ts":
        'import { record } from "../capabilities/commit.ts";\nexport function helper(): void { record(); }\n',
      "src/intruders/grant_alias.ts":
        'import { authorize as remember } from "../capabilities/grant.ts";\nremember();\n',
      "src/intruders/grant_dynamic.ts":
        'const { authorize } = await import("../capabilities/grant.ts");\nauthorize();\n',
      "src/intruders/grant_reexport.ts":
        'export { authorize as note } from "../capabilities/grant.ts";\n',
      "src/intruders/grant_helper.ts":
        'import { authorize } from "../capabilities/grant.ts";\nexport function helper(): void { authorize(); }\n',
    };
    for (const [rel, text] of Object.entries(files)) {
      const path = join(root, rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, text);
    }
    const boundaries: readonly RestrictedWriterModule[] = [
      {
        id: "commit",
        module: "src/capabilities/commit.ts",
        allowedImporters: ["src/owners/setup.ts"],
        authority: "only setup records",
      },
      {
        id: "grant",
        module: "src/capabilities/grant.ts",
        allowedImporters: ["src/owners/desk.ts"],
        authority: "only desk authorizes",
      },
    ];
    const graph = await shippedModuleGraph(root, "src/entry.ts");
    assertEquals(writerBoundaryOffenders(graph, boundaries), [
      "commit: src/intruders/commit_alias.ts reaches src/capabilities/commit.ts; only setup records",
      "commit: src/intruders/commit_dynamic.ts reaches src/capabilities/commit.ts; only setup records",
      "commit: src/intruders/commit_helper.ts reaches src/capabilities/commit.ts; only setup records",
      "commit: src/intruders/commit_reexport.ts reaches src/capabilities/commit.ts; only setup records",
      "grant: src/intruders/grant_alias.ts reaches src/capabilities/grant.ts; only desk authorizes",
      "grant: src/intruders/grant_dynamic.ts reaches src/capabilities/grant.ts; only desk authorizes",
      "grant: src/intruders/grant_helper.ts reaches src/capabilities/grant.ts; only desk authorizes",
      "grant: src/intruders/grant_reexport.ts reaches src/capabilities/grant.ts; only desk authorizes",
    ]);
  });
});
