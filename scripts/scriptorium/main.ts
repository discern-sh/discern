/**
 * The Scriptorium's command line. `open <entry>` resolves any canon id, slug,
 * or title across the five prose registries and jumps the IDE to its exact
 * source line; the serving surface builds on the same resolution.
 */

import { locateEntries, openInIde } from "./locate.ts";

const USAGE = `The Scriptorium — the canon registries, where you read them.

Usage:
  discern scripts scriptorium open <entry> [--print] [--json]

Commands:
  open <entry>   Resolve a canon entry (id, slug, or title — e.g. proof,
                 file-ownership, "Only better") and open its registry source
                 in the IDE at the exact line. --print writes the position
                 instead of launching the IDE; --json emits it structured.
`;

/** Render one match as a clickable position line. */
function positionLine(entry: {
  file: string;
  line: number;
  registry: string;
  kind: string;
  id: string;
}): string {
  return `${entry.file}:${entry.line} — ${entry.registry} ${entry.kind} ${entry.id}`;
}

/** Run `open`: resolve the query, then jump, print, or list matches. */
function runOpen(args: readonly string[]): number {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const query = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (query === "") {
    console.error("open needs an entry id, slug, or title.");
    return 2;
  }
  const matches = locateEntries(query);
  if (matches.length === 0) {
    console.error(`No canon entry matches "${query}".`);
    return 1;
  }
  if (matches.length > 1) {
    console.error(`"${query}" is ambiguous — ${matches.length} entries match:`);
    for (const match of matches) console.error(`  ${positionLine(match)}`);
    return 1;
  }
  const entry = matches[0];
  if (entry === undefined) return 1;
  if (flags.has("--json")) {
    console.log(JSON.stringify(entry));
    return 0;
  }
  console.log(positionLine(entry));
  if (!flags.has("--print") && !openInIde(entry.file, entry.line)) {
    console.error("No `phpstorm` launcher on PATH — printed the position.");
  }
  return 0;
}

/** Dispatch the scriptorium subcommands. */
export function runScriptorium(args: readonly string[]): number {
  const [command, ...rest] = args;
  if (command === "open") return runOpen(rest);
  console.error(USAGE.trimEnd());
  return command === undefined || command === "--help" || command === "help"
    ? 0
    : 2;
}

if (import.meta.main) {
  Deno.exit(runScriptorium(Deno.args));
}
