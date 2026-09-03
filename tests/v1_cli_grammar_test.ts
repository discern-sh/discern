/** The settled v1 command grammar, derived from the live Cliffy/result models. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { KIT_VERSION } from "../src/lib/version.ts";
import { buildCli } from "../src/main.ts";
import {
  type CliCommand,
  cliCommandModel,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import { CLI_JSON_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import { CLI_JSON_DESCRIPTION_OVERRIDES } from "../src/shared/result_formats.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";

/** Build the one live command model used by help, suggestions, and generation. */
function liveModel(): CliCommand {
  return cliCommandModel(buildCli(true, "main"));
}

/** Resolve one canonical command path from the live model. */
function commandAt(model: CliCommand, path: string): CliCommand {
  const command = [...walkCliCommands(model)].find((entry) =>
    entry.path.join(" ") === path
  );
  assert(command !== undefined, `missing live command: ${path}`);
  return command;
}

/** The exact published command paths, projected from result contracts. */
function contractedPaths(): Set<string> {
  return new Set(
    CLI_JSON_RESULT_CONTRACTS.flatMap((contract) => [...contract.commands]),
  );
}

Deno.test("the live command and result models expose only the settled v1 names", () => {
  const paths = new Set(
    [...walkCliCommands(liveModel())].map((command) => command.path.join(" ")),
  );
  const contracts = contractedPaths();

  for (
    const retained of [
      "setup",
      "setup begin",
      "enter",
      "worktree",
      "triangle",
      "patterns seal",
      "patterns archives",
      "worktree ensure",
    ]
  ) {
    assert(paths.has(retained), `live model lost ${retained}`);
  }
  for (
    const retired of [
      "preset",
      "worktrees",
      "patterns archive",
      "remove-worktree-safely",
      "inherit-main-env-vars",
      "with-gotchas",
      "init",
      "install",
    ]
  ) {
    assert(!paths.has(retired), `retired command re-entered: ${retired}`);
    assert(
      !contracts.has(retired),
      `retired result contract re-entered: ${retired}`,
    );
  }

  assert(contracts.has("help"));
  assert(contracts.has("worktree ensure"));
  assert(!contracts.has("worktree hook create"));
  assert(!contracts.has("worktree hook remove"));
});

Deno.test("setup is read-only and setup begin exclusively owns scaffold options", () => {
  const model = liveModel();
  const setup = commandAt(model, "setup");
  const begin = commandAt(model, "setup begin");
  const localFlags = (command: CliCommand): string[] =>
    command.options.filter((option) => !option.global).flatMap((option) =>
      option.flags
    );

  assertEquals(localFlags(setup), []);
  const beginFlags = new Set(localFlags(begin));
  for (
    const flag of [
      "--slug",
      "--config",
      "--dry-run",
      "--force",
      "--allow-dirty",
      "--confirmed",
    ]
  ) {
    assert(beginFlags.has(flag), `setup begin does not own ${flag}`);
  }
  assert(!beginFlags.has("--yes"), "the private setup --yes input returned");
});

Deno.test("every command describes itself and local JSON overrides equal their registry", () => {
  const commands = [...walkCliCommands(liveModel())];
  assertEquals(
    commands.filter((command) =>
      command.path.length > 0 && command.description.trim() === ""
    ).map((command) => command.path.join(" ")),
    [],
  );

  const observed = commands.flatMap((command) =>
    command.options
      .filter((option) => !option.global && option.flags.includes("--json"))
      .map((option) => [command.path.join(" "), option.description] as const)
  ).sort(([left], [right]) => left.localeCompare(right));
  const expected = Object.entries(CLI_JSON_DESCRIPTION_OVERRIDES)
    .sort(([left], [right]) => left.localeCompare(right));
  assertEquals(observed, expected);
});

Deno.test("nested help has one typed result in every JSON flag position", async () => {
  await withTempDir(async (dir) => {
    const invocations = [
      ["--json", "help", "worktree", "ensure"],
      ["help", "--json", "worktree", "ensure"],
      ["help", "worktree", "--json", "ensure"],
      ["help", "worktree", "ensure", "--json"],
    ];
    let expectedCommand: unknown;
    for (const args of invocations) {
      const result = await runCli(args, dir);
      assertEquals(result.code, 0, result.stdout + result.stderr);
      assertEquals(result.stderr, "");
      const envelope = decodeCliResult(result.stdout, "help");
      assertEquals(envelope.ok, true);
      assert(
        envelope.data !== undefined && "command" in envelope.data,
        "help result must carry data.command",
      );
      assertEquals(envelope.data.command.path, ["worktree", "ensure"]);
      if (expectedCommand === undefined) {
        expectedCommand = envelope.data.command;
      } else {
        assertEquals(envelope.data.command, expectedCommand);
      }
    }

    const human = await runCli(["help", "worktree", "ensure"], dir);
    assertEquals(human.code, 0, human.stdout + human.stderr);
    assertTerminalTextIncludes(human.stdout, "discern worktree ensure");
  });
});

