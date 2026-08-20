/**
 * The `[checkpoints.<id>]` config surface: what parses, what loads, and what a
 * programmatic writes may produce. The generic record-family guards
 * (banner parity, settable paths, key legality) enrol the section
 * automatically; these tests pin the checkpoint-specific semantic boundary:
 * selector errors and incomplete or ambiguous question sources block both
 * writes and loads.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  configWriteIssues,
  parseConfig,
  RECORD_ENTRY_SCHEMAS,
} from "../src/shared/config_schema.ts";
import { applyConfigDoc } from "../src/lib/config_doc.ts";
import type { DiscernConfigDoc } from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { CHECKPOINT_PATTERN_LIMITS } from "../src/shared/checkpoints.ts";

const CONTENT_PATTERN_FIELDS = [
  "adds_matching",
  "removes_matching",
] as const;

/** Parse one complete entry through the live checkpoint record schema. */
function parsePatternEntry(
  field: (typeof CONTENT_PATTERN_FIELDS)[number],
  patterns: readonly string[],
): ReturnType<typeof RECORD_ENTRY_SCHEMAS.checkpoints.safeParse> {
  return RECORD_ENTRY_SCHEMAS.checkpoints.safeParse({
    question: "Judged.",
    [field]: patterns,
  });
}

const SCOPED = `
[scopes.docs]
paths = ["docs/**"]

[checkpoints.docs-review]
scope = "docs"
min_changed_files = 3
mode = "advise"
question = "Changed pages still reduce the reading needed for a correct decision."
teach = "Behaviour and where to look, never inventories."
reference = "project/map/review-notes.md"
`;

Deno.test("a full checkpoint entry parses with every field preserved", () => {
  const { config, issues } = parseConfig(SCOPED);
  assertEquals(issues, []);
  assert(config !== undefined);
  const entry = config.checkpoints["docs-review"];
  assert(entry !== undefined);
  assertEquals(entry.scope, "docs");
  assertEquals(entry.min_changed_files, 3);
  assertEquals(entry.mode, "advise");
  assertEquals(entry.teach, "Behaviour and where to look, never inventories.");
  assertEquals(entry.reference, "project/map/review-notes.md");
});

Deno.test("unset checkpoint fields stay absent (presence is meaningful at resolution)", () => {
  const { config } = parseConfig(`
[checkpoints.plain]
paths = ["src/**"]
question = "The change is judged."
`);
  assert(config !== undefined);
  const entry = config.checkpoints.plain;
  assert(entry !== undefined);
  assertEquals(entry.mode, undefined);
  assertEquals(entry.deletion_dominant, undefined);
  assertEquals(entry.similar_new_file, undefined);
  assertEquals(entry.min_changed_files, undefined);
  assertEquals(entry.unless_changed, undefined);
});

Deno.test("a checkpoint scope selector must name a configured scope", () => {
  const { config, issues } = parseConfig(`
[checkpoints.x]
scope = "nope"
question = "Judged."
`);
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "checkpoints.x.scope");
  assert(issue !== undefined);
  assertStringIncludes(issue.message, 'unknown scope "nope"');
  // A reference issue is wrong however complete the entry becomes, so it
  // blocks a programmatic write too.
  assert(
    configWriteIssues(`[checkpoints.x]\nscope = "nope"\n`)
      .some((i) => i.path === "checkpoints.x.scope"),
  );
});

Deno.test("a checkpoint takes one selector — scope or paths, not both", () => {
  const both = `
[scopes.docs]
paths = ["docs/**"]

[checkpoints.x]
scope = "docs"
paths = ["docs/**"]
question = "Judged."
`;
  const { config, issues } = parseConfig(both);
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "checkpoints.x");
  assert(issue !== undefined);
  assertStringIncludes(issue.message, "not both");
  assert(configWriteIssues(both).some((i) => i.path === "checkpoints.x"));
});

Deno.test("an authored checkpoint without a question source blocks loads and writes", () => {
  const incomplete = `
[checkpoints.mine]
paths = ["src/**"]
`;
  const { config, issues } = parseConfig(incomplete);
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "checkpoints.mine");
  assert(issue !== undefined);
  assertStringIncludes(issue.message, "question");
  assert(
    configWriteIssues(incomplete).some((i) => i.path === "checkpoints.mine"),
  );
});

