# ADR 0173: Trim the bundled skills to seven, and split delivery between skills and hints

> **Amendments.**
>
> - **Growth ([ADR 0191](0191-an-eighth-bundled-skill-write-it-once.md), [ADR 0263](0263-a-ninth-bundled-skill-await-the-fleet.md), [ADR 0304](0304-a-tenth-bundled-skill-places-the-checkpoint.md)):** the set has since grown through the raise-then-pin ceiling this record established; the skills-count standard holds the live size.
> - **Outcome:** the deferred document-subsystem retirement did not proceed; the skill remains bundled.

**Status**: accepted

## Context

[ADR 0087](0087-prefix-and-expand-bundled-skills.md) grew the bundled set from four to nine and accepted the cost in these words: "Nine descriptions now ride in every agent's context. Accepted for this size," naming a config-selected catalog as the escape hatch if the set grew further. The set grew further: thirteen skills ship today, and their descriptions total roughly 1,080 words — injected into every session of every project discern is installed in. That is larger than the entire compiled guidance the `[standards.guidance]` ceiling holds at 827 words: the surface that was capped is now smaller than the surface that wasn't.

Months of running discern hard across real projects supplied the field evidence a curation pass needs:

- `discern-delegate-work` and `discern-write-adr` earn constant use — the owner's most-invoked skill, and a ~170-record ADR corpus. The "adr" keyword sitting front-and-center in the name is load-bearing for that recall.
- `discern-cure-a-bug` and `discern-audit-the-suite` are the set's strongest procedures.
- `discern-shape-the-work` and `discern-prove-it-works` are invoked — eagerly by some agents, never by others — with no observable difference in outcome either way. Both restate discipline frontier models now apply unprompted, and an invocation that changes nothing still costs its body tokens.
- `discern-survey-the-fleet` is mostly deterministic fact-gathering (ahead/behind, dirty state, last activity, collisions) that the engine computes more reliably than an agent running git reads per worktree, followed by narration that needs no playbook once the facts arrive structured.
- `discern-document-subsystem` fires during setup and rarely again; its actual method already lives project-side in the materialized documenter brief. Seven-plus surfaces cite it by name, including the setup instructions and two engine advisory strings.

Meanwhile the hint registry ([ADR 0172](0172-hints-compile-from-a-registry.md)) landed a second delivery channel: registry-defined advisory text attached to a verb's result at the moment it applies, at zero ambient cost.

Two principles fall out, and this record fixes them as the bar for bundling:

1. **A bundled skill must teach what a frontier model wouldn't do unprompted.** A skill that restates native behaviour is worse than none: it pays ambient description cost in every session and body cost at every invocation, and returns nothing observable.
2. **Skills answer asks; hints answer moments.** A playbook whose trigger is a conversational ask belongs in the skill picker. A discipline whose trigger is a verb moment — a gate just passed, a fleet was just listed — belongs in a hint fired at that moment.

## Decision

**Seven skills ship: `discern-cure-a-bug`, `discern-set-the-standard`, `discern-clear-the-decks`, `discern-delegate-work`, `discern-document-subsystem`, `discern-teach-the-project`, `discern-write-adr`.**

The merges are structural, never editorial:

- `discern-cure-a-bug` absorbs `discern-diagnose-a-bug` and `discern-audit-the-suite`. Its `SKILL.md` routes between three entries — proving a cause, curing a class, auditing existing guards — and the absorbed procedures survive verbatim as files inside the skill, loaded per mode. This reverses 0087's diagnose/cure split: the seam is sequential and one-to-one, and an explicit stop-point after proof preserves the diagnose-only mode without a second ambient description.
- `discern-standard-a-metric` becomes `discern-set-the-standard` and absorbs `discern-outlaw-a-pattern` as its drive-to-zero mode — the two already cite each other for exactly that relationship. The old name verbs a noun; the new one is both the literal config action and the benchmark idiom.
- `discern-prune-the-overgrowth` becomes `discern-clear-the-decks`. The skill invocation line is one of the few places a user watches discern work — a marketing surface — and the garden metaphor reads kitsch there. Clearing the decks frames maintenance as making ready for the next feature, which is the true story.

Three skills leave the picker for better channels:

- `discern-shape-the-work` is cut outright: invoked without lift, natively inferred.
- `discern-prove-it-works` compresses to a registry hint on a green, receipt-emitting gate run — exercise the real artifact along the changed paths before offering the receipt. The full playbook retires.
- `discern-survey-the-fleet` retires in favour of the engine: the status fleet survey gains the one fact only a fleet-wide view holds — cross-worktree changed-file collisions, computed by the same intersection `update` already uses — and the fleet hints prompt the narration.

`discern-document-subsystem` stays but slims: its description drops to keyword essentials, and its `_internal/` method scaffolding (the documenter brief and scope-manifest template) materializes at `discern setup` rather than on the skill's first run. The recorded end state — post-launch, once map-drift and map-validation hints exist — is that its orchestration joins the brief inside the map and the skill retires, making the set six.

Enforcement replaces acceptance-prose:

- Two `[standards.skills]` ceilings hold the surface: the bundled count at seven, and the total description words at the landed value. Growing either is an owner decision the gate fails by default — 0087's "accepted for this size" becomes a number.
- A parity guard closes the citation class: every `discern-*` skill name appearing in engine string literals, templates, or the map must name a bundled skill. The logbook detectors recommend skills by name; without this guard, the trim itself would have shipped advice citing skills that no longer exist.

Explicit *no*s: no config-selected catalog or packs — curation beats configuration for a default surface, and a new knob contradicts the direction set by retiring the feature toggles ([ADR 0101](0101-retire-the-features-toggles.md)). No deletion of the absorbed procedures' content — the delivery was wrong, not the material. No change to the surviving naming convention (imperative verb + concrete object, per 0087).

## Consequences

- The ambient description block roughly halves; the exact landed number is pinned by the new standard and can only fall.
- Removed and renamed names self-heal in agent skills directories on the next refresh or upgrade via the ownership manifest, exactly as 0087's renames did. A `[skills].exclude` entry naming a removed skill warns and excludes nothing — the existing behaviour for any unknown name.
- A project that overrode or ejected an absorbed skill under its old name keeps an authored copy standing alone — the same consequence 0087 accepted for its renames.
- Surviving descriptions must carry the absorbed trigger vocabulary ("why is this happening", "audit the tests", "migrate off X"), so they grow individually while the block shrinks; the description-words ceiling caps the pressure to restuff.
- A merged skill reads as one discipline with modes; an invocation pays one extra file read to load its mode.
- Hints now carry disciplines that once had full playbooks: fewer words at better moments, but less depth. The logbook records which hints fire; if that evidence later shows a hint ignored where the playbook demonstrably changed behaviour, restoring a skill is a one-directory revert plus an owner-approved limit move — the cheap direction of this door.

## Alternatives considered

- **Keep thirteen and rely on `[skills].exclude`.** Rejected: exclusion is opt-out curation performed by every user individually, and almost nobody will. The default surface is the product.
- **A config-selected catalog** — 0087's sketched escape hatch. Rejected for launch: it adds configuration to solve what curation solves, and the default set would still need choosing.
- **Cut the weak performers' content entirely.** Rejected for the merged three: those procedures are the set's best writing; only their packaging failed.
- **`discern-hold-a-standard` and `discern-cut-the-cruft` as the new names.** Rejected on the owner's ear: "hold" is custodial where the feature's story is aspirational, and "cruft" is developer-canonical but opaque to onlookers watching the invocation line.
