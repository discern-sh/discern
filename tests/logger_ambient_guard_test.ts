/**
 * Human-mode Loggers in tests must inject their terminal context.
 *
 * A `json: false` Logger renders decorated output whose glyph capability is
 * resolved from the process environment when no `terminal` is injected, so a
 * test that constructs one ambiently asserts the shell's locale instead of
 * the code — green in a UTF-8 terminal, red in a locale-less shell (agent
 * harnesses, bare CI). JSON-mode Loggers never decorate and may stay ambient.
 * Scoped to `tests/`: production code resolving the ambient terminal is the
 * product behaviour, not a defect.
 */

import { join } from "@std/path";
import { assertEquals } from "@std/assert";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const CALL = "new Logger(";

/** Each literal `new Logger({ … })` options span in one source, brace-matched. */
function loggerOptionSpans(source: string): string[] {
  const spans: string[] = [];
  let at = source.indexOf(CALL);
  while (at !== -1) {
    const open = at + CALL.length;
    // A non-literal construction (`new Logger(opts)`) is opaque to a source
    // scan; the injected-context rule still applies to what `opts` holds.
    if (source[open] !== "{") {
      at = source.indexOf(CALL, open);
      continue;
    }
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    spans.push(source.slice(open, end + 1));
    at = source.indexOf(CALL, end);
  }
  return spans;
}

Deno.test("human-mode test Loggers pin their terminal context", async () => {
  const offenders: string[] = [];
  for (const file of AUTHORED_TS_FILES) {
    if (!file.startsWith("tests/")) {
      continue;
    }
    const source = await Deno.readTextFile(join(REPO_ROOT, file));
    for (const span of loggerOptionSpans(source)) {
      if (span.includes("json: false") && !span.includes("terminal")) {
        offenders.push(file);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "these tests build a human-mode Logger from the ambient environment; " +
      "pass `terminal: pinnedTerminal()` (tests/helpers.ts) — or another " +
      "injected context — so the asserted decoration cannot float with " +
      "the shell's locale",
  );
});
