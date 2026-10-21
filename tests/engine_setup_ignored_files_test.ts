/**
 * Setup in a project whose own ignore rules exclude the folders discern
 * writes tracked integration files into — the shape many editor and tool
 * `.gitignore` templates take. The preflight serves one owner decision,
 * `begin` applies each answer without a failed machinery commit and refuses
 * before any write without one, and `doctor` reports the outcome.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { trackedSharedProviderPaths } from "../src/lib/artifact_ownership.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import { describeIgnoredFiles } from "../src/shared/ignored_integration.ts";
import { discernCommand, flag } from "../src/shared/command_reference.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut, runAgent, type RunResult } from "./engine_helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

type SetupBeginData = Exclude<
  NonNullable<CliResultForCommand<"setup begin">["data"]>,
  { issues: unknown }
>;

/** The provider folder one agent's integration files live under. */
const AGENT = "codex";
const AGENT_PATHS = trackedSharedProviderPaths([AGENT]);

/** A rule that excludes `path` the way a tool-folder template would. */
function excludingRule(path: string): string {
  const [top = path] = path.split("/");
  return path.includes("/") ? `${top}/` : path;
}

/** The fixture's ignore rules: an unrelated one, then every provider folder. */
const RULES = [
  "/build-output/",
  ...new Set(
    AGENT_NAMES.flatMap((agent) =>
      trackedSharedProviderPaths([agent]).map(excludingRule)
    ),
  ),
];

/** A committed project whose `.gitignore` excludes every provider folder. */
async function projectIgnoringToolFolders(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# Fixture\n");
  await Deno.writeTextFile(join(dir, ".gitignore"), `${RULES.join("\n")}\n`);
  await gitInit(dir);
}

/** The fixture rule excluding `path`, as Git reports it. */
function fixtureRule(path: string): string {
  const rule = excludingRule(path);
  return `.gitignore:${RULES.indexOf(rule) + 1}: ${rule}`;
}

/** Run `setup begin` for the one fixture agent with the given extra flags. */
async function begin(dir: string, ...extra: string[]): Promise<RunResult> {
  return await runAgent(dir, [
    "setup",
    "begin",
    "--name",
    "Fixture",
    "--agents",
    AGENT,
    "--model",
    "unreported",
    "--confirmed",
    "--json",
    ...extra,
  ]);
}

/** Decode setup-begin effect accounting, excluding configuration refusals. */
function beginData(stdout: string): SetupBeginData {
  const result = decodeCliResult(stdout, "setup begin");
  assertResultDataKey(result, "next_action");
  return result.data;
}

/** The integration paths Git tracks in `dir`. */
async function trackedAgentPaths(dir: string): Promise<string[]> {
  return (await gitOut(dir, "ls-files", "-z", "--", ...AGENT_PATHS))
    .split("\0").filter((path) => path !== "");
}

Deno.test("verify serves the ignored-files decision for every excluded integration file", async () => {
  await withTempDir(async (dir) => {
    await projectIgnoringToolFolders(dir);
    const result = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(result, "phase");
    const data = result.data;
    assert(data.findings !== undefined);
    const expected = trackedSharedProviderPaths(data.findings.agents_effective);
    assert(
      expected.length > 0,
      "precondition: the effective agents write files",
    );
    assertEquals(
      (data.findings.ignored_integration_files ?? []).map((file) => file.path),
      expected,
    );
    const conflict = data.conflicts?.find((c) =>
      c.kind === "ignored_integration_files"
    );
    assert(conflict !== undefined, JSON.stringify(data.conflicts));
    assertStringIncludes(data.instructions ?? "", "commit just those files");
    assertStringIncludes(
      data.next_action,
      "--ignored-integration-files track-anyway",
    );
    assertStringIncludes(
      data.instructions ?? "",
      "--ignored-integration-files keep-local",
    );
  });
});

