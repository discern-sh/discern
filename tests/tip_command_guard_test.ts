/**
 * Command-reference guard for the tip registry — the hint command guard's
 * discipline (ADR 0172) applied to tips:
 *
 * 1. RENDERED: every tip renders through the shared render authority, and
 *    each quoted `discern …` span validates against the live command model —
 *    a renamed verb or dropped flag fails here, not at a desk session.
 * 2. COMPLETENESS: after stripping reference tokens, a rendered tip may carry
 *    no bare `discern …` span — a runnable command written as prose is
 *    rejected.
 * 3. SOURCE: the registry module's whole source is scanned, so a stale
 *    command in a branch no example renders is caught statically.
 *
 * (Constructor-built references in this module already enrol in the
 * repo-wide sweep the hint command guard runs over all authored TypeScript.)
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import { validateFencedCommand } from "../src/lib/docs_integrity.ts";
import { discoverProjectScripts } from "../src/engine/project_scripts.ts";
import { authoredTipText, renderTipCli, TIPS } from "../src/shared/tips.ts";
import { stripCommandRefs } from "../src/shared/command_reference.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import {
  quotedDiscernCommands,
  sourceDiscernCommands,
} from "./command_span_scan.ts";

/** The channel-owning module — the closed universe every tip is defined in. */
const TIPS_MODULE = join(REPO_ROOT, "src", "shared", "tips.ts");

Deno.test("every quoted discern command in the tip registry validates against the live CLI", async () => {
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((script) => script.name));
  const failures: string[] = [];

  // Pass 1 — rendered lines, per tip, with references resolved to their CLI
  // spelling: every reference a registered example reaches.
  for (const tip of TIPS) {
    for (const command of quotedDiscernCommands(renderTipCli(tip))) {
      const reason = validateFencedCommand(command, model, extraVerbs);
      if (reason !== undefined) {
        failures.push(`${tip.id}: \`${command}\` — ${reason}`);
      }
    }
  }

  // Pass 2 — the registry module's whole source (unexercised branches and
  // shared helper strings enrol by existing).
  const moduleSource = await Deno.readTextFile(TIPS_MODULE);
  for (const command of new Set(sourceDiscernCommands(moduleSource))) {
    const reason = validateFencedCommand(command, model, extraVerbs);
    if (reason !== undefined) {
      failures.push(`tips.ts source: \`${command}\` — ${reason}`);
    }
  }

  assertEquals(
    failures,
    [],
    "quoted tip commands must match the live command registry — update the " +
      `template or command declaration:\n  ${failures.join("\n  ")}`,
  );
});

/** Bare runnable spans left once references are stripped; a lone `discern`
 * span is the product name, not a runnable command. */
function proseCommandSpans(authoredText: string): string[] {
  return quotedDiscernCommands(stripCommandRefs(authoredText))
    .filter((span) => span !== "discern");
}

Deno.test("every rendered tip spells runnable discern commands only through references", () => {
  const failures: string[] = [];
  for (const tip of TIPS) {
    for (const span of proseCommandSpans(authoredTipText(tip))) {
      failures.push(`${tip.id}: \`${span}\``);
    }
  }
  assertEquals(
    failures,
    [],
    "a runnable discern command is written as prose — build it with " +
      `discernCommand() so every surface can spell it:\n  ${
        failures.join("\n  ")
      }`,
  );
});

Deno.test("the tip completeness detector rejects a prose-spelled command beside a reference", () => {
  // The adversarial future sibling: one converted reference, one span left as
  // prose. The stripped text must still expose the prose span.
  const authored =
    '⟦discern-cmd:{"words":"patterns","args":[],"executor":"caller"}⟧ first, then `discern done`.';
  assertEquals(proseCommandSpans(authored), ["discern done"]);
});
