/**
 * Repository control documents fail at the same project-owned checker the Gate
 * runs. Fixtures plant unrelated future siblings so discovery, rather than a
 * copied filename list, is what enrolls each programme and brief.
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assert, assertEquals } from "@std/assert";
import {
  checkProjectControls,
  type ProjectControlFinding,
  type ProjectControlRule,
} from "../scripts/project_control_integrity.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const PROGRAMME = "project/map/_private/planning/fresh-contract-workstreams";
const PAGE_TEMPLATES = "project/map/_internal/page-templates.md";

/** A compact page-shape authority for scope and budget fixtures. */
function pageAuthority(): Readonly<Record<string, string>> {
  return {
    [PAGE_TEMPLATES]: [
      "# Page templates",
      "",
      "<!-- project-page-shape: overview -->",
      "## Overview",
      "",
      "Default budget: 100–200 words.",
      "",
      "<!-- project-page-shape: guide -->",
      "## Guide",
      "",
      "Default budget: 200–300 words.",
      "",
    ].join("\n"),
  };
}

/** Write one synthetic repository tree and return every control finding. */
async function fixtureFindings(
  files: Readonly<Record<string, string>>,
): Promise<ProjectControlFinding[]> {
  let findings: ProjectControlFinding[] = [];
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, ".gitignore"), "\n");
    for (const [path, text] of Object.entries(files)) {
      await ensureDir(dirname(join(root, path)));
      await Deno.writeTextFile(join(root, path), text);
    }
    await gitInit(root);
    findings = await checkProjectControls(root);
  });
  return findings;
}

/** One valid active programme whose extra body may plant a violation. */
function activeProgramme(
  body = "",
): Readonly<Record<string, string>> {
  return {
    [PROGRAMME + "/README.md"]: [
      "# Fresh contract workstreams",
      "",
      "| Key | Brief | Depends on |",
      "| --- | ----- | ---------- |",
      "| 1A | [First](1a-first.md) | — |",
      "",
    ].join("\n"),
    [PROGRAMME + "/1a-first.md"]: [
      "# First",
      "",
      "Run `discern_start` with the literal name `fresh-contract-1a`.",
      body,
      "",
    ].join("\n"),
  };
}

/** Findings for one rule, rendered compactly for exact assertions. */
function ruleFindings(
  findings: readonly ProjectControlFinding[],
  rule: ProjectControlRule,
): string[] {
  return findings.filter((item) => item.rule === rule).map((item) =>
    item.file + ":" + item.line + " " + item.detail
  );
}

Deno.test("the live repository control documents pass their project checker", async () => {
  assertEquals(await checkProjectControls(REPO_ROOT), []);
});

Deno.test("a public clone without the optional private overlay is quiet", async () => {
  assertEquals(await fixtureFindings({}), []);
});

Deno.test("TODO items have one tidy-stable shape and two explicit evidence modes", async () => {
  const repositoryEvidence = {
    "project/TODO.md": [
      "# Open work",
      "",
      "- [ ] **Repair the durable example.** Replace the placeholder with the repository-backed implementation. Evidence: `src/example.ts:12`.",
      "",
      "- [ ] **Complete the account handoff.** Configure the external account after its ownership is assigned. Evidence: Owner-only: The required account has no checkout artifact.",
      "",
    ].join("\n"),
    "src/example.ts": "export {};\n",
  };
  assertEquals(await fixtureFindings(repositoryEvidence), []);

  const malformed = await fixtureFindings({
    "project/TODO.md": [
      "# Open work",
      "",
      "- [x] Finished work stays in the ledger. Evidence: `missing.ts`.",
      "",
      "- [ ] **Repeat the durable repair.**",
      "  Fix it next session after reading the [missing brief](missing.md).",
      "  Evidence: `missing.ts`.",
      "",
      "- [ ] **Repeat the durable repair.**",
      "  This second item deliberately duplicates the durable title above.",
      "  Evidence: Owner-only: A maintainer must approve the external account.",
      "",
    ].join("\n"),
  });
  assert(ruleFindings(malformed, "todo-shape").length >= 1);
  assert(ruleFindings(malformed, "todo-title").length >= 2);
  assertEquals(ruleFindings(malformed, "todo-session-wording").length, 1);
  assertEquals(ruleFindings(malformed, "todo-link").length, 1);
  assert(ruleFindings(malformed, "todo-evidence").length >= 2);
});

