/**
 * Setup in a project whose own ignore rules exclude the folders discern
 * writes tracked integration files into — the shape many editor and tool
 * `.gitignore` templates take. Nothing waits on the owner: the preflight
 * discloses the files discern's `.gitignore` block will re-include, `begin`
 * commits them like any other file, and a file that already held someone
 * else's entries stays out of the commit for the coding agent to resolve.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { trackedSharedProviderPaths } from "../src/lib/artifact_ownership.ts";
import { HINTS } from "../src/shared/hints.ts";
import { describePaths } from "../src/shared/ignored_integration.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut, runAgent } from "./engine_helpers.ts";
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

/** The agents `begin` wires, and the integration files they expect tracked. */
const AGENTS = ["claude_code", "codex"];
const AGENT_PATHS = trackedSharedProviderPaths(AGENTS);

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

/** One root-level integration file the fixture already holds, with another
 * tool's entry, before setup. */
const [HELD = ""] = AGENT_PATHS.filter((path) => !path.includes("/"));

/** Decode setup-begin effect accounting, excluding configuration refusals. */
function beginData(stdout: string): SetupBeginData {
  const result = decodeCliResult(stdout, "setup begin");
  assertResultDataKey(result, "complete");
  return result.data;
}

Deno.test("setup re-includes ignored integration files without asking and leaves a file with other entries to the agent", async () => {
  assert(HELD !== "", "the fixture needs a root-level integration file");
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# Fixture\n");
    await Deno.writeTextFile(join(dir, ".gitignore"), `${RULES.join("\n")}\n`);
    await Deno.writeTextFile(
      join(dir, HELD),
      '{"mcpServers":{"other":{"command":"other-server"}}}\n',
    );
    await gitInit(dir);

    const verify = decodeCliResult(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
      "setup verify",
    );
    assertResultDataKey(verify, "phase");
    const findings = verify.data.findings;
    assert(findings !== undefined);
    const effective = trackedSharedProviderPaths(findings.agents_effective);
    assert(
      effective.length > 0,
      "precondition: the effective agents write files",
    );
    assertEquals(
      (findings.ignored_integration_files ?? []).map((file) => file.path),
      effective,
    );
    assertEquals(
      findings.existing_integration_files ?? [],
      effective.includes(HELD) ? [HELD] : [],
    );
    assertStringIncludes(
      verify.data.instructions ?? "",
      "discern's `.gitignore` block re-includes just those files",
    );
    assert(!verify.data.next_action.includes("--ignored-integration-files"));

    const run = await runAgent(dir, [
      "setup",
      "begin",
      "--name",
      "Fixture",
      "--agents",
      AGENTS.join(","),
      "--model",
      "unreported",
      "--confirmed",
      "--json",
    ]);
    assertEquals(run.code, 0, run.output);
    const result = decodeCliResult(run.stdout, "setup begin");
    const data = beginData(run.stdout);
    assertEquals(data.machinery_committed, true, JSON.stringify(data));
    assertEquals(data.existing_integration_files, [HELD]);
    assertHasHint(result, HINTS["setup-existing-integration-files"], {
      files: describePaths([HELD]),
    });

    const tracked = (await gitOut(dir, "ls-files", "-z", "--", ...AGENT_PATHS))
      .split("\0").filter((path) => path !== "").sort();
    assertEquals(tracked, AGENT_PATHS.filter((path) => path !== HELD).sort());
    assertStringIncludes(
      await gitOut(dir, "show", "HEAD:.gitignore"),
      `!/${HELD}`,
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain", "--", HELD),
      `?? ${HELD}`,
    );

    // Everything else the project's rules excluded stays excluded.
    await Deno.writeTextFile(join(dir, ".codex", "other.json"), "{}\n");
    assertEquals(
      await gitOut(dir, "check-ignore", "--", ".codex/other.json"),
      ".codex/other.json",
    );

    const doctor = decodeCliResult(
      (await runAgent(dir, ["doctor", "--json"])).stdout,
      "doctor",
    );
    assertResultDataKey(doctor, "checks");
    const check = doctor.data.checks.find((c) =>
      c.name === "integration files"
    );
    assertEquals(check?.status, "ok", JSON.stringify(check));
  });
});
