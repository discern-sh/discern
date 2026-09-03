/**
 * Flag-first routing parity — the guard for the class of defect where a
 * pre-Cliffy routing decision in `main()` keys on `argv[0]` while Cliffy
 * itself accepts the global flags BEFORE the subcommand. Any such decision
 * must key on the RESOLVED verb (the first non-global-flag token), or a
 * leading result-format or `--no-color` flag smuggles the invocation past the router:
 * the ADR 0036 setup redirect, the operator help, the root JSON refusal,
 * and project script dispatch all diverge.
 *
 * The matrices derive from the single sources of truth so a new member
 * auto-enrols: global flag names and value arity come from the Cliffy
 * registration, and gated verbs come from `SETUP_GATED_VERBS`. The arity test
 * holds the early router to the boolean-or-one-required-value grammar it
 * implements.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { Command } from "@cliffy/command";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine, writeExecutable } from "./engine_helpers.ts";
import {
  backgroundSensingRequested,
  buildCli,
  CLI_CHILD_BOUNDARIES,
  discernOwnedArgv,
  globalFlagTokens,
  globalValueFlagTokens,
  resolveInvocation,
  ROOT_GLOBAL_FLAG_TOKENS,
  ROOT_GLOBAL_FLAGS,
  ROOT_GLOBAL_VALUE_FLAG_TOKENS,
} from "../src/main.ts";
import { SETUP_GATED_VERBS } from "../src/shared/setup_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  CLI_RESULT_FORMATS,
  CLI_RESULT_RENDER,
} from "../src/shared/result_formats.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

/** Every global flag token, straight from the Cliffy registration. */
const GLOBAL_FLAGS: readonly string[] = [
  ...globalFlagTokens(buildCli(false) as unknown as Command),
].sort();
const GLOBAL_VALUE_FLAGS: readonly string[] = [
  ...globalValueFlagTokens(buildCli(false) as unknown as Command),
].sort();
const GLOBAL_VALUE_SAMPLES: Readonly<Record<string, string>> = {
  [ROOT_GLOBAL_FLAGS.theme]: "dark",
};
const GLOBAL_FLAG_FORMS: readonly {
  readonly flag: string;
  readonly tokens: readonly string[];
}[] = GLOBAL_FLAGS.map((flag) => ({
  flag,
  tokens: GLOBAL_VALUE_FLAGS.includes(flag)
    ? [flag, GLOBAL_VALUE_SAMPLES[flag] ?? ""]
    : [flag],
}));

Deno.test("the global-flag registration includes both explicit result formats", () => {
  // The matrices below iterate this set — an empty derivation would make
  // every flag-first case silently vacuous.
  assert(GLOBAL_FLAGS.length > 0, "no global flags derived from the root");
  assert(GLOBAL_FLAGS.includes("--json"), GLOBAL_FLAGS.join(", "));
  assert(GLOBAL_FLAGS.includes("--markdown"), GLOBAL_FLAGS.join(", "));
  assert(GLOBAL_FLAGS.includes("--render"), GLOBAL_FLAGS.join(", "));
  assert(!GLOBAL_FLAGS.includes("--md"), GLOBAL_FLAGS.join(", "));
  assertEquals([...ROOT_GLOBAL_FLAG_TOKENS].sort(), GLOBAL_FLAGS);
  assertEquals(
    [...ROOT_GLOBAL_VALUE_FLAG_TOKENS].sort(),
    GLOBAL_VALUE_FLAGS,
  );
  assertEquals(Object.keys(GLOBAL_VALUE_SAMPLES).sort(), GLOBAL_VALUE_FLAGS);
});