Deno.test("scope manifests enroll live leaves in both directions", async () => {
  const manifestPath = "project/map/_internal/scopes/10-example.md";
  const base = {
    ...pageAuthority(),
    "project/map/10-example/README.md": "# Example\n",
    "project/map/10-example/live.md": "# Live\n",
  };
  const valid = {
    ...base,
    [manifestPath]: [
      "# Scope: 10-example",
      "",
      "## Files to produce",
      "",
      "| File | Shape | Topic |",
      "| ---- | ----- | ----- |",
      "| `README.md` | [overview](../page-templates.md#overview) | Overview and curated reading order. |",
      "| `live.md` | [guide](../page-templates.md#guide) | Durable behavior of the live example. |",
      "",
    ].join("\n"),
  };
  assertEquals(await fixtureFindings(valid), []);

  const missing = { ...valid };
  missing[manifestPath] = missing[manifestPath].replace(
    "| `live.md` | [guide](../page-templates.md#guide) | Durable behavior of the live example. |\n",
    "",
  );
  assert(
    ruleFindings(await fixtureFindings(missing), "scope-member").some(
      (item) => item.includes("not enrolled"),
    ),
  );

  const stale = {
    ...valid,
    [manifestPath]: valid[manifestPath].replace(
      "| `live.md` | [guide](../page-templates.md#guide) | Durable behavior of the live example. |",
      "| `gone.md` | [guide](../page-templates.md#guide) | A page that no longer exists in the subtree. |",
    ),
  };
  assert(
    ruleFindings(await fixtureFindings(stale), "scope-member").some(
      (item) => item.includes("stale"),
    ),
  );

  const excluded = {
    ...base,
    [manifestPath]: [
      "# Scope: 10-example",
      "",
      "## Files to produce",
      "",
      "| File | Shape | Topic |",
      "| ---- | ----- | ----- |",
      "| `README.md` | [overview](../page-templates.md#overview) | Overview and curated reading order. |",
      "",
      "## Declared exclusions",
      "",
      "| File | Reason |",
      "| ---- | ------ |",
      "| `live.md` | Generated elsewhere and deliberately not refreshed here. |",
      "",
    ].join("\n"),
  };
  assertEquals(await fixtureFindings(excluded), []);
});

