/**
 * Unit tests for the plan presentation layer (`src/lib/plan_view.ts`): the
 * `--dry-run` per-file listing (`renderPlan`), the grouped review-and-confirm
 * screen (`renderReview`), and the JSON projection (`planToJson`).
 *
 * Post single-binary cutover the installer is a SEED-only scaffolder: the only
 * dispositions are `create | skip | merge | append` (no managed files, no `.new`,
 * no orphan removal, no upgrade-managed-summary). These are direct unit tests
 * over synthetic `Plan`s. Colour is forced off (`noColor: true`), so `bold`/`dim`
 * are identity and we assert on plain text. We spy on `console.log` (the `line`
 * channel, stdout) and `console.error` (heading/warn, stderr), restoring the
 * originals in a `finally`. Two integration cases drive the real renderer through
 * `init`.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { Logger } from "../src/lib/log.ts";
import type { OpDisposition, Plan, PlanOp } from "../src/lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../src/lib/plan_view.ts";
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
    op("discern.toml", "create"),
    op(".gitignore", "append"),
  ]);
  const { err, out } = await capture(() =>
    renderPlan(plainLogger(), p, "Dry run — would write:")
  );
  assertEquals(err, ["\nDry run — would write:"]);
  assertEquals(out.length, 2);
  const [row0, row1] = out;
  assertExists(row0);
  assertExists(row1);
  assertStringIncludes(row0, "create");
  assertStringIncludes(row0, "discern.toml");
  assertStringIncludes(row1, "append");
  assertStringIncludes(row1, ".gitignore");
});

Deno.test("renderPlan maps every (seed-era) disposition to its label and renders the note suffix", async () => {
  const p = plan([
    op("a", "create"),
    op("b", "skip", { note: "seed present — left as-is" }),
    op(".claude/settings.json", "merge"),
    op(".gitignore", "append"),
  ]);
  const { out } = await capture(() => renderPlan(plainLogger(), p, "h"));
  assertEquals(out.length, 4);
  const [row0, row1, row2, row3] = out;
  assertExists(row0);
  assertExists(row1);
  assertExists(row2);
  assertExists(row3);
  assertStringIncludes(row0, "create");
  assertStringIncludes(row1, "skip");
  assertStringIncludes(row2, "merge");
  assertStringIncludes(row3, "append");
  // The note is appended after an em-dash on the op that has one.
  assertStringIncludes(row1, "— seed present");
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

Deno.test("renderReview groups config, your content, and integration", async () => {
  const p = plan([
    op("discern.toml", "create"),
    op("brief.md", "create"),
    op(".gitignore", "append"),
    op(".claude/settings.json", "merge"),
  ]);
  const { err, out } = await capture(() =>
    renderReview(plainLogger(), p, "/projects/demo")
  );
  const text = out.join("\n");
  // Heading names the destination and goes to stderr.
  assertStringIncludes(err.join("\n"), "/projects/demo");
  assertStringIncludes(err.join("\n"), "will set up its harness");
  // The total file count line.
  assertStringIncludes(text, "4 files.");
  // Config group names the one root file.
  assertStringIncludes(text, "Config");
  assertStringIncludes(text, "discern.toml");
  // Other seeded content (the brief) is grouped under "Your content".
  assertStringIncludes(text, "Your content");
  assertStringIncludes(text, "brief.md");
  // Integration files grouped by how they land.
  assertStringIncludes(text, "Git & agent settings");
  assertStringIncludes(text, "merged into your existing settings");
  assertStringIncludes(text, "the harness section appended to your .gitignore");
  // The closing hint to see every file.
  assertStringIncludes(text, "re-running with --dry-run");
});

Deno.test("renderReview lists seeded content under 'Your content', with and without notes", async () => {
  const p = plan([
    op("stray/file.txt", "create", { note: "a stray note" }),
    op("stray/bare.txt", "create"),
  ]);
  const { out } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = out.join("\n");
  assertStringIncludes(text, "Your content");
  assertStringIncludes(text, "stray/file.txt");
  assertStringIncludes(text, "— a stray note");
  const bareLine = out.find((l) => l.includes("stray/bare.txt"));
  assert(bareLine !== undefined && !bareLine.includes("—"));
});

Deno.test("renderReview warns about unknown tokens after the file list", async () => {
  const tokens = new Map<string, string[]>([
    ["docs/foo.md", ["unknown_a", "unknown_b"]],
  ]);
  const p = plan([op("docs/foo.md", "create")], tokens);
  const { err } = await capture(() => renderReview(plainLogger(), p, "/dest"));
  const text = err.join("\n");
  assertStringIncludes(text, "unknown token(s) left untouched in docs/foo.md");
  assertStringIncludes(text, "unknown_a, unknown_b");
});

Deno.test("renderReview omits every optional group for a minimal plan", async () => {
  const p = plan([op("docs/x.md", "create")]);
  const { err, out } = await capture(() =>
    renderReview(plainLogger(), p, "/dest")
  );
  const text = out.join("\n");
  assert(!text.includes("Config\n") && !text.includes("  Config "));
  assert(!text.includes("Git & agent settings"));
  // The one seeded file is grouped under "Your content".
  assertStringIncludes(text, "Your content");
  assertStringIncludes(text, "docs/x.md");
  assert(!err.join("\n").includes("unknown token"));
});

// ---------------------------------------------------------------------------
// planToJson — the JSON projection.
// ---------------------------------------------------------------------------

Deno.test("planToJson maps each op to {path, action, note}", () => {
  const p = plan([
    op("a", "create"),
    op("b", "skip", { note: "seed present — left as-is" }),
  ]);
  assertEquals(planToJson(p), [
    { path: "a", action: "create", note: undefined },
    { path: "b", action: "skip", note: "seed present — left as-is" },
  ]);
});

// ---------------------------------------------------------------------------
// Integration: the dry-run plan renderer wired through `setup`. (The grouped
// review screen `renderReview` is now only used by `add-preset` — covered in
// preset_test; `setup` is non-interactive, so it has no review screen.)
// ---------------------------------------------------------------------------

Deno.test("setup --dry-run prints the full per-file plan via renderPlan", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(
      ["setup", "--confirmed", "--dry-run", "--slug", "demo"],
      dir,
    );
    assertEquals(code, 0);
    // The flat listing names the seed files with the create label; nothing was
    // written (dry run).
    assertStringIncludes(stdout, "create");
    assertStringIncludes(stdout, "discern.toml");
  });
});
