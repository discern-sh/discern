/**
 * Command-reference guard for the hint registry (ADR 0172). Every template is
 * rendered from its typed example, then each quoted `discern …` code span passes
 * through the same live-registry validator as the map's fenced commands.
 */

import { assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import { validateFencedCommand } from "../src/lib/docs_integrity.ts";
import { discoverProjectScripts } from "../src/engine/project_scripts.ts";
import { HINTS } from "../src/shared/hints.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

/** Extract Markdown code spans whose content is a `discern` command. */
function quotedDiscernCommands(text: string): string[] {
  const commands: string[] = [];
  for (const match of text.matchAll(/`([^`\r\n]+)`/gu)) {
    const code = (match[1] ?? "").trim();
    if (/^discern(?:\s|$)/u.test(code)) commands.push(code);
  }
  return commands;
}

Deno.test("hint command guard extracts only quoted discern commands", () => {
  assertEquals(
    quotedDiscernCommands(
      "Run `discern status --json`, then inspect `git status`; discern done in prose is not a command span.",
    ),
    ["discern status --json"],
  );
});

Deno.test("every quoted discern command in the hint registry validates against the live CLI", async () => {
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((script) => script.name));
  const failures: string[] = [];

  for (const [key, value] of Object.entries(HINTS)) {
    const def = value as {
      example: unknown;
      template: (params: unknown) => string;
    };
    const rendered = def.template(def.example);
    for (const command of quotedDiscernCommands(rendered)) {
      const reason = validateFencedCommand(command, model, extraVerbs);
      if (reason !== undefined) {
        failures.push(`${key}: \`${command}\` — ${reason}`);
      }
    }
  }

  assertEquals(
    failures,
    [],
    "quoted hint commands must match the live command registry — update the " +
      `template or command declaration:\n  ${failures.join("\n  ")}`,
  );
});
