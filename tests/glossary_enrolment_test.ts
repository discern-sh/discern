/**
 * Closed-set ENROLMENT guard — the canonical-set parity discipline applied to
 * the vocabulary itself (the ADR 0051 family, joining engine_verb_parity and
 * friends).
 *
 * Every member of the engine's closed sets — the known jobs, the stages, the
 * top-level verbs — must be in the glossary's vocabulary the moment it exists:
 * either NAMED by the glossary (a term of its own, or backticked inside a
 * definition — the Gate job and Stage entries interpolate their sets, so
 * those members auto-enrol) or recorded in `DELIBERATELY_ABSENT` with the
 * reason. Exactly one of the two: an unnamed, unrecorded member fails the gate
 * until someone decides, and an absence record for a member the glossary now
 * names fails as stale.
 *
 * The sets are read from their single sources (`KNOWN_JOBS`, `STAGES`,
 * `KNOWN_VERBS`), never a hand-copied list, so a new member auto-enrols in the
 * check itself.
 */

import { assert, assertEquals } from "@std/assert";
import {
  DELIBERATELY_ABSENT,
  GLOSSARY,
  type GlossaryEntry,
} from "../scripts/glossary_registry.ts";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";

/** The closed sets the vocabulary must account for, from their single sources. */
const CLOSED_SETS: Readonly<Record<string, readonly string[]>> = {
  job: Object.keys(KNOWN_JOBS),
  stage: STAGES,
  verb: [...KNOWN_VERBS].sort(),
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the glossary names `member`: as a term of its own
 * (case-insensitive — headings capitalize) or backticked inside a definition
 * (`` `member` `` or `` `discern member …` `` — exact case, code is verbatim).
 * A backtick followed by anything else (`` `[skills].exclude` `` for the
 * `skills` verb) is a different name and does not enrol.
 */
function namedBy(glossary: readonly GlossaryEntry[], member: string): boolean {
  const lower = member.toLowerCase();
  if (glossary.some((e) => e.term.toLowerCase() === lower)) return true;
  const mention = new RegExp(`\`(?:discern )?${escapeRegExp(member)}\\b`);
  return glossary.some((e) => mention.test(e.definition));
}

Deno.test("every known job, stage, and top-level verb is named by the glossary or recorded deliberately absent", () => {
  const offenders: string[] = [];
  for (const [set, members] of Object.entries(CLOSED_SETS)) {
    for (const member of members) {
      const key = `${set}:${member}`;
      const named = namedBy(GLOSSARY, member);
      const recorded = Object.hasOwn(DELIBERATELY_ABSENT, key);
      if (!named && !recorded) {
        offenders.push(
          `${key} is outside the vocabulary — give it a glossary entry, name ` +
            "it in one, or record it in DELIBERATELY_ABSENT with the reason",
        );
      }
      if (named && recorded) {
        offenders.push(
          `${key} is recorded deliberately absent, but the glossary names ` +
            "it — delete the stale record",
        );
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "closed-set members must enter the vocabulary the moment they exist " +
      `(scripts/glossary_registry.ts):\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every deliberate-absence record points at a live closed-set member, with a reason", () => {
  for (const [key, reason] of Object.entries(DELIBERATELY_ABSENT)) {
    const at = key.indexOf(":");
    const set = at === -1 ? key : key.slice(0, at);
    const member = at === -1 ? "" : key.slice(at + 1);
    const members = CLOSED_SETS[set];
    assert(
      members !== undefined,
      `${key}: "${set}" is not a closed set the enrolment guard covers`,
    );
    assert(
      members.includes(member),
      `${key}: no such member — the set changed under this record; delete or rename it`,
    );
    assert(
      reason.trim().length > 0,
      `${key}: a deliberate absence carries its reason`,
    );
  }
});

// Positive controls: prove the predicate discriminates, so the guard can't
// rot into a test that passes because everything looks named.

Deno.test("enrolment guard: the naming predicate matches terms and backticked mentions only", () => {
  const fixture: GlossaryEntry[] = [
    {
      term: "Gate",
      definition:
        "Run with `discern done`; declared under `[standards]`. The `desk` opens it.",
    },
  ];
  assert(namedBy(fixture, "gate"), "a term of its own names the member");
  assert(namedBy(fixture, "done"), "a `discern <verb>` mention names it");
  assert(namedBy(fixture, "desk"), "a bare backticked mention names it");
  assert(
    !namedBy(fixture, "standards"),
    "`[standards]` names the config table, not the standards verb",
  );
  assert(!namedBy(fixture, "doctor"), "an unmentioned member is not named");
});
