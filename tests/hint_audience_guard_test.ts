/**
 * Audience guards for the hints channel.
 *
 * The class of defect: an interactive human renderer prints the raw `hints[]`
 * channel, so an agent-audience entry reaches a person it was never written
 * for. The registry owns the drop (`interactiveHintTexts` for wire arrays,
 * `interactiveHints` for fired pairs) — a renderer that loops the channel
 * directly bypasses it, and the bypass stays invisible until an agent-audience
 * entry happens to fire on that surface.
 *
 * The law: outside `src/shared/hints.ts` (which owns the channel), no `for…of`
 * iterates a `.hints` member. Renderers print a projection; builders compose
 * with `hintTexts`/`appendHintTexts`, which are not iteration. Reading a
 * single element (a failure headline) stays legal — the guard targets the
 * render-the-channel shape, the one way every historical bypass was written.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { type HintAudience, HINTS } from "../src/shared/hints.ts";

const SRC = join(REPO_ROOT, "src");

/** The channel-owning module: the one legal home for raw hint iteration. */
const CHANNEL_OWNER = "src/shared/hints.ts";

/** A `for…of` over some object's `.hints` member, `?? []` fallbacks included. */
const RAW_HINT_LOOP = /for\s*\(\s*const\s+\w+\s+of\s+\(?\s*[\w.?]*\.hints\b/;

Deno.test("interactive renderers never iterate the raw hints channel", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })
  ) {
    const rel = relative(REPO_ROOT, entry.path);
    if (rel === CHANNEL_OWNER) {
      continue;
    }
    const source = await Deno.readTextFile(entry.path);
    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      if (RAW_HINT_LOOP.test(line)) {
        offenders.push(`${rel}:${index + 1} ${line.trim()}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "raw hints-channel iteration outside the registry — render " +
      "`interactiveHintTexts(result.hints)` (or `interactiveHints(fired)`) " +
      `so agent-audience entries stay wire-only:\n  ${offenders.join("\n  ")}`,
  );
});

// ── the agent-vocabulary tripwire ───────────────────────────────────────────
//
// An all-audience entry renders on interactive human surfaces, so wording that
// addresses an agent — or points into the JSON envelope — is a decision, not a
// default. The tripwire flags agent-flavored vocabulary in all-audience
// templates; an intentional use is allowlisted per entry, per phrase, with the
// reasoning recorded beside it. Both the rendered example and the template
// source are scanned, so a phrase in a conditional branch the example does not
// exercise still trips.

/** Vocabulary that reads as agent-directed on a human surface. */
const AGENT_VOCABULARY: readonly { label: string; pattern: RegExp }[] = [
  { label: "your owner", pattern: /\byour owner\b/i },
  { label: "your human", pattern: /\byour human\b/i },
  { label: "agent session", pattern: /\bagent sessions?\b/i },
  { label: "MCP", pattern: /\bMCP\b/ },
  { label: "data.<field>", pattern: /\bdata\.\w+/ },
];

/**
 * Conscious exceptions: entry id → the phrases it may carry while staying
 * all-audience.
 *
 * - "agent session" / "MCP": the setup-unfinished guardrails state a fact a
 *   supervising human needs too, and the restart/reactivate family instructs
 *   an action the human often performs (restarting their own agent session).
 * - "data.<field>": `data` is discern's documented envelope vocabulary on
 *   every surface; a payload pointer beside rendered output is jargon, not
 *   misdirection.
 */
const ALLOWED_AGENT_VOCABULARY: Record<string, readonly string[]> = {
  "setup-unfinished-doctor": ["agent session"],
  "setup-unfinished-gate": ["agent session"],
  "setup-unfinished-status": ["agent session"],
  "setup-reactivate-tools": ["MCP"],
  "refresh-mcp-first-install": ["agent session", "MCP"],
  "upgrade-restart-session": ["agent session", "MCP"],
  "mcp-version-mismatch": ["agent session", "MCP"],
  "accept-review-via-status": ["data.<field>"],
  "accept-relay-landing-receipt": ["data.<field>"],
  "coupling-evidence-summary": ["data.<field>"],
  "coupling-evidence-more": ["data.<field>"],
  "standards-pinnable-slack": ["data.<field>"],
  "status-fleet-member-ready": ["data.<field>"],
  "status-fleet-member-stale": ["data.<field>"],
  "status-fleet-collisions": ["data.<field>"],
};

Deno.test("all-audience templates carry agent vocabulary only by allowlisted decision", () => {
  const offenders: string[] = [];
  for (const [key, def] of Object.entries(HINTS)) {
    const entry = def as {
      audience: HintAudience;
      example: unknown;
      template: (params: unknown) => string;
    };
    if (entry.audience !== "all") {
      continue;
    }
    const corpus = `${entry.template(entry.example)}\n${entry.template}`;
    const allowed = ALLOWED_AGENT_VOCABULARY[key] ?? [];
    for (const { label, pattern } of AGENT_VOCABULARY) {
      if (pattern.test(corpus) && !allowed.includes(label)) {
        offenders.push(`${key} uses "${label}"`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "agent-flavored vocabulary in an all-audience hint — reword it for both " +
      'audiences, set the entry\'s audience to "agent", or record the ' +
      `decision in ALLOWED_AGENT_VOCABULARY:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the agent-vocabulary allowlist stays live", () => {
  const labels = new Set(AGENT_VOCABULARY.map((v) => v.label));
  for (const [key, allowed] of Object.entries(ALLOWED_AGENT_VOCABULARY)) {
    const def = (HINTS as Record<string, unknown>)[key] as {
      audience: HintAudience;
      example: unknown;
      template: (params: unknown) => string;
    } | undefined;
    assert(def !== undefined, `allowlisted hint no longer exists: ${key}`);
    assertEquals(
      def.audience,
      "all",
      `${key} is no longer all-audience — remove its allowlist entry`,
    );
    const corpus = `${def.template(def.example)}\n${def.template}`;
    for (const label of allowed) {
      assert(labels.has(label), `${key} allows unknown vocabulary "${label}"`);
      const { pattern } = AGENT_VOCABULARY.find((v) => v.label === label) ??
        (() => {
          throw new Error(`no pattern for "${label}"`);
        })();
      assert(
        pattern.test(corpus),
        `${key} no longer uses "${label}" — remove the stale allowance`,
      );
    }
  }
});