Deno.test("page budgets have one authority and explicit local exceptions", async () => {
  const manifestPath = "project/map/_internal/scopes/10-example.md";
  const valid = {
    ...pageAuthority(),
    "project/map/_internal/documenter-agent-brief.md": [
      "# Documenter brief",
      "",
      "<!-- project-page-shape-use: numbered leaf | guide -->",
      "Use the [guide shape](page-templates.md#guide).",
      "",
    ].join("\n"),
    "project/map/10-example/README.md": "# Example\n",
    "project/map/10-example/live.md": "# Live\n",
    [manifestPath]: [
      "# Scope: 10-example",
      "",
      "## Files to produce",
      "",
      "| File | Shape | Topic |",
      "| ---- | ----- | ----- |",
      "| `README.md` | [overview](../page-templates.md#overview) | Overview and reading order. |",
      "| `live.md` | [guide](../page-templates.md#guide) | Durable behavior of the live page. |",
      "",
      "<!-- project-page-budget-exception: live.md | 250–350 words | Existing exemplar retains required safety detail. -->",
      "",
    ].join("\n"),
  };
  assertEquals(await fixtureFindings(valid), []);

  const copied = {
    ...valid,
    "project/map/_internal/documenter-agent-brief.md":
      valid["project/map/_internal/documenter-agent-brief.md"] +
      "Default leaves use 200–300 words.\n",
  };
  assertEquals(
    ruleFindings(await fixtureFindings(copied), "budget-copy").length,
    1,
  );

  const unknown = {
    ...valid,
    [manifestPath]: valid[manifestPath].replace(
      "[guide](../page-templates.md#guide)",
      "[essay](../page-templates.md#essay)",
    ),
  };
  assertEquals(
    ruleFindings(await fixtureFindings(unknown), "page-shape").length,
    1,
  );

  const mislinked = {
    ...valid,
    "project/map/_internal/documenter-agent-brief.md":
      valid["project/map/_internal/documenter-agent-brief.md"].replace(
        "page-templates.md#guide",
        "page-templates.md#overview",
      ),
  };
  assertEquals(
    ruleFindings(await fixtureFindings(mislinked), "page-shape").length,
    1,
  );

  const staleException = {
    ...valid,
    [manifestPath]: valid[manifestPath].replace(
      "live.md | 250–350 words",
      "gone.md | 350–250 words",
    ),
  };
  assertEquals(
    ruleFindings(
      await fixtureFindings(staleException),
      "budget-exception",
    ).length,
    1,
  );
});

Deno.test("planning links and renderer-derived anchors enroll every present programme", async () => {
  const sound = activeProgramme(
    "Read the [decision](notes.md#chosen-path).",
  );
  const withTarget = {
    ...sound,
    [PROGRAMME + "/notes.md"]: "# Notes\n\n## Chosen path\n",
  };
  assertEquals(await fixtureFindings(withTarget), []);

  const missing = await fixtureFindings(activeProgramme(
    "Read the [missing decision](missing.md).",
  ));
  assertEquals(ruleFindings(missing, "planning-link").length, 1);

  const badAnchor = await fixtureFindings({
    ...activeProgramme("Read the [decision](notes.md#wrong-path)."),
    [PROGRAMME + "/notes.md"]: "# Notes\n\n## Chosen path\n",
  });
  assertEquals(ruleFindings(badAnchor, "planning-anchor").length, 1);
});

Deno.test("README completion state derives from the brief's live path", async () => {
  const findings = await fixtureFindings({
    [PROGRAMME + "/README.md"]: [
      "# Fresh contract workstreams",
      "",
      "| Key | Active brief |",
      "| --- | ------------ |",
      "| 1A | [First](_done/1a-first.md) |",
      "",
    ].join("\n"),
    [PROGRAMME + "/_done/1a-first.md"]: "# First\n",
  });
  assertEquals(ruleFindings(findings, "planning-state").length, 1);
});

Deno.test("a stream's evidence worksheet is not classified as a numbered brief", async () => {
  const findings = await fixtureFindings({
    [PROGRAMME + "/README.md"]: [
      "# Fresh contract workstreams",
      "",
      "| Key | Brief | Depends on |",
      "| --- | ----- | ---------- |",
      "| 1A | [`_done/1a-first.md`](_done/1a-first.md) | — |",
      "",
    ].join("\n"),
    [PROGRAMME + "/_done/1a-first.md"]: "# First\n",
    [PROGRAMME + "/evidence/README.md"]: "# Evidence worksheet\n",
    [PROGRAMME + "/evidence/1a-first-notes.md"]: "# Evidence\n",
  });
  assertEquals(ruleFindings(findings, "planning-worktree"), []);
  assertEquals(ruleFindings(findings, "planning-readme-table"), []);
});

Deno.test("active briefs reject durable claims about transient fleet state", async () => {
  const findings = await fixtureFindings(activeProgramme(
    "This dispatches beside the in-flight 7A.",
  ));
  assertEquals(ruleFindings(findings, "planning-transient-state").length, 1);
});

