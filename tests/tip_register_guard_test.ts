/**
 * Beginner-register and shape guard for desk tips.
 *
 * Tips inherit the plain canon's "quote names, translate concepts" scan. The
 * small allowlist below is limited to terms the desk itself presents, with a
 * reason for each. The rendered line is also held to one or two sentences and
 * 160 characters: at 60–80 columns that is two or three wrapped lines.
 *
 * There is deliberately no reading-grade ceiling. A grade calculated over
 * one or two sentences swings sharply with command names and placeholders,
 * while an aggregate grade can hide one dense tip. The per-tip jargon scan,
 * sentence cap, and rendered-length cap catch the actionable failures
 * directly.
 */

import { assert, assertEquals } from "@std/assert";
import {
  plainPolicedTerms,
  stripCodeSpans,
} from "../scripts/feature_registry.ts";
import {
  authoredTipText,
  renderTipCli,
  TIP_RENDERED_LENGTH_LIMIT,
  TIPS,
} from "../src/shared/tips.ts";
import { extractCommandRefs } from "../src/shared/command_reference.ts";

/**
 * Exact nouns and labels the desk already asks a human to recognize.
 * Keys match `plainPolicedTerms()` names, not ad hoc patterns.
 */
const TIP_REGISTER_ALLOWLIST: Readonly<Record<string, string>> = {
  "Worktree":
    "The desk names a task's separate working copy a Worktree in its task details and cleanup actions.",
  "branch":
    "The desk shows the branch name as the stable identity humans type to confirm cleanup.",
  "commit":
    'The desk action is labeled "Inspect commits and changes"; the tip quotes that exact label.',
  "Project script":
    'The desk action is labeled "Run a Project Script"; the tip quotes that exact label.',
};

function registerHits(id: string, text: string): string[] {
  const stripped = stripCodeSpans(text);
  const hits: string[] = [];
  for (const { name, matcher, plain } of plainPolicedTerms()) {
    if (Object.hasOwn(TIP_REGISTER_ALLOWLIST, name)) {
      continue;
    }
    matcher.lastIndex = 0;
    const hit = matcher.exec(stripped);
    if (hit !== null) {
      hits.push(
        `${id}: "${hit[0]}" is jargon in a beginner tip — say "${plain}" ` +
          `instead or quote the exact name in code spans (term: ${name})`,
      );
    }
  }
  return hits;
}

Deno.test("the tip register allowlist is live, narrow, and reasoned", () => {
  const policed = new Set(plainPolicedTerms().map(({ name }) => name));
  for (const [term, reason] of Object.entries(TIP_REGISTER_ALLOWLIST)) {
    assert(policed.has(term), `${term}: allowlist entry is not a policed term`);
    assert(
      reason.trim().length > 0,
      `${term}: an allowlisted desk term carries its reason`,
    );
  }
});

Deno.test("the curriculum stays within its count, sentence, and rendered-length budgets", () => {
  assert(
    TIPS.length >= 15 && TIPS.length <= 25,
    `the curriculum needs 15–25 tips; found ${TIPS.length}`,
  );
  const offenders: string[] = [];
  for (const tip of TIPS) {
    const rendered = renderTipCli(tip);
    if (rendered.includes("\n")) {
      offenders.push(`${tip.id}: rendered tip contains a newline`);
    }
    if (rendered.length > TIP_RENDERED_LENGTH_LIMIT) {
      offenders.push(
        `${tip.id}: ${rendered.length} characters exceeds the ` +
          `${TIP_RENDERED_LENGTH_LIMIT}-character, two-to-three-line budget`,
      );
    }
    const sentences = rendered.match(/[.!?](?:\s|$)/g)?.length ?? 0;
    if (sentences < 1 || sentences > 2) {
      offenders.push(
        `${tip.id}: ${sentences} sentences; each tip needs one or two`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    `tip shape and length budget failures:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("no unquoted policed jargon appears in a rendered tip", () => {
  const offenders = TIPS.flatMap((tip) =>
    registerHits(tip.id, renderTipCli(tip))
  );
  assertEquals(
    offenders,
    [],
    "tips quote discern names and translate the concepts around them:\n  " +
      offenders.join("\n  "),
  );
});

Deno.test("the tip jargon scan rejects dense beginner-hostile prose", () => {
  const hits = registerHits(
    "fixture",
    "The receipt keeps gate metadata in the repository while the agent waits.",
  );
  assert(
    hits.length >= 4,
    `expected several independent jargon hits, got:\n${hits.join("\n")}`,
  );
});

Deno.test("the tip jargon scan permits code spans and exact desk labels", () => {
  assertEquals(
    registerHits(
      "fixture",
      "`discern worktree prune` protects the separate working copy.",
    ),
    [],
  );
  assertEquals(
    registerHits(
      "fixture",
      'The Worktree view shows a branch and offers "Inspect commits and changes" or "Run a Project Script".',
    ),
    [],
  );
});

Deno.test("every command-teaching tip declares its observable follow-through", () => {
  const offenders: string[] = [];
  for (const tip of TIPS) {
    const referenced = new Set(
      extractCommandRefs(authoredTipText(tip)).map(({ words }) =>
        words.split(" ")[0]
      ).filter((verb): verb is string => verb !== undefined && verb !== ""),
    );
    for (const verb of referenced) {
      if (!tip.followThrough?.verbs.includes(verb)) {
        offenders.push(
          `${tip.id}: teaches '${verb}' without a verb-run follow-through`,
        );
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `command-teaching tips need observable adoption declarations:\n  ${
      offenders.join("\n  ")
    }`,
  );
});
