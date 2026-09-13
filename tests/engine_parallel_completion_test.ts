/**
 * The per-record completion pattern the delegate-work skill teaches, proven
 * end to end: each parallel effort records its completion by flipping the
 * status line of its OWN brief file, the shared index carries links but no
 * per-record status, and both efforts land through ordinary acceptance —
 * the second composed — with no conflict, no renewed checkpoint judgment,
 * and a current human-readable summary in the briefs themselves. The
 * contrast case shows the coordination defect the pattern removes: two
 * completions that must each edit the same shared index collide as a real
 * conflict the second author must resolve.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { listIntegrationLandingRecords } from "../src/engine/worktree/integration_record.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

/** One stop checkpoint watches the whole planning tree, so any completion
 * write there is judged — the pattern must stay clean under it. */
function config(): string {
  return [
    "[meta]",
    "bootstrapped = true",
    "",
    "[project]",
    'slug = "completion-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = "sh count-producer.sh"',
    "",
    "[checkpoints.plan-review]",
    'paths = ["planning/**"]',
    'question = "A completed record leaves every other record intact."',
    "",
  ].join("\n");
}

/** Scaffold a trunk carrying two per-effort briefs (each owning its own
 * status line) and an index that lists them without any status column. */
async function fixture(dir: string, counter: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config());
  await Deno.writeTextFile(
    join(dir, "count-producer.sh"),
    `printf x >> "${counter}"\n`,
  );
  await Deno.mkdir(join(dir, "planning"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "planning", "2a-first-task.md"),
    "Status: pending\n\n# 2A — First task\n\nDo the first thing.\n",
  );
  await Deno.writeTextFile(
    join(dir, "planning", "2b-second-task.md"),
    "Status: pending\n\n# 2B — Second task\n\nDo the second thing.\n",
  );
  await Deno.writeTextFile(
    join(dir, "planning", "README.md"),
    [
      "# The wave",
      "",
      "- [2A — First task](2a-first-task.md)",
      "- [2B — Second task](2b-second-task.md)",
      "",
      "Status lives in each brief's own first line.",
      "",
    ].join("\n"),
  );
  await gitInit(dir);
  assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
  await git(dir, "add", "-A");
  if ((await gitOut(dir, "status", "--porcelain")) !== "") {
    await git(dir, "commit", "-q", "-m", "converge artifacts", "--no-gpg-sign");
  }
}

/** The producer executions recorded so far. */
async function producerRuns(counter: string): Promise<number> {
  try {
    return (await Deno.readTextFile(counter)).length;
  } catch {
    return 0;
  }
}

Deno.test("parallel completions that each flip their own brief land cleanly: no conflict, no renewed judgment, both records and the summary current", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await fixture(dir, counter);
      const complete = async (
        name: string,
        brief: string,
      ): Promise<string> => {
        const wt = await addWorktree(dir, name);
        const path = join(wt, "planning", brief);
        const current = await Deno.readTextFile(path);
        await Deno.writeTextFile(
          path,
          current.replace(
            "Status: pending",
            `Status: complete (2026-09-13) — landed as agent/${name}`,
          ),
        );
        await git(wt, "add", "-A");
        await git(
          wt,
          "commit",
          "-q",
          "-m",
          `complete: ${name}`,
          "--no-gpg-sign",
        );
        return wt;
      };
      const alpha = await complete("alpha", "2a-first-task.md");
      const beta = await complete("beta", "2b-second-task.md");
      assertEquals(
        (await runAgent(alpha, ["done", "--met", "plan-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["done", "--met", "plan-review", "--json"]))
          .code,
        0,
      );
      const authorRuns = await producerRuns(counter);

      // Both land through ordinary acceptance; the second composes. Each
      // effort changed only its own brief, so the composition is clean AND
      // the second effort's judged subject is untouched by the first
      // landing — its conclusion carries, and no renewed judgment is served.
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      const landed = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.ok, landed.output);
      assert(result.message !== undefined);
      assertStringIncludes(result.message, "composed with main");

      // One combined check for the composed landing; nothing retained, no
      // author-side rerun.
      assertEquals(await producerRuns(counter), authorRuns + 1);
      assertEquals(
        await listIntegrationLandingRecords(await Deno.realPath(dir)),
        [],
      );

      // Both contributions and the human-readable summary are current: the
      // briefs carry their own status, and the index needed no edit.
      const first = await Deno.readTextFile(
        join(dir, "planning", "2a-first-task.md"),
      );
      const second = await Deno.readTextFile(
        join(dir, "planning", "2b-second-task.md"),
      );
      assertStringIncludes(first, "Status: complete");
      assertStringIncludes(first, "landed as agent/alpha");
      assertStringIncludes(second, "Status: complete");
      assertStringIncludes(second, "landed as agent/beta");
      assertStringIncludes(
        await Deno.readTextFile(join(dir, "planning", "README.md")),
        "Status lives in each brief's own first line.",
      );
    });
  });
});

Deno.test("the shared-index convention the pattern replaces really is the conflict class: parallel edits of one index collide and route to repair", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await fixture(dir, counter);
      // Old convention: completion also edits the shared index's own row.
      const completeWithIndexRow = async (
        name: string,
        marker: string,
      ): Promise<string> => {
        const wt = await addWorktree(dir, name);
        const index = join(wt, "planning", "README.md");
        const current = await Deno.readTextFile(index);
        await Deno.writeTextFile(
          index,
          current.replace(marker, `${marker} — complete`),
        );
        await git(wt, "add", "-A");
        await git(wt, "commit", "-q", "-m", `index: ${name}`, "--no-gpg-sign");
        return wt;
      };
      const alpha = await completeWithIndexRow(
        "alpha",
        "[2A — First task](2a-first-task.md)",
      );
      const beta = await completeWithIndexRow(
        "beta",
        "[2B — Second task](2b-second-task.md)",
      );
      assertEquals(
        (await runAgent(alpha, ["done", "--met", "plan-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["done", "--met", "plan-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      const refused = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const result = decodeCliResult(refused.stdout, "accept");
      assert(result.message !== undefined);
      assertStringIncludes(result.message, "conflicts with main in:");
      assertStringIncludes(result.message, "planning/README.md");
      assertStringIncludes(result.message, "Run discern update from");
    });
  });
});
