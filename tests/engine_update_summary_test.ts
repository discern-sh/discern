/**
 * Engine coverage for `update`'s "what landed beneath you" summary (ADR 0064):
 * the `UpdateData` payload (commits/files/overlap/scopes/range), the overlap hot
 * zone, capped-list commands folded into one summary hint, and predicted
 * `--dry-run` parity.
 * Each test drives a REAL linked worktree in a hermetic git repo and reads the
 * `--json` envelope an agent would.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import type { UpdateData } from "../src/shared/result_schemas.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

type UpdateJson = Omit<CliResultForCommand<"update">, "data"> & {
  data: UpdateData;
};

/** Parse an `update --json` run's stdout. */
function parse(stdout: string): UpdateJson {
  const result = decodeCliResult(stdout, "update");
  assertResultDataKey(result, "commits");
  return result;
}

/** Looks like an abbreviated-or-full git object id. */
const isSha = (s: string): boolean => /^[0-9a-f]{7,40}$/.test(s);

/** A scaffolded, committed main repo with one linked worktree forked from its tip. */
async function mainAndWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Write `files` and commit them on main (`dir`), advancing it by one commit. */
async function commitOnMain(
  dir: string,
  msg: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [p, body] of Object.entries(files)) {
    const abs = join(dir, p);
    await Deno.mkdir(join(abs, ".."), { recursive: true });
    await Deno.writeTextFile(abs, body);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", msg, "--no-gpg-sign");
}

Deno.test("update --json: reports the commits, files, and range anchors brought in", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainAndWorktree(dir, "data-ff");
    await commitOnMain(dir, "upstream one", { "a.txt": "a\n" });
    await commitOnMain(dir, "upstream two", { "b.txt": "bb\n" });

    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    const { data } = parse(r.stdout);
    assert(data !== undefined, `update must carry data\n${r.stdout}`);

    assertEquals(data.behind, 2);
    // The worktree made no commits of its own → main is a strict ancestor → FF.
    assertEquals(data.fast_forward, true);
    assertEquals(data.commits_total, 2);
    assertEquals(data.commits.length, 2);
    // git log order is newest-first.
    const [newest] = data.commits;
    assert(newest !== undefined, "expected a commit");
    assertEquals(newest.subject, "upstream two");
    assert(isSha(newest.sha), newest.sha);

    const paths = data.files.map((f) => f.path).sort();
    assertEquals(paths, ["a.txt", "b.txt"]);
    const a = data.files.find((f) => f.path === "a.txt");
    assertEquals(a?.status, "A");
    assertEquals(a?.added, 1);
    assertEquals(a?.removed, 0);

    // The range anchors are real object ids an agent can diff/log against, and a
    // fast-forward lands main's tip exactly (after === main).
    assert(isSha(data.range.before), `before: ${data.range.before}`);
    assert(isSha(data.range.main), `main: ${data.range.main}`);
    assert(
      data.range.after !== undefined && isSha(data.range.after),
      `after: ${data.range.after}`,
    );
    assertEquals(data.range.after, data.range.main);

    // Nothing of the branch's own was touched → no overlap.
    assertEquals(data.overlap, []);
    assertEquals(data.overlap_total, 0);
  });
});

Deno.test("update rechecks ancestry inside every apply instead of trusting its plan", async () => {
  for (const fromArgs of [[], ["--from", "main"]]) {
    await withTempDir(async (dir) => {
      const wt = await mainAndWorktree(
        dir,
        fromArgs.length === 0 ? "recheck-trunk" : "recheck-from",
      );
      await commitOnMain(dir, "incoming", { "incoming.txt": "incoming\n" });
      const before = await gitOut(wt, "rev-parse", "HEAD");
      const counter = join(dir, "ancestry-read-once");
      const mergeEffect = join(dir, "merge-ran");
      const gitWrapper = join(dir, "fail-second-ancestry-git");
      await Deno.writeTextFile(
        gitWrapper,
        [
          "#!/bin/sh",
          'case " $* " in',
          '  *" merge-base --is-ancestor "*)',
          '    if [ -e "$NUMERIC_RECHECK_COUNTER" ]; then',
          '      echo "forced ancestry read failure" >&2',
          "      exit 2",
          "    fi",
          '    : > "$NUMERIC_RECHECK_COUNTER"',
          "    ;;",
          "esac",
          'case " $* " in',
          '  *" merge "*) : > "$NUMERIC_MERGE_EFFECT" ;;',
          "esac",
          'exec git "$@"',
          "",
        ].join("\n"),
        { mode: 0o700 },
      );

      const r = await runAgent(wt, ["update", ...fromArgs, "--json"], {
        env: {
          GIT_BIN: gitWrapper,
          NUMERIC_MERGE_EFFECT: mergeEffect,
          NUMERIC_RECHECK_COUNTER: counter,
        },
      });
      assertEquals(r.code, 1, r.output);
      assertTerminalTextIncludes(r.output, "forced ancestry read failure");
      assertEquals(await targetExists(mergeEffect), false);
      assertEquals(await gitOut(wt, "rev-parse", "HEAD"), before);
    });
  }
});

