/**
 * Copy outside the Desk that names a Desk control (status recovery advice,
 * hints, tips, park refusals and plan titles) quotes the control's
 * registered label, never a typed copy of it. The source scan keeps each
 * quote an import from the Desk vocabulary; the rendered scan proves every
 * control a hint or tip asks a person to choose exists. The feature registry
 * is edited as plain literals by the Canon Editor, so its typed control names
 * must resolve to registered labels instead.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { stringLiterals } from "./vocab_scan.ts";
import { stripCodeSpans } from "../scripts/feature_registry.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  DESK_ACTION_LABELS,
  DESK_COMMAND_LABELS,
  DESK_COMMAND_TOGGLED_LABELS,
  labelName,
} from "../src/shared/desk_vocabulary.ts";
import { renderTipCli, TIPS } from "../src/shared/tips.ts";
import { renderHintInventoryDoc } from "../src/shared/hint_inventory_codegen.ts";

/** Modules that tell people which Desk control to choose. */
const QUOTING_MODULES = new Set([
  "src/engine/status/recovery_presentation.ts",
  "src/engine/worktree/park.ts",
  "src/engine/worktree/plan.ts",
  "src/shared/hints.ts",
  "src/shared/tips.ts",
]);

/** Every label a Desk control shows, from the vocabulary. */
const LABELS: readonly string[] = [
  ...Object.values(DESK_ACTION_LABELS),
  ...Object.values(DESK_COMMAND_LABELS),
  ...Object.values(DESK_COMMAND_TOGGLED_LABELS),
];

/** Labels distinctive enough that typing one in copy can only mean the
 * control: several words, or a promise of a question. */
const DISTINCTIVE: readonly string[] = [
  ...new Set(
    LABELS.flatMap((label) => [label, labelName(label)]).filter((label) =>
      label.includes(" ") || label.endsWith("…")
    ),
  ),
];

/** Typed control names in one module's string literals. */
function typedLabels(source: string): string[] {
  return stringLiterals(source).flatMap(({ text, line }) => [
    ...DISTINCTIVE.filter((label) => text.includes(label)).map((label) =>
      `line ${line}: types "${label}"`
    ),
    ...[...text.matchAll(/\b[Cc]hoose [A-Z]/gu)].map(() =>
      `line ${line}: "choose" a capitalized name typed in place`
    ),
    ...[...text.matchAll(/"[A-Z][^"]*/gu)].map((match) =>
      `line ${line}: quotes ${match[0]} in place`
    ),
  ]);
}

/** Authored registries the Canon Editor rewrites as literals: they may type a
 * control's name, which must then be a registered label. */
const LITERAL_COPY_MODULES = new Set(["scripts/feature_registry.ts"]);

/** Whether a phrase starts with a registered control label. */
function startsWithLabel(phrase: string): boolean {
  return LABELS.some((label) =>
    phrase.startsWith(label) || phrase.startsWith(labelName(label))
  );
}

Deno.test("Desk label guard", async () => {
  const files = await structuralGuardScope({
    guard: "tests/engine_desk_label_guard_test.ts#quoted-desk-labels",
    universe: "authored-ts",
    narrow: {
      reason:
        "These modules address people about Desk controls from outside the Desk; the Desk's own registries are the labels' source.",
      include: (path) => QUOTING_MODULES.has(path),
    },
  });
  await assertNamedCasesAsync({
    "every quoting module is in scope": () => {
      assertEquals(files.length, QUOTING_MODULES.size);
    },
    "copy outside the Desk imports control labels instead of typing them":
      async () => {
        const findings: string[] = [];
        for (const file of files) {
          const source = await Deno.readTextFile(join(REPO_ROOT, file));
          findings.push(...typedLabels(source).map((hit) => `${file} ${hit}`));
        }
        assertEquals(findings, []);
      },
    "the scan recognizes a typed label, a typed choice, and a typed quote":
      () => {
        for (
          const typed of [
            'const a = "Open Run checks… now";',
            'const b = "Choose Show recovery steps.";',
            "const c = 'Use \"Join the landing queue\" next';",
            "const d = 'the desk offers \"Project ' + 'Scripts\".';",
          ]
        ) assert(typedLabels(typed).length > 0, typed);
        assertEquals(
          typedLabels(
            'const a = `choose ${DESK_ACTION_LABELS.recovery}`; const b = "choose whether to wait";',
          ),
          [],
        );
      },
    "every control a literal registry names is a registered label":
      async () => {
        const literalFiles = await structuralGuardScope({
          guard: "tests/engine_desk_label_guard_test.ts#literal-desk-labels",
          universe: "authored-ts",
          narrow: {
            reason:
              "These registries are edited as literals; their typed control names must resolve rather than import.",
            include: (path) => LITERAL_COPY_MODULES.has(path),
          },
        });
        assertEquals(literalFiles.length, LITERAL_COPY_MODULES.size);
        const unresolved: string[] = [];
        for (const file of literalFiles) {
          const source = await Deno.readTextFile(join(REPO_ROOT, file));
          for (const { text, line } of stringLiterals(source)) {
            for (const match of text.matchAll(/\b[Cc]hoose ([A-Z][^.\n]*)/gu)) {
              if (!startsWithLabel(match[1] ?? "")) {
                unresolved.push(`${file} line ${line}: choose ${match[1]}`);
              }
            }
          }
        }
        assertEquals(unresolved, []);
      },
    "every control a tip quotes is a registered label": () => {
      const quoted = TIPS.flatMap((tip) =>
        [...stripCodeSpans(renderTipCli(tip)).matchAll(/"([^"]+)"/gu)].map((
          match,
        ) => [tip.id, match[1] ?? ""] as const)
      );
      assert(quoted.length > 0);
      assertEquals(
        quoted.filter(([, phrase]) => !LABELS.includes(phrase)),
        [],
      );
    },
    "every control a hint asks a person to choose is a registered label":
      () => {
        const choices = [
          ...renderHintInventoryDoc().matchAll(/\b[Cc]hoose ([A-Z][^.\n]*)/gu),
        ].map((match) => match[1] ?? "");
        assert(choices.length > 0);
        assertEquals(choices.filter((phrase) => !startsWithLabel(phrase)), []);
      },
  });
});
