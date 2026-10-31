/**
 * Architectural guard: a discern result decodes from its whole finished run.
 *
 * `decodeCliResult` takes the run, so a failed decode reports the exit code
 * and stderr that explain it. A decode that reads only a run's `.stdout` drops
 * that evidence again: passing it to `decodeResultText`, which exists for
 * result JSON no process printed, or hand-building a run from another run's
 * stdout without spreading that run.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const DECODER_MODULE = "tests/decode_cli_result.ts";
const RESULT_TEXT_CALL = ["decodeResultText", "("].join("");
const CLI_RESULT_CALL = ["decodeCliResult", "("].join("");

/** The first argument of the call whose opening parenthesis ends at `open`. */
function firstArgument(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (quote !== null) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return source.slice(open, index);
      depth--;
    } else if (char === "," && depth === 0) return source.slice(open, index);
  }
  return source.slice(open);
}

/** One-based `path:line:column` of a source offset. */
function location(path: string, source: string, offset: number): string {
  const before = source.slice(0, offset).split("\n");
  return `${path}:${before.length}:${(before.at(-1)?.length ?? 0) + 1}`;
}

/** Every decode in `source` that takes a run's stdout without the run. */
export function strippedRunDecodes(path: string, source: string): string[] {
  if (path === DECODER_MODULE) return [];
  const findings: string[] = [];
  for (
    const [callee, stripped] of [
      [RESULT_TEXT_CALL, (argument: string) => /\.stdout\b/.test(argument)],
      [
        CLI_RESULT_CALL,
        (argument: string) =>
          argument.trimStart().startsWith("{") &&
          /\.stdout\b/.test(argument) && !argument.includes("..."),
      ],
    ] as const
  ) {
    let offset = source.indexOf(callee);
    while (offset >= 0) {
      const argument = firstArgument(source, offset + callee.length);
      if (stripped(argument)) findings.push(location(path, source, offset));
      offset = source.indexOf(callee, offset + callee.length);
    }
  }
  return findings;
}

Deno.test("the stripped-run guard catches a future decode under new names", () => {
  const future = [
    'const outcome = await launch(["status", "--json"]);',
    `${RESULT_TEXT_CALL}outcome.stdout, "status");`,
    RESULT_TEXT_CALL,
    '  (await launch(["doctor", "--json"])).stdout.trim(),',
    '  "doctor",',
    ");",
    `${CLI_RESULT_CALL}{ code: 0, stdout: outcome.stdout, stderr: "" }, "s");`,
  ].join("\n");
  assertEquals(strippedRunDecodes("tests/future_test.ts", future), [
    "tests/future_test.ts:2:1",
    "tests/future_test.ts:3:1",
    "tests/future_test.ts:7:1",
  ]);
});

Deno.test("the stripped-run guard leaves whole-run and processless decodes alone", () => {
  const allowed = [
    `${CLI_RESULT_CALL}outcome, "status");`,
    `${CLI_RESULT_CALL}{ code, stdout, stderr }, "status");`,
    `${CLI_RESULT_CALL}{ ...outcome, stdout: outcome.stdout.slice(0, 9) }, "x");`,
    `${RESULT_TEXT_CALL}lines[0] ?? "", "licenses");`,
    `${RESULT_TEXT_CALL}JSON.stringify(content), "status");`,
  ].join("\n");
  assertEquals(strippedRunDecodes("tests/future_test.ts", allowed), []);
});

Deno.test("discern results decode from their whole run", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/cli_run_decode_guard_test.ts#whole-run-decodes",
      universe: {
        kind: "specialized",
        name: "test TypeScript including executable fixture paths",
        extensions: [".ts", ".tsx"],
        reason:
          "AUTHORED_TS_FILES deliberately excludes fixtures, but executable test fixtures also decode discern results.",
      },
      narrow: {
        reason:
          "The result decoders are test helpers; production code decodes through its own runtime boundary.",
        include: (path) => path.startsWith("tests/"),
      },
    })
  ) {
    offenders.push(...strippedRunDecodes(
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ));
  }
  assertEquals(
    offenders,
    [],
    "a discern result decode dropped its run's exit code and stderr; pass the run to decodeCliResult(run, command), spreading it when you alter stdout",
  );
});
