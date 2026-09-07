/** Every elapsed shell wait requires a reviewed semantic purpose. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
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
