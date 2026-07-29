/**
 * Command-reference guard for the hint registry (ADR 0172). Every runnable
 * discern command a hint names is a typed reference; this guard holds each
 * one to the LIVE command registry, through the same validator as the map's
 * fenced commands:
 *
 * 1. RENDERED: every template renders from its typed example, references
 *    resolve to their CLI spelling, and each quoted `discern …` span is
 *    validated — a renamed verb or dropped flag fails here, not in a user's
 *    session. This exercises spans whose command text arrives via
 *    interpolation.
 * 2. COMPLETENESS: after stripping the reference tokens, a rendered hint may
 *    carry NO bare `discern …` span — a runnable command written as prose
 *    (which the surface renderers could never re-spell) is rejected.
 * 3. SOURCE: the registry module's source text is scanned for backticked
 *    `discern …` spans — post-migration these can only be commentary, and any
 *    that appear must still be live. Constructor calls with literal words are
 *    scanned across ALL authored TypeScript (call sites build references
 *    too), so a stale word path in a branch no example renders is caught
 *    statically.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import { validateFencedCommand } from "../src/lib/docs_integrity.ts";
import { discoverProjectScripts } from "../src/engine/project_scripts.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  renderCommandRefsCli,
  stripCommandRefs,
} from "../src/shared/command_reference.ts";
import {
  AUTHORED_TS_FILES,
  REPO_AUTHORED_PATHS,
  REPO_ROOT,
} from "./repo_authored_paths.ts";

/** The channel-owning module — the closed universe every hint is defined in. */
const HINTS_MODULE = join(REPO_ROOT, "src", "shared", "hints.ts");

import {
  quotedDiscernCommands,
  sourceDiscernCommands,
} from "./command_span_scan.ts";

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

  // Pass 1 — rendered examples, per hint, with references resolved to their
  // CLI spelling (covers interpolated spans AND every reference the example
  // reaches: a renamed verb or dropped flag inside a reference fails here).
  for (const [key, value] of Object.entries(HINTS)) {
    const def = value as {
      example: unknown;
      template: (params: unknown) => string;
    };
    const rendered = renderCommandRefsCli(def.template(def.example));
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

/** Bare runnable spans left in a rendered hint once references are stripped —
 * the completeness detector the live pass and its negative control share. A
 * lone `discern` span is the product NAME, not a runnable command with a verb
 * to re-spell, so it stays legal prose. */
function proseCommandSpans(authoredText: string): string[] {
  return quotedDiscernCommands(stripCommandRefs(authoredText))
    .filter((span) => span !== "discern");
}

Deno.test("every rendered hint spells runnable discern commands only through references", () => {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(HINTS)) {
    const def = value as {
      example: unknown;
      template: (params: unknown) => string;
    };
    for (const span of proseCommandSpans(def.template(def.example))) {
      failures.push(`${key}: \`${span}\``);
    }
  }
  assertEquals(
    failures,
    [],
    "a runnable discern command is written as prose — build it with " +
      "discernCommand()/ownerDiscernCommand() so every surface can spell it:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("the completeness detector rejects a prose-spelled command beside a reference", () => {
  // The adversarial future sibling: one converted reference, one span left as
  // prose. The stripped text must still expose the prose span.
  const authored =
    '⟦discern-cmd:{"words":"update","args":[],"executor":"caller"}⟧ first, then `discern done`.';
  assertEquals(proseCommandSpans(authored), ["discern done"]);
});

Deno.test("a reference with a stale flag or subcommand fails the live validation", async () => {
  // Constructors validate the verb word at build time, but a stale flag or
  // subcommand only resolves against the live CLI model — prove the rendered
  // pass rejects both, through the same validator the live pass uses.
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((script) => script.name));
  for (
    const stale of ["discern map some-target --jsonx", "discern setup beginx"]
  ) {
    assert(
      validateFencedCommand(stale, model, extraVerbs) !== undefined,
      `the live validator must reject "${stale}"`,
    );
  }
});

Deno.test("every constructor-built reference in authored source names a live verb path", async () => {
  // References are built at call sites too (gotchas, await, setup), so the
  // static sweep covers ALL authored TypeScript, not just the registry: a
  // literal word path in a branch no test renders still resolves or fails
  // here. Interpolated word paths are covered by the constructors' own
  // KNOWN_VERBS check at build time.
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((script) => script.name));
  const pattern = /(?:discernCommand|ownerDiscernCommand)\(\s*"([^"\n]*)"/g;
  const failures: string[] = [];
  let scanned = 0;
  // Narrower than AUTHORED_TS_FILES for a stated reason: test files construct
  // deliberately invalid references as negative fixtures (and this guard's
  // own scan pattern), which are not shipped call sites.
  for (const rel of AUTHORED_TS_FILES.filter((r) => !r.startsWith("tests/"))) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const match of source.matchAll(pattern)) {
      const words = match[1] ?? "";
      scanned += 1;
      if (words === "") {
        continue; // the root form (`discern --help`) has no word path
      }
      const reason = validateFencedCommand(
        `discern ${words}`,
        model,
        extraVerbs,
      );
      if (reason !== undefined) {
        failures.push(`${rel}: discernCommand("${words}") — ${reason}`);
      }
    }
  }
  assert(
    scanned > 0,
    "the constructor sweep found no references — broken scan",
  );
  assertEquals(
    failures,
    [],
    `constructor-built references must name live verb paths:\n  ${
      failures.join("\n  ")
    }`,
  );
});
