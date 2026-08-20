/**
 * The `[checkpoints.<id>]` config surface: what parses, what loads, and what a
 * programmatic write may leave incomplete. The generic record-family guards
 * (banner parity, settable paths, key legality) enrol the section
 * automatically; these tests pin the checkpoint-specific validation split:
 * reference issues (unknown scope, both selectors) block writes AND loads,
 * while completeness (a non-built-in entry's missing question) blocks loads
 * only, so an entry can be built incrementally like any record family's.
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

const SCOPED = `
[scopes.docs]
paths = ["docs/**"]

[checkpoints.docs-review]
scope = "docs"
min_changed_files = 3
mode = "advise"
question = "Changed pages still reduce the reading needed for a correct decision."
teach = "Behaviour and where to look, never inventories."
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

Deno.test("an authored checkpoint without a question fails the LOAD, not the incremental write", () => {
  const incomplete = `
[checkpoints.mine]
paths = ["src/**"]
`;
  const { config, issues } = parseConfig(incomplete);
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "checkpoints.mine.question");
  assert(issue !== undefined);
  assertStringIncludes(issue.message, "question");
  // Incremental construction stays legal: the write-time check excuses the
  // missing question exactly as it excuses a standards entry's missing run.
  assertEquals(configWriteIssues(incomplete), []);
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
    },
    "path-review": {
      paths: ["src/**"],
      question: "The selected source change is judged.",
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

Deno.test("a config document refuses an authored checkpoint without a question", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        new TomlEditor(""),
        {
          checkpoints: { mine: { paths: ["src/**"] } },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'checkpoint "mine": a question is required',
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
