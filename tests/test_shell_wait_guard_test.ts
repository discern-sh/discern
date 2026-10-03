/**
 * Every elapsed shell wait requires a reviewed semantic purpose, every file
 * hold comes from the renderer that bounds it by its owner, and every content
 * poll limits its attempts.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { shellAwaitFile } from "./shell_hold.ts";
import {
  SHELL_FILE_HOLD_RENDERER,
  shellFileHoldFindings,
  shellFileHoldSites,
  shellHoldSources,
  shellWaitingFindings,
  shellWaitSites,
} from "./test_shell_wait_guard.ts";
import { TEST_SHELL_WAIT_BOUNDARIES } from "./test_shell_wait_boundaries.ts";
import { waitingSources } from "./test_waiting_guard.ts";
import { withTempDir } from "./temp_dir.ts";

Deno.test("shell waiting enrolls renamed commands, concatenations, embedded programs and new fixture trees", async () => {
  await withTempDir(async (root) => {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: root }).output();
    const command = ["sl", "eep"].join("");
    const sources = [
      [
        "tests/new-rig/foreign.ts",
        `const alias = "${command}"; new Deno.Command(alias, {args:["1"]});`,
      ],
      [
        "tests/future_test.ts",
        `const recipe = "sl" + "eep 0.5"; launch(recipe);`,
      ],
      ["components/orbit.test.ts", `const recipe = "${command} 0.5";`],
      ["extension/tests/foreign.ts", `const recipe = "${command} 0.7";`],
      ["tests/new-rig/child.sh", `#!/bin/sh\n/usr/bin/${command} 1\n`],
      [
        "tests/embedded_test.ts",
        `const program = \`[jobs]\nrun = 'printf ready; ${command} 0.2; printf done'\`;`,
      ],
      [
        "tests/presentation.ts",
        `const name = 'different rig'; const script = \`\${name}${command} 0.3\`;`,
      ],
    ] as const;
    for (const [path, source] of sources) {
      await Deno.mkdir(join(root, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, path), source);
    }
    const discovered = await waitingSources(root);
    assertEquals(shellWaitingFindings(discovered).length, sources.length);
    assertEquals(
      shellWaitSites(discovered).map((site) => site.path).sort(),
      sources.map(([path]) => path).sort(),
    );
  });
});

Deno.test("shell waiting rejects new copies, moved waits, changed arguments and stale enrollment", () => {
  const command = ["sl", "eep"].join("");
  const source = {
    path: "tests/arbitrary.ts",
    source: `function unrelated() { return "${command} 2"; }`,
  };
  const boundary = {
    path: source.path,
    enclosing: "unrelated",
    argument: "2",
    count: 1,
    classification: "elapsed-behavior" as const,
    reason: "The scenario exercises an actual watchdog interval.",
  };
  assertEquals(shellWaitingFindings([source], [boundary]), []);
  for (
    const sources of [
      [],
      [{
        ...source,
        source: source.source.replace(
          "return ",
          `const duplicate = "${command} 2"; return `,
        ),
      }],
      [{ ...source, path: "tests/new-rig/opaque.ts" }],
      [{ ...source, source: source.source.replace("2", "3") }],
    ]
  ) assert(shellWaitingFindings(sources, [boundary]).length > 0);
  assert(
    shellWaitingFindings([source], [boundary, boundary]).some((finding) =>
      finding.includes("repeat")
    ),
  );
  assert(
    shellWaitingFindings([source], [{ ...boundary, reason: "", count: 0 }])
      .some((finding) => finding.includes("specific reason")),
  );
  assertEquals(
    shellWaitSites([{
      path: "tests/comments.ts",
      source: `// ${command} 2 is an example\nconst inert = "asleep";`,
    }]),
    [],
  );
});

Deno.test("elapsed shell waits belong to the reviewed full-universe census", async () => {
  assertEquals(
    shellWaitingFindings(await waitingSources(), TEST_SHELL_WAIT_BOUNDARIES),
    [],
  );
});

Deno.test("a hand-written file poll fails wherever tests or repository tools write one", async () => {
  await withTempDir(async (root) => {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: root }).output();
    // Assembled at runtime, so this module's own text stays outside the census.
    const loop = ["wh", "ile"].join("");
    const until = ["un", "til"].join("");
    const pause = ["sl", "eep"].join("");
    const planted = [
      [
        "tests/future_test.ts",
        `const hold = 'printf ready > "$1"; ${loop} [ ! -e "$2" ]; do ${pause} 0.05; done';`,
        "existence",
      ],
      [
        "tests/new-rig/pause.sh",
        `#!/bin/sh\n${until} [ -f "$1/release" ]; do ${pause} 0.1; done\n`,
        "existence",
      ],
      [
        "tests/hook_test.ts",
        `const hook = ["${loop} ! test -f \\"$PWD/ready\\"; do", "  ${pause} 0.01", "done"];`,
        "existence",
      ],
      [
        "tests/lines_test.ts",
        `Deno.test("held", () => { run(["${loop} :; do", '  [ -e "$f" ] && break', "  ${pause} 0.05", "done"]); });`,
        "existence",
      ],
      [
        "components/orbit.test.ts",
        `const job = "${loop} :; do [ -s ready ] && break; ${pause} 1; done";`,
        "existence",
      ],
      [
        "scripts/capture.ts",
        `const step = '${until} [ -e "$SIGNALS/built" ]; do :; done';`,
        "existence",
      ],
      [
        "site/scripts/preview.ts",
        `const step = '${loop} [ ! -e built ]; do ${pause} 1; done';`,
        "existence",
      ],
      [
        "tests/pasted_test.ts",
        `const hold = ${JSON.stringify(shellAwaitFile('"$2"'))};`,
        "existence",
      ],
      [
        "tests/content_test.ts",
        `const job = '${until} grep -q go "$f"; do ${pause} 0.05; done';`,
        "content",
      ],
      [
        "tests/substituted_test.ts",
        `const job = '${until} [ "$(cat "$f")" = go ]; do :; done';`,
        "content",
      ],
      [
        "scripts/tools/await_log.ts",
        `function awaitLog() { return ["${loop} :; do", 'grep -q ready "$log" && break', "${pause} 0.1", "done"]; }`,
        "content",
      ],
    ] as const;
    const exempt = [
      ["tests/caller_test.ts", `const hold = shellAwaitFile('"$2"');`],
      [
        "src/engine/shipped.ts",
        `const step = '${loop} [ ! -e "$1" ]; do ${pause} 1; done';`,
      ],
      [
        "tests/handshake_test.ts",
        `const job = 'i=0; ${loop} ! grep -q go "$f"; do i=$((i+1)); [ "$i" -gt 200 ] && exit 1; ${pause} 0.1; done';`,
      ],
      [
        "tests/unrelated_test.ts",
        `Deno.test("reads", () => { run('grep -q ok "$log"'); run("${pause} 1"); });`,
      ],
    ] as const;
    for (const [path, source] of [...planted, ...exempt]) {
      await Deno.mkdir(join(root, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, path), source);
    }
    const sources = await shellHoldSources(root);
    assertEquals(
      shellFileHoldSites(sources).map(({ path, polls }) => [path, polls])
        .sort(),
      planted.map(([path, , polls]) => [path, polls]).sort(),
    );
    const findings = shellFileHoldFindings(sources);
    assertEquals(
      findings.map((finding) => finding.slice(0, finding.indexOf(":"))),
      planted.map(([path]) => path).sort(),
    );
    for (const [path, , polls] of planted) {
      const finding = findings.find((line) => line.startsWith(`${path}:`));
      assertStringIncludes(
        finding ?? "",
        polls === "content" ? "no attempt limit" : "hand-written shell loop",
      );
      assertStringIncludes(finding ?? "", SHELL_FILE_HOLD_RENDERER.enclosing);
      assertStringIncludes(finding ?? "", SHELL_FILE_HOLD_RENDERER.path);
    }
  });
});

Deno.test("every file hold in tests and repository tools comes from the owner-bounded renderer", async () => {
  const sources = await shellHoldSources();
  assertEquals(shellFileHoldFindings(sources), []);
  assertEquals(
    shellFileHoldSites(sources).map(({ path, enclosing }) => ({
      path,
      enclosing,
    })),
    [SHELL_FILE_HOLD_RENDERER],
    "the renderer's own poll must stay recognizable, or its exemption guards nothing",
  );
});
