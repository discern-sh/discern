/**
 * Engine coverage for the `impact` verb's output surface — the human
 * line list, the `--has` membership exit code, and the `--json` DiscernResult
 * envelope (ADR 0028: `{ok, verb, data:{scopes}}`, no longer a bare array).
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  classifyScopes,
  CODE_MARKER,
  isScopeMarker,
  PREVIEWABLE_MARKER,
} from "../src/engine/scopes/scopes.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/** Create a minimal project with one gated widget scope for impact classification. */
async function scaffoldWithWidget(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[scopes.widget]",
      'paths = ["widget/**"]',
      'gate = "true"',
      "",
    ].join("\n"),
  );
  await gitInit(dir);
  await writeExecutable(join(dir, "widget/x.txt"), "x"); // make widget a changed scope
}

Deno.test("impact --json: emits the DiscernResult envelope, not a bare array", async () => {
  await withTempDir(async (dir) => {
    await scaffoldWithWidget(dir);
    const r = await runAgent(dir, ["impact", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "impact");
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "impact");
    assertResultDataKey(obj, "scopes");
    assert(Array.isArray(obj.data.scopes), r.stdout);
    assert(obj.data.scopes.includes("widget"), r.stdout);
  });
});

Deno.test("impact emits ONLY declared SCOPE_MARKERS alongside the configured scope names", async () => {
  // The producer's marker pushes go through the SCOPE_MARKERS SSOT; this pins that
  // behaviourally. A previewable scope change fires both derived markers, and EVERY
  // emitted entry must be either a configured scope name or a declared marker — so a
  // future bare-literal `out.push("...")` outside SCOPE_MARKERS red-lights here.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.web]",
        'paths = ["web/**"]',
        "previewable = true",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "web/x.txt"), "x"); // a previewable change

    const result = await classifyScopes(dir);
    // Both derived markers fire for a previewable, non-neutral change (behaviour).
    assert(
      result.includes(CODE_MARKER),
      `expected ${CODE_MARKER} in ${result}`,
    );
    assert(
      result.includes(PREVIEWABLE_MARKER),
      `expected ${PREVIEWABLE_MARKER} in ${result}`,
    );
    // Every non-scope-name entry is a DECLARED marker (the producer-side tie).
    const scopeNames = new Set(Object.keys((await loadConfig(dir)).scopes));
    for (const entry of result) {
      assert(
        scopeNames.has(entry) || isScopeMarker(entry),
        `scopes emitted "${entry}", neither a configured scope nor a declared marker`,
      );
    }
  });
});

// The CLASS guard for B27: "a marker derived from a filtered view when its
// contract is defined over the unfiltered set". The `previewable` marker's
// contract is "a previewable-flagged scope changed" — a property of the
// previewable flag ALONE, independent of the neutral flag. It used to be read
// off `fired`, computed over NON-neutral scopes only, so a scope that was both
// neutral AND previewable changed without ever lighting the marker. This drives
// the full cross-product of the two flags off one table and asserts the marker
// tracks `previewable` at every neutral setting — so re-filtering the marker's
// input by any other flag re-breaks it here. The neutral+previewable row is the
// case the pre-fix derivation dropped.
Deno.test("previewable marker tracks the previewable flag at every neutral setting", async (t) => {
  const cases: {
    neutral: boolean;
    previewable: boolean;
    wantPreviewable: boolean;
    wantCode: boolean;
  }[] = [
    // previewable, non-neutral: the ordinary human-visible gated scope.
    {
      neutral: false,
      previewable: true,
      wantPreviewable: true,
      wantCode: true,
    },
    // previewable AND neutral: fires no gate, but a person can still see it —
    // the marker MUST light (the regression this guard exists for).
    {
      neutral: true,
      previewable: true,
      wantPreviewable: true,
      wantCode: false,
    },
    // not previewable: the marker must stay dark whether neutral or not.
    {
      neutral: false,
      previewable: false,
      wantPreviewable: false,
      wantCode: true,
    },
    {
      neutral: true,
      previewable: false,
      wantPreviewable: false,
      wantCode: false,
    },
  ];
  for (const c of cases) {
    const name = `neutral=${c.neutral} previewable=${c.previewable}`;
    await t.step(name, async () => {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir);
        await writeConfig(
          dir,
          [
            "[project]",
            'slug = "engine-test"',
            "",
            "[repository]",
            'trunk = "main"',
            "",
            "[scopes.zone]",
            'paths = ["zone/**"]',
            ...(c.neutral ? ["neutral = true"] : []),
            ...(c.previewable ? ["previewable = true"] : []),
            "",
          ].join("\n"),
        );
        await gitInit(dir);
        await writeExecutable(join(dir, "zone/x.txt"), "x");

        const result = await classifyScopes(dir);
        assertEquals(
          result.includes(PREVIEWABLE_MARKER),
          c.wantPreviewable,
          `${name}: previewable marker — got [${result}]`,
        );
        // Guard against over-firing: a neutral change must never count as code.
        assertEquals(
          result.includes(CODE_MARKER),
          c.wantCode,
          `${name}: code marker — got [${result}]`,
        );
      });
    });
  }
});