Deno.test("result-format help names representations without assigning audiences", () => {
  const options = (buildCli(false) as unknown as Command).getOptions(true);
  for (const format of Object.values(CLI_RESULT_FORMATS)) {
    const option = options.find((candidate) =>
      candidate.flags.includes(format.flag)
    );
    assert(option !== undefined, `missing ${format.flag}`);
    assertEquals(option.description, format.description);
    assert(
      !/\b(?:agent|human|machine)[- ](?:readable|output)\b/i.test(
        option.description,
      ),
      `${format.flag} assigns its format to an audience: ${option.description}`,
    );
  }
});

Deno.test("render is a secondary terminal convenience, outside the result-format set", () => {
  assertEquals(Object.keys(CLI_RESULT_FORMATS), ["json", "markdown"]);
  const options = (buildCli(false) as unknown as Command).getOptions(true);
  const option = options.find((candidate) =>
    candidate.flags.includes(CLI_RESULT_RENDER.flag)
  );
  assert(option !== undefined, `missing ${CLI_RESULT_RENDER.flag}`);
  assertEquals(option.description, CLI_RESULT_RENDER.description);
});

Deno.test("raw child boundaries exclude every global-looking child flag", () => {
  for (const [verb, boundary] of Object.entries(CLI_CHILD_BOUNDARIES)) {
    for (const form of GLOBAL_FLAG_FORMS) {
      const argv = boundary.kind === "delimiter"
        ? [...form.tokens, verb, boundary.token, "fresh-relay", ...form.tokens]
        : [...form.tokens, verb, "fresh-relay", ...form.tokens];
      const expected = boundary.kind === "delimiter"
        ? [...form.tokens, verb]
        : [...form.tokens, verb, "fresh-relay"];
      assertEquals(
        discernOwnedArgv(
          argv,
          ROOT_GLOBAL_FLAG_TOKENS,
          ROOT_GLOBAL_VALUE_FLAG_TOKENS,
        ),
        expected,
        `${verb} let child flag ${form.flag} select a discern global mode`,
      );
    }
  }
});

Deno.test("global option arity stays within the early router's supported grammar", () => {
  const root = buildCli(false) as unknown as Command;
  for (const option of root.getOptions(true)) {
    if (option.global !== true) {
      continue;
    }
    assert(
      option.args.length <= 1,
      `global flag ${option.flags.join("/")} takes more than one value`,
    );
    const argument = option.args[0];
    if (argument === undefined) continue;
    assertEquals(argument.optional, false);
    assertEquals(argument.variadic, false);
    assertEquals(argument.list, false);
  }
});

Deno.test("resolveInvocation finds the verb past any run of global flags", () => {
  const tokens = globalFlagTokens(buildCli(false) as unknown as Command);
  const valueTokens = globalValueFlagTokens(
    buildCli(false) as unknown as Command,
  );
  // Verb-first: the plain path stays the plain path.
  assertEquals(resolveInvocation(["map", "--json"], tokens), {
    verb: "map",
    argsWithoutVerb: ["--json"],
  });
  // Each single global flag placed first.
  for (const form of GLOBAL_FLAG_FORMS) {
    assertEquals(
      resolveInvocation(
        [...form.tokens, "map", "x"],
        tokens,
        valueTokens,
      ),
      {
        verb: "map",
        argsWithoutVerb: [...form.tokens, "x"],
      },
    );
  }
  // Every global flag stacked before the verb.
  const stacked = GLOBAL_FLAG_FORMS.flatMap((form) => form.tokens);
  assertEquals(
    resolveInvocation([...stacked, "map"], tokens, valueTokens).verb,
    "map",
  );
  // Flags only: no verb at all (routes like bare `discern`).
  assertEquals(resolveInvocation([...stacked], tokens, valueTokens), {
    verb: undefined,
    argsWithoutVerb: [...stacked],
  });
  assertEquals(
    resolveInvocation(["--theme=light", "map"], tokens, valueTokens),
    { verb: "map", argsWithoutVerb: ["--theme=light"] },
  );
  assertEquals(resolveInvocation([], tokens).verb, undefined);
  // An UNKNOWN leading flag is not skipped — Cliffy owns that error.
  assertEquals(resolveInvocation(["--bogus", "map"], tokens).verb, "--bogus");
});

