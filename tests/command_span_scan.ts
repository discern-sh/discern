/** Shared scanners for backticked `discern …` command spans, used by the
 * hint, tip, and surface-rendering guards, and the live validator they check
 * each extracted command with. */

import { validateFencedCommand } from "../src/lib/docs_integrity.ts";
import { discoverProjectScripts } from "../src/engine/project_scripts.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

/** Extract Markdown code spans whose content is a `discern` command. */
export function quotedDiscernCommands(text: string): string[] {
  const commands: string[] = [];
  for (const match of text.matchAll(/`([^`\r\n]+)`/gu)) {
    const code = (match[1] ?? "").trim();
    if (/^discern(?:\s|$)/u.test(code)) commands.push(code);
  }
  return commands;
}

/**
 * Extract backticked `discern …` spans from SOURCE text — TypeScript, not
 * rendered prose. Code spans appear there in two spellings: `\`…\`` inside a
 * template literal and bare `` ` `` inside a quoted string. The escaped form
 * is rewritten to a private delimiter first so the two systems cannot pair
 * with each other, and string-concatenation glue is dropped so a span split
 * across `+` pieces survives. Spans containing `${` are skipped — their
 * command text only exists after rendering.
 */
export function sourceDiscernCommands(source: string): string[] {
  // `"…" + "…"` renders as one string: drop the glue between string literals
  // so a code span split across the pieces is extracted whole.
  const glued = source.replace(/(["'`])\s*\+\s*(["'`])/gu, "");
  // Escaped backticks (code spans inside template literals) become a private
  // delimiter that cannot pair with the literals' own bare-backtick delimiters.
  const marked = glued.replace(/\\`/gu, "");
  const spans = [
    ...marked.matchAll(/([^`\r\n]+)/gu),
    ...marked.matchAll(/`([^`\r\n]+)`/gu),
  ];
  const commands: string[] = [];
  for (const match of spans) {
    const code = (match[1] ?? "").trim();
    if (/^discern(?:\s|$)/u.test(code) && !code.includes("${")) {
      commands.push(code);
    }
  }
  return commands;
}

/**
 * Validate `discern …` commands against the live CLI model, admitting this
 * repository's project scripts as first-class verbs. Returns the failure
 * reason, or undefined for a live command.
 */
export async function liveCommandValidator(): Promise<
  (command: string) => string | undefined
> {
  const model = TEST_CLI_MODEL();
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((script) => script.name));
  return (command) => validateFencedCommand(command, model, extraVerbs);
}
