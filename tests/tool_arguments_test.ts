/**
 * Repository tools read their arguments through one grammar: one reader of
 * an option's value, one set of refusals. The structural case keeps every
 * other script from growing its own value reader, the way three once did.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { stringLiterals } from "./vocab_scan.ts";
import {
  parseToolArguments,
  toolOptionValue,
} from "../scripts/tool_arguments.ts";

/** The module that owns the option-value refusal. */
const GRAMMAR = "scripts/tool_arguments.ts";

Deno.test("repository tools share one argument grammar", async () => {
  await assertNamedCasesAsync({
    "options, flags, and one operand read in any order": () => {
      const parsed = parseToolArguments(
        ["--", "--replace", "out", "--config", "deno.json"],
        { flags: ["--replace"], values: ["--config"], operand: "directory" },
      );
      assertEquals(parsed.operand, "out");
      assertEquals([...parsed.flags], ["--replace"]);
      assertEquals(parsed.values.get("--config"), "deno.json");
      assertEquals(toolOptionValue(["--checkout", "../kit"], 0), "../kit");
    },
    "every refusal names what is wrong": () => {
      const grammar = { values: ["--config"], operand: "directory" };
      for (
        const [args, message] of [
          [["--config"], "--config needs a value"],
          [["--config", "--other"], "--config needs a value"],
          [["--unknown"], "unknown option: --unknown"],
          [["one", "two"], "pass at most one directory"],
          [[" "], "the directory cannot be empty"],
        ] as const
      ) {
        assertThrows(
          () => parseToolArguments(args, grammar),
          TypeError,
          message,
        );
      }
    },
    "no other script reads an option value by hand": async () => {
      const files = await structuralGuardScope({
        guard: "tests/tool_arguments_test.ts#option-value-readers",
        universe: "authored-ts",
        narrow: {
          reason:
            "Repository tools under scripts/ share the grammar; the CLI's own verbs parse through the engine dispatcher.",
          include: (path) => path.startsWith("scripts/") && path !== GRAMMAR,
        },
      });
      const findings: string[] = [];
      for (const file of files) {
        const source = await Deno.readTextFile(join(REPO_ROOT, file));
        for (const { text, line } of stringLiterals(source)) {
          if (text.includes("needs a value")) {
            findings.push(`${file} line ${line}: ${text}`);
          }
        }
      }
      assertEquals(findings, []);
    },
  });
});
