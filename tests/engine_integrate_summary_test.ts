/**
 * Engine coverage for `integrate`'s "what landed beneath you" summary (ADR 0064):
 * the `IntegrateData` payload (commits/files/overlap/scopes/range), the overlap hot
 * zone, the capping + git escape-hatch hints, and predicted `--dry-run` parity.
 * Each test drives a REAL linked worktree in a hermetic git repo and reads the
 * `--json` envelope an agent would.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import type { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  type IntegrateData,
  IntegrateOutputSchema,
} from "../src/shared/result_schemas.ts";

type IntegrateJson = Omit<z.infer<typeof IntegrateOutputSchema>, "data"> & {
  data?: IntegrateData;
};

/** Parse an `integrate --json` run's stdout. */
function parse(stdout: string): IntegrateJson {
  const raw = JSON.parse(stdout);
  const parsed = IntegrateOutputSchema.safeParse(raw);
  assert(
    parsed.success,
    `integrate --json drifted from IntegrateOutputSchema:\n${
      JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
    }\n${stdout}`,
  );
  return parsed.data as IntegrateJson;
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

Deno.test("integrate --json: reports the commits, files, and range anchors brought in", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainAndWorktree(dir, "data-ff");
    await commitOnMain(dir, "upstream one", { "a.txt": "a\n" });
    await commitOnMain(dir, "upstream two", { "b.txt": "bb\n" });

    const r = await runAgent(wt, ["integrate", "--json"]);
    assertEquals(r.code, 0, r.output);
    const { data } = parse(r.stdout);
    assert(data !== undefined, `integrate must carry data\n${r.stdout}`);

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

Deno.test("integrate: overlap names the files you AND main both changed (clean merge, semantic-conflict risk)", async () => {
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

    const r = await runAgent(wt, ["integrate", "--json"]);
    assertEquals(r.code, 0, r.output);
    const { data, hints } = parse(r.stdout);
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
    assert(
      hints !== undefined &&
        hints.some((h) => h.includes("⚠") && h.includes("shared.txt")),
      `overlap hint missing:\n${JSON.stringify(hints, null, 2)}`,
    );

    // The clean merge genuinely combined both regions in the worktree.
    const merged = await Deno.readTextFile(join(wt, "shared.txt"));
    assertStringIncludes(merged, "line 1 — worktree edit");
    assertStringIncludes(merged, "line 12 — main edit");
  });
});

Deno.test("integrate: a large merge caps the lists and hands back a git escape-hatch command", async () => {
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

    const r = await runAgent(wt, ["integrate", "--json"]);
    assertEquals(r.code, 0, r.output);
    const { data, hints } = parse(r.stdout);
    assert(data !== undefined && hints !== undefined, r.stdout);

    // Capped inline, but the totals + truncation flags tell the agent the full size.
    assertEquals(data.commits_total, 12);
    assertEquals(data.commits.length, 10);
    assertEquals(data.commits_truncated, true);
    assertEquals(data.files_total, 36);
    assertEquals(data.files.length, 20);
    assertEquals(data.files_truncated, true);

    // The escape hatch: the FULL list in one call, anchors pre-substituted — no
    // guessing the range. (Apply → two-dot before..after; full-list log → before..main.)
    const filesCmd =
      `git diff --stat ${data.range.before}..${data.range.after}`;
    assert(
      hints.some((h) => h.includes(filesCmd)),
      `files escape-hatch (${filesCmd}) missing:\n${
        JSON.stringify(hints, null, 2)
      }`,
    );
    const logCmd = `git log --oneline ${data.range.before}..${data.range.main}`;
    assert(
      hints.some((h) => h.includes(logCmd)),
      `commits escape-hatch (${logCmd}) missing:\n${
        JSON.stringify(hints, null, 2)
      }`,
    );
  });
});

Deno.test("integrate: scopes_incoming classifies the merge's files through the project's scopes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A non-neutral scope so an incoming src/** file classifies into it.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
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

    const r = await runAgent(wt, ["integrate", "--json"]);
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

Deno.test("integrate --dry-run --json: predicts the same summary read-only — no `after`, nothing merged", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainAndWorktree(dir, "preview");
    await commitOnMain(dir, "upstream", { "upstream.txt": "u\n" });

    const r = await runAgent(wt, ["integrate", "--dry-run", "--json"]);
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
      await exists(join(wt, "upstream.txt")),
      false,
      `--dry-run must not merge\n${r.stdout}`,
    );
  });
});
