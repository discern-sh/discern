import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
/** Native retirement remains independent of a settled public landing. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  claimedLanding,
  landInProcess,
  provenSource,
} from "./completion_journey_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import {
  RETIREMENT_BOUNDARIES,
  type RetirementRuntime,
  retireQueueLanding,
} from "../src/engine/landing_queue/retirement.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { Logger } from "../src/lib/log.ts";
import { statIfExists } from "../src/shared/fs_presence.ts";
import { ownValidationEnvironment } from "../src/engine/execution/public_environment.ts";
import {
  releaseExecutionEnvironment,
  requireEnvironment,
} from "../src/engine/execution/registry.ts";
import { saveEnvironmentArtifact } from "../src/engine/execution/artifacts.ts";
import { resourcesDir } from "../src/engine/worktree/resources.ts";
import {
  resolveCommonGitDir,
  worktreeGitKey,
} from "../src/engine/worktree/git.ts";
import { currentOperationLocks } from "../src/shared/operation_lock_context.ts";

/** Create a separately authorized, settled landing with optional owner release.
 *
 * The landing is settled by the production publication core in this process;
 * one journey below settles it through a real public accept instead so the
 * retirement contract stays proven against the complete producer path.
 */
async function landed(
  root: string,
  options: { readonly retained?: boolean; readonly accept?: boolean } = {},
): Promise<
  {
    path: string;
    landing: import("../src/engine/landing_queue/publication.ts").LandingRecord;
    runtime: RetirementRuntime;
    records: import("../src/engine/completion/records.ts").CompletionRecord[];
    release: () => Promise<void>;
  }