Deno.test("bound predecessor selectors preserve live readiness instead of recording fleet state", async () => {
  const binding =
    "**Dependency binding:** worktree `orbit-4b-a3b2c1`, full branch `agent/orbit-4b-a3b2c1`. Required readiness: **4B landed**.";
  assertEquals(await fixtureFindings(activeProgramme(binding)), []);
  for (
    const invalid of [
      binding.replace(
        "worktree `orbit-4b-a3b2c1`",
        "worktree `comet-4b-a3b2c1`",
      ),
      binding.replace("Required readiness: **4B landed**.", ""),
      binding + " Currently green.",
      "The branch `agent/orbit-4b-a3b2c1` is ready.",
    ]
  ) {
    const findings = await fixtureFindings(activeProgramme(invalid));
    assertEquals(
      ruleFindings(findings, "planning-transient-state").length,
      1,
      invalid,
    );
  }
});

Deno.test("retained package selectors require matching identities and an explicit final stage", async () => {
  const binding =
    "**Design-system worktree:** `orbit-source-a3b2c1`, full branch `agent/orbit-source-a3b2c1`. Retain through 4A.";
  assertEquals(await fixtureFindings(activeProgramme(binding)), []);
  for (
    const invalid of [
      binding.replace("`orbit-source-a3b2c1`", "`comet-source-a3b2c1`"),
      binding.replace("Retain through 4A.", ""),
      binding + " Currently green.",
    ]
  ) {
    assertEquals(
      ruleFindings(
        await fixtureFindings(activeProgramme(invalid)),
        "planning-transient-state",
      ).length,
      1,
      invalid,
    );
  }
});

Deno.test("planned outputs pass only while absent, referenced, local, and unique", async () => {
  const valid = activeProgramme([
    "<!-- discern-planned-output: generated/report.md -->",
    "Read the [later report](generated/report.md).",
  ].join("\n"));
  assertEquals(await fixtureFindings(valid), []);

  const undeclared = activeProgramme(
    "Read the [later report](generated/report.md).",
  );
  assertEquals(
    ruleFindings(await fixtureFindings(undeclared), "planning-link").length,
    1,
  );

  const stale = {
    ...valid,
    [PROGRAMME + "/generated/report.md"]: "# Report\n",
  };
  assert(
    ruleFindings(await fixtureFindings(stale), "planned-output").some((item) =>
      item.includes("stale")
    ),
  );

  const malformed = activeProgramme([
    "<!-- discern-planned-output generated/report.md -->",
    "<!-- discern-planned-output: ../escape.md -->",
    "<!-- discern-planned-output: generated/report.md -->",
    "<!-- discern-planned-output: generated/report.md -->",
    "Read the [later report](generated/report.md).",
  ].join("\n"));
  const malformedFindings = ruleFindings(
    await fixtureFindings(malformed),
    "planned-output",
  );
  assert(malformedFindings.some((item) => item.includes("malformed")));
  assert(malformedFindings.some((item) => item.includes("does not resolve")));
  assert(malformedFindings.some((item) => item.includes("duplicates")));
  assert(malformedFindings.some((item) => item.includes("not beside")));
});

Deno.test("README keys, dependency targets, and active worktree names are guarded", async () => {
  const findings = await fixtureFindings({
    [PROGRAMME + "/README.md"]: [
      "# Fresh contract workstreams",
      "",
      "| Key | Brief | Depends on |",
      "| --- | ----- | ---------- |",
      "| 1A | [First](1a-first.md) | 9Z |",
      "| 1A | [Other](1a-other.md) | — |",
      "",
    ].join("\n"),
    [PROGRAMME + "/1a-first.md"]: "# First\n",
    [PROGRAMME + "/1a-other.md"]: [
      "# Other",
      "",
      "Create worktree `fresh-contract-1a`.",
      "",
    ].join("\n"),
  });
  assert(ruleFindings(findings, "planning-brief-key").length >= 2);
  assertEquals(ruleFindings(findings, "planning-dependency").length, 1);
  assertEquals(ruleFindings(findings, "planning-worktree").length, 1);
});
