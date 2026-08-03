/**
 * Terminal-dimension funnel guard — size-aware human output funnels through
 * `src/lib/text.ts`, where the wrap helper lives.
 *
 * The grouped `discern --help` and `doctor`'s execution model wrap their prose to
 * the terminal width with {@link wrapText}, reading the width with
 * {@link terminalWidth}. The risk going forward is a NEW human-facing surface that
 * reads terminal dimensions itself (`Deno.consoleSize()`, `$COLUMNS`, or `$LINES`) and then prints
 * long prose WITHOUT wrapping — or wraps it with a second, slightly-different
 * algorithm. Either way the DX drifts.
 *
 * You cannot guard "all prose wraps" structurally: whether a line SHOULD wrap is a
 * judgment (a description should; a data table, a JSON blob, or a file path should
 * not), and discern can't tell them apart. What you CAN guard is the door: the
 * terminal width is read in exactly ONE module, the same module that exports
 * `wrapText`. So any code that becomes width-aware is forced through `lib/text.ts`
 * and meets the wrap helper there — no second ad-hoc reader can quietly diverge.
 * This is the `discern-cure-a-bug` move applied to a presentation concern: pin the
 * single source of terminal dimensions, not every call site that should wrap.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AUTHORED_DENO_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

/** The one module allowed to read terminal dimensions (it pairs width with wrapText). */
const HOME = "src/lib/text.ts";

/** Source with comments removed, so the scan sees calls, not prose that merely
 * mentions `$COLUMNS` while documenting the behaviour. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Runtime source only: tests may name unsafe shapes as detector fixtures. */
const RUNTIME_DENO_FILES = AUTHORED_DENO_FILES.filter((rel) =>
  !rel.startsWith("tests/")
);

/** The terminal-dimension reads that must funnel through {@link HOME}. */
const DIMENSION_READS = [
  { label: "Deno.consoleSize", pattern: /\bconsoleSize\b/u },
  { label: "COLUMNS", pattern: /\bCOLUMNS\b/u },
  { label: "LINES", pattern: /\bLINES\b/u },
] as const;
const NODE_TERMINAL_MODULE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?:node:)?(?:process|tty)["']/u;
const NODE_TERMINAL_DIMENSION = /\b(?:columns|rows|getWindowSize)\b/u;
const GLOBAL_PROCESS_DIMENSION =
  /\bprocess\.stdout\??\.(?:columns|rows|getWindowSize)\b/u;

/** Detect Node's terminal-size capabilities even when imports are aliased. */
function readsNodeTerminalDimensions(code: string): boolean {
  return GLOBAL_PROCESS_DIMENSION.test(code) ||
    (NODE_TERMINAL_MODULE.test(code) && NODE_TERMINAL_DIMENSION.test(code));
}

/** Find forbidden dimension reads in one comment-free runtime source. */
function directDimensionReads(rel: string, source: string): string[] {
  if (rel === HOME) {
    return [];
  }
  const code = codeOnly(source);
  const offenders = DIMENSION_READS.filter(({ pattern }) => pattern.test(code))
    .map(
      ({ label }) => `${rel}  (${label})`,
    );
  if (readsNodeTerminalDimensions(code)) {
    offenders.push(`${rel}  (Node terminal dimensions)`);
  }
  return offenders;
}

Deno.test("terminal dimensions are read only in lib/text.ts (the wrapText funnel)", async () => {
  const offenders: string[] = [];
  for (const rel of RUNTIME_DENO_FILES) {
    offenders.push(
      ...directDimensionReads(
        rel,
        await Deno.readTextFile(join(REPO_ROOT, rel)),
      ),
    );
  }
  assert(
    offenders.length === 0,
    `terminal-dimension reads must funnel through ${HOME} (terminalSize + terminalWidth + wrapText), so ` +
      `width-aware human output always meets the shared wrap helper and can't diverge ` +
      `into an ad-hoc reader that wraps differently — or not at all. Replace the direct ` +
      `read with terminalSize() or terminalWidth():\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("control: a fresh runtime container cannot open a second dimension funnel", () => {
  assertEquals(
    directDimensionReads(
      "tools/whimsy.mjs",
      'const viewport = Deno.consoleSize();\nconst rows = Deno.env.get("LINES");',
    ),
    ["tools/whimsy.mjs  (Deno.consoleSize)", "tools/whimsy.mjs  (LINES)"],
  );
  assertEquals(
    directDimensionReads(
      "tools/aliased.js",
      "const readViewport = Deno.consoleSize;\nconst viewport = readViewport();",
    ),
    ["tools/aliased.js  (Deno.consoleSize)"],
  );
  assertEquals(
    directDimensionReads(
      "tools/node-terminal.mjs",
      'import { stdout as terminal } from "node:process";\n' +
        "const width = terminal.columns;\nconst height = terminal.rows;",
    ),
    ["tools/node-terminal.mjs  (Node terminal dimensions)"],
  );
  assertEquals(
    directDimensionReads(
      "tools/destructured-deno.ts",
      "const { consoleSize: readViewport } = Deno;\nconst viewport = readViewport();",
    ),
    ["tools/destructured-deno.ts  (Deno.consoleSize)"],
  );
  assertEquals(
    directDimensionReads(
      "tools/destructured-node.mjs",
      'const { stdout: { columns, rows } } = await import("node:process");',
    ),
    ["tools/destructured-node.mjs  (Node terminal dimensions)"],
  );
});
