/**
 * Landing on integration worktrees, end to end through the public CLI: a
 * submission the trunk overtook lands through one `accept` that composes and
 * proves the combined code in a disposable integration worktree; ancestry —
 * never queue length — selects the direct fast path; a conflict names its
 * files and a red combined check names its failing check and reproduce
 * command, both leaving the trunk and the author's checkout untouched; author
 * work that arrives during checking is excluded and preserved; and the
 * integration copy, its branch, its resources, and its record are gone when
 * the landing settles.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { listIntegrationLandingRecords } from "../src/engine/worktree/integration_record.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { submissionRows } from "../src/engine/worktree/submissions_view.ts";
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
import { waitUntil } from "./waiting.ts";

const CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "integration-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
].join("\n");

/** Scaffold a refresh-converged repository: the committed tree carries the
 * current compiled agent artifacts, exactly as a really set-up project does,
 * so a fresh integration worktree's own setup regenerates byte-identical
 * files instead of drifting. */
async function integrationFixture(
  dir: string,
  config = CONFIG,
): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await gitInit(dir);
  assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
  await git(dir, "add", "-A");
  const status = await gitOut(dir, "status", "--porcelain");
  if (status !== "") {
    await git(dir, "commit", "-q", "-m", "converge artifacts", "--no-gpg-sign");
  }
}

/** Scaffold one committed effort worktree over the shared fixture. */
async function effortWithWork(
  dir: string,
  name: string,
  file: string,
  contents = `${name} work\n`,
): Promise<string> {
  const wt = await addWorktree(dir, name);
  await Deno.mkdir(join(wt, dirname(file)), { recursive: true });
  await Deno.writeTextFile(join(wt, file), contents);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", `feat: ${name}`, "--no-gpg-sign");
  return wt;
}

/** No integration worktree, branch, or record survives outside a live run. */
async function assertNoIntegrationRemains(dir: string): Promise<void> {
  const root = await Deno.realPath(dir);
  assertEquals(await listIntegrationLandingRecords(root), []);
  const branches = await gitOut(dir, "branch", "--list", "integration/*");
  assertEquals(branches, "");
  const registered = await gitOut(dir, "worktree", "list", "--porcelain");
  assert(
    !registered.includes("integration-"),
    `an integration checkout remains registered:\n${registered}`,
  );
}

Deno.test("a submission the trunk overtook lands through one accept, composed and proven in an integration worktree", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(dir);
    const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
    const beta = await effortWithWork(dir, "beta", "beta.txt");

    // Both prove against the same trunk; alpha lands first, moving it.
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
    const betaHead = await gitOut(beta, "rev-parse", "HEAD");
    const betaBranch = await gitOut(beta, "branch", "--show-current");
    const betaPath = await Deno.realPath(beta);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );
    const movedTip = await gitOut(dir, "rev-parse", "main");

    // Beta's accept composes with the moved trunk instead of refusing.
    const landed = await runAgent(beta, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assert(result.ok, landed.output);
    assert(result.message !== undefined);
    assertStringIncludes(
      result.message,
      `Landed ${betaBranch}'s submission ${betaHead.slice(0, 12)}, composed ` +
        `with main and proven as`,
    );
    assertStringIncludes(
      result.message,
      "its checkout, branch, and resources are gone.",
    );

    // The trunk advanced to the proven combined commit: both changes present,
    // the submitted revision and the old tip both ancestors.
    const tip = await gitOut(dir, "rev-parse", "main");
    assert(tip !== movedTip);
    assert(await targetExists(join(dir, "alpha.txt")));
    assert(await targetExists(join(dir, "beta.txt")));
    await git(dir, "merge-base", "--is-ancestor", betaHead, tip);
    await git(dir, "merge-base", "--is-ancestor", movedTip, tip);

    // The landed commit carries a Proof note naming the author's branch.
    const note = await gitOut(dir, "notes", "--ref=discern", "show", tip);
    assert(note.length > 0, "the landed commit carries a Proof note");
    assert(result.data !== undefined && !("issues" in result.data));
    assertEquals(result.data.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    });
    const proofLine = result.data.proof_line;
    assert(proofLine !== undefined);
    assertStringIncludes(proofLine, betaBranch);

    // The author's checkout, branch, and submission are consumed; the
    // integration copy, branch, and record are gone.
    assertEquals(await targetExists(betaPath), false);
    assertEquals(await gitOut(dir, "branch", "--list", betaBranch), "");
    await assertNoIntegrationRemains(dir);
    assertEquals(await submissionRows(await Deno.realPath(dir), "main"), []);
  });
});

