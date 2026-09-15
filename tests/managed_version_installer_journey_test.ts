/** Real installer replacement composed with source-CLI project adoption.
 * The downloaded executable launches the production CLI; the immutable version
 * sampled before replacement models an already-running agent/MCP session.
 * Native binary transport remains the release-smoke authority, and the frozen
 * reader suite independently exercises the first-public engine contract.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withInstallerRun } from "./install_fixture.ts";
import { git, gitInit, writeExecutable } from "./engine_helpers.ts";
import { REAL_TEMPLATES } from "./helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  DISCERN_VERSION,
  humanVersion,
  parseVersionOutput,
  SCHEMA_VERSION,
} from "../src/lib/version.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { compareManagedVersion } from "../src/shared/managed_version.ts";
import { planTrackedRefresh } from "../src/engine/tracked_refresh.ts";
import { DESK_SESSION_ENV } from "../src/engine/desk/session.ts";
import { colorResolvedEnv } from "../src/shared/color_env.ts";

const previous = "0.9.7";
const entry = fromFileUrl(new URL("../src/main.ts", import.meta.url));
const denoConfig = fromFileUrl(new URL("../deno.json", import.meta.url));
const decoder = new TextDecoder();

/** Invoke the executable actually placed at the installer's chosen destination. */
async function invoke(
  binary: string,
  project: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command(binary, {
    args,
    cwd: project,
    env: {
      ...colorResolvedEnv(),
      [DESK_SESSION_ENV]: "",
      DISCERN_TEMPLATES_DIR: REAL_TEMPLATES,
      NO_COLOR: "1",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

Deno.test("verified replacement leaves adoption unchanged until a restarted CLI successfully upgrades the project", async () => {
  let oldSessionVersion: string | undefined;
  let beforeConfig = "";
  await withInstallerRun("curl", async (installed) => {
    assert(installed.success, installed.stderr);
    assertEquals(installed.invocations.length, 2);
    assert(installed.invocations.every((run) => run.success));
    assertEquals(
      await Deno.readTextFile(installed.target),
      installed.expectedBinary,
    );
    const configPath = join(installed.project, "discern.toml");
    assertEquals(await Deno.readTextFile(configPath), beforeConfig);
    assertEquals(
      oldSessionVersion,
      previous,
      "replacement does not change an existing session's version",
    );

    const fresh = await invoke(installed.target, installed.project, [
      "--version",
    ]);
    assertEquals(fresh.code, 0, fresh.stderr);
    const restartedVersion = parseVersionOutput(fresh.stdout);
    assertEquals(restartedVersion, DISCERN_VERSION);
    assert(restartedVersion !== undefined);
    assertEquals(
      compareManagedVersion(
        restartedVersion,
        (await loadConfig(installed.project)).meta.managed_version,
      ).state,
      "running-newer",
    );

    const preview = await invoke(installed.target, installed.project, [
      "upgrade",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.stdout + preview.stderr);
    const planned = decodeCliResult(preview.stdout, "upgrade");
    assertResultDataKey(planned, "managed_version");
    assertEquals(planned.data.managed_version, {
      previous,
      adopted: restartedVersion,
    });
    assertEquals(await Deno.readTextFile(configPath), beforeConfig);

    // A provider failure after earlier managed effects is not successful adoption.
    const mcpPath = join(installed.project, ".mcp.json");
    await Deno.writeTextFile(mcpPath, '{"mcpServers": {"other": true,},}\n');
    const failed = await invoke(installed.target, installed.project, [
      "upgrade",
      "--allow-dirty",
      "--json",
    ]);
    assertEquals(failed.code, 1, failed.stdout + failed.stderr);
    assertEquals(
      decodeCliResult(failed.stdout, "upgrade").error,
      "partial_refresh",
    );
    assertEquals(
      (await loadConfig(installed.project)).meta.managed_version,
      previous,
    );

    await Deno.writeTextFile(mcpPath, "{}\n");
    const applied = await invoke(installed.target, installed.project, [
      "upgrade",
      "--allow-dirty",
      "--json",
    ]);
    assertEquals(applied.code, 0, applied.stdout + applied.stderr);
    const result = decodeCliResult(applied.stdout, "upgrade");
    assertResultDataKey(result, "managed_version");
    assertEquals(result.data.managed_version, {
      previous,
      adopted: restartedVersion,
    });
    const adopted = await loadConfig(installed.project);
    assertEquals(adopted.meta.managed_version, restartedVersion);
    assert(oldSessionVersion !== undefined);
    assertEquals(
      compareManagedVersion(oldSessionVersion, adopted.meta.managed_version)
        .state,
      "project-managed-by-newer",
    );
    assertEquals(
      compareManagedVersion(restartedVersion, adopted.meta.managed_version)
        .state,
      "equal",
    );

    await git(installed.project, "add", "-A");
    await git(
      installed.project,
      "commit",
      "-m",
      "share successful managed adoption",
    );
    const currency = await planTrackedRefresh(installed.project);
    assert(currency.unavailable === undefined);
    assertEquals(currency.errors, []);
    assertEquals(currency.changes, []);
    const committed = await Deno.readTextFile(configPath);
    const again = await invoke(installed.target, installed.project, [
      "upgrade",
      "--json",
    ]);
    assertEquals(again.code, 0, again.stdout + again.stderr);
    assertEquals(await Deno.readTextFile(configPath), committed);
    assertStringIncludes(
      installed.downloaderLog,
      `/download/v${DISCERN_VERSION}/`,
    );
  }, {
    version: DISCERN_VERSION,
    existing: true,
    binOnPath: true,
    repeat: 2,
    binaryCommand: [
      Deno.execPath(),
      "run",
      "--quiet",
      "-A",
      "--config",
      denoConfig,
      entry,
    ],
    beforeInstall: async (project, target) => {
      await Deno.writeTextFile(
        join(project, "discern.toml"),
        `[meta]\nschema_version = ${SCHEMA_VERSION}\nbootstrapped = true\nmanaged_version = "${previous}"\n[project]\nagents = ["claude_code", "codex"]\n`,
      );
      await gitInit(project);
      await writeExecutable(
        target,
        `#!/bin/sh\nprintf '%s\\n' '${humanVersion({ version: previous })}'\n`,
      );
      oldSessionVersion = parseVersionOutput(
        (await invoke(target, project, ["--version"])).stdout,
      );
      beforeConfig = await Deno.readTextFile(join(project, "discern.toml"));
    },
  });
});
