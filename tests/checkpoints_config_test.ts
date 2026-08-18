/**
 * The `[checkpoints.<id>]` config surface: what parses, what loads, and what a
 * programmatic write may leave incomplete. The generic record-family guards
 * (banner parity, settable paths, key legality) enrol the section
 * automatically; these tests pin the checkpoint-specific validation split:
 * reference issues (unknown scope, both selectors) block writes AND loads,
 * while completeness (a non-built-in entry's missing criterion) blocks loads
 * only, so an entry can be built incrementally like any record family's.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { configWriteIssues, parseConfig } from "../src/shared/config_schema.ts";
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
criterion = "Changed pages still reduce the reading needed for a correct decision."
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
criterion = "The change is judged."
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
criterion = "Judged."
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
criterion = "Judged."
`;
  const { config, issues } = parseConfig(both);
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "checkpoints.x");
  assert(issue !== undefined);
  assertStringIncludes(issue.message, "not both");
  assert(configWriteIssues(both).some((i) => i.path === "checkpoints.x"));
});

Deno.test("an authored checkpoint without a criterion fails the LOAD, not the incremental write", () => {
  const incomplete = `
[checkpoints.mine]
paths = ["src/**"]
`;
  const { config, issues } = parseConfig(incomplete);
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "checkpoints.mine.criterion");
  assert(issue !== undefined);
  assertStringIncludes(issue.message, "criterion");
  // Incremental construction stays legal: the write-time check excuses the
  // missing criterion exactly as it excuses a standards entry's missing run.
  assertEquals(configWriteIssues(incomplete), []);
});

Deno.test("a whitespace-only criterion reads as missing", () => {
  const { config, issues } = parseConfig(`
[checkpoints.mine]
criterion = "   "
`);
  assertEquals(config, undefined);
  assert(issues.some((i) => i.path === "checkpoints.mine.criterion"));
});

Deno.test("min_changed_files rejects zero and non-integers", () => {
  for (const bad of ["min_changed_files = 0", "min_changed_files = 1.5"]) {
    const { config, issues } = parseConfig(
      `[checkpoints.x]\ncriterion = "Judged."\n${bad}\n`,
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
criterion = "Judged."
mode = "block"
`);
  assertEquals(config, undefined);
  assert(issues.some((i) => i.path === "checkpoints.x.mode"));
  for (const mode of ["stop", "advise"]) {
    const ok = parseConfig(
      `[checkpoints.x]\ncriterion = "Judged."\nmode = "${mode}"\n`,
    );
    assertEquals(ok.issues, [], mode);
  }
});

Deno.test("an unknown key inside a checkpoint entry is a load error", () => {
  const { config, issues } = parseConfig(`
[checkpoints.x]
criterion = "Judged."
serverity = "high"
`);
  assertEquals(config, undefined);
  assert(issues.some((i) => i.path.startsWith("checkpoints.x")));
});

Deno.test("a config document applies a checkpoint that the live schema then loads", () => {
  const editor = new TomlEditor("");
  const report = applyConfigDoc(editor, {
    scopes: { docs: { paths: ["docs/**"] } },
    checkpoints: {
      "docs-review": {
        scope: "docs",
        min_changed_files: 2,
        mode: "advise",
        criterion: "Changed pages still earn their place.",
        teach: "Prose the reader needed, not an inventory.",
      },
    },
  });
  assert(report.filled.includes("checkpoints.docs-review"));
  const { config, issues } = parseConfig(editor.toString());
  assertEquals(issues, []);
  assert(config !== undefined);
  assertEquals(config.checkpoints["docs-review"]?.min_changed_files, 2);
});

Deno.test("a config document refuses an authored checkpoint without a criterion", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        new TomlEditor(""),
        {
          checkpoints: { mine: { paths: ["src/**"] } },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'checkpoint "mine": a criterion is required',
  );
});

Deno.test("a config document refuses two checkpoint selectors", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        new TomlEditor(""),
        {
          checkpoints: {
            x: { scope: "docs", paths: ["docs/**"], criterion: "Judged." },
          },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    "scope or paths, not both",
  );
});
