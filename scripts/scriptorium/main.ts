/**
 * The Scriptorium's command line. `serve` (the default) opens the studio in
 * the browser's reading room; `open <entry>` resolves any canon id, slug, or
 * title across the five prose registries and jumps the IDE to its exact
 * source line.
 */

import { locateEntries, openInIde } from "./locate.ts";

const USAGE = `The Scriptorium — the canon registries, where you read them.

Usage:
  discern scripts scriptorium [serve]
  discern scripts scriptorium open <entry> [--print] [--json]

Commands:
  serve          Start the studio on this worktree's derived port (or PORT)
                 and keep it live against registry changes. The default.
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

/** Run the studio server until interrupted. */
async function runServe(): Promise<number> {
  const { startStudio } = await import("./server.ts");
  await startStudio();
  await new Promise<never>(() => {
    // The server owns the process until a signal ends it.
  });
  return 0;
}

/** Dispatch the scriptorium subcommands. */
export async function runScriptorium(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === "open") return runOpen(rest);
  if (command === "serve" || command === undefined) return await runServe();
  console.error(USAGE.trimEnd());
  return command === "--help" || command === "help" ? 0 : 2;
}

if (import.meta.main) {
  Deno.exit(await runScriptorium(Deno.args));
}
