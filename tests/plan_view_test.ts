/**
 * Unit tests for the plan presentation layer (`src/lib/plan_view.ts`): the
 * `--dry-run` per-file listing (`renderPlan`), the grouped review-and-confirm
 * screen (`renderReview`), the shared kept-as-`.new` summary
 * (`renderNewFilesSummary`), the grouped `upgrade` summary (`renderUpgradeSummary`),
 * and the JSON projection (`planToJson`).
 *
 * These are direct unit tests over synthetic `Plan`s, so each disposition branch
 * and grouping path is driven precisely. Colour is forced off (no TTY under
 * `deno test`, and `noColor: true` passed to the logger), so `bold`/`dim` are
 * identity and we assert on plain text. We spy on `console.log` (the `line`
 * channel, stdout) and `console.error` (heading/info/ok/warn/detail, stderr),
 * saving and restoring the originals in a `finally`. A pair of integration
 * cases drive the real renderer through `init --dry-run` to exercise the wiring.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Logger } from "../src/lib/log.ts";
import type { OpDisposition, Plan, PlanOp } from "../src/lib/fs_plan.ts";
import {
  planToJson,
  renderNewFilesSummary,
  renderPlan,
  renderReview,
  renderUpgradeSummary,
} from "../src/lib/plan_view.ts";
import { runCli, withTempDir } from "./helpers.ts";

/** Capture everything written to console.error / console.log while `fn` runs. */
async function capture(
  fn: () => void | Promise<void>,
): Promise<{ err: string[]; out: string[] }> {
  const err: string[] = [];
  const out: string[] = [];
  const origErr = console.error;
  const origOut = console.log;
  console.error = (...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  };
  console.log = (...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = origErr;
    console.log = origOut;
  }
  return { err, out };
}

/** A logger with colour forced off, so `bold`/`dim` are identity. */
function plainLogger(): Logger {
  return new Logger({ json: false, noColor: true });
}

/** Build a synthetic `write` PlanOp at `targetRel` with the given disposition. */
function op(
  targetRel: string,
  disposition: OpDisposition,
  extra: Partial<PlanOp> = {},
): PlanOp {
  return {
    kind: "write",
    targetRel,
    targetAbs: `/dest/${targetRel}`,
    disposition,
    bytes: new Uint8Array(),
    mode: 0o644,
    managed: false,
    ...extra,
  };
}

/** Wrap a flat op list into a `Plan` with no token drift. */
function plan(
  ops: PlanOp[],
  unknownTokens: Map<string, string[]> = new Map(),
): Plan {
  return { ops, unknownTokens };
}

// ---------------------------------------------------------------------------
// renderPlan — the flat per-file --dry-run listing.
// ---------------------------------------------------------------------------

Deno.test("renderPlan writes the heading to stderr and one padded row per op to stdout", async () => {
  const p = plan([
    op("agent", "create"),
    op(".icculus/engine/lib.sh", "overwrite", { managed: true }),
  ]);
  const { err, out } = await capture(() =>
    renderPlan(plainLogger(), p, "Dry run — would write:")
  );
  // Heading goes to stderr, blank-line prefixed.
  assertEquals(err, ["\nDry run — would write:"]);
  // One row per op on stdout, each starting with the padded label.
  assertEquals(out.length, 2);
  assertStringIncludes(out[0], "create");
  assertStringIncludes(out[0], "agent");
  // The managed op carries the dim [managed] marker (identity without colour).
  assertStringIncludes(out[1], "update");
  assertStringIncludes(out[1], ".icculus/engine/lib.sh");
  assertStringIncludes(out[1], "[managed]");
});

Deno.test("renderPlan renders the note suffix and maps every disposition to its label", async () => {
  const p = plan([
    op("a", "create"),
    op("b", "overwrite"),
    op("c", "skip", { note: "already up to date" }),
    op("d.new", "new"),
    op(".claude/settings.json", "merge"),
    op(".gitignore", "append"),
    op("old", "remove"),
  ]);
  const { out } = await capture(() => renderPlan(plainLogger(), p, "h"));
  assertEquals(out.length, 7);
  // Disposition → label mapping (DISPOSITION_LABEL).
  assertStringIncludes(out[0], "create");
  assertStringIncludes(out[1], "update");
  assertStringIncludes(out[2], "skip");
  assertStringIncludes(out[3], "new file");
  assertStringIncludes(out[4], "merge");
  assertStringIncludes(out[5], "append");
  assertStringIncludes(out[6], "remove");
  // The note is appended after an em-dash on the op that has one.
  assertStringIncludes(out[2], "— already up to date");
});

