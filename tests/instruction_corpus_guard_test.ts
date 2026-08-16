/**
 * Reference guard for the shipped agent-facing corpus: the instructions templates
 * every project compiles into its agent files, the bundled skills, and the
 * MCP server's instructions and tool descriptions. The hint registry and the
 * map's fenced examples already validate against the live registries; this
 * corpus is the highest-read surface discern ships and gets the same
 * treatment — a retired verb, flag, tool, or skill name here reaches every
 * project and goes stale silently.
 *
 * Three sweeps, each anchored non-vacuous so a broken walk fails loudly:
 *
 * 1. Backticked `discern …` command spans → the live CLI model. No
 *    project-script escape hatch: shipped prose must never lean on one
 *    repository's scripts.
 * 2. `discern_*` tool tokens (backticked or bare) → the MCP TOOLS registry.
 * 3. Backticked `discern-…` skill spans → the bundled skill directories
 *    under `templates/skills/`.
 */

import { assert, assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { walk } from "@std/fs";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import { validateFencedCommand } from "../src/lib/docs_integrity.ts";
import { buildInstructions, TOOLS } from "../src/engine/mcp/server.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** One scanned document: a label for failure messages plus its text. */
interface CorpusDoc {
  readonly label: string;
  readonly text: string;
}

/** Every Markdown file under a templates/ subtree, labelled repo-relative. */
async function markdownDocs(dir: string): Promise<CorpusDoc[]> {
  const docs: CorpusDoc[] = [];
  for await (const entry of walk(dir, { exts: [".md"], includeDirs: false })) {
    docs.push({
      label: relative(REPO_ROOT, entry.path),
      text: await Deno.readTextFile(entry.path),
    });
  }
  return docs;
}

/** The whole shipped agent-facing corpus, one doc per surface. */
async function collectCorpus(): Promise<CorpusDoc[]> {
  const docs: CorpusDoc[] = [
    ...(await markdownDocs(join(REPO_ROOT, "templates", "instructions"))),
    ...(await markdownDocs(join(REPO_ROOT, "templates", "skills"))),
    { label: "mcp server instructions", text: buildInstructions() },
    ...TOOLS.map((tool) => ({
      label: `mcp tool ${tool.name}`,
      text: `${tool.title ?? ""}\n${tool.description}`,
    })),
  ];
  return docs;
}

/** Backticked code spans, the corpus's convention for every literal name. */
function backtickSpans(text: string): string[] {
  return [...text.matchAll(/`([^`\r\n]+)`/gu)].map((m) => (m[1] ?? "").trim());
}

/** Spans that are `discern …` CLI invocations. */
function discernCommands(text: string): string[] {
  return backtickSpans(text).filter((span) =>
    /^discern(?:\s|$)/u.test(span) && !span.includes("{{")
  );
}

/** Every `discern_*` MCP tool token, backticked or bare. */
function toolTokens(text: string): string[] {
  return [...text.matchAll(/\bdiscern_[a-z][a-z_]*\b/gu)].map((m) => m[0]);
}

/** Backticked spans shaped like bundled-skill names. */
function skillSpans(text: string): string[] {
  return backtickSpans(text).filter((span) =>
    /^discern-[a-z][a-z0-9-]*$/u.test(span)
  );
}

/** The bundled skill set: one directory per skill under templates/skills. */
async function bundledSkillNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for await (
    const entry of Deno.readDir(join(REPO_ROOT, "templates", "skills"))
  ) {
    if (entry.isDirectory) names.add(entry.name);
  }
  return names;
}

Deno.test("shipped corpus command spans validate against the live CLI", async () => {
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const failures: string[] = [];
  let spans = 0;
  for (const doc of await collectCorpus()) {
    for (const command of discernCommands(doc.text)) {
      spans += 1;
      const reason = validateFencedCommand(command, model, new Set());
      if (reason !== undefined) {
        failures.push(`${doc.label}: \`${command}\` — ${reason}`);
      }
    }
  }
  assert(
    spans > 0,
    "the corpus walk found no command spans — check the scan set",
  );
  assertEquals(
    failures,
    [],
    "shipped prose must reference live commands — fix the span or the " +
      `command declaration:\n  ${failures.join("\n  ")}`,
  );
});

Deno.test("shipped corpus tool references validate against the MCP registry", async () => {
  const registered = new Set(TOOLS.map((tool) => tool.name));
  const failures: string[] = [];
  let tokens = 0;
  for (const doc of await collectCorpus()) {
    for (const token of toolTokens(doc.text)) {
      tokens += 1;
      if (!registered.has(token)) {
        failures.push(`${doc.label}: ${token}`);
      }
    }
  }
  assert(
    tokens > 0,
    "the corpus walk found no tool tokens — check the scan set",
  );
  assertEquals(
    failures,
    [],
    "shipped prose must reference registered MCP tools — fix the reference " +
      `or register the tool:\n  ${failures.join("\n  ")}`,
  );
});

Deno.test("shipped corpus skill references validate against the bundled set", async () => {
  const bundled = await bundledSkillNames();
  const failures: string[] = [];
  let spans = 0;
  for (const doc of await collectCorpus()) {
    for (const span of skillSpans(doc.text)) {
      spans += 1;
      if (!bundled.has(span)) {
        failures.push(`${doc.label}: \`${span}\``);
      }
    }
  }
  assert(
    spans > 0,
    "the corpus walk found no skill spans — check the scan set",
  );
  assertEquals(
    failures,
    [],
    "shipped prose must reference bundled skills by their directory names " +
      `under templates/skills/:\n  ${failures.join("\n  ")}`,
  );
});
