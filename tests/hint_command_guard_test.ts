/**
 * Command-reference guard for the hint registry (ADR 0172). Two passes, both
 * through the same live-registry validator as the map's fenced commands:
 *
 * 1. RENDERED: every template is rendered from its typed example and each
 *    quoted `discern …` code span is validated — this exercises spans whose
 *    command text arrives via interpolation.
 * 2. SOURCE: the registry module's source text is scanned for backticked
 *    `discern …` spans — this reaches conditional branches the example never
 *    renders and the shared helper strings templates call into, where a
 *    misspelled or retired command would otherwise ship silently. Spans
 *    carrying a `${…}` interpolation are skipped here (their text is not
 *    knowable statically); the rendered pass covers those.
 *
 * The scope contract: every hint lives in `src/shared/hints.ts` (the closed
 * registry), so that module's source is the whole search universe for pass 2.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import { validateFencedCommand } from "../src/lib/docs_integrity.ts";
import { discoverProjectScripts } from "../src/engine/project_scripts.ts";
import { HINTS } from "../src/shared/hints.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

/** The channel-owning module — the closed universe every hint is defined in. */
const HINTS_MODULE = join(REPO_ROOT, "src", "shared", "hints.ts");

/** Extract Markdown code spans whose content is a `discern` command. */
function quotedDiscernCommands(text: string): string[] {
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
function sourceDiscernCommands(source: string): string[] {
  // `"…" + "…"` renders as one string: drop the glue between string literals
  // so a code span split across the pieces is extracted whole.
  const glued = source.replace(/(["'`])\s*\+\s*(["'`])/gu, "");
  // Escaped backticks (code spans inside template literals) become a private
  // delimiter that cannot pair with the literals' own bare-backtick delimiters.
  const marked = glued.replace(/\\`/gu, "\u0000");
  const spans = [
    ...marked.matchAll(/\u0000([^\u0000`\r\n]+)\u0000/gu),
    ...marked.matchAll(/`([^\u0000`\r\n]+)`/gu),
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

Deno.test("hint command guard extracts only quoted discern commands", () => {
  assertEquals(
    quotedDiscernCommands(
      "Run `discern status --json`, then inspect `git status`; discern done in prose is not a command span.",
    ),
    ["discern status --json"],
  );
});

Deno.test("hint source scan reaches branches the example never renders", () => {
  // The adversarial future sibling: a command misspelling hiding in the arm
  // the typed example does NOT exercise. The rendered pass is blind to it;
  // the source pass must extract it without this fixture being special-cased.
  const def = {
    example: { urgent: false },
    template: ({ urgent }: { urgent: boolean }): string =>
      urgent ? `Run \`discern frobnicate\` immediately.` : "Nothing to do.",
  };
  assertEquals(quotedDiscernCommands(def.template(def.example)), []);
  assertEquals(sourceDiscernCommands(String(def.template)), [
    "discern frobnicate",
  ]);
});

Deno.test("hint source scan skips interpolated spans and survives concatenation", () => {
  const template = ({ verb }: { verb: string }): string =>
    `Try \`discern ${verb}\` first, then run \`discern ` +
    `frobnicate --json\` and stop.`;
  assertEquals(sourceDiscernCommands(String(template)), [
    "discern frobnicate --json",
  ]);
});

Deno.test("a stale command in an unexercised branch is flagged end-to-end", () => {
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const template = ({ legacy }: { legacy: boolean }): string =>
    legacy ? `Run \`discern frobnicate\` to migrate.` : "Up to date.";
  const [command] = sourceDiscernCommands(String(template));
  assert(command !== undefined, "the fixture span must be extracted");
  assert(
    validateFencedCommand(command, model, new Set()) !== undefined,
    "an unknown command reached through the source scan must be rejected",
  );
});

Deno.test("every quoted discern command in the hint registry validates against the live CLI", async () => {
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((script) => script.name));
  const failures: string[] = [];

  // Pass 1 — rendered examples, per hint (covers interpolated spans).
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

  // Pass 2 — the registry module's whole source (covers unexercised branches
  // and shared helper strings; new templates and helpers enrol by existing).
  const moduleSource = await Deno.readTextFile(HINTS_MODULE);
  for (const command of new Set(sourceDiscernCommands(moduleSource))) {
    const reason = validateFencedCommand(command, model, extraVerbs);
    if (reason !== undefined) {
      failures.push(`hints.ts source: \`${command}\` — ${reason}`);
    }
  }

  assertEquals(
    failures,
    [],
    "quoted hint commands must match the live command registry — update the " +
      `template or command declaration:\n  ${failures.join("\n  ")}`,
  );
});
