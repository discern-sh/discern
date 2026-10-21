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

Deno.test("verify serves the decision, begin refuses without a valid choice, then track-anyway commits the files", async () => {
  await withTempDir(async (dir) => {
    await projectIgnoringToolFolders(dir);
    const head = await gitOut(dir, "rev-parse", "HEAD");
    /** Assert a refusal consumed nothing: same commit, branch, and clean tree. */
    const assertUntouched = async (): Promise<void> => {
      assertEquals(await gitOut(dir, "rev-parse", "HEAD"), head);
      assertEquals(
        (await gitOut(dir, "branch", "--show-current")).trim(),
        "main",
      );
      assertEquals(await gitOut(dir, "status", "--porcelain", "-z"), "");
      assertEquals(await targetExists(join(dir, "discern.toml")), false);
    };

    const verify = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(verify, "phase");
    const findings = verify.data.findings;
    assert(findings !== undefined);
    const expected = trackedSharedProviderPaths(findings.agents_effective);
    assert(
      expected.length > 0,
      "precondition: the effective agents write files",
    );
    assertEquals(
      (findings.ignored_integration_files ?? []).map((file) => file.path),
      expected,
    );
    assert(
      verify.data.conflicts?.some((c) =>
        c.kind === "ignored_integration_files"
      ),
      JSON.stringify(verify.data.conflicts),
    );
    assertStringIncludes(
      verify.data.instructions ?? "",
      "commit just those files",
    );
    assertStringIncludes(
      verify.data.next_action,
      "--ignored-integration-files track-anyway",
    );

    const invalid = await begin(
      dir,
      "--ignored-integration-files",
      "change-rule",
    );
    assertEquals(invalid.code, 1, invalid.output);
    assertEquals(
      decodeCliResult(invalid.stdout, "setup begin").error,
      "invalid_arguments",
    );
    await assertUntouched();

    const unanswered = await begin(dir);
    assertEquals(unanswered.code, 1, unanswered.output);
    const refusal = decodeCliResult(unanswered.stdout, "setup begin");
    assertEquals(refusal.error, "awaiting_decision");
    assertHasHint(refusal, HINTS["setup-awaiting-ignored-files-choice"], {
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
    await assertUntouched();

    const tracked = await begin(
      dir,
      "--ignored-integration-files",
      "track-anyway",
    );
    assertEquals(tracked.code, 0, tracked.output);
    const data = beginData(tracked.stdout);
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