Deno.test("renderPlan on an empty plan prints only the heading, no rows", async () => {
  const { err, out } = await capture(() =>
    renderPlan(plainLogger(), plan([]), "Nothing to do")
  );
  assertEquals(err, ["\nNothing to do"]);
  assertEquals(out, []);
});

// ---------------------------------------------------------------------------
// renderReview — the grouped review-and-confirm screen.
// ---------------------------------------------------------------------------

Deno.test("renderReview groups config, runner, guidance, skills, docs and engine", async () => {
  const p = plan([
    op(".icculus/config.toml", "create"),
    op("agent", "create"),
    op(".icculus/guidelines/icculus.md", "create"),
    op(".icculus/skills/foo/SKILL.md", "create"),
    op(".icculus/skills/foo/helper.sh", "create"),
    op(".icculus/skills/bar/SKILL.md", "create"),
    op("docs/00-orientation.md", "create"),
    op("TODO.md", "create"),
    op(".icculus/engine/lib.sh", "create", { managed: true }),
    op(".icculus/manifest.json", "create"),
  ]);
  const { err, out } = await capture(() =>
    renderReview(plainLogger(), p, "/projects/demo")
  );
  const text = out.join("\n");
  // Heading names the destination and goes to stderr.
  assertStringIncludes(err.join("\n"), "/projects/demo");
  // The total file count line.
  assertStringIncludes(text, "10 files.");
  // Config & runner group.
  assertStringIncludes(text, "Config & runner");
  assertStringIncludes(text, ".icculus/config.toml");
  assertStringIncludes(text, "agent");
  // Agent guidance: the guideline path is listed, skills collapsed to a count.
  assertStringIncludes(text, "Agent guidance");
  assertStringIncludes(text, ".icculus/guidelines/icculus.md");
  // Two distinct skill directories (foo, bar), not three files.
  assertStringIncludes(text, "2 portable skills");
  // Docs scaffold: only the docs/ file is counted, plus TODO.md listed.
  assertStringIncludes(text, "Docs scaffold");
  assertStringIncludes(text, "1 files — orientation, ADRs, gate gotchas");
  assertStringIncludes(text, "TODO.md");
  // Engine group counts every .icculus/ op (manifest.json included).
  assertStringIncludes(text, "Engine");
  assertStringIncludes(text, "2 files — the generic shell engine + manifest");
  // The closing hint to see every file.
  assertStringIncludes(text, "icculus init --dry-run");
});

Deno.test("renderReview surfaces the kept-your-versions group (singular phrasing)", async () => {
  const p = plan([
    op("agent.new", "new", { managed: true }),
  ]);
  const { out } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = out.join("\n");
  assertStringIncludes(text, "Kept your versions");
  // Singular subject for exactly one kept file.
  assertStringIncludes(text, "1 managed file already here is kept");
  assertStringIncludes(text, "<file>.new");
  // The canonical path is shown, pointing at the .new sibling.
  assertStringIncludes(text, "kept; kit version → agent.new");
});

Deno.test("renderReview uses plural phrasing for multiple kept files", async () => {
  const p = plan([
    op("agent.new", "new", { managed: true }),
    op(".icculus/engine/lib.sh.new", "new", { managed: true }),
  ]);
  const { out } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  assertStringIncludes(
    out.join("\n"),
    "2 managed files already here are kept",
  );
});

Deno.test("renderReview puts a managed agent preserved as .new in 'Kept', not 'Config & runner'", async () => {
  // A `.new` op for agent must not count as the runner row.
  const p = plan([
    op("agent.new", "new", { managed: true }),
  ]);
  const { out } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = out.join("\n");
  assert(!text.includes("Config & runner"), "should not show the runner group");
  assertStringIncludes(text, "Kept your versions");
});

