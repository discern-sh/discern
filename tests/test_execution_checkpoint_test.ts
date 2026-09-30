/** Cost-review selection preserves cheap edits and catches repeated real work. */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  testExecutionGrowth,
  type TestExecutionSource,
} from "../scripts/test_execution_analysis.ts";
import {
  committedExecutionSources,
  matchingExecutionChanges,
  TEST_EXECUTION_CHECKPOINT_ID,
} from "../scripts/test_execution_checkpoint.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./temp_dir.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { assertNamedCases } from "./assert_cases.ts";

const PATH = "tests/example_test.ts";
const IMPORT = 'import { runAgent as invoke } from "./engine_helpers.ts";';
const CALL = 'await invoke(dir, ["done"]);';

/** Exercise the actual narrow-permission checkpoint command on the same fixture. */
async function runMatcher(
  dir: string,
  input: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const inputPath = `${dir}/input.json`;
  await Deno.writeTextFile(inputPath, JSON.stringify(input));
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--quiet",
      "--no-prompt",
      "--config",
      `${REPO_ROOT}/deno.json`,
      "--allow-read",
      "--allow-env=DISCERN_CHECKPOINT_INPUT",
      "--allow-run=git",
      `${REPO_ROOT}/scripts/test_execution_checkpoint.ts`,
    ],
    cwd: dir,
    env: {
      DISCERN_CHECKPOINT_INPUT: inputPath,
      NO_COLOR: "1",
      FORCE_COLOR: "",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

/** Exercise the production selector over an in-memory test module. */
function selected(
  before: string,
  after: string,
  extra: readonly TestExecutionSource[] = [],
): boolean {
  return testExecutionGrowth(
    [{ path: PATH, text: before }, ...extra],
    [{ path: PATH, text: after }, ...extra],
    new Set([PATH]),
  ).length > 0;
}

Deno.test("test execution checkpoint: selected cases", () => {
  assertNamedCases({
    "test cost selection distinguishes extra execution from incidental edits":
      () => {
        const base = `${IMPORT} async function example() { ${CALL} }`;
        for (
          const [label, after, fires] of [
            [
              "extra invocation",
              `${IMPORT} async function example() { ${CALL} ${CALL} }`,
              true,
            ],
            [
              "assertion",
              `${IMPORT} async function example() { ${CALL} assertEquals(result.code, 0); }`,
              false,
            ],
            ["comment", `${base}\n// await invoke(dir, ["done"]);`, false],
            [
              "string",
              `${base}\nconst fixture = 'await invoke(dir, ["done"]);';`,
              false,
            ],
            [
              "format",
              `${IMPORT}\nasync function example() {\n${CALL}\n}`,
              false,
            ],
            ["move", `${IMPORT} async function renamed() { ${CALL} }`, false],
            ["delete", IMPORT, false],
            [
              "new loop",
              `${IMPORT} async function example() { for (const x of [1, 2]) { ${CALL} } }`,
              true,
            ],
            [
              "shadow",
              `${base}\nfunction pure(invoke: () => void) { invoke(); }`,
              false,
            ],
          ] as const
        ) assertEquals(selected(base, after), fires, label);
      },
    "test cost recognizes MCP client process creation": () => {
      const imports = 'import { spawnMcp } from "./mcp_client.ts";';
      assertEquals(
        selected(
          imports,
          `${imports}
async function example() { await using client = await spawnMcp(dir); }`,
        ),
        true,
      );
    },
    "test cost recognizes in-process surveys and gate results": () => {
      for (
        const [module, name] of [
          ["status/status", "statusResult"],
          ["gate/prepare", "prepareResult"],
          ["gate/test_job", "testResult"],
        ]
      ) {
        const imports =
          `import { ${name} as observe } from "../src/engine/${module}.ts";`;
        assertEquals(
          selected(imports, `${imports} await observe(dir);`),
          true,
          name,
        );
      }
    },
    "call-count adapters and callable aliases retain their expensive boundary":
      () => {
        const base = `${IMPORT}
import { countedCalls } from "./counted_calls.ts";
const wrapped = countedCalls(invoke);
const observe = wrapped.run;`;
        assertEquals(selected(base, `${base} await observe(dir);`), true);
        assertEquals(selected(base, `${base} await wrapped.run(dir);`), true);
        assertEquals(
          selected(base, `${base} const alias = observe; await alias(dir);`),
          true,
        );
      },
    "test cost follows expensive named callbacks in pristine pools": () => {
      for (
        const [module, name] of [
          ["engine_surface_fixture", "withPristineInstalls"],
          ["engine_integration_fixture", "withCountedPristineInstalls"],
        ]
      ) {
        const source = (entries: string): string =>
          `${IMPORT}
import { ${name} as pool } from "./${module}.ts";
async function scenario() { ${CALL} }
async function cheap() { assertEquals(1, 1); }
const cases = [${entries}] as const;
await pool(t, cheap, cases);`;
        const one = '["first", scenario]';
        assertEquals(
          selected(source(one), source(`${one}, ["second", scenario]`)),
          true,
          name,
        );
        assertEquals(
          selected(source(one), source(`${one}, ["cheap", cheap]`)),
          false,
          name,
        );
        assertEquals(
          selected(source(`${one}, ["second", scenario]`), source(one)),
          false,
          name,
        );
        assertEquals(
          selected(source(one), source('["renamed", scenario]')),
          false,
          name,
        );
        // One expensive seed with assertion-only cases stays one seed as cases grow.
        const seed = (entries: string): string =>
          source(entries).replace(
            "pool(t, cheap, cases)",
            "pool(t, scenario, cases)",
          );
        assertEquals(
          selected(seed('["a", cheap]'), seed('["a", cheap], ["b", cheap]')),
          false,
          name,
        );
      }
    },
    "test cost follows fixture wrappers, namespace imports, and re-exports":
      () => {
        const extra = [
          {
            path: "tests/fixture.ts",
            text: `${IMPORT} export async function ready() { ${CALL} }`,
          },
          {
            path: "tests/reexport.ts",
            text: 'export { ready as fixture } from "./fixture.ts";',
          },
        ];
        for (
          const [imports, call] of [
            [
              'import { fixture as prepare } from "./reexport.ts";',
              "prepare()",
            ],
            ['import * as fixtures from "./fixture.ts";', "fixtures.ready()"],
          ]
        ) {
          assertEquals(
            selected(
              imports ?? "",
              `${imports} async function test() { await ${call}; }`,
              extra,
            ),
            true,
          );
        }
        assertEquals(
          selected(
            IMPORT,
            `${IMPORT} async function helper() { ${CALL} } async function test() { await helper(); }`,
          ),
          true,
        );
      },
    "test cost detects local matrix expansion and ignores changed case values":
      () => {
        for (
          const loop of [
            `for (const entry of cases) { ${CALL} }`,
            `await cases.map(async () => { ${CALL} });`,
          ]
        ) {
          const source = (values: string): string =>
            `${IMPORT} const cases = [${values}] as const; async function test() { ${loop} }`;
          assertEquals(selected(source("1"), source("1, 2")), true);
          assertEquals(selected(source("1, 2"), source("1")), false);
          assertEquals(selected(source("1"), source("99")), false);
        }
        assertEquals(
          selected(
            "",
            "for (const entry of [1,2]) { assertEquals(entry, entry); }",
          ),
          false,
        );
      },
  });
});
Deno.test("test cost refreshes unchanged callers when dependencies change", () => {
  const fixture = (text: string): TestExecutionSource => ({
    path: "tests/fixture.ts",
    text,
  });
  const cheap = fixture("export async function ready() {}");
  const expensive = fixture(
    `${IMPORT} export async function ready() { ${CALL} }`,
  );
  const caller = 'import { ready } from "./fixture.ts"; await ready();';
  const reexport = (name: string): TestExecutionSource => ({
    path: "tests/reexport.ts",
    text: `export { ${name} as ready } from "./fixture.ts";`,
  });
  const choices = fixture(
    `${IMPORT} export async function cheap() {} ` +
      `export async function expensive() { ${CALL} }`,
  );
  const cases = (values: string): TestExecutionSource => ({
    path: "tests/cases.ts",
    text: `export const cases = [${values}] as const;`,
  });
  for (
    const { label, subject, before, after } of [
      {
        label: "wrapper body",
        subject: caller,
        before: [cheap],
        after: [expensive],
      },
      {
        label: "added module",
        subject: caller,
        before: [],
        after: [expensive],
      },
      {
        label: "re-export target",
        subject: 'import { ready } from "./reexport.ts"; await ready();',
        before: [choices, reexport("cheap")],
        after: [choices, reexport("expensive")],
      },
      {
        label: "imported matrix",
        subject: `${IMPORT} import { cases } from "./cases.ts"; ` +
          `for (const entry of cases) { ${CALL} }`,
        before: [cases("1")],
        after: [cases("1, 2")],
      },
    ]
  ) {
    const source = { path: PATH, text: subject };
    for (const reverse of [false, true]) {
      const findings = testExecutionGrowth(
        [source, ...(reverse ? after : before)],
        [source, ...(reverse ? before : after)],
        new Set([PATH]),
      );
      assertEquals(
        findings.map(({ path }) => path),
        reverse ? [] : [PATH],
        label,
      );
    }
  }
});

Deno.test("test cost enrolls runtime fixture dependencies and reports the changed cause", () => {
  const fixturePath = "tests/fixtures/cases.ts";
  const fixture = (text: string): TestExecutionSource => ({
    path: fixturePath,
    text,
  });
  const source = {
    path: PATH,
    text: `${IMPORT}
import { cases } from "./fixtures/cases.ts";
for (const entry of cases) { ${CALL} }`,
  };
  const before = [source, fixture("export const cases = [1];")];
  const after = [source, fixture("export const cases = [1, 2];")];
  assertEquals(
    testExecutionGrowth(before, after, new Set([fixturePath])).map(({ path }) =>
      path
    ),
    [fixturePath],
  );
  assertEquals(testExecutionGrowth(after, before, new Set([fixturePath])), []);
  for (
    const text of [
      'import type { cases } from "./fixtures/cases.ts";',
      'const path = "./fixtures/cases.ts";',
    ]
  ) {
    const inert = { path: PATH, text };
    assertEquals(
      testExecutionGrowth(
        [inert],
        [inert, fixture("function {")],
        new Set([fixturePath]),
      ),
      [],
    );
  }
  for (
    const text of [
      'export { cases } from "./fixtures/cases.ts";',
      'await import("./fixtures/cases.ts");',
    ]
  ) {
    const runtime = { path: PATH, text };
    assertThrows(
      () =>
        testExecutionGrowth(
          [runtime],
          [runtime, fixture("function {")],
          new Set([fixturePath]),
        ),
      Error,
      "cannot parse",
    );
  }
});

Deno.test("incidental dependency edits do not inherit an independently changed caller's growth", () => {
  const helper = { path: "tests/helper.ts", text: "export const value = 1;" };
  const before = {
    path: PATH,
    text: `${IMPORT} import { value } from "./helper.ts"; ${CALL}`,
  };
  const after = { ...before, text: before.text + CALL };
  assertEquals(
    testExecutionGrowth([before, helper], [after, {
      ...helper,
      text: helper.text + " // explanation",
    }], new Set([PATH, helper.path])).map(({ path }) => path),
    [PATH],
  );
});

Deno.test("test cost rejects malformed sources outside the changed subjects", () => {
  const subject = { path: PATH, text: `${IMPORT} ${CALL}` };
  const malformed = { path: "tests/unrelated.ts", text: "function {" };
  for (const beforeMalformed of [false, true]) {
    assertThrows(
      () =>
        testExecutionGrowth(
          beforeMalformed ? [subject, malformed] : [subject],
          beforeMalformed ? [subject] : [subject, malformed],
          new Set([PATH]),
        ),
      Error,
      "cannot parse tests/unrelated.ts",
    );
  }
});

Deno.test("test cost leaves unrelated processes outside the boundary set and refuses malformed source", () => {
  assertEquals(selected("", 'new Deno.Command("git").output();'), false);
  assertThrows(() => selected("", "function {"), Error, "cannot parse");
});

Deno.test("test cost counts hand-rolled engine spawns through the invocation builders", () => {
  const fixture = {
    path: "tests/peer_fixture.ts",
    text: 'import { engineEnv, engineRunArgs } from "./engine_helpers.ts";\n' +
      "export async function openPeer(root: string) {\n" +
      "  return new Deno.Command(Deno.execPath(), {\n" +
      '    args: engineRunArgs(["mcp"]),\n' +
      "    cwd: root,\n" +
      "    env: await engineEnv(),\n" +
      "  }).spawn();\n" +
      "}\n",
  };
  const importPeer = 'import { openPeer } from "./peer_fixture.ts";';
  assertEquals(
    selected(
      importPeer,
      `${importPeer} async function test() { await openPeer(dir); }`,
      [fixture],
    ),
    true,
  );
  assertEquals(
    selected(
      'import { engineEnv } from "./engine_helpers.ts";',
      'import { engineEnv } from "./engine_helpers.ts";\n' +
        "async function test() { await engineEnv(); }",
    ),
    true,
  );
});

Deno.test("test cost host reads committed and dirty candidate bytes without running the fixture", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(`${dir}/tests/fixtures`, { recursive: true });
    const helperPath = "tests/fixtures/helper.ts";
    const helper = "export async function ready() {}";
    await Deno.writeTextFile(`${dir}/${helperPath}`, helper);
    await Deno.writeTextFile(`${dir}/${PATH}`, IMPORT);
    await gitInit(dir);
    const commit = await gitOut(dir, "rev-parse", "HEAD");
    const before = await committedExecutionSources(dir, commit);
    assertEquals(before, [{ path: PATH, text: IMPORT }, {
      path: helperPath,
      text: helper,
    }]);
    await Deno.writeTextFile(
      `${dir}/${PATH}`,
      `${IMPORT} async function example() { ${CALL} }`,
    );
    const input = {
      version: 1 as const,
      checkpoint: { id: TEST_EXECUTION_CHECKPOINT_ID, mode: "stop" as const },
      policy_commit: commit,
      changed_files: [{
        path: PATH,
        kind: "modified" as const,
        insertions: 1,
        deletions: 0,
        binary: false,
      }],
    };
    const state = await gitOut(dir, "status", "--porcelain");
    assertEquals(
      (await matchingExecutionChanges(dir, input)).map((finding) =>
        finding.path
      ),
      [PATH],
    );
    assertEquals(await gitOut(dir, "status", "--porcelain"), state);
    const fired = await runMatcher(dir, input);
    assertEquals(fired.code, 0, fired.stderr);
    assertEquals(fired.stdout.trim(), `DISCERN_MATCH ${PATH}`);
    await Deno.writeTextFile(`${dir}/${PATH}`, IMPORT);
    assertEquals((await runMatcher(dir, input)).code, 10);
    assertEquals((await runMatcher(dir, {})).code, 1);
    await Deno.writeTextFile(
      `${dir}/${PATH}`,
      'import { ready } from "./fixtures/helper.ts"; await ready();',
    );
    await Deno.writeTextFile(
      `${dir}/${helperPath}`,
      'import { runAgent } from "../engine_helpers.ts"; export async function ready() { await runAgent(dir, ["done"]); }',
    );
    assertEquals(
      (await matchingExecutionChanges(dir, {
        ...input,
        changed_files: [...input.changed_files, {
          ...input.changed_files[0],
          path: helperPath,
          kind: "modified",
          insertions: 1,
          deletions: 1,
          binary: false,
        }],
      })).map(({ path }) => path),
      [PATH, helperPath],
    );
    await Deno.remove(`${dir}/${PATH}`);
    assertEquals(
      await matchingExecutionChanges(dir, {
        ...input,
        changed_files: [{
          ...input.changed_files[0],
          path: PATH,
          kind: "deleted",
          insertions: 0,
          deletions: 1,
          binary: false,
        }],
      }),
      [],
    );
    await Deno.symlink("/etc/hosts", `${dir}/${PATH}`);
    await assertRejects(() => matchingExecutionChanges(dir, input));
    await assertRejects(
      () => committedExecutionSources(dir, "--help"),
      Error,
      "resolved commit",
    );
  });
});