Deno.test("a checkpoint takes one explicit question source, while a built-in may inherit", () => {
  for (const id of ["mine", "map-focus"]) {
    const text = `[checkpoints.${id}]\nquestion = "Inline."\n` +
      'question_file = "policy/review.md"\n';
    const { config, issues } = parseConfig(text);
    assertEquals(config, undefined, id);
    const issue = issues.find((candidate) =>
      candidate.path === `checkpoints.${id}`
    );
    assert(issue !== undefined, id);
    assertStringIncludes(issue.message, `[checkpoints.${id}]`);
    assertStringIncludes(issue.message, "question_file");
    assert(
      configWriteIssues(text).some((candidate) =>
        candidate.path === `checkpoints.${id}`
      ),
    );
  }

  const inherited = parseConfig("[checkpoints.map-focus]\n");
  assert(inherited.config !== undefined);
  assertEquals(inherited.issues, []);
});

Deno.test("question_file uses the portable project-relative file path contract", () => {
  const valid = parseConfig(
    '[checkpoints.mine]\nquestion_file = "./policy/review question.md"\n',
  );
  assert(valid.config !== undefined);
  assertEquals(
    valid.config.checkpoints.mine?.question_file,
    "policy/review question.md",
  );
  for (
    const path of [
      "/absolute.md",
      "../outside.md",
      ".git/question.md",
      "policy//question.md",
      "https://example.test/question.md",
    ]
  ) {
    const parsed = parseConfig(
      `[checkpoints.mine]\nquestion_file = ${JSON.stringify(path)}\n`,
    );
    assertEquals(parsed.config, undefined, path);
    assert(
      parsed.issues.some((issue) =>
        issue.path === "checkpoints.mine.question_file"
      ),
      path,
    );
  }
});

Deno.test("a whitespace-only question reads as missing", () => {
  const { config, issues } = parseConfig(`
[checkpoints.mine]
question = "   "
`);
  assertEquals(config, undefined);
  assert(issues.some((i) => i.path === "checkpoints.mine.question"));
});

Deno.test("min_changed_files rejects zero and non-integers", () => {
  for (const bad of ["min_changed_files = 0", "min_changed_files = 1.5"]) {
    const { config, issues } = parseConfig(
      `[checkpoints.x]\nquestion = "Judged."\n${bad}\n`,
    );
    assertEquals(config, undefined, bad);
    assert(
      issues.some((i) => i.path === "checkpoints.x.min_changed_files"),
      bad,
    );
  }
});