Deno.test("renderReview lists unclassified ops under 'Other', with and without notes", async () => {
  const p = plan([
    op("stray/file.txt", "create", { note: "a stray note" }),
    op("stray/bare.txt", "create"), // no note → no em-dash suffix
  ]);
  const { out } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = out.join("\n");
  assertStringIncludes(text, "Other");
  assertStringIncludes(text, "stray/file.txt");
  assertStringIncludes(text, "— a stray note");
  // The note-less op is listed bare, with no trailing em-dash note.
  const bareLine = out.find((l) => l.includes("stray/bare.txt"));
  assert(bareLine !== undefined && !bareLine.includes("—"));
});

Deno.test("renderReview groups integration files by how they land (merge / append / created)", async () => {
  const p = plan([
    op(".claude/settings.json", "merge"),
    op(".gitignore", "append"),
    op(".claude/other.json", "create"),
  ]);
  const { out } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = out.join("\n");
  assertStringIncludes(text, "Git & agent settings");
  assertStringIncludes(text, "merged into your existing settings");
  assertStringIncludes(text, "the harness section appended to your .gitignore");
  // A non-merge, non-append integration op falls through to "created".
  assertStringIncludes(text, "created");
});

Deno.test("renderReview warns about unknown tokens after the file list", async () => {
  const tokens = new Map<string, string[]>([
    ["docs/foo.md", ["unknown_a", "unknown_b"]],
  ]);
  const p = plan([op("docs/foo.md", "create")], tokens);
  const { err } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = err.join("\n");
  // The warning goes to stderr (log.warn) and names the path and tokens.
  assertStringIncludes(text, "unknown token(s) left untouched in docs/foo.md");
  assertStringIncludes(text, "unknown_a, unknown_b");
});

Deno.test("renderReview omits every optional group for a minimal plan", async () => {
  // Only a docs file: no config, runner, guidance, skills, engine, kept, other,
  // integration, or token warnings.
  const p = plan([op("docs/x.md", "create")]);
  const { err, out } = await capture(() =>
    renderReview(plainLogger(), p, "/dest")
  );
  const text = out.join("\n");
  assert(!text.includes("Config & runner"));
  assert(!text.includes("Agent guidance"));
  assert(!text.includes("Engine"));
  assert(!text.includes("Kept your versions"));
  assert(!text.includes("Other"));
  assert(!text.includes("Git & agent settings"));
  // Docs scaffold is present (it is the one file we gave).
  assertStringIncludes(text, "Docs scaffold");
  // No token warnings emitted.
  assert(!err.join("\n").includes("unknown token"));
});

// ---------------------------------------------------------------------------
// renderNewFilesSummary — the shared kept-as-`.new` summary.
// ---------------------------------------------------------------------------

Deno.test("renderNewFilesSummary is a no-op when there are no preserved files", async () => {
  const { err, out } = await capture(() =>
    renderNewFilesSummary(plainLogger(), [])
  );
  assertEquals(err, []);
  assertEquals(out, []);
});

Deno.test("renderNewFilesSummary (default = applied) reports past tense and the merge hint", async () => {
  const files = [op("agent.new", "new", { managed: true })];
  const { err } = await capture(() =>
    renderNewFilesSummary(plainLogger(), files)
  );
  const text = err.join("\n");
  // Default opts: dryRun falsy → past tense "kept" / "was".
  assertStringIncludes(text, "kept your version of 1 managed file");
  assertStringIncludes(text, "was written alongside");
  // The detail line points to the canonical path to merge into.
  assertStringIncludes(text, "agent.new");
  assertStringIncludes(text, "merge into agent or delete");
});

Deno.test("renderNewFilesSummary in dry-run uses conditional phrasing and plural count", async () => {
  const files = [
    op("a.new", "new", { managed: true }),
    op("b.new", "new", { managed: true }),
  ];
  const { err } = await capture(() =>
    renderNewFilesSummary(plainLogger(), files, { dryRun: true })
  );
  const text = err.join("\n");
  assertStringIncludes(text, "would keep your version of 2 managed files");
  assertStringIncludes(text, "would be written alongside");
});

// ---------------------------------------------------------------------------
// renderUpgradeSummary — the grouped upgrade summary / dry-run preview.
// ---------------------------------------------------------------------------

