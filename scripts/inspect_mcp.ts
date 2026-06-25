/**
 * Launch the MCP Inspector (https://github.com/modelcontextprotocol/inspector)
 * against discern's OWN MCP server, run from source so live edits to the tool
 * surface (`src/engine/mcp/server.ts`) take effect on the next connect — the
 * maintainer's way to eyeball that surface (tool annotations, input/output
 * schemas, resources) while working on the MCP layer.
 *
 * It is a MAINTAINER helper, not a shipped feature: it lives in `scripts/`
 * (outside `templates/`), so it is never bundled into the binary or laid into a
 * project, and it is NOT part of the gate. The Inspector is a Node tool, invoked
 * here via `npx` (Node/npx must be on PATH); it never enters discern's Deno
 * dependency graph.
 *
 * Usage (via the `inspect-mcp` task):
 *   deno task inspect-mcp
 *       → open the Inspector UI at its printed (pre-authenticated) localhost URL.
 *   deno task inspect-mcp --cli --method tools/list
 *   deno task inspect-mcp --cli --method resources/list
 *   deno task inspect-mcp --cli --method tools/call \
 *       --tool-name discern_status --tool-arg local=true
 *       → one-shot CLI calls, printed as JSON, no browser.
 *
 * Everything you pass is forwarded to the Inspector as ITS flags; discern's
 * server command is appended after `--`, so the Inspector hands it to the OS
 * verbatim and Commander never reinterprets deno's `--allow-*` flags.
 */

import { fromFileUrl } from "@std/path";

/** The least-privilege permissions discern's MCP server runs under — the same set
 * the `dev` task and the compiled binary carry: read (config/git/docs), write
 * (the gate's fixers mutate), env, and run (git + the configured commands). */
const SERVER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
];

/** Absolute path to the CLI entrypoint, resolved from this script's own location
 * so the launch does not depend on the working directory. */
const MAIN_TS = fromFileUrl(new URL("../src/main.ts", import.meta.url));

/** Spawn the Inspector over `npx`, wired to discern's MCP server, and return its
 * exit code. The server command sits after `--`; the user's args precede it and
 * are parsed as the Inspector's own options (UI by default, `--cli ...` for a
 * one-shot call). */
async function main(): Promise<number> {
  const args = [
    "-y",
    "@modelcontextprotocol/inspector",
    ...Deno.args,
    "--",
    Deno.execPath(),
    "run",
    ...SERVER_PERMISSIONS,
    MAIN_TS,
    "mcp",
  ];

  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("npx", {
      args,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.error(
        "inspect-mcp: `npx` was not found on PATH. The MCP Inspector is a Node tool — install Node.js to use it.",
      );
      return 127;
    }
    throw e;
  }

  const { code } = await child.status;
  return code;
}

if (import.meta.main) {
  Deno.exit(await main());
}