Deno.test("ancestry selects the direct fast path regardless of queue length", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(dir);
    // Several submissions wait; the selected one is at the trunk tip.
    const efforts = await Promise.all(
      ["one", "two", "three"].map(
        (name) => effortWithWork(dir, name, `${name}.txt`),
      ),
    );
    for (const wt of efforts) {
      assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
      assertEquals((await runAgent(wt, ["accept", "--json"])).code, 1);
    }
    const rows = await submissionRows(await Deno.realPath(dir), "main");
    assertEquals(rows.length, 3);

    const landed = await runAgent(efforts[0] as string, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assert(result.message !== undefined);
    // The direct sentence: landed at its own commit, no composition.
    assertStringIncludes(result.message, "Landed agent/one at");
    await assertNoIntegrationRemains(dir);
  });
});

Deno.test("a conflicting composition names its files and route, changing nothing", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(dir);
    const alpha = await effortWithWork(dir, "alpha", "shared.txt", "alpha\n");
    const beta = await effortWithWork(dir, "beta", "shared.txt", "beta\n");
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );
    const tipBefore = await gitOut(dir, "rev-parse", "main");
    const betaHead = await gitOut(beta, "rev-parse", "HEAD");

    const refused = await runAgent(beta, ["accept", "--confirmed", "--json"]);
    assertEquals(refused.code, 1);
    const result = decodeCliResult(refused.stdout, "accept");
    assert(result.message !== undefined);
    assertStringIncludes(
      result.message,
      "conflicts with main in: shared.txt",
    );
    assertStringIncludes(
      result.message,
      `Run discern update from ${await Deno.realPath(beta)}, resolve what ` +
        `it reports, commit, run discern done, then discern accept.`,
    );
    assertStringIncludes(result.message, "Nothing has been landed");

    // Neither the trunk nor the author's checkout changed; the submission
    // stays recorded; no integration state remains.
    assertEquals(await gitOut(dir, "rev-parse", "main"), tipBefore);
    assertEquals(await gitOut(beta, "rev-parse", "HEAD"), betaHead);
    assertEquals(await gitOut(beta, "status", "--porcelain"), "");
    assertEquals((await readSubmission(beta)).status, "submitted");
    await assertNoIntegrationRemains(dir);
  });
});

Deno.test("a red combined check names the failing stage and reproduce command and returns to the author", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(dir);
    const alpha = await effortWithWork(dir, "alpha", "gate.sh", "");
    const beta = await effortWithWork(dir, "beta", "beta.txt");
    // Alpha lands a trunk-side gate that fails whenever beta's file exists —
    // each branch is green alone; only the combination goes red.
    await writeConfig(
      alpha,
      CONFIG.replace(
        'lint = ":"',
        'lint = "test ! -f beta.txt"',
      ),
    );
    await git(alpha, "add", "-A");
    await git(alpha, "commit", "-q", "-m", "gate", "--no-gpg-sign");
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );
    const tipBefore = await gitOut(dir, "rev-parse", "main");

    const refused = await runAgent(beta, ["accept", "--confirmed", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const result = decodeCliResult(refused.stdout, "accept");
    assert(result.message !== undefined);
    assertStringIncludes(result.message, "The combined check for");
    assertStringIncludes(result.message, "failed");
    assertStringIncludes(result.message, "Reproduce with:");
    assertStringIncludes(
      result.message,
      "run discern done, then discern accept.",
    );
    assertEquals(result.error, "gate_failed");

    assertEquals(await gitOut(dir, "rev-parse", "main"), tipBefore);
    assertEquals(await gitOut(beta, "status", "--porcelain"), "");
    assertEquals((await readSubmission(beta)).status, "submitted");
    await assertNoIntegrationRemains(dir);
  });
});