Deno.test("pre-setup: the redirect fires for every global flag before every gated verb", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    for (const form of GLOBAL_FLAG_FORMS) {
      for (const verb of SETUP_GATED_VERBS) {
        const args = [...form.tokens, verb];
        const markdown = args.includes("--markdown");
        const render = args.includes("--render");
        if (!args.includes("--json") && !markdown && !render) {
          args.push("--json");
        }
        const r = await runAgent(dir, args);
        const label = `discern ${args.join(" ")}`;
        assertEquals(r.code, 1, `${label}: ${r.output}`);
        if (markdown) {
          assertTerminalTextIncludes(r.stdout, `# \`discern ${verb}\``);
          assertTerminalTextIncludes(r.stdout, "## Current state");
          assertTerminalTextIncludes(r.stdout, "isn't set up");
          continue;
        }
        if (render) {
          assertTerminalTextIncludes(r.stdout, `discern ${verb}`);
          assertTerminalTextIncludes(r.stdout, "Current state");
          assertTerminalTextIncludes(r.stdout, "isn't set up");
          assert(!r.stdout.trimStart().startsWith("{"), r.stdout);
          continue;
        }
        const res = decodeCliResult(r.stdout, verb);
        assertEquals(
          res.error,
          "not_set_up",
          `${label} must hard-redirect to setup (ADR 0036): ${r.output}`,
        );
        assertEquals(res.verb, verb, label);
      }
    }
  });
});

Deno.test("pre-setup: a flags-only JSON invocation returns the root refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["--json"]);
    assertEquals(r.code, 2, r.output);
    const res = decodeCliResult(r.stdout, "discern");
    assertEquals(res.ok, false, r.output);
    assertEquals(res.verb, "discern", r.output);
    assertEquals(res.error, "invalid_arguments", r.output);
    assertHasHint(res, HINTS["failure-recovery"], { verb: "discern" });
  });
});

Deno.test("pre-setup: a flags-only Markdown invocation returns the same root refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["--markdown"]);
    assertEquals(r.code, 2, r.output);
    assertTerminalTextIncludes(r.stdout, "# `discern`");
    assertTerminalTextIncludes(r.stdout, "discern --markdown needs a command");
    assertTerminalTextIncludes(r.stdout, "## Next action");
  });
});

Deno.test("pre-setup: a flags-only render invocation returns a terminal refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["--render"]);
    assertEquals(r.code, 2, r.output);
    assertTerminalTextIncludes(r.stdout, "discern");
    assertTerminalTextIncludes(r.stdout, "discern --render needs a command");
    assertTerminalTextIncludes(r.stdout, "Next action");
    assert(!r.stdout.trimStart().startsWith("{"), r.stdout);
  });
});

Deno.test("result output modes are mutually exclusive", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    for (
      const flags of [
        ["--json", "--markdown"],
        ["--json", "--render"],
        ["--markdown", "--render"],
      ]
    ) {
      const r = await runAgent(dir, ["status", ...flags]);
      assertEquals(r.code, 1, `${flags.join(" ")}: ${r.output}`);
      if (flags.includes("--json")) {
        const result = decodeCliResult(r.stdout, "discern");
        assertEquals(result.error, "invalid_arguments");
        assert(result.message !== undefined);
        assertStringIncludes(result.message, "cannot be combined");
      } else {
        assertTerminalTextIncludes(r.stdout, "cannot be combined");
      }
    }
  });
});

Deno.test("--md is not an alias for --markdown", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const result = await runAgent(dir, ["status", "--md"]);
    assertEquals(result.code, 2, result.output);
    assertTerminalTextIncludes(result.output, 'Unknown option "--md"');
  });
});

