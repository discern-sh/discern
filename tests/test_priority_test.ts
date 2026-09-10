import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  affectedTestFiles,
  discoverTestPriority,
  priorityExclusions,
  priorityFile,
} from "../scripts/test_priority.ts";
import { decodeDenoInfoGraph } from "../src/shared/deno_graph.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./temp_dir.ts";

Deno.test("resolved affected tests follow transitive code, type, alias and cyclic edges", () => {
  const graph = decodeDenoInfoGraph({
    redirects: { alias: "source" },
    npmPackages: {},
    modules: [
      {
        specifier: "source",
        local: "/repo/source.ts",
        mediaType: "TypeScript",
        dependencies: [{ specifier: "cycle", code: { specifier: "helper" } }],
      },
      {
        specifier: "helper",
        dependencies: [{ specifier: "source", code: { specifier: "alias" } }],
      },
      {
        specifier: "test-a",
        dependencies: [{ specifier: "helper", type: { specifier: "helper" } }],
      },
      {
        specifier: "test-b",
        dependencies: [{ specifier: "source", code: { specifier: "source" } }],
      },
      { specifier: "test-c" },
    ],
  });
  const modules = ["test-c", "test-b", "test-a", "test-a"];
  assertEquals(affectedTestFiles(graph, modules, ["source", "source"]), [
    "test-a",
    "test-b",
  ]);
  assertEquals(affectedTestFiles(graph, modules, ["test-c"]), ["test-c"]);
  assertEquals(affectedTestFiles(graph, modules, []), []);
  assertEquals(affectedTestFiles(graph, modules, ["unknown"]), []);
  assertEquals(affectedTestFiles(graph, modules, ["source", "test-c"]), [
    "test-a",
    "test-b",
    "test-c",
  ]);
});

Deno.test("priority fallback preserves unsupported native selections and literal filename boundaries", () => {
  assertEquals(priorityExclusions({}), []);
  assertEquals(
    priorityExclusions({
      test: { exclude: ["tests/fixtures/", "generated/*.ts"] },
    }),
    ["tests/fixtures/", "generated/*.ts"],
  );
  for (
    const value of [
      null,
      [],
      { test: { exclude: "wrong" } },
      { test: { exclude: ["comma,name"] } },
      { test: { include: [] } },
      { workspace: [] },
      { exclude: [] },
    ]
  ) {
    assertEquals(priorityExclusions(value), undefined);
  }
  for (
    const path of [
      "tests/a_test.ts",
      "test.ts",
      "path with spaces/b.test.js",
      "tests/c_test.tsx",
      "d_test.mjs",
    ]
  ) assert(priorityFile(path), path);
  for (
    const path of [
      "",
      "/absolute_test.ts",
      "../parent_test.ts",
      "-a_test.ts",
      "comma,name_test.ts",
      "tests/[literal]_test.ts",
      "tests/*.test.ts",
      "helpers.ts",
      "tests/a_test.ts.map",
    ]
  ) assertEquals(priorityFile(path), false, path);
});

Deno.test("priority discovery uses the repository diff and resolved graph with safe fallback", async () => {
  // One small Git repository and one metadata graph exercise the actual discovery
  // boundary; no scaffold, gate, test producer, or worktree is required.
  await withTempDir(async (root) => {
    const signal = new AbortController().signal;
    await Deno.mkdir(join(root, "tests"));
    await Deno.writeTextFile(join(root, "deno.json"), "{}");
    await Deno.writeTextFile(
      join(root, "discern.toml"),
      '[project]\nslug = "priority-fixture"\n[repository]\ntrunk = "main"\n',
    );
    await Deno.writeTextFile(
      join(root, "source.ts"),
      "export const value = 1;\n",
    );
    await Deno.writeTextFile(
      join(root, "tests", "importer_test.ts"),
      'import { value } from "../source.ts";\nDeno.test("importer", () => { if (!value) throw new Error("missing"); });\n',
    );
    await Deno.writeTextFile(
      join(root, "tests", "unaffected_test.ts"),
      'Deno.test("unaffected", () => {});\n',
    );
    assertEquals(await discoverTestPriority(root, signal), undefined);
    await gitInit(root);
    assertEquals(await discoverTestPriority(root, signal), undefined);
    await Deno.writeTextFile(
      join(root, "source.ts"),
      "export const value = 2;\n",
    );
    assertEquals(await discoverTestPriority(root, signal), {
      files: ["tests/importer_test.ts"],
      excluded: [],
      moduleCount: 2,
    });
    await Deno.writeTextFile(
      join(root, "deno.json"),
      '{"test":{"include":[]}}',
    );
    assertEquals(await discoverTestPriority(root, signal), undefined);
    await Deno.writeTextFile(join(root, "deno.json"), "invalid JSON");
    assertEquals(await discoverTestPriority(root, signal), undefined);
    await assertRejects(() => discoverTestPriority(root, AbortSignal.abort()));
  });
});

Deno.test("the shared Deno graph decoder preserves missing resolutions and rejects malformed metadata", () => {
  const empty = { modules: [], redirects: {}, npmPackages: {} };
  assertEquals(decodeDenoInfoGraph(empty), { ...empty, npmPackages: [] });
  const module = {
    specifier: "source",
    dependencies: [
      { specifier: "unavailable", code: { error: "unresolved" } },
      { specifier: "types", type: { specifier: "target" } },
    ],
  };
  assertEquals(
    decodeDenoInfoGraph({ ...empty, modules: [module] }).modules[0]
      ?.dependencies,
    [{ specifier: "unavailable" }, {
      specifier: "types",
      type: { specifier: "target" },
    }],
  );
  const valid = decodeDenoInfoGraph({
    ...empty,
    modules: [{ specifier: "source", local: null, mediaType: null }],
    npmPackages: { id: { name: "library", localPath: "/cache/library" } },
  });
  assertEquals(valid.npmPackages, [{
    name: "library",
    localPath: "/cache/library",
  }]);
  for (
    const value of [
      null,
      [],
      { ...empty, modules: {} },
      { ...empty, modules: [null] },
      ...[
        {},
        { specifier: "" },
        { specifier: 1 },
        { specifier: "source", local: 1 },
        { specifier: "source", mediaType: 1 },
        { specifier: "source", dependencies: {} },
        { specifier: "source", dependencies: [null] },
        { specifier: "source", dependencies: [{}] },
        { specifier: "source", dependencies: [{ specifier: "dep", code: 1 }] },
        { specifier: "source", dependencies: [{ specifier: "dep", code: {} }] },
      ].map((bad) => ({ ...empty, modules: [bad] })),
      { ...empty, redirects: [] },
      { ...empty, redirects: { source: 1 } },
      { ...empty, npmPackages: [] },
      { ...empty, npmPackages: { id: null } },
      { ...empty, npmPackages: { id: { name: "library" } } },
    ]
  ) assertThrows(() => decodeDenoInfoGraph(value), TypeError);
});