Deno.test("author commits during checking stay intact, excluded, and named for the next landing", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(dir);
    const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
    const beta = await effortWithWork(dir, "beta", "beta.txt");
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
    const betaHead = await gitOut(beta, "rev-parse", "HEAD");
    const betaBranch = await gitOut(beta, "branch", "--show-current");
    assertEquals(
      (await runAgent(beta, ["accept", "--json"])).code,
      1,
      "the unauthorized accept records the submission",
    );
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );

    // The author moves on after submitting; the frozen submission still
    // lands, and the later commit stays on the surviving branch.
    await Deno.writeTextFile(join(beta, "beta-later.txt"), "later\n");
    await git(beta, "add", "-A");
    await git(beta, "commit", "-q", "-m", "later work", "--no-gpg-sign");
    const laterHead = await gitOut(beta, "rev-parse", "HEAD");

    const landed = await runAgent(dir, [
      "accept",
      "--target",
      betaBranch,
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assert(result.message !== undefined);
    assertStringIncludes(
      result.message,
      `Landed ${betaBranch}'s submission ${betaHead.slice(0, 12)}`,
    );
    assertStringIncludes(
      result.message,
      "the branch holds later commits, so its checkout and branch stay.",
    );

    const tip = await gitOut(dir, "rev-parse", "main");
    await git(dir, "merge-base", "--is-ancestor", betaHead, tip);
    assert(await targetExists(join(dir, "beta.txt")));
    assertEquals(
      await targetExists(join(dir, "beta-later.txt")),
      false,
      "work after the submission is excluded from the landing",
    );
    assertEquals(await gitOut(beta, "rev-parse", "HEAD"), laterHead);
    assertEquals(
      (await readSubmission(beta)).status,
      "missing",
      "the landed submission is consumed",
    );
    await assertNoIntegrationRemains(dir);
  });
});
Deno.test("the integration copy provisions its resources and removes them with the landing", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (markers) => {
      await integrationFixture(
        dir,
        `${CONFIG}[worktree.resources.thing]\ncreate  = 'sh -c "printf x >> ${markers}/created-@worktree@"'\ndestroy = 'sh -c "printf x >> ${markers}/destroyed-@worktree@"'\n`,
      );
      const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
      const beta = await effortWithWork(dir, "beta", "beta.txt");
      assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
      assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      const landed = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(landed.code, 0, landed.output);

      // The integration copy's own resource was created once and destroyed
      // once, under its own worktree-derived handle.
      const files: string[] = [];
      for await (const entry of Deno.readDir(markers)) {
        files.push(entry.name);
      }
      const created = files.filter((name) =>
        name.startsWith("created-") && name.includes("integration")
      );
      const destroyed = files.filter((name) =>
        name.startsWith("destroyed-") && name.includes("integration")
      );
      assertEquals(created.length, 1, files.join(", "));
      assertEquals(destroyed.length, 1, files.join(", "));
      await assertNoIntegrationRemains(dir);
    });
  });
});

Deno.test("a checkpoint conclusion travels with its evidence and an unchanged subject lands without a new decision", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(
      dir,
      `${CONFIG}[checkpoints.api-review]\npaths = ["api/**"]\nquestion = "Does this API change keep its consumers working?"\n`,
    );
    const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
    const beta = await effortWithWork(dir, "beta", "api/surface.txt");
    // Beta answers its own fired checkpoint and proves green.
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals(
      (await runAgent(beta, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    const betaHead = await gitOut(beta, "rev-parse", "HEAD");
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );

    // The author's declaration travels with its evidence, so the unchanged
    // subject stays answered on the combined tree and the landing completes
    // without anyone re-deciding or inventing anything.
    const landed = await runAgent(beta, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const tip = await gitOut(dir, "rev-parse", "main");
    await git(dir, "merge-base", "--is-ancestor", betaHead, tip);
    await assertNoIntegrationRemains(dir);
  });
});

