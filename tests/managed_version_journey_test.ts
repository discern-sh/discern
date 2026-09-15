/** Team adoption through production command and operation boundaries. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  writeExecutable,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { DISCERN_VERSION, SCHEMA_VERSION } from "../src/lib/version.ts";
import { OPERATION_EFFECTS } from "../src/shared/operation_effects.ts";
import { executeOperation } from "../src/engine/operation_execution.ts";
import { OperationLockError } from "../src/engine/operation_lock.ts";
import { planTrackedRefresh } from "../src/engine/tracked_refresh.ts";
import { statusResult } from "../src/engine/status/status.ts";
import { committedManagedVersionBoundary } from "../src/engine/managed_version.ts";
import { doctorResult } from "../src/commands/doctor.ts";
import {
  commitSetupAuthoring,
  readyForSetupDone,
} from "./fixtures/setup_completion_harness.ts";
import { writeDiscernToml } from "../src/lib/tidy_format.ts";
import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";

Deno.test("only applied successful upgrade adopts; preview and same-version rerun preserve evidence", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# Adoption fixture\n");
    await gitInit(dir);
    const begin = await runCli([
      "setup",
      "begin",
      "--confirmed",
      "--slug",
      "adoption",
    ], dir);
    assertEquals(begin.code, 0, begin.stderr);
    assertEquals((await loadConfig(dir)).meta.managed_version, undefined);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    for (const flag of ["--dry-run", "--check"]) {
      const run = await runCli(["upgrade", flag, "--json"], dir);
      const result = decodeCliResult(run.stdout, "upgrade");
      assertResultDataKey(result, "managed_version");
      assertEquals(result.data.managed_version, {
        previous: null,
        adopted: DISCERN_VERSION,
      });
      assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), before);
    }
    const applied = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
    assertEquals(applied.code, 0, applied.stdout + applied.stderr);
    assertEquals((await loadConfig(dir)).meta.managed_version, DISCERN_VERSION);
    const adopted = await Deno.readTextFile(join(dir, "discern.toml"));
    const again = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
    assertEquals(again.code, 0, again.stdout + again.stderr);
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), adopted);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "commit successful project adoption");
    await Deno.writeTextFile(
      join(dir, "AGENTS.md"),
      "# Hand-edited managed material\n",
    );
    const drift = await planTrackedRefresh(dir);
    assert(drift.unavailable === undefined);
    assert(drift.changes.some((change) => change.path === "AGENTS.md"));
  });
});

Deno.test("newer project adoption guards every registered writer and Proof, including previews", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# Team fixture\n");
    await gitInit(dir);
    const config =
      '[meta]\nschema_version = 1\nbootstrapped = true\nmanaged_version = "99.0.0"\n[project]\nagents = []\n[jobs]\ntest = "true"\n';
    await Deno.writeTextFile(join(dir, "discern.toml"), config);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "newer teammate adoption");
    let effects = 0;
    const guarded = Object.entries(OPERATION_EFFECTS).filter((
      [command, policy],
    ) =>
      policy.effects.includes("managed-artifact-write") || command === "done"
    );
    for (const [command] of guarded) {
      for (const dryRun of [false, true]) {
        await assertRejects(
          () =>
            executeOperation(
              dir,
              { command, dryRun },
              () => {
                effects++;
                return Promise.resolve({ ok: true as const, verb: command });
              },
              (result) => result,
            ),
          OperationLockError,
          "99.0.0",
        );
      }
    }
    assertEquals(effects, 0);
    // Setup has a stricter result contract than generic operation refusals.
    // Every setup writer must carry the actual release handoff through the CLI.
    for (
      const [command] of guarded.filter(([command]) =>
        command.startsWith("setup ")
      )
    ) {
      const run = await runCli([...command.split(" "), "--json"], dir);
      assertEquals(run.code, 1, run.stdout + run.stderr);
      const result = decodeCliResult(run.stdout, command);
      assertResultDataKey(result, "next_action");
      assertEquals(result.data.next_action, "discern releases");
    }
    // Incomplete metadata repair must not bypass a readable newer adoption.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      config.replace("schema_version = 1", 'schema_version = "one"'),
    );
    const repair = await runCli(
      ["setup", "begin", "--confirmed", "--json"],
      dir,
    );
    assertEquals(repair.code, 1, repair.stdout + repair.stderr);
    assertStringIncludes(repair.stdout, "99.0.0");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'schema_version = "one"',
    );
    // A valid newer schema keeps its hard refusal, ahead of adoption advice.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      config.replace(
        "schema_version = 1",
        `schema_version = ${SCHEMA_VERSION + 1}`,
      ),
    );
    const schema = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(
      decodeCliResult(schema.stdout, "upgrade").error,
      "schema_version_too_new",
    );
    await Deno.writeTextFile(join(dir, "discern.toml"), config);
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), config);
    const plan = await planTrackedRefresh(dir);
    assert(plan.unavailable !== undefined);
    assertEquals(Object.keys(plan), ["unavailable"]);
    const status = await statusResult(dir, { local: true });
    assert(status.ok);
    assertEquals(
      status.data?.managed_version?.state,
      "project-managed-by-newer",
    );
    assertEquals(status.data?.pending_tracked_refresh, undefined);
    assertEquals(status.data?.tracked_refresh_plan_errors, undefined);
    assertStringIncludes(
      renderCommandRefsCli(status.hints?.join("\n") ?? ""),
      "discern releases",
    );
    const doctor = await doctorResult(dir);
    assertEquals(
      doctor.data?.managed_version?.state,
      "project-managed-by-newer",
    );
    assertStringIncludes(
      renderCommandRefsCli(doctor.hints?.join("\n") ?? ""),
      "discern releases",
    );
    assert(
      !doctor.data?.checks?.some((check) =>
        check.status === "fail" &&
        /stale|outdated|managed.version/i.test(check.detail ?? "")
      ),
    );
    const test = await runCli(["test", "--json"], dir);
    assertEquals(test.code, 0, test.stdout + test.stderr);
    assert((await inspectGateProof(dir)).status !== "honored");
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), config);
  });
});

Deno.test("clean branch deletion and lowering cannot pass the trunk adoption boundary", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# Rollback fixture\n");
    await gitInit(dir);
    const config =
      `[meta]\nschema_version = 1\nbootstrapped = true\nmanaged_version = "${DISCERN_VERSION}"\n[project]\nagents = []\n`;
    const path = join(dir, "discern.toml");
    await Deno.writeTextFile(path, config);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "adoption");
    await git(dir, "checkout", "-b", "feature");
    for (const replacement of ["", 'managed_version = "0.0.1"\n']) {
      await Deno.writeTextFile(
        path,
        config.replace(/^managed_version.*\n/m, replacement),
      );
      await git(dir, "add", "-A");
      await git(dir, "commit", "-m", "proposed rollback");
      const done = await runCli(["done", "--dry-run", "--json"], dir);
      assertEquals(done.code, 1, done.stdout + done.stderr);
      assertTerminalTextIncludes(done.stdout, "Restore the trunk value");
      const submitted = await gitOut(dir, "rev-parse", "HEAD");
      // Acceptance reads the submitted commit independently of mutable checkout bytes.
      await Deno.writeTextFile(path, config);
      assertStringIncludes(
        await committedManagedVersionBoundary(dir, "main", submitted) ?? "",
        "Restore the trunk value",
      );
    }
  });
});

Deno.test("atomic adoption replacement failure preserves the previous config bytes", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "discern.toml");
    const before = '[meta]\nmanaged_version = "0.0.1"\n# owner comment\n';
    await Deno.writeTextFile(path, before);
    const rename = Deno.rename;
    Deno.rename = () =>
      Promise.reject(
        new Deno.errors.PermissionDenied("fixture replacement denied"),
      );
    try {
      await assertRejects(
        () =>
          writeDiscernToml(
            path,
            before.replace('"0.0.1"', `"${DISCERN_VERSION}"`),
            {
              atomic: true,
            },
          ),
        Deno.errors.PermissionDenied,
      );
      assertEquals(await Deno.readTextFile(path), before);
    } finally {
      Deno.rename = rename;
    }
  });
});

Deno.test("failed setup retracts adoption when a commit hook prevents wider rollback", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "true");
    await commitSetupAuthoring(dir);
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await writeExecutable(
      hook,
      "#!/bin/sh\nprintf 'kept work\\n' > retained.txt\nexit 1\n",
    );
    const failed = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(failed.code, 1, failed.output);
    const result = decodeCliResult(failed.stdout, "setup done");
    assertResultDataKey(result, "rollback");
    assertEquals(result.data.rollback, "retained");
    assertEquals((await loadConfig(dir)).meta.managed_version, undefined);
    assertEquals(
      await Deno.readTextFile(join(dir, "retained.txt")),
      "kept work\n",
    );
  });
});
