/** Public completion keeps judgment, landing, and checkout ownership distinct. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { engineEnv, engineRunArgs, git, runAgent } from "./engine_helpers.ts";
import { settlePending, waitForPendingCondition } from "./waiting.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";

Deno.test("public retained review, preview, release, and feedback preserve ownership without duplicate producers", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const path = await project(root, ["local"]);
      await Deno.mkdir(`${path}/discern/scripts`, { recursive: true });
      const script = `${path}/discern/scripts/preview`;
      await Deno.writeTextFile(
        script,
        `#!/bin/sh\necho ready > '${aux}/ready'\ntail -f /dev/null\n`,
      );
      await Deno.chmod(script, 0o755);
      await git(path, "add", "discern/scripts/preview");
      await git(path, "commit", "-m", "Add review preview");
      const green = await runAgent(path, [
        "done",
        "--retain-checkout",
        "--json",
      ]);
      assertEquals(green.code, 0, green.output);
      const preview = new Deno.Command(Deno.execPath(), {
        args: engineRunArgs(["scripts", "preview"]),
        cwd: path,
        env: await engineEnv(),
        stdin: "null",
        stdout: "null",
        stderr: "piped",
      }).spawn();
      const settled = preview.output();
      try {
        await waitForPendingCondition(
          settled,
          () => pathExists(`${aux}/ready`),
          "the review preview to start",
        );
        const release = await runAgent(path, ["done", "--json"]);
        assertEquals(release.code, 1, release.output);
        assert(release.output.includes("checkout"), release.output);
        assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
      } finally {
        preview.kill("SIGINT");
        await settlePending(settled, "the preview and its children to stop", {
          timeoutMs: 10_000,
        });
      }
      for (let repeat = 0; repeat < 2; repeat++) {
        const released = await runAgent(path, ["done", "--json"]);
        assertEquals(released.code, 0, released.output);
        assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
        const environments = observedRecords(await observeQueue(root, "main"))
          .filter((record) => record.kind === "environment");
        assertEquals(environments.length, 1);
        assertEquals(environments[0]?.data.release.kind, "released");
        assert(environments[0]?.data.release.kind === "released");
        assertEquals(environments[0].data.release.retirement, true);
      }
      const feedback = await runAgent(path, [
        "done",
        "--retain-checkout",
        "--json",
      ]);
      assertEquals(feedback.code, 0, feedback.output);
      assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
      const held = observedRecords(await observeQueue(root, "main")).find((
        record,
      ) => record.kind === "environment");
      assertEquals(held?.data.release.kind, "held");
      await Deno.writeTextFile(`${path}/source`, "review feedback\n");
      await git(path, "add", "source");
      await git(path, "commit", "-m", "Apply review feedback");
      const revised = await runAgent(path, [
        "done",
        "--retain-checkout",
        "--json",
      ]);
      assertEquals(revised.code, 0, revised.output);
      assertEquals(await Deno.readTextFile(`${path}/executions`), "tt");
    });
  });
});
