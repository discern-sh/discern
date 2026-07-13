/**
 * The `--json` purity guard (ADR 0030): the regression net that keeps every verb's
 * machine output to the single result envelope and nothing else.
 *
 * Two layers:
 *  1. **Behavioural** — run each `--json` verb against a config whose commands print
 *     loudly to BOTH stdout and stderr, and assert the COMBINED stdout+stderr is
 *     exactly one envelope line. Combined (not just stdout) because an agent calling
 *     through a shell tool captures both; a leak on either stream fails the test.
 *  2. **Structural** — a source-level guard that `serializeResult` is called only
 *     through the one emission chokepoint, so a new verb cannot hand-roll an emit
 *     that bypasses the silence rule.
 *
 * Together they make the "an agent only ever sees JSON" contract impossible to
 * regress: add a verb that streams a stray line, or print an envelope off-channel,
 * and one of these fails the gate.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  type RunResult,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

/**
 * Assert a `<verb> --json` run emitted ONLY the envelope. The compact envelope is a
 * single physical line, and `JSON.stringify` escapes any newline inside a string
 * value (e.g. a diagnostic's captured output) — so a real newline in the combined
 * output means human narration or subprocess output leaked.
 */
function assertEnvelopeOnly(
  r: RunResult,
  verb: string,
  context = verb,
): void {
  const combined = r.output.trim();
  assert(
    combined.length > 0 && !combined.includes("\n"),
    `${context} --json must emit exactly one line (the envelope), nothing else on stdout OR stderr.\n--- got ---\n${r.output}\n-----------`,
  );
  let obj: { ok?: unknown; verb?: unknown };
  try {
    obj = JSON.parse(combined);
  } catch {
    throw new Error(
      `${context} --json combined output is not valid JSON:\n${r.output}`,
    );
  }
  assertEquals(
    typeof obj.ok,
    "boolean",
    `${verb}: envelope missing boolean ok`,
  );
  assertEquals(obj.verb, verb, `${verb}: envelope carries the wrong verb`);
}

/** A config whose every gate command and standard prints loudly to stdout AND
 * stderr (and still succeeds), so a silence regression surfaces as leaked text. */
const NOISY_CONFIG = [
  "[project]",
  'slug = "json-purity"',
  "",
  "[capabilities]",
  `format = "printf 'FMT-OUT\\n'; printf 'FMT-ERR\\n' >&2"`,
  `lint = "printf 'LINT-OUT\\n'; printf 'LINT-ERR\\n' >&2"`,
  `typecheck = "printf 'TC-OUT\\n'"`,
  `test = "printf 'TEST-OUT\\n'; printf 'TEST-ERR\\n' >&2"`,
  "",
  "[standards.cov]",
  `run = "printf 'STANDARD-NOISE\\n'; printf 'DISCERN_METRIC cov 90\\n'"`,
  'direction = "up"',
  "limit = 80",
  "",
].join("\n");

const NOISY_CONFIGS = [
  { name: "buffered", toml: NOISY_CONFIG },
  {
    name: "streamed",
    toml: `${NOISY_CONFIG}\n[gate]\nstream = true\n`,
  },
];

Deno.test("every --json verb emits ONLY the envelope (no human or subprocess leak)", async () => {
  for (const config of NOISY_CONFIGS) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, config.toml);
      await gitInit(dir);

      const cases: Array<{ args: string[]; verb: string }> = [
        { args: ["done", "--json"], verb: "done" },
        { args: ["prepare", "--json"], verb: "prepare" },
        { args: ["test", "--json"], verb: "test" },
        { args: ["standards", "--json"], verb: "standards" },
        { args: ["improvement", "--json"], verb: "improvement" },
        { args: ["impact", "--json"], verb: "impact" },
        { args: ["status", "--json"], verb: "status" },
        { args: ["refresh", "--json"], verb: "refresh" },
        { args: ["skills", "list", "--json"], verb: "skills list" },
        {
          args: ["skills", "eject", "--json", "discern-write-adr"],
          verb: "skills eject",
        },
        // A dry-run preview is an envelope too (plan, no steps).
        { args: ["done", "--dry-run", "--json"], verb: "done" },
      ];
      for (const c of cases) {
        assertEnvelopeOnly(
          await runAgent(dir, c.args),
          c.verb,
          `${c.verb} (${config.name})`,
        );
      }
    });
  }
});

Deno.test("done --json: a FAILING gate captures output INTO the envelope, never leaks it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "json-purity"',
        "",
        "[capabilities]",
        `lint = "printf 'LINT-BOOM-OUT\\n'; printf 'LINT-BOOM-ERR\\n' >&2; exit 1"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    // Single envelope line, despite the failing command's multi-line output…
    assertEnvelopeOnly(r, "done");
    const obj = JSON.parse(r.output.trim());
    assertEquals(obj.ok, false);
    // …and that output rode INTO the envelope as a diagnostic (newlines escaped),
    // which is exactly why it didn't leak as a real stream line.
    assertStringIncludes(
      JSON.stringify(obj.diagnostics),
      "LINT-BOOM",
      "the failing command's output must be captured into the diagnostic",
    );
  });
});

Deno.test("worktree --json: setup steps and resource commands don't leak", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "json-purity"',
        "",
        "[worktree.setup]",
        `steps = ["printf 'SETUP-NOISE-OUT\\n'; printf 'SETUP-NOISE-ERR\\n' >&2"]`,
        "",
        "[worktree.resources.thing]",
        `create = "printf 'RESOURCE-CREATE-NOISE\\n'"`,
        `destroy = "printf 'RESOURCE-DESTROY-NOISE\\n'"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "purity");
    // `worktree setup` runs setup: the printing setup step + resource create must
    // be silenced under --json (they inherit stdio in human mode).
    assertEnvelopeOnly(
      await runAgent(wt, ["worktree", "setup", "--json"]),
      "worktree setup",
    );
  });
});

Deno.test("a pre-verb config error is still the uniform envelope (verb + single line)", async () => {
  await withTempDir(async (dir) => {
    // A malformed discern.toml fails during the pre-flight config read, before the
    // verb runs — the one global error path. It must still be the envelope.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this is = not valid toml [[[\n",
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEnvelopeOnly(r, "done"); // carries the attempted verb, single line
    assertEquals(JSON.parse(r.output.trim()).error, "invalid_toml");
  });
});

Deno.test("serializeResult reaches stdout ONLY through the emitResult chokepoint", async () => {
  // The wire shape is defined once (result.ts) and printed once (emit.ts). The MCP
  // server is the one other legitimate caller — it folds the serialized envelope
  // into a JSON-RPC tool result, not onto stdout. Any other file calling
  // serializeResult is a verb hand-rolling an emit that escapes the silence rule.
  const allowed = new Set([
    join("src", "shared", "result.ts"), // the definition
    join("src", "shared", "emit.ts"), // the single print site
    join("src", "engine", "mcp", "server.ts"), // builds the MCP tool result
  ]);
  const offenders: string[] = [];
  for await (const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })) {
    const rel = relative(REPO_ROOT, entry.path);
    if (allowed.has(rel)) {
      continue;
    }
    const text = await Deno.readTextFile(entry.path);
    if (/serializeResult\s*\(/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    `serializeResult must only be emitted via emitResult (src/shared/emit.ts) or the MCP renderer.\n` +
      `Hand-rolled envelope emission found in:\n  ${offenders.join("\n  ")}`,
  );
});
