/**
 * Structural guard for discern-managed human output groups.
 *
 * A semantic boundary must be expressed through the shared grouping renderer or
 * grouped-prompt helper. Hand-emitting an empty line or reaching straight for
 * Cliffy's separator recreates the permissive boundary that let composed views
 * collapse into flat lists.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  populatedHumanOutputGroups,
  renderHumanOutputGroups,
} from "../src/shared/result.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";
import { makeOut } from "../src/engine/output.ts";
import { groupedSelectOptions } from "../src/lib/prompts.ts";

interface BoundaryFinding {
  readonly rule: string;
  readonly offset: number;
}

const MANUAL_BOUNDARY_RULES: readonly {
  readonly id: string;
  readonly pattern: RegExp;
}[] = [
  {
    id: "empty-console-line",
    pattern: /console\.(?:log|error|warn)\(\s*([\"'`])\1\s*\)/g,
  },
  {
    id: "escaped-newline-console-call",
    pattern: /console\.(?:log|error|warn)\(\s*(?:[\"']\\n|`\\n)/g,
  },
  {
    id: "double-newline-console-call",
    pattern: /console\.(?:log|error|warn)\([^;]*?\\n\\n[^;]*?\)/gs,
  },
  {
    id: "empty-output-call",
    pattern: /\.(?:line|humanLine)\(\s*\)/g,
  },
  {
    id: "empty-output-string",
    pattern: /\.(?:line|humanLine)\(\s*([\"'`])\1\s*\)/g,
  },
  {
    id: "escaped-newline-output-call",
    pattern: /\.(?:line|humanLine|raw)\(\s*(?:[\"']\\n|`\\n)/g,
  },
  {
    id: "double-newline-output-call",
    pattern: /\.(?:line|humanLine|raw)\([^;]*?\\n\\n[^;]*?\)/gs,
  },
  {
    id: "joined-line-output-call",
    pattern:
      /console\.(?:log|error|warn)\(\s*[^;]*?\.join\(\s*[\"']\\n[\"']\s*\)\s*\)/gs,
  },
];

function manualBoundaryFindings(source: string): BoundaryFinding[] {
  return MANUAL_BOUNDARY_RULES.flatMap(({ id, pattern }) => {
    pattern.lastIndex = 0;
    return [...source.matchAll(pattern)].map((match) => ({
      rule: id,
      offset: match.index ?? 0,
    }));
  });
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

Deno.test("human-output boundary detector rejects unrelated future siblings", () => {
  const synthetic = [
    'function orbit(writer: { raw(s: string): void }) { writer.raw("\\n"); }',
    'function canopy() { console.log(""); }',
    "function harbor(log: { line(): void }) { log.line(); }",
    'function estuary(lines: string[]) { console.log(lines.join("\\n")); }',
    'function inlet(log: { line(s: string): void }) { log.line(""); }',
    'function delta(writer: { raw(s: string): void }) { writer.raw("one\\n\\ntwo"); }',
    'function shoal() { console.error("\\n"); }',
    'function channel() { console.warn("one\\n\\ntwo"); }',
  ].join("\n");

  assertEquals(
    manualBoundaryFindings(synthetic).map((finding) => finding.rule).sort(),
    [
      "double-newline-console-call",
      "double-newline-output-call",
      "empty-console-line",
      "empty-output-call",
      "empty-output-string",
      "escaped-newline-console-call",
      "escaped-newline-output-call",
      "joined-line-output-call",
    ],
  );
});

Deno.test("the text grouping surface owns populated boundaries and identities", () => {
  const rendered = renderHumanOutputGroups([
    { id: "orbit", items: ["first\n", "second"] },
    { id: "canopy", label: "Canopy", items: [] },
    { id: "harbor", label: "Harbor", items: ["third"] },
  ], {
    leadingBoundary: true,
    renderLabel: (group) => group.label,
  });

  assertEquals(rendered, "\nfirst\nsecond\n\nHarbor\nthird");
  assertThrows(
    () => populatedHumanOutputGroups([{ id: " ", items: ["one"] }]),
    Error,
    "must not be blank",
  );
  assertThrows(
    () =>
      populatedHumanOutputGroups([
        { id: "orbit", items: ["one"] },
        { id: "orbit", items: ["two"] },
      ]),
    Error,
    "duplicate human output group id",
  );
  assertThrows(
    () =>
      populatedHumanOutputGroups([{
        id: "orbit",
        label: " ",
        items: ["one"],
      }]),
    Error,
    "label must not be blank",
  );
});

Deno.test("the live output grouping surface writes exactly one complete boundary", () => {
  const chunks: string[] = [];
  const errors: string[] = [];
  const out = makeOut(false, {
    stdout: (text) => chunks.push(text),
    stderr: (text) => errors.push(text),
  });

  out.group("leading");
  out.raw("first");
  out.group("second");
  out.group("same-boundary");
  out.raw("second\n");
  out.group("third");
  out.info("third");
  out.group("fourth", "Fourth");
  out.raw("fourth\n");
  assertThrows(
    () => out.group("invalid-label", " "),
    Error,
    "label must not be blank",
  );

  assertEquals(
    chunks.join(""),
    "first\n\nsecond\n\n→ third\n\n  ── Fourth\nfourth\n",
  );

  out.error("failure");
  out.group("failure-recovery", "Recovery");
  out.warn("fix it");
  assertEquals(
    errors.join(""),
    "✗ failure\n\n  ── Recovery\n! fix it\n",
  );
});

Deno.test("the prompt grouping surface labels every populated group", () => {
  const options = groupedSelectOptions<string>([
    {
      id: "orbit",
      label: "Orbit",
      items: [{ name: "First", value: "first" }],
    },
    { id: "canopy", label: "Canopy", items: [] },
    {
      id: "harbor",
      label: "Harbor",
      items: [{ name: "Second", value: "second" }],
    },
  ]);

  assertEquals(options.length, 4);
  const serialized = JSON.stringify(options);
  assertStringIncludes(serialized, "── Orbit ──");
  assertStringIncludes(serialized, "── Harbor ──");
  assert(!serialized.includes("Canopy"));
});

Deno.test("discern-managed human boundaries use the semantic grouping surface", async () => {
  const offenders: string[] = [];
  for (
    const rel of AUTHORED_TS_FILES.filter((path) => path.startsWith("src/"))
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const finding of manualBoundaryFindings(source)) {
      offenders.push(
        `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
      );
    }
    if (rel !== "src/lib/prompts.ts" && source.includes("Select.separator(")) {
      offenders.push(`${rel} (direct-select-separator)`);
    }
  }

  assert(
    offenders.length === 0,
    "Human output groups must go through the shared text/prompt grouping surfaces; " +
      `found:\n${offenders.join("\n")}`,
  );
});