Deno.test("update: overlap names the files you AND main both changed (clean merge, semantic-conflict risk)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A baseline file present at the fork point so both sides edit DIFFERENT regions
    // of it and git still merges cleanly — exactly the case a textual merge can't vet.
    const base = Array.from({ length: 12 }, (_, i) =>
      `line ${i + 1}`).join("\n") +
      "\n";
    await commitOnMain(dir, "add shared", { "shared.txt": base });
    const wt = await addWorktree(dir, "overlap");

    // The worktree edits the TOP of shared.txt and commits its own work.
    await Deno.writeTextFile(
      join(wt, "shared.txt"),
      base.replace("line 1\n", "line 1 — worktree edit\n"),
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "worktree edits shared",
      "--no-gpg-sign",
    );

    // main edits the BOTTOM of shared.txt and adds an unrelated file.
    await commitOnMain(dir, "main edits shared + adds upstream", {
      "shared.txt": base.replace("line 12\n", "line 12 — main edit\n"),
      "upstream.txt": "u\n",
    });

    // Both global and per-branch options can otherwise turn a divergent update
    // into an ff-only refusal. discern owns this merge's topology.
    await git(wt, "config", "merge.ff", "only");
    await git(
      wt,
      "config",
      "branch.agent/overlap.mergeOptions",
      "--ff-only",
    );

    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = parse(r.stdout);
    const { data } = result;
    assert(data !== undefined, r.stdout);

    // shared.txt merged cleanly, yet it is the OVERLAP — both sides touched it.
    assertEquals(data.overlap, ["shared.txt"]);
    assertEquals(data.overlap_total, 1);
    // Diverged histories → a real merge commit, not a fast-forward.
    assertEquals(data.fast_forward, false);
    // The files that changed beneath the branch are main's edits.
    assertEquals(data.files.map((f) => f.path).sort(), [
      "shared.txt",
      "upstream.txt",
    ]);

    // The headline hint warns and names the overlap (the DX payoff).
    assertHasHint(result, HINTS["update-overlap"], {
      source: "main",
      overlap: ["shared.txt"],
      overlapTotal: 1,
      predicted: false,
      filesRange: undefined,
      commitsRange: undefined,
    });

    // The clean merge genuinely combined both regions in the worktree.
    const merged = await Deno.readTextFile(join(wt, "shared.txt"));
    assertStringIncludes(merged, "line 1 — worktree edit");
    assertStringIncludes(merged, "line 12 — main edit");
  });
});

Deno.test("update: a large merge caps the lists and hands back a git escape-hatch command", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainAndWorktree(dir, "big");
    // 12 commits on main, 36 changed files total — both past the inline caps (10/20).
    for (let c = 0; c < 12; c++) {
      const files: Record<string, string> = {};
      for (let f = 0; f < 3; f++) {
        const n = c * 3 + f;
        files[`f${String(n).padStart(2, "0")}.txt`] = `file ${n}\n`;
      }
      await commitOnMain(dir, `batch ${c}`, files);
    }

    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = parse(r.stdout);
    const { data } = result;
    assert(data !== undefined, r.stdout);

    // Capped inline, but the totals + truncation flags tell the agent the full size.
    assertEquals(data.commits_total, 12);
    assertEquals(data.commits.length, 10);
    assertEquals(data.commits_truncated, true);
    assertEquals(data.files_total, 36);
    assertEquals(data.files.length, 20);
    assertEquals(data.files_truncated, true);

    // Both full-list commands are folded into the one summary hint, with anchors
    // pre-substituted. Pagination therefore adds no extra hint rows.
    const summary = assertHasHint(result, HINTS["update-no-overlap"], {
      source: "main",
      predicted: false,
      filesRange: `${data.range.before}..${data.range.after}`,
      commitsRange: {
        before: data.range.before,
        main: data.range.main,
      },
    });
    assertEquals(
      result.hints?.filter((hint) => hint === summary).length,
      1,
      "the full-list commands share one update summary hint",
    );
  });
});

Deno.test("update: scopes_incoming classifies the merge's files through the project's scopes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A non-neutral scope so an incoming src/** file classifies into it.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.engine]",
        'paths = ["src/**"]',
        'gate = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "scoped");
    await commitOnMain(dir, "touch engine + a doc", {
      "src/core.ts": "export const x = 1;\n",
      "notes.txt": "note\n",
    });

    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    const { data } = parse(r.stdout);
    assert(data !== undefined, r.stdout);
    assert(
      data.scopes_incoming.includes("engine"),
      `scopes_incoming should classify src/core.ts → engine: ${
        JSON.stringify(data.scopes_incoming)
      }`,
    );
  });
});

Deno.test("update --dry-run --json: predicts the same summary read-only — no `after`, nothing merged", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainAndWorktree(dir, "preview");
    await commitOnMain(dir, "upstream", { "upstream.txt": "u\n" });

    const r = await runAgent(wt, ["update", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parse(r.stdout);

    assertEquals(obj.dry_run, true);
    assert(
      obj.data !== undefined,
      `dry-run must carry predicted data\n${r.stdout}`,
    );
    assertEquals(obj.data.behind, 1);
    assertEquals(obj.data.files.map((f) => f.path), ["upstream.txt"]);
    // No merge happened → no `after` anchor (the escape hatch falls back to the
    // three-dot before...main prediction).
    assertEquals(obj.data.range.after, undefined);
    assert(isSha(obj.data.range.before), obj.data.range.before);
    assert(isSha(obj.data.range.main), obj.data.range.main);

    // …and the preview genuinely merged nothing.
    assertEquals(
      await targetExists(join(wt, "upstream.txt")),
      false,
      `--dry-run must not merge\n${r.stdout}`,
    );
  });
});
