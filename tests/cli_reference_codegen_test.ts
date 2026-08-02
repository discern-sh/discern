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
  renderCliReferenceDoc,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import { validateFrontmatter } from "../src/lib/frontmatter.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const root = buildCli(false) as unknown as Command;
const rendered = renderCliReferenceDoc(root);
const model = cliCommandModel(root);

/** Read the configured map's checked-in CLI reference for generator parity. */
async function committedReference(): Promise<string> {
  return await Deno.readTextFile(
    `${REPO_AUTHORED_PATHS.map}/70-reference/cli-reference.md`,
  );
}

Deno.test("the configured map's CLI reference matches the generator (run `deno task codegen`)", async () => {
  const path = `${REPO_AUTHORED_PATHS.map}/70-reference/cli-reference.md`;
  assertEquals(
    await committedReference(),
    await canonicalGeneratedMarkdown(path, rendered),
    `${REPO_AUTHORED_PATHS.mapRel}/70-reference/cli-reference.md is stale — run \`deno task codegen\``,
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
  // command (preset, worktree create/remove, …) leaks into the public page.
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
  assertStringIncludes(frontmatter, "order: 10");
  assertStringIncludes(frontmatter, "publish: true");
  for (const node of walkCliCommands(model)) {
    if (node.hidden || node.path.length === 0) continue;
    assertStringIncludes(
      frontmatter,
      `  - discern ${node.path.join(" ")}`,
      `the CLI reference is missing a search alias for ${node.path.join(" ")}`,
    );
  }
});

Deno.test("the committed reference declares its generated provenance", async () => {
  assertStringIncludes(
    await committedReference(),
    "GENERATED by `deno task codegen`",
    "the committed CLI reference lost its generated banner",
  );
});