Deno.test("impact: a rename OUT of a gated scope still fires the vacated scope", async (t) => {
  // A rename is a deletion from the old scope plus an addition elsewhere. Dropping
  // the vacated (old) path would run FEWER gates than a plain deletion of the same
  // file — exactly what the fail-open doctrine forbids. Table-driven over BOTH
  // change-set sources: the committed diff (main...HEAD) and the porcelain
  // working tree (a staged rename).
  for (const commit of [true, false]) {
    const name = commit ? "committed rename" : "staged, uncommitted rename";
    await t.step(name, async () => {
      await withTempDir(async (dir) => {
        await scaffoldWithWidget(dir); // widget/x.txt exists, still untracked
        await git(dir, "add", "-A");
        await git(dir, "commit", "-q", "-m", "widget on main", "--no-gpg-sign");
        await git(dir, "checkout", "-q", "-b", "task");
        await Deno.mkdir(join(dir, "attic"), { recursive: true });
        await git(dir, "mv", "widget/x.txt", "attic/x.txt");
        if (commit) {
          await git(
            dir,
            "commit",
            "-q",
            "-m",
            "vacate widget",
            "--no-gpg-sign",
          );
        }
        const result = await classifyScopes(dir);
        assert(
          result.includes("widget"),
          `${name}: the vacated scope must fire, got: [${result}]`,
        );
      });
    });
  }
});

Deno.test("impact fails open when git cannot diff against the main branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.map]",
        'paths = ["docs/**"]',
        "neutral = true",
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        "previewable = true",
        "",
        "[scopes.api]",
        'paths = ["api/**"]',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await git(dir, "branch", "-M", "trunk");

    const r = await runAgent(dir, ["impact", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "impact");
    assertResultDataKey(obj, "scopes");
    assertEquals(obj.data.scopes, [
      CODE_MARKER,
      PREVIEWABLE_MARKER,
      "widget",
      "api",
    ]);
  });
});

Deno.test("impact: a committed non-ASCII filename still fires its scope", async () => {
  // git C-quotes "unusual" paths in line-oriented output (default core.quotePath),
  // e.g. `"widget/a\303\261adir.txt"` — a string no scope pattern can match. The
  // engine must read the branch's changed paths NUL-separated (-z), so the scope
  // fires on the real path.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "feat");
    await writeExecutable(join(dir, "widget/añadir.txt"), "x");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "non-ascii", "--no-gpg-sign");

    const result = await classifyScopes(dir);
    assert(
      result.includes("widget"),
      `a committed widget/añadir.txt must fire the widget scope: ${result}`,
    );
  });
});

Deno.test("impact: an uncommitted path under a non-ASCII directory still fires its scope", async () => {
  // The working-tree half reads `git status --porcelain`; C-quoted entries used
  // to keep their octal escapes, so a pattern naming a non-ASCII directory never
  // matched the pending change.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.intl]",
        'paths = ["café/**"]',
        'gate = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "café/x.txt"), "x"); // untracked, uncommitted

    const result = await classifyScopes(dir);
    assert(
      result.includes("intl"),
      `an untracked café/x.txt must fire the intl scope: ${result}`,
    );
  });
});

Deno.test("impact: a docs-only branch stays neutral when the doc's filename is non-ASCII", async () => {
  // The complementary failure: a C-quoted docs path escapes the neutral filter,
  // so a docs-only branch misclassifies as a `code` change.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.map]",
        'paths = ["docs/**"]',
        "neutral = true",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "feat");
    await writeExecutable(join(dir, "docs/añadir.md"), "notes");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "docs only", "--no-gpg-sign");

    assertEquals(
      await classifyScopes(dir),
      [],
      "a docs-only change must classify neutral regardless of the filename's bytes",
    );
  });
});

Deno.test("impact: a scope defined with standard glob syntax fires", async () => {
  // The template invites "** for any depth", so `widget/**/*.txt` must select
  // the scope — historically it fell through to exact match and the scope was
  // permanently dead (its gate never ran, with no diagnostic anywhere).
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**/*.txt"]',
        'gate = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/sub/note.txt"), "x");

    const result = await classifyScopes(dir);
    assert(
      result.includes("widget"),
      `widget/**/*.txt must match widget/sub/note.txt: ${result}`,
    );
  });
});

Deno.test("impact: human mode lists scopes one per line; --has tests membership by exit code", async () => {
  await withTempDir(async (dir) => {
    await scaffoldWithWidget(dir);

    const human = await runAgent(dir, ["impact"]);
    assertEquals(human.code, 0, human.output);
    assert(
      human.stdout.split("\n").includes("widget"),
      `expected 'widget' on its own line, got: ${human.stdout}`,
    );

    const hit = await runAgent(dir, ["impact", "--has", "widget"]);
    assertEquals(hit.code, 0, "widget changed → exit 0");
    const miss = await runAgent(dir, ["impact", "--has", "nope"]);
    assertEquals(miss.code, 1, "unknown scope → exit 1");
  });
});
