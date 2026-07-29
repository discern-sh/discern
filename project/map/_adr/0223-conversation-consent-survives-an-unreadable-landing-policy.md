# ADR 0223: Conversation consent survives an unreadable committed landing policy

**Status**: accepted — narrows [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md)'s settlement clarification, which made a malformed committed policy blocking evidence for every consent source.

## Context

The first schema-tightening landing after ADR 0194 hit its own boundary. The [ADR 0222](0222-frozen-contracts-complete-the-canon.md) canon sweep retired a config key, so the trunk's committed `discern.toml` — valid when written — no longer satisfied the branch engine's strict schema. `accept` rightly warned that it could not check standing authority. But `accept --confirmed` refused too: the malformed-policy rule vetoed the owner's live attestation and told them to fix the trunk config first. That advice demands a direct trunk edit the worktree discipline forbids — from the branch that was itself the fix.

The deadlock is structural in both distribution shapes:

- **Source-built** (this repository): the trunk checkout's older engine still parses the old record — an escape that exists only because two engine versions coexist.
- **Single binary** (every end-user install): once the binary's schema tightens, no engine anywhere parses the old record. The worktree carrying the migration is the only repair vehicle inside the discipline.

And the record cannot express what the veto implied. `[acceptance].pre_authorized` is grants-only: it widens authority, never restricts it, so an unreadable record holds nothing live consent could bypass. The veto protected no restriction — it froze the one landing that repairs the record, and made "fail toward a conversation" a sentence the conversation could not cash.

## Decision

**An unreadable committed landing policy blocks the recorded consent sources and only them.** Unreadable covers both failure modes: a record that does not parse, and one the current schema rejects.

- **Standing grants** stay blocked — they live inside the unreadable record.
- **Effort grants** stay blocked — authority recorded in advance keeps failing closed on defective policy evidence, as ADR 0194's settlement clarification holds. The pure resolver still refuses effort authority on blocking evidence.
- **Current-conversation consent proceeds.** `accept --confirmed` lands, and the record's defect travels as an authority warning on the result envelope. An unconfirmed call still refuses into the review moment with the defect named, so the owner decides while looking at it. The narrowing lives at the acceptance consent boundary, not in the resolver.

The verification gate keeps its own stop. A trunk config that fails to parse still fails the never-loosen standards check, since it yields no limits baseline. Schema-era drift — a record that parses but carries retired keys — passes that check by design, because the standards baseline reads raw sections. The migration branch lands end to end. A syntactically destroyed record still halts one layer later, for a verifiable reason.

## Consequences

- The bootstrap landing exists on every distribution shape: a branch moving config and schema together lands itself under owner consent, with no trunk hand-edit and no second engine.
- A defective record degrades autonomy instead of freezing landing. Scopes lose their standing coverage until the record's repair lands, and every affected envelope says so in its authority warnings.
- The regression suite constructs both failure modes: a retired key under a strict schema, and a syntactically dead record. It holds the whole boundary — recorded sources blocked, conversation honored, the syntax case stopping at the never-loosen verification rather than at consent.
- ADR 0194's malformed-policy rule narrows to the recorded sources, and its settlement clarification gains a pointer here.

## Alternatives considered

- **Rewording the refusal to name the trunk-engine escape.** Rejected: the escape exists only source-built. An installed project has one binary and no engine that parses the old record, so the advice would be wrong for it.
- **Tolerant section-reads of `[acceptance]` and `[scopes]` so standing grants survive unrelated drift.** Rejected: reading a record from one schema era with another era's reader moves autonomy-widening under version skew, which the direction principle forbids. It also forks the config schema's authority into a second, looser parser.
- **Keeping the consent-layer veto for the syntax-dead case only.** Rejected: the never-loosen verification already owns that stop with a diagnostic naming the repair. A consent-layer duplicate re-creates the double veto this record removes.