> {
  root = await Deno.realPath(root);
  const proven = await provenSource(root, { retainCheckout: true });
  const path = proven.path;
  if (options.accept) {
    const accepted = await runAgent(root, ["accept", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
  } else {
    await landInProcess(await claimedLanding(root, proven));
  }
  const records = observedRecords(await observeQueue(root, "main"));
  const landing = records.find((record) => record.kind === "landing");
  assert(landing?.kind === "landing");
  const release = async (): Promise<void> => {
    const source = landing.data.source;
    const actor = {
      operation_id: crypto.randomUUID(),
      originating_effort: source.effort_id,
      started_at: SYSTEM_CLOCK.wallNow(),
    };
    const environmentPorts = await ownValidationEnvironment(
      path,
      await loadConfig(path),
      source,
      actor,
      null,
    );
    assert(!("kind" in environmentPorts), JSON.stringify(environmentPorts));
    const current = await requireEnvironment(
      root,
      environmentPorts.environmentId,
    );
    await releaseExecutionEnvironment(
      root,
      environmentPorts.environmentId,
      current.stamp,
      actor,
      null,
      environmentPorts,
      { retirement: true },
    );
  };
  if (!options.retained) await release();
  const runtime: RetirementRuntime = {
    root,
    trunk: "main",
    config: await loadConfig(root),
    log: new Logger({ json: true, noColor: true }),
  };
  return { path, landing, runtime, records, release };
}

for (const boundary of RETIREMENT_BOUNDARIES) {
  Deno.test(`retirement recovers after ${boundary} without replaying landing or authority`, async () => {
    await withTempDir(async (root) => {
      const f = await landed(root);
      const interrupted = await retireQueueLanding({
        ...f.runtime,
        afterBoundary: (phase) => {
          if (phase === "resources") {
            assertEquals([...(currentOperationLocks()?.boundaries ?? [])], [
              "checkout",
            ], "resource cleanup holds only checkout exclusion");
          }
          if (phase === boundary) throw new Error(`interrupt ${phase}`);
          return Promise.resolve();
        },
      }, f.landing);
      assertEquals(interrupted.kind, "recovery", JSON.stringify(interrupted));
      const recovered = await retireQueueLanding(f.runtime, f.landing);
      assertEquals(recovered.kind, "retired", JSON.stringify(recovered));
      assertEquals(await statIfExists(f.path), undefined);
      const retirement = observedRecords(await observeQueue(root, "main")).find(
        (record) =>
          record.kind === "retirement" &&
          record.data.landing_id === f.landing.id,
      );
      assert(retirement?.kind === "retirement");
      assertEquals(retirement.data.effects, {
        worktree_removed: true,
        branch_deleted: true,
      });
      assertEquals(
        await gitOut(
          root,
          "for-each-ref",
          "--format=%(refname)",
          "refs/heads/agent/public-done",
        ),
        "",
      );
      assertEquals(
        observedRecords(await observeQueue(root, "main")).filter((record) =>
          record.kind === "landing" || record.kind === "authority"
        ),
        f.records.filter((record) =>
          record.kind === "landing" || record.kind === "authority"
        ),
      );
      assertEquals(await retireQueueLanding(f.runtime, f.landing), recovered);
    });
  });
}

// Each refusal below returns before any retirement record exists, so one held
// landing is released, dirtied, then moved in the order the checkout would age.
Deno.test("retirement keeps a held, dirty, or moved source checkout and branch", async (t) => {
  await withTempDir(async (root) => {
    const f = await landed(root, { retained: true });
    const keeps = async (): Promise<void> => {
      const result = await retireQueueLanding(f.runtime, f.landing);
      assert(
        result.kind === "retained" || result.kind === "recovery",
        JSON.stringify(result),
      );
      assert(await statIfExists(f.path) !== undefined);
      assert(
        (await gitOut(
          root,
          "for-each-ref",
          "--format=%(refname)",
          "refs/heads/agent/public-done",
        )).length > 0,
      );
    };
    await t.step("retirement keeps held source checkout and branch", keeps);
    await f.release();
    await t.step(
      "retirement keeps dirty source checkout and branch",
      async () => {
        await Deno.writeTextFile(`${f.path}/later`, "new authoring work\n");
        await keeps();
      },
    );
    await t.step(
      "retirement keeps moved source checkout and branch",
      async () => {
        await git(f.path, "add", "later");
        await git(f.path, "commit", "-m", "Continue source");
        await keeps();
      },
    );
  });
});

for (const change of ["resource", "uncertain-child"] as const) {
  Deno.test(`retirement retry preserves a checkout with ${change} after reservation`, async () => {
    await withTempDir(async (root) => {
      const f = await landed(root);
      let effects = 0;
      const interrupted = await retireQueueLanding({
        ...f.runtime,
        afterBoundary: async (phase, record) => {
          if (phase !== "planned") return;
          if (change === "resource") {
            const common = await resolveCommonGitDir(f.path);
            const key = await worktreeGitKey(f.path);
            assert(common !== undefined && key !== undefined);
            const directory = resourcesDir(common);
            await Deno.mkdir(directory, { recursive: true });
            await Deno.writeTextFile(
              `${directory}/${key}__uncertain.json`,
              "{uncertain",
            );
          } else {
            await saveEnvironmentArtifact(
              f.runtime.root,
              {
                attempt_id: record.id,
                candidate_id: f.landing.data.candidate_id,
                context: "local",
              },
              "children/planned-uncertain",
              true,
            );
          }
          throw new Error("interrupted before cleanup");
        },
      }, f.landing);
      assertEquals(interrupted.kind, "recovery");
      const retried = await retireQueueLanding({
        ...f.runtime,
        afterBoundary: (phase) => {
          if (phase === "resources") effects++;
          return Promise.resolve();
        },
      }, f.landing);
      assertEquals(retried.kind, "recovery", JSON.stringify(retried));
      assertEquals(effects, 0);
      assert(await statIfExists(f.path) !== undefined);
      assertEquals(
        observedRecords(await observeQueue(root, "main")).filter((record) =>
          record.kind === "landing" || record.kind === "authority"
        ),
        f.records.filter((record) =>
          record.kind === "landing" || record.kind === "authority"
        ),
      );
    });
  });
}

// The complete producer path: a public accept settles this landing before release.
Deno.test("retirement accepts a timestamp-only index refresh after release", async () => {
  await withTempDir(async (root) => {
    const f = await landed(root, { accept: true });
    await Deno.utime(`${f.path}/discern.toml`, 1234567890, 1234567890);
    await git(f.path, "status", "--porcelain");
    const result = await retireQueueLanding(f.runtime, f.landing);
    assertEquals(result.kind, "retired", JSON.stringify(result));
    assertEquals(await statIfExists(f.path), undefined);
  });
});