Deno.test("verify asks nothing when no ignore rule matches an integration file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "/build-output/\n");
    await gitInit(dir);
    const result = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(result, "phase");
    assertEquals(result.data.findings?.ignored_integration_files, []);
    assert(!result.data.next_action.includes("--ignored-integration-files"));
  });
});

Deno.test("begin without the owner's choice refuses before writing anything", async () => {
  await withTempDir(async (dir) => {
    await projectIgnoringToolFolders(dir);
    const run = await begin(dir);
    assertEquals(run.code, 1, run.output);
    const result = decodeCliResult(run.stdout, "setup begin");
    assertEquals(result.error, "awaiting_decision");
    for (const path of AGENT_PATHS) {
      assertStringIncludes(result.message ?? "", path);
    }
    assertHasHint(result, HINTS["setup-awaiting-ignored-files-choice"], {
      files: describeIgnoredFiles(
        AGENT_PATHS.map((path) => ({ path, rule: fixtureRule(path) })),
      ),
      track: discernCommand(
        "setup begin",
        flag("ignored-integration-files", "track-anyway"),
      ),
      keepLocal: discernCommand(
        "setup begin",
        flag("ignored-integration-files", "keep-local"),
      ),
    });
    assertEquals(await gitOut(dir, "status", "--porcelain", "-z"), "");
    assertEquals(
      (await gitOut(dir, "branch", "--show-current")).trim(),
      "main",
    );
    assertEquals(await targetExists(join(dir, "discern.toml")), false);
  });
});

Deno.test("begin rejects an unknown ignored-files choice before writing anything", async () => {
  await withTempDir(async (dir) => {
    await projectIgnoringToolFolders(dir);
    const run = await begin(dir, "--ignored-integration-files", "change-rule");
    assertEquals(run.code, 1, run.output);
    assertEquals(
      decodeCliResult(run.stdout, "setup begin").error,
      "invalid_arguments",
    );
    assertEquals(await targetExists(join(dir, "discern.toml")), false);
  });
});

Deno.test("begin with track-anyway commits the excluded integration files", async () => {
  await withTempDir(async (dir) => {
    await projectIgnoringToolFolders(dir);
    const run = await begin(dir, "--ignored-integration-files", "track-anyway");
    assertEquals(run.code, 0, run.output);
    const data = beginData(run.stdout);
    assertEquals(data.machinery_committed, true, JSON.stringify(data));
    assertEquals(data.ignored_integration_files, {
      choice: "track-anyway",
      paths: AGENT_PATHS,
    });
    assertEquals(
      (await trackedAgentPaths(dir)).sort(),
      [...AGENT_PATHS].sort(),
    );
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertEquals(parseConfigOrThrow(toml).project.local_integration_files, []);
  });
});

Deno.test("begin with keep-local commits the wiring without them and records the choice for doctor", async () => {
  await withTempDir(async (dir) => {
    await projectIgnoringToolFolders(dir);
    const run = await begin(dir, "--ignored-integration-files", "keep-local");
    assertEquals(run.code, 0, run.output);
    const data = beginData(run.stdout);
    assertEquals(data.machinery_committed, true, JSON.stringify(data));
    assertEquals(data.ignored_integration_files?.choice, "keep-local");
    assertEquals(await trackedAgentPaths(dir), []);
    for (const path of AGENT_PATHS) {
      assert(await targetExists(join(dir, path)), `${path} stays on disk`);
    }
    const committed = parseConfigOrThrow(
      await gitOut(dir, "show", "HEAD:discern.toml"),
    );
    assertEquals(committed.project.local_integration_files, AGENT_PATHS);

    const doctor = decodeCliResult(
      (await runAgent(dir, ["doctor", "--json"])).stdout,
      "doctor",
    );
    assertResultDataKey(doctor, "checks");
    const check = doctor.data.checks.find((c) =>
      c.name === "integration files"
    );
    assertEquals(check?.status, "ok", JSON.stringify(check));
    assertStringIncludes(check?.detail ?? "", "kept out of Git");
  });
});