Deno.test("content-pattern fields reject every invalid list and literal shape", () => {
  const invalid = [
    { label: "empty list", patterns: [] },
    { label: "empty literal", patterns: [""] },
    { label: "duplicate literal", patterns: ["same", "same"] },
    { label: "NUL", patterns: ["left\0right"] },
    { label: "CR", patterns: ["left\rright"] },
    { label: "LF", patterns: ["left\nright"] },
  ] as const;
  for (const field of CONTENT_PATTERN_FIELDS) {
    for (const { label, patterns } of invalid) {
      const parsed = parsePatternEntry(field, patterns);
      assertEquals(parsed.success, false, `${field}: ${label}`);
      if (parsed.success) continue;
      assert(
        parsed.error.issues.some((issue) => issue.path[0] === field),
        `${field}: ${label}: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
  }
});

Deno.test("content-pattern count and UTF-8 byte limits accept the exact boundary only", () => {
  const countLimit = CHECKPOINT_PATTERN_LIMITS.maxPatternsPerField;
  assertEquals(countLimit, 16);
  const exactCount = Array.from(
    { length: countLimit },
    (_, index) => `literal-${index}`,
  );
  const overCount = [...exactCount, `literal-${countLimit}`];
  const byteLimit = CHECKPOINT_PATTERN_LIMITS.maxPatternBytes;
  assertEquals(byteLimit, 128);
  const exactBytes = "é".repeat(byteLimit / 2);
  const overBytes = `${exactBytes}a`;
  const encoder = new TextEncoder();
  assertEquals(encoder.encode(exactBytes).length, byteLimit);
  assertEquals(encoder.encode(overBytes).length, byteLimit + 1);

  for (const field of CONTENT_PATTERN_FIELDS) {
    for (
      const [label, patterns] of [
        ["exact count", exactCount],
        ["exact UTF-8 bytes", [exactBytes]],
      ] as const
    ) {
      const parsed = parsePatternEntry(field, patterns);
      assert(parsed.success, `${field}: ${label}`);
    }
    for (
      const [label, patterns] of [
        ["count over", overCount],
        ["UTF-8 bytes over", [overBytes]],
      ] as const
    ) {
      const parsed = parsePatternEntry(field, patterns);
      assertEquals(parsed.success, false, `${field}: ${label}`);
      if (parsed.success) continue;
      assert(
        parsed.error.issues.some((issue) => issue.path[0] === field),
        `${field}: ${label}: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
  }
});

Deno.test("mode accepts only the closed pair", () => {
  const { config, issues } = parseConfig(`
[checkpoints.x]
question = "Judged."
mode = "block"
`);
  assertEquals(config, undefined);
  assert(issues.some((i) => i.path === "checkpoints.x.mode"));
  for (const mode of ["stop", "advise"]) {
    const ok = parseConfig(
      `[checkpoints.x]\nquestion = "Judged."\nmode = "${mode}"\n`,
    );
    assertEquals(ok.issues, [], mode);
  }
});

Deno.test("an unknown key inside a checkpoint entry is a load error", () => {
  const { config, issues } = parseConfig(`
[checkpoints.x]
question = "Judged."
serverity = "high"
`);
  assertEquals(config, undefined);
  assert(issues.some((i) => i.path.startsWith("checkpoints.x")));
});

Deno.test("the config document writes every checkpoint field the live schema declares", () => {
  const checkpoints = {
    "docs-review": {
      scope: "docs",
      include_generated: true,
      exclude_paths: ["docs/generated/**"],
      unless_changed: ["docs/reference/**"],
      kinds: ["added" as const, "modified" as const],
      adds_matching: ["new dependency"],
      removes_matching: ["legacy dependency"],
      new_directory: true,
      binary: false,
      min_changed_files: 2,
      min_changed_lines: 20,
      deletion_dominant: true,
      similar_new_file: true,
      min_commits: 2,
      when: "check-docs",
      mode: "advise" as const,
      question: "Changed pages still earn their place.",
      teach: "Prose the reader needed, not an inventory.",
      reference: "project/map/review-notes.md",
    },
    "path-review": {
      paths: ["src/**"],
      question_file: "policy/source review.md",
    },
  } satisfies NonNullable<DiscernConfigDoc["checkpoints"]>;
  const coveredFields = new Set(
    Object.values(checkpoints).flatMap((entry) => Object.keys(entry)),
  );
  assertEquals(
    [...coveredFields].sort(),
    Object.keys(RECORD_ENTRY_SCHEMAS.checkpoints.shape).sort(),
    "a new checkpoint config field must join the document writer/parser fixture",
  );

  const editor = new TomlEditor("");
  const report = applyConfigDoc(editor, {
    scopes: { docs: { paths: ["docs/**"] } },
    checkpoints,
  });
  assert(report.filled.includes("checkpoints.docs-review"));
  assert(report.filled.includes("checkpoints.path-review"));
  const { config, issues } = parseConfig(editor.toString());
  assertEquals(issues, []);
  assert(config !== undefined);
  assertEquals(config.checkpoints, checkpoints);
});

Deno.test("a config document refuses an authored checkpoint without a question source", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        new TomlEditor(""),
        {
          checkpoints: { mine: { paths: ["src/**"] } },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    "[checkpoints.mine] must set exactly one question source",
  );
});

Deno.test("a config document refuses two checkpoint question sources", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        new TomlEditor(""),
        {
          checkpoints: {
            mine: {
              question: "Inline.",
              question_file: "policy/question.md",
            },
          },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    "[checkpoints.mine] sets both question and question_file",
  );
});

Deno.test("a config document refuses two checkpoint selectors", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        new TomlEditor(""),
        {
          checkpoints: {
            x: { scope: "docs", paths: ["docs/**"], question: "Judged." },
          },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    "scope or paths, not both",
  );
});