Deno.test("renderUpgradeSummary (applied) lists up-to-date, refreshed, removed and kept groups", async () => {
  const refreshed = [
    op(".icculus/engine/lib.sh", "overwrite", { managed: true }),
  ];
  const preserved = [op(".icculus/engine/gate.sh", "skip", { managed: true })];
  const newFiles = [op("agent.new", "new", { managed: true })];
  const removed = [op(".icculus/engine/old.sh", "remove", { managed: true })];
  const { err } = await capture(() =>
    renderUpgradeSummary(
      plainLogger(),
      refreshed,
      preserved,
      newFiles,
      removed,
    )
  );
  const text = err.join("\n");
  // Heading is the applied (non-dry) form.
  assertStringIncludes(text, "Upgrade summary");
  // Up-to-date bulk first, with its detail row.
  assertStringIncludes(text, "already up to date: 1");
  assertStringIncludes(text, ".icculus/engine/gate.sh");
  // Refreshed group, past tense.
  assertStringIncludes(text, "refreshed: 1");
  assertStringIncludes(text, ".icculus/engine/lib.sh");
  // Removed group, past tense.
  assertStringIncludes(text, "removed (no longer shipped): 1");
  assertStringIncludes(text, ".icculus/engine/old.sh");
  // Kept-as-.new summary (delegated to renderNewFilesSummary), past tense.
  assertStringIncludes(text, "kept your version of 1 managed file");
});

Deno.test("renderUpgradeSummary (dry-run) switches the heading and every verb to conditional", async () => {
  const refreshed = [op("x", "overwrite", { managed: true })];
  const removed = [op("y", "remove", { managed: true })];
  const { err } = await capture(() =>
    renderUpgradeSummary(
      plainLogger(),
      refreshed,
      [],
      [],
      removed,
      { dryRun: true },
    )
  );
  const text = err.join("\n");
  assertStringIncludes(text, "Dry run — `upgrade` would perform:");
  assertStringIncludes(text, "would refresh: 1");
  assertStringIncludes(text, "would remove (no longer shipped): 1");
});

Deno.test("renderUpgradeSummary omits the up-to-date and removed groups when empty", async () => {
  // No preserved, no removed (removed defaults to []): only the refreshed line.
  const refreshed = [op("x", "overwrite", { managed: true })];
  const { err } = await capture(() =>
    renderUpgradeSummary(plainLogger(), refreshed, [], [])
  );
  const text = err.join("\n");
  assert(!text.includes("already up to date"));
  assert(!text.includes("no longer shipped"));
  assertStringIncludes(text, "refreshed: 1");
});

Deno.test("renderUpgradeSummary always emits the refreshed line, even at zero", async () => {
  const { err } = await capture(() =>
    renderUpgradeSummary(plainLogger(), [], [], [])
  );
  assertStringIncludes(err.join("\n"), "refreshed: 0");
});

// ---------------------------------------------------------------------------
// planToJson — the JSON projection.
// ---------------------------------------------------------------------------

Deno.test("planToJson maps each op to {path, action, managed, note}", () => {
  const p = plan([
    op("a", "create"),
    op("b.new", "new", { managed: true, note: "your edits kept" }),
  ]);
  assertEquals(planToJson(p), [
    { path: "a", action: "create", managed: false, note: undefined },
    { path: "b.new", action: "new", managed: true, note: "your edits kept" },
  ]);
});

// ---------------------------------------------------------------------------
// Integration: the real review/dry-run renderers wired through `init`.
// ---------------------------------------------------------------------------

Deno.test("init review screen (no --dry-run) renders the grouped summary via renderReview", async () => {
  await withTempDir(async (dir) => {
    // No --yes: the confirm prompt is declined on the closed stdin, but the
    // review screen is printed first. NO_COLOR is set by runCli.
    const { stdout, stderr } = await runCli(["init", "--slug", "demo"], dir);
    const text = stdout + stderr;
    assertStringIncludes(text, "will set up its harness");
    assertStringIncludes(text, "Config & runner");
    assertStringIncludes(text, "icculus init --dry-run");
  });
});

Deno.test("init --dry-run prints the full per-file plan via renderPlan", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["init", "--yes", "--dry-run", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 0);
    // The flat listing names managed engine files with the [managed] marker and
    // the create label, and nothing was written (dry run).
    assertStringIncludes(stdout, "[managed]");
    assertStringIncludes(stdout, "create");
    assertStringIncludes(stdout, "agent");
  });
});