Deno.test("a trunk that moves during the combined check recomposes once, shows the checking row, and lands", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      // The gate job itself moves the trunk on the FIRST integration run —
      // a deterministic stand-in for an outside actor committing to main —
      // and slows down enough for the queue row to be observed mid-check.
      const moved = join(scratch, "moved-once");
      await integrationFixture(
        dir,
        CONFIG.replace('lint = ":"', 'lint = "sh maybe-move.sh"'),
      );
      await Deno.writeTextFile(
        join(dir, "maybe-move.sh"),
        [
          "#!/bin/sh",
          "sleep 2",
          'case "$(pwd)" in',
          `  *integration*) if [ ! -e "${moved}" ]; then`,
          `    touch "${moved}"`,
          `    git -C "${await Deno.realPath(
            dir,
          )}" commit -q --allow-empty -m outside --no-gpg-sign`,
          "  fi ;;",
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", "wire moving gate", "--no-gpg-sign");
      assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
      await git(dir, "add", "-A");
      if ((await gitOut(dir, "status", "--porcelain")) !== "") {
        await git(dir, "commit", "-q", "-m", "converge", "--no-gpg-sign");
      }

      const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
      const beta = await effortWithWork(dir, "beta", "beta.txt");
      assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
      assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
      const betaHead = await gitOut(beta, "rev-parse", "HEAD");
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );

      const root = await Deno.realPath(dir);
      const landing = runAgent(beta, ["accept", "--confirmed", "--json"]);
      // While the combined check runs, the queue row names the running
      // landing: waiting, with the reconnect handle every surface shares.
      await waitUntil(
        async () => {
          const rows = await submissionRows(root, "main");
          return rows.some((row) =>
            row.readiness === "waiting" &&
            row.operation_handle !== undefined &&
            (row.reason ?? "").includes("discern progress")
          );
        },
        "the queue row names the running landing's handle",
        {
          timeoutMs: 120_000,
        },
      );

      const landed = await landing;
      assertEquals(landed.code, 0, landed.output);
      const tip = await gitOut(dir, "rev-parse", "main");
      await git(dir, "merge-base", "--is-ancestor", betaHead, tip);
      assert(await targetExists(join(dir, "beta.txt")));
      await assertNoIntegrationRemains(dir);
    });
  });
});

Deno.test("a trunk that keeps moving stops the landing after one bounded recompose with the retry route", async () => {
  await withTempDir(async (dir) => {
    await integrationFixture(
      dir,
      CONFIG.replace('lint = ":"', 'lint = "sh always-move.sh"'),
    );
    await Deno.writeTextFile(
      join(dir, "always-move.sh"),
      [
        "#!/bin/sh",
        'case "$(pwd)" in',
        `  *integration*) git -C "${await Deno.realPath(
          dir,
        )}" commit -q --allow-empty -m outside --no-gpg-sign ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "wire moving gate", "--no-gpg-sign");
    assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
    await git(dir, "add", "-A");
    if ((await gitOut(dir, "status", "--porcelain")) !== "") {
      await git(dir, "commit", "-q", "-m", "converge", "--no-gpg-sign");
    }

    const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
    const beta = await effortWithWork(dir, "beta", "beta.txt");
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );
    const refused = await runAgent(beta, ["accept", "--confirmed", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const result = decodeCliResult(refused.stdout, "accept");
    assertStringIncludes(
      result.message ?? "",
      "moved again while this landing recomposed",
    );
    assertStringIncludes(
      result.message ?? "",
      "Re-run `discern accept` to compose against the current trunk.",
    );
    assertEquals((await readSubmission(beta)).status, "submitted");
    await assertNoIntegrationRemains(dir);
  });
});
