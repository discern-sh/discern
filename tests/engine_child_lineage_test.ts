/** Runtime evidence for automated children and independent interactive handoffs. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  setActiveInvocationId,
  spawnedByEnv,
} from "../src/shared/invocation_context.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { runGit, runShell } from "../src/shared/subprocess.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
} from "../src/shared/discern_commit.ts";
import { runShellRouted } from "../src/engine/worktree/shell.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { spawnJob } from "../src/engine/jobs/command.ts";
import { runDeskInteractiveChild } from "../src/engine/desk/desk.ts";
import { Logger } from "../src/lib/log.ts";
import { gitInit } from "./engine_helpers.ts";
import { pinnedTerminal, withTempDir } from "./helpers.ts";

Deno.test("child lineage follows the current invocation across automated runners and ends at interactive handoffs", async (t) => {
  assertEquals(
    spawnedByEnv(),
    {},
    "a host without a recorder preserves ambient inheritance",
  );
  const marker = DISCERN_ENVIRONMENT_VARIABLES.spawnedBy;
  const probe = `printf '%s' "$${marker}" > lineage-output`;
  const env = { [marker]: "stale-ancestor" };
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const runners: Record<string, () => Promise<number>> = {
      "buffered shell": async () =>
        (await runShell(probe, { cwd: dir, env })).code,
      "lifecycle shell": () =>
        runShellRouted(probe, {
          cwd: dir,
          env,
          log: new Logger({
            json: false,
            noColor: true,
            terminal: pinnedTerminal(),
          }),
        }),
      "gate job": async () => {
        const child = await spawnJob(
          { label: "lineage-probe", command: probe },
          {
            cwd: dir,
            env,
            stream: false,
            write: () => {},
          },
        );
        assertEquals(child.result.status, "ok");
        return 0;
      },
      "owned command with a replaced environment": async () =>
        (await runOwnedChild("/bin/sh", {
          args: ["-c", probe],
          cwd: dir,
          env,
          clearEnv: true,
        })).status.code,
      "Git checkout hook": async () => {
        const hook = join(dir, ".git/hooks/post-checkout");
        await Deno.writeTextFile(hook, `#!/bin/sh\n${probe}\n`);
        await Deno.chmod(hook, 0o755);
        return (await runGit(["checkout", "-b", "child-lineage"], {
          cwd: dir,
          env,
        })).code;
      },
      "discern commit hook": async () => {
        const hook = join(dir, ".git/hooks/post-commit");
        await Deno.writeTextFile(hook, `#!/bin/sh\n${probe}\n`);
        await Deno.chmod(hook, 0o755);
        await Deno.writeTextFile(join(dir, "seed.txt"), "changed\n");
        const result = await commitDiscernChanges({
          site: DISCERN_AUTHORED_COMMIT_SITES.scaffoldWiring,
          values: undefined,
          cwd: dir,
          pathspecs: ["seed.txt"],
        });
        assertEquals(result.success, true, result.stderr);
        return result.code;
      },
    };
    for (const [name, run] of Object.entries(runners)) {
      await t.step(name, async () => {
        const parent = `parent-${name}`;
        setActiveInvocationId(parent);
        assertEquals(await run(), 0);
        assertEquals(
          await Deno.readTextFile(join(dir, "lineage-output")),
          parent,
        );
        await Deno.remove(join(dir, "lineage-output"));
      });
    }
    await t.step(
      "interactive owner handoff clears both current and inherited lineage",
      async () => {
        assertEquals(
          await runDeskInteractiveChild("/bin/sh", ["-c", probe], dir, env),
          0,
        );
        assertEquals(await Deno.readTextFile(join(dir, "lineage-output")), "");
        assertEquals(spawnedByEnv("interactive"), { [marker]: "" });
      },
    );
  });
});
