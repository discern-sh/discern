# ADR 0263: A ninth bundled skill routes wait-shaped asks to `await`

**Status**: accepted; the second owner-approved growth of the set [ADR 0173](0173-trim-the-bundled-skills-to-seven.md) capped, landed with the raise-then-pin ceiling sequence [ADR 0191](0191-an-eighth-bundled-skill-write-it-once.md) established. Builds on the `await` contract of [ADR 0213](0213-await-blocks-on-authoritative-fleet-conditions.md) and the operating-policy registry of [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md).

## Context

`discern await` carries its contract on more surfaces than any comparable verb: the always-loaded guidance bullet, the MCP server instructions, the tool description, the met/refusal hints, and the map's fleet-awaiting page — with a parity guard holding the calling conduct identical across the authored ones. Yet every one of those surfaces activates only **after** an agent has decided the verb is relevant. The tool description is read when the tool is considered; hints fire after a call; the guidance bullet is conduct-dense — resume handling, reporting discipline — with no vocabulary connecting it to the moment a user says "wait for the other agent to finish."

Field evidence said that routing gap is real. Unless the owner typed `discern_await` literally, agents met wait-shaped asks with status polling loops, shell sleeps, or a request that the human relay readiness — precisely the relays the verb exists to delete — or executed the watch with improvised conduct. This repository's own staged planning briefs re-spelled the calling procedure by hand in every dependent brief rather than trusting the always-loaded bullet. And `discern-delegate-work` §4 pointed dependent briefs at "the receiving agent's built-in guidance" for the wait procedure — a surface that carries the conduct rules but not the condition choice or the composition steps a dependent stage actually needs, which is consistent with delegated agents rarely awaiting well.

[ADR 0173](0173-trim-the-bundled-skills-to-seven.md) fixed the bar for bundling: a skill must teach what a frontier model would not do unprompted, and skills answer asks while hints answer verb moments. The failing moment here is an ask — "wait for X", "when it lands, carry on" — that arrives **before** any verb runs, so no hint can reach it: a hint cannot fix a call that is never made. Skill descriptions are the one discern surface indexed by conversational intent.

## Decision

**`discern-await-the-fleet` ships as the ninth bundled skill: a router from wait-shaped asks to one well-formed watch, plus the composition procedure that follows it.**

The body teaches what the other surfaces don't carry at the routing moment: choose the one condition from the need (build on the tree → green; need it in the trunk → landed; any movement → trunk moved), await the literal returned branch rather than a guessed suffix, hold one longest-safe call quietly, follow the met hint's composition step and verify the arrival, route refusals forward, and recognize the waits that don't warrant a watch — your own branch, subagents inside the caller's own session, things only a human can supply. The calling-conduct paragraph quotes the canonical operating-policy statement **verbatim**, and the await calling-surfaces parity test enrolls the `SKILL.md` as a fifth surface, so the skill is structurally unable to drift from the policy: a reworded policy updates all five surfaces or fails the gate.

The name takes the map page's established vocabulary ("Awaiting the fleet") and the set's imperative verb-phrase convention. The working title — "wait your turn" — was rejected for routing on the wrong vocabulary: it reads as queueing and politeness, colliding with `discern queue`, while "await" in the name means even a terse ask fuzzy-matches the skill. The description carries the trigger phrases ("wait for", "watch", "check back on"; polling, sleeping, relayed readiness) and one scope boundary: not for subagents inside the agent's own session, the nearest neighboring intent a harness offers.

`discern-delegate-work` re-points rather than duplicates: a dependent brief carries the dependency facts — exact returned branch, readiness condition, composition move — and names `discern-await-the-fleet` as the owner of the mechanics. Its contract test moves the pinned sentence and keeps the leaked-procedure blocklist that already banned wait mechanics from briefs.

The owner raised the standards on `main` before this implementation: `skills_count` from 8 to 9 and `skills_words` from 795 to 900. The change adds 97 frontmatter words, bringing the measured total to 892, and pins the ceiling back down to 892.

## Consequences

- "Wait for the sibling", "when it lands, carry on", and their variants route to `await` without the verb being named literally, and arrive with the condition-choice and composition judgment the contract surfaces defer.
- Every agent session in every installed project pays 97 additional ambient frontmatter words; the pinned ceiling holds the price, and `[skills].exclude` remains the opt-out for projects that never run parallel worktrees — the same trade `discern-delegate-work` already makes.
- The conduct paragraph is a fourth authored copy of the watch policy by count, but the first added under enrollment: parity now spans guidance, MCP instructions, the tool description, and the skill as one checked set.
- Staged briefs shrink: delegate-work's briefs state dependency facts in one line and inherit the procedure by reference, removing the per-brief hand-restatement this repository's own planning documents had normalized.
- The catalog and canon guards enrolled the ninth member on addition — map tables, feature canon, registry atlas, desk tip — so rename or removal drift fails the gate, as designed.

## Alternatives considered

- **Trigger vocabulary in the guidance bullet.** Rejected: the guidance ceiling is an always-loaded budget with words of headroom, and the genuinely missing content — condition choice, branch resolution, composition — is a procedure, not a clause.
- **A richer tool description.** Rejected: it is already the contract's best single statement, and it is read only after the routing decision it would need to influence; CLI-only installs never see it at all.
- **A hint.** Rejected on [ADR 0173](0173-trim-the-bundled-skills-to-seven.md)'s own line: hints answer verb moments, and the failing moment precedes any verb.
- **Ship the skill without parity enrollment.** Rejected: an unenrolled restatement of the watch policy is a copy free to drift — the exact defect class the operating-policy registry exists to prevent.
- **Fold the procedure into `discern-delegate-work`.** Rejected: delegation is one producer of waits, not the only one — a user's direct ask and a coordinator session watching a landing route through no brief — and the delegate-work contract test deliberately bans wait mechanics from that skill's body.