Deno.test("--theme is a documented value-taking global with an auto default", () => {
  const root = buildCli(false) as unknown as Command;
  const option = root.getOptions(true).find((candidate) =>
    candidate.flags.includes(ROOT_GLOBAL_FLAGS.theme)
  );
  assert(option !== undefined);
  assertEquals(option.typeDefinition, "<theme:string>");
  assertStringIncludes(option.description, "Default: `auto`");
  assertStringIncludes(option.description, "`--no-color` and `NO_COLOR`");
  assertStringIncludes(option.description, "skip sensing");
});

Deno.test("background sensing is limited to auto-themed human terminal modes", () => {
  for (
    const argv of [
      ["status", "--json"],
      ["--markdown", "status"],
      ["mcp"],
      ["--theme", "auto", "mcp"],
      ["status", "--theme", "light"],
      ["--theme=dark", "status"],
      ["status", "--theme", "sepia"],
      ["status", "--theme"],
      ["--no-color", "status"],
    ]
  ) {
    assertEquals(backgroundSensingRequested(argv), false, argv.join(" "));
  }
  for (
    const argv of [
      ["status"],
      ["status", "--plain"],
      ["status", "--render"],
      ["--theme", "auto", "status"],
      ["status", "--theme=auto"],
    ]
  ) {
    assertEquals(backgroundSensingRequested(argv), true, argv.join(" "));
  }
});

Deno.test("theme modes leave a quiet config projection byte-identical", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = ["config", "get", "meta.schema_version", "--json"];
    const baseline = await runAgent(dir, command);
    assertEquals(baseline.code, 0, baseline.output);
    for (const mode of ["auto", "light", "dark"] as const) {
      const themed = await runAgent(dir, ["--theme", mode, ...command]);
      assertEquals(themed.code, 0, themed.output);
      assertEquals(themed.stdout, baseline.stdout, mode);
      assert(!themed.output.includes("\x1b]11;?"), themed.output);
    }
    const equalsForm = await runAgent(dir, ["--theme=light", ...command]);
    assertEquals(equalsForm.code, 0, equalsForm.output);
    assertEquals(equalsForm.stdout, baseline.stdout);
  });
});

Deno.test("an unsupported theme value uses the selected result-format refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const result = await runAgent(dir, [
      "status",
      "--theme",
      "sepia",
      "--json",
    ]);
    assertEquals(result.code, 2, result.output);
    const parsed = decodeCliResult(result.stdout, "status");
    assertEquals(parsed.error, "invalid_arguments");
    assert(parsed.message !== undefined);
    assertStringIncludes(parsed.message, "--theme accepts");
  });
});

Deno.test("flag-first --help renders the operator help with the scripts command", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["--no-color", "--help"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "scripts");
  });
});

Deno.test("flag-first --markdown selects the authored result projection", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["--markdown", "status"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "# `discern status`");
    assertTerminalTextIncludes(r.stdout, "## Current state");
    assert(!r.stdout.trimStart().startsWith("{"), r.stdout);
  });
});

Deno.test("flag-first --render selects the terminal-rendered Markdown result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["--render", "status"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "discern status");
    assertTerminalTextIncludes(r.stdout, "Current state");
    assert(!r.stdout.trimStart().startsWith("{"), r.stdout);
  });
});

Deno.test("a project script dispatches with a global flag placed first", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho HELLO-FROM-PROJECT\n",
    );
    const r = await runAgent(dir, ["--no-color", "scripts", "hello"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "HELLO-FROM-PROJECT");
  });
});

Deno.test("a Project Script owns child result-looking flags", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/relay"),
      "#!/usr/bin/env sh\nprintf '%s\\n' \"$1\"\n",
    );
    for (const flag of ["--markdown", "--render"]) {
      const r = await runAgent(dir, ["scripts", "relay", flag]);
      assertEquals(r.code, 0, r.output);
      assertEquals(r.stdout, `${flag}\n`);
    }
  });
});
