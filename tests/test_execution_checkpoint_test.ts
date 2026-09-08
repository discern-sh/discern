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

Deno.test("test cost selection distinguishes extra execution from incidental edits", () => {
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
      ["format", `${IMPORT}\nasync function example() {\n${CALL}\n}`, false],
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
});

Deno.test("test cost follows fixture wrappers, namespace imports, and re-exports", () => {
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
      ['import { fixture as prepare } from "./reexport.ts";', "prepare()"],
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
});

Deno.test("test cost detects local matrix expansion and ignores changed case values", () => {
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
    selected("", "for (const entry of [1,2]) { assertEquals(entry, entry); }"),
    false,
  );
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
    await Deno.mkdir(`${dir}/tests`);
    await Deno.writeTextFile(`${dir}/${PATH}`, IMPORT);
    await gitInit(dir);
    const commit = await gitOut(dir, "rev-parse", "HEAD");
    const before = await committedExecutionSources(dir, commit);
    assertEquals(before, [{ path: PATH, text: IMPORT }]);
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