Deno.test("version, usage, option ownership, and the top-level boundary use canonical exits", async () => {
  await withTempDir(async (dir) => {
    for (const flag of ["-V", "--version"]) {
      const version = await runCli([flag], dir);
      assertEquals(version.code, 0);
      assertEquals(version.stdout, `discern ${KIT_VERSION}\n`);
      assertEquals(version.stderr, "");
    }

    const bare = await runCli(["--json"], dir);
    assertEquals(bare.code, 2);
    assertEquals(
      decodeCliResult(bare.stdout, "discern").error,
      "invalid_arguments",
    );

    const boundary = await runCli(["--", "--json"], dir);
    assertEquals(boundary.code, 2);
    assertTerminalTextIncludes(
      decodeCliResult(boundary.stdout, "discern").message ?? "",
      "only valid after `discern queue`",
    );

    const parentOption = await runCli(
      ["setup", "--slug", "retired-owner", "--json"],
      dir,
    );
    assertEquals(parentOption.code, 2);
    const refusal = decodeCliResult(parentOption.stdout, "setup");
    assertEquals(refusal.error, "invalid_arguments");
    assertStringIncludes(refusal.message ?? "", "setup begin --help");

    const begin = await runCli(
      [
        "setup",
        "begin",
        "--slug",
        "v1-contract",
        "--confirmed",
        "--dry-run",
        "--json",
      ],
      dir,
    );
    assertEquals(begin.code, 0, begin.stdout + begin.stderr);
    const beginResult = decodeCliResult(begin.stdout, "setup begin");
    assertEquals(beginResult.verb, "setup begin");
    assertEquals(beginResult.dry_run, true);
  });
});

Deno.test("retired commands receive no alias while generic suggestions use the live model", async () => {
  await withTempDir(async (dir) => {
    for (
      const retired of [
        "preset",
        "worktrees",
        "remove-worktree-safely",
        "inherit-main-env-vars",
        "with-gotchas",
      ]
    ) {
      const result = await runCli([retired, "--json"], dir);
      assertEquals(result.code, 1, result.stdout + result.stderr);
      const envelope = decodeCliResult(result.stdout, "discern");
      assertEquals(envelope.error, "unknown_command");
    }

    const oldAction = await runCli(
      ["patterns", "archive", "--dry-run", "--json"],
      dir,
    );
    assertEquals(oldAction.code, 2, oldAction.stdout + oldAction.stderr);
    assertEquals(
      decodeCliResult(oldAction.stdout, "patterns").error,
      "invalid_arguments",
    );

    const suggestions = [
      { args: ["doctr"], expected: "discern doctor" },
      { args: ["worktree-drop"], expected: "discern worktree drop" },
      { args: ["wortree", "park"], expected: "discern worktree park" },
      { args: ["init"], expected: "discern setup" },
      { args: ["install"], expected: "discern setup" },
    ];
    for (const { args, expected } of suggestions) {
      const result = await runCli([...args, "--json"], dir);
      const envelope = decodeCliResult(result.stdout, "discern");
      assertStringIncludes(envelope.hints?.join("\n") ?? "", expected);
    }
    const tiny = decodeCliResult(
      (await runCli(["a", "--json"], dir)).stdout,
      "discern",
    );
    assertEquals(
      tiny.hints?.some((hint) => hint.startsWith("Did you mean")),
      false,
    );
  });
});

Deno.test("worktree ensure is a pure registered JSON result and triangle remains live", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const ensure = await runAgent(dir, ["worktree", "ensure", "--json"]);
    assertEquals(ensure.code, 0, ensure.output);
    const ensured = decodeCliResult(ensure.stdout, "worktree ensure");
    assertEquals(ensured.ok, true);
    assertEquals(ensured.data, undefined);

    const triangle = await runAgent(dir, ["triangle", "--json"]);
    assertEquals(triangle.code, 0, triangle.output);
    const triangleResult = decodeCliResult(triangle.stdout, "triangle");
    assertEquals(triangleResult.ok, true);
    assert(triangleResult.data !== undefined);
  });
});

Deno.test("config get distinguishes a missing value from an empty value", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const result = await runAgent(dir, [
      "config",
      "get",
      "zz.missing",
      "--json",
    ]);
    assertEquals(result.code, 1, result.output);
    const envelope = decodeCliResult(result.stdout, "config");
    assertEquals(envelope.error, "unknown_key");
    assertStringIncludes(envelope.message ?? "", "discern config has");
  });
});

Deno.test("MCP transport timeout flags are visible in the live help model", () => {
  const mcp = commandAt(liveModel(), "mcp");
  const flags = new Set(mcp.options.flatMap((option) => option.flags));
  assert(flags.has("--strict-tool-calls"));
  assert(flags.has("--long-tool-calls"));
});
