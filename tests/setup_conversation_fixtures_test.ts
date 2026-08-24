/** Reviewable, semantic conversation fixtures for setup's owner register. */

import { assert, assertEquals } from "@std/assert";
import { GLOSSARY } from "../scripts/glossary_registry.ts";
import { renderFreshWelcome } from "../src/commands/setup_welcome.ts";
import {
  renderSetupOwnerMoment,
  resolveSetupHumanMoments,
  setupHumanMomentFactIds,
  type SetupMomentEvidence,
} from "../src/shared/setup_experience.ts";

interface ConversationFixture {
  readonly id: string;
  readonly momentId: string;
  readonly evidence?: SetupMomentEvidence;
  readonly noviceAnchors: readonly string[];
  readonly experiencedAnchors: readonly string[];
}

const FIXTURES: readonly ConversationFixture[] = [
  {
    id: "first-contact",
    momentId: "first-use-value",
    noviceAnchors: ["future coding sessions", "reviewable branch"],
    experiencedAnchors: ["commission the project once", "project guide"],
  },
  {
    id: "model-choice",
    momentId: "model-selection",
    noviceAnchors: [
      "future sessions",
      "strongest suitable",
      "Nothing has been written",
    ],
    experiencedAnchors: [
      "persistent project context",
      "self-declared provenance",
    ],
  },
  {
    id: "project-name",
    momentId: "project-name-confirmation",
    noviceAnchors: [
      "strongest project name",
      "maintained project guide",
      "use your recommendation",
    ],
    experiencedAnchors: ["supports <name>", "persist it in the project guide"],
  },
  {
    id: "no-conflict-progress",
    momentId: "setup-started",
    noviceAnchors: [
      "separate, reviewable branch",
      "routine reversible authoring",
    ],
    experiencedAnchors: [
      "gathering repository evidence",
      "consequential choices",
    ],
  },
  {
    id: "applicable-data-policy",
    momentId: "worktree-resource-policy",
    evidence: {
      evidenceId: "worktree-resource-consequence",
      satisfied: true,
      detail: "Two tasks would mutate the same durable database.",
    },
    noviceAnchors: [
      "Parallel tasks",
      "consequence",
      "I will not create or change",
    ],
    experiencedAnchors: ["Concurrent worktrees", "one concrete policy"],
  },
  {
    id: "subsystem-review",
    momentId: "subsystem-sanity-check",
    noviceAnchors: [
      "heart of this project",
      "important rule",
      "use your recommendation",
    ],
    experiencedAnchors: ["primary subsystem", "concrete invariant"],
  },
  {
    id: "completion",
    momentId: "completion-handoff",
    evidence: {
      evidenceId: "setup-proof-current",
      satisfied: true,
      detail: "The final committed setup has current Proof.",
    },
    noviceAnchors: [
      "Later agents will begin",
      "final quality check",
      "project's checks (Proof)",
    ],
    experiencedAnchors: ["primary area", "grants no landing authority"],
  },
  {
    id: "landing",
    momentId: "landing-choice",
    evidence: {
      evidenceId: "proved-setup-unlanded",
      satisfied: true,
      detail: "The proved setup branch is not on trunk.",
    },
    noviceAnchors: [
      "future sessions",
      "not permission to merge",
      "leave it for review",
    ],
    experiencedAnchors: ["grants no landing authority", "I will wait"],
  },
  {
    id: "fresh-session-activation",
    momentId: "activation-handoff",
    evidence: {
      evidenceId: "proved-setup-landed",
      satisfied: true,
      detail: "The proved setup is on trunk.",
    },
    noviceAnchors: [
      "registered tools",
      "exact local activation action",
      "discern doctor",
    ],
    experiencedAnchors: ["registered tool inventory", "effectful rerun"],
  },
];

Deno.test("novice and experienced setup readings derive from the same semantic facts", () => {
  for (const fixture of FIXTURES) {
    const moment = resolveSetupHumanMoments([fixture.momentId])[0];
    assert(moment !== undefined);
    const novice = renderSetupOwnerMoment(moment, "novice", fixture.evidence);
    const experienced = renderSetupOwnerMoment(
      moment,
      "experienced",
      fixture.evidence,
    );
    assert(novice !== undefined, `${fixture.id} novice reading was not served`);
    assert(
      experienced !== undefined,
      `${fixture.id} experienced reading was not served`,
    );
    assertEquals(novice.factIds, setupHumanMomentFactIds(moment));
    assertEquals(experienced.factIds, novice.factIds);
    assertEquals(novice.waitsForOwner, moment.kind === "decision");
    assertEquals(experienced.waitsForOwner, novice.waitsForOwner);
    for (const anchor of fixture.noviceAnchors) {
      assert(
        novice.message.includes(anchor),
        `${fixture.id} novice reading lost ${anchor}:\n${novice.message}`,
      );
    }
    for (const anchor of fixture.experiencedAnchors) {
      assert(
        experienced.message.includes(anchor),
        `${fixture.id} experienced reading lost ${anchor}:\n${experienced.message}`,
      );
    }
    const words = novice.message.trim().split(/\s+/).length;
    assert(words <= 150, `${fixture.id} exceeded 150 words (${words})`);
    assert(
      !/Claude|Codex|Gemini|Cursor|Copilot/.test(novice.message),
      `${fixture.id} encoded a provider ranking`,
    );
  }
});

Deno.test("successful first contact is one short explanation with the complete setup frame", () => {
  const welcome = renderFreshWelcome({ tty: false }).join("\n");
  for (
    const fact of [
      "20–40 minutes",
      "meaningful number of tokens",
      "separate reviewable branch",
      "discern.toml",
      "discern/",
      "uninstall",
      "strongest suitable reasoning model",
      "To stop",
      "discern setup verify",
    ]
  ) {
    assert(welcome.includes(fact), `welcome lost ${fact}`);
  }
  assert(!welcome.includes("backs it all out"));
  assert(welcome.split(/\s+/).length <= 350);
});

Deno.test("owner jargon follows the glossary's canonical plain rendering", () => {
  const noviceConversation = FIXTURES.map((fixture) => {
    const moment = resolveSetupHumanMoments([fixture.momentId])[0];
    assert(moment !== undefined);
    const rendered = renderSetupOwnerMoment(moment, "novice", fixture.evidence);
    assert(rendered !== undefined);
    return rendered.message;
  }).join("\n");
  const governedTerms = new Set(["Gate", "Map", "Proof", "Worktree"]);
  for (const entry of GLOSSARY) {
    if (!governedTerms.has(entry.term) || !("phrase" in entry.plain)) continue;
    const termAt = noviceConversation.indexOf(entry.term);
    if (termAt < 0) continue;
    const plainAt = noviceConversation.toLocaleLowerCase().indexOf(
      entry.plain.phrase.toLocaleLowerCase(),
    );
    assert(
      plainAt >= 0 && plainAt < termAt,
      `${entry.term} appeared before its plain rendering “${entry.plain.phrase}”`,
    );
  }
});
