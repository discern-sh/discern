/**
 * The generated CLI reference stays in lockstep with the live command registry
 * (the same drift discipline as the config artifacts, ADR 0026): the committed
 * page must equal its generator's output, and the generator must be TOTAL over
 * the public surface — every visible verb and subcommand appears, no hidden one
 * does. Renaming a verb, adding a flag, or hiding a command without regenerating
 * (`deno task codegen`) fails here, in the gate's test stage.
 *
 * Coverage is driven off the verb SSOT (`KNOWN_VERBS`) and the live Cliffy tree,
 * never a hand-copied list, so a new verb auto-enrols (ADR 0051).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { Command } from "@cliffy/command";
import { buildCli, KNOWN_VERBS } from "../src/main.ts";
import {
  cliCommandModel,
  commandHeadingLabel,
  renderCliReferenceModel,
  renderManualCliReferenceDoc,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { validateFrontmatter } from "../src/lib/frontmatter.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { renderGeneratedManualDocument } from "../scripts/manual_codegen.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const root = buildCli(false) as unknown as Command;
const model = cliCommandModel(root);
const manualTree = await discoverDocs({
  cwd: REPO_ROOT,
  dir: REPO_AUTHORED_PATHS.manual,
});
assert(manualTree !== undefined);
const manualProjection = await buildManualProjection(manualTree.entries);
const renderedManual = renderGeneratedManualDocument(
  renderManualCliReferenceDoc(root),
  "70-reference/cli-reference.md",
  "30-reference/cli-reference.md",
  { id: "reference-cli", order: 20 },
  manualProjection,
);

// The manual is the one generated CLI-reference destination; body checks below
// run against the same rendered document the committed page must equal.
const rendered = renderedManual;

Deno.test("the public manual's CLI reference matches its direct registry projection", async () => {
  const path = `${REPO_AUTHORED_PATHS.manual}/30-reference/cli-reference.md`;
  assertEquals(
    await Deno.readTextFile(path),
    await canonicalGeneratedMarkdown(path, renderedManual),
    `${REPO_AUTHORED_PATHS.manualRel}/30-reference/cli-reference.md is stale — run \`deno task codegen\``,
  );
});

Deno.test("every public CLI verb appears in the generated reference; no hidden command does", () => {
  // Every KNOWN_VERBS member that the CLI shows (i.e. is not a hidden command)
  // must have its own heading. The set is the verb SSOT filtered by the LIVE
  // tree's visibility — no hand-kept list of "public" verbs to drift.
  const byName = new Map(model.children.map((c) => [c.path[0] ?? "", c]));
  for (const verb of KNOWN_VERBS) {
    const node = byName.get(verb);
    assert(
      node !== undefined,
      `KNOWN_VERBS names "${verb}" but the built CLI has no such command`,
    );
    if (node.hidden) continue;
    assertStringIncludes(
      rendered,
      `\n### \`${commandHeadingLabel(node)}\`\n`,
      `the CLI reference is missing the public verb "${verb}" — the generator ` +
        "must be total over the visible surface",
    );
  }

  // Generation is total over the whole VISIBLE tree: every visible subcommand
  // gets a heading too (worktree/skills/config/setup members), and no hidden
  // command (provider hooks, worktree create/remove, …) leaks into the public page.
  for (const node of walkCliCommands(model)) {
    if (node.path.length === 0) continue;
    const heading = `\`${commandHeadingLabel(node)}\``;
    if (node.hidden) {
      assert(
        !rendered.includes(heading),
        `hidden command "${node.path.join(" ")}" leaked into the CLI reference`,
      );
    } else {
      assertStringIncludes(
        rendered,
        heading,
        `the CLI reference is missing the visible subcommand "${
          node.path.join(" ")
        }"`,
      );
    }
  }
});

Deno.test("the reference documents every visible flag of every visible command", () => {
  for (const node of walkCliCommands(model)) {
    if (node.hidden || node.path.length === 0) continue;
    for (const option of node.options) {
      if (option.hidden || option.global) continue;
      const spelling = option.flags.at(-1) ?? "";
      assertStringIncludes(
        rendered,
        spelling,
        `the CLI reference is missing ${
          node.path.join(" ")
        }'s flag "${spelling}"`,
      );
    }
  }
});

Deno.test("exec-style queue advertises no inherited JSON surface", () => {
  const queue = model.children.find((node) => node.path[0] === "queue");
  assert(queue !== undefined, "the live command tree lost discern queue");
  assertEquals(
    queue.options.some((option) => option.flags.includes("--json")),
    false,
    "discern queue must not advertise the result-envelope option it does not implement",
  );
  assert(
    !rendered.includes("Accepted by every command."),
    "the root option account must preserve exec-surface exemptions",
  );
});

Deno.test("the generated reference carries valid published frontmatter and searchable command aliases", () => {
  assertEquals(validateFrontmatter(rendered), []);
  const frontmatter = rendered.split("\n---\n")[0] ?? "";
  assertStringIncludes(frontmatter, "order: 20");
  assertStringIncludes(frontmatter, "publish: true");
  for (const node of walkCliCommands(model)) {
    if (node.hidden || node.path.length === 0) continue;
    assertStringIncludes(
      frontmatter,
      `  - ${JSON.stringify(`discern ${node.path.join(" ")}`)}`,
      `the CLI reference is missing a search alias for ${node.path.join(" ")}`,
    );
  }
});

Deno.test("the committed reference declares its generated provenance", async () => {
  assertStringIncludes(
    await Deno.readTextFile(
      `${REPO_AUTHORED_PATHS.manual}/30-reference/cli-reference.md`,
    ),
    "This reference is generated from the live command registry.",
    "the committed CLI reference lost its generated banner",
  );
});

Deno.test("manual CLI generation enrolls a future command alias and exact parser boundaries", () => {
  const synthetic = structuredClone(model);
  const status = synthetic.children.find((node) => node.path[0] === "status");
  assert(status !== undefined);
  status.children.push({
    path: ["status", "future-contract"],
    description: "Synthetic future public contract.",
    aliases: ["future-alias"],
    hidden: false,
    args: [{
      name: "value",
      optional: false,
      variadic: false,
      value_types: ["string"],
    }],
    usage: "",
    options: [],
    children: [],
  });
  const document = renderCliReferenceModel(synthetic, true);
  assertStringIncludes(document, "`discern status future-contract`");
  assertStringIncludes(document, "`discern status future-alias`");
  assertStringIncludes(document, "`-h`, `--help`");
  assertStringIncludes(document, "`-V`, `--version`");
  assertStringIncludes(document, "| `124` | `discern await`");
});

Deno.test("manual CLI generation retains the exact interactive documentation reader contract", () => {
  for (
    const term of [
      "## Interactive documentation reader",
      "`Tab`, `Shift-Tab`",
      "`Page Up`, `Page Down`",
      "`Home`, `End`",
      "`[`, `]`",
      "three picker entries or three document rows",
      "at least 32 columns",
      "picker-only layout needs 10 total rows",
      "document-only needs 11",
      "split layout begins at 18",
      "`Press Enter to continue.`",
      "`$PAGER`",
      "Other external schemes are not supported.",
    ]
  ) {
    assertStringIncludes(renderedManual, term);
  }
  const frontmatter = renderedManual.split("\n---\n")[0] ?? "";
  for (
    const alias of [
      "interactive documentation reader",
      "terminal reader controls",
      "Tab picker",
      "Press Enter to continue",
      "$PAGER",
    ]
  ) {
    assertStringIncludes(frontmatter, `  - \"${alias}\"`);
  }
});
