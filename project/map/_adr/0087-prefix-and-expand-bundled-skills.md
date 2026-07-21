# ADR 0087: Prefix the bundled skills with `discern-` and expand the set to nine

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `graduate` → `accept`; the decision and reasoning are unchanged. **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** Current pointers use Project Script for the former project Recipe surface; the decision and reasoning are unchanged.

**Status**: accepted

## Context

The bundled skills materialize into each agent's skills directory alongside skills from every other source — the user's own, other tools', a vendor's — with nothing marking where they came from. A user watching `fix-a-bug-class` run had no way to see discern behind it, and a user authoring a skill could collide with a bundled name by accident. Meanwhile the set itself was due to grow: the two skills that had proven the bar (`fix-a-bug-class`, `delegate-task`) are general working disciplines, and a curation pass identified five more playbooks worth shipping — plus two naming problems ("class" in `fix-a-bug-class` parses as an object-oriented class before it parses as a category; `delegate-task` had no answer for parallel fan-out beyond an appendix section).

[ADR 0046](_superseded/0046-graduate-destination-and-skill-removal.md) set the quality bar that constrains any expansion: a bundled skill must be a genuine multi-step judgement playbook, never a wrapper around a deterministic verb.

## Decision

**Every bundled skill is named `discern-<imperative verb>-<object>`, and the set grows from four to nine.**

The naming convention: an imperative verb plus a concrete object, articles where they read naturally — a name you could say aloud to a colleague (`discern-cure-a-bug`, `discern-survey-the-fleet`). The `discern-` prefix is the one namespace that works across every provider (no cross-vendor plugin namespace exists): it attributes the skill at the moment it runs, groups the bundled set in any alphabetical picker, and removes by construction the collision class where an authored skill accidentally shares a bundled name. Each description ends with a "Bundled with discern." provenance tail for skill pickers that show descriptions.

Renames:

- `write-adr` → `discern-write-adr`; `document-subsystem` → `discern-document-subsystem` (prefix only).
- `fix-a-bug-class` → `discern-cure-a-bug` — "cure", as opposed to symptomatic relief, states the same promise (every instance, permanently, behind a guard) without the object-oriented misreading.
- `delegate-task` → `discern-delegate-work` — absorbs parallel fan-out as a first-class "shape the handoff" step (one brief, a sub-agent fan-out, parallel worktrees on real seams, or staged briefs), per ADR 0046's one-real-skill-over-two-thin-ones doctrine.

New skills:

- `discern-diagnose-a-bug` — prove a bug's cause (reproduction, falsifying hypothesis loop, history interrogation) before any fix; hands the proven class to `discern-cure-a-bug`.
- `discern-standard-a-metric` — the judgement around the standard feature: defendable metrics, rates over raw counts, limits at today's value, the never-loosen discipline, and the retire-at-zero end state.
- `discern-outlaw-a-pattern` — codebase-wide pattern elimination as legislation: detector, falling standard (a one-way door, not gradualism — removal goes as fast as budget allows), permanent gate rule at zero.
- `discern-teach-the-project` — route a session's lesson to exactly one of the project's knowledge surfaces (guidance line, authored skill, Project Script, doc, ADR). The built-in skills guidance gains one ambient line telling agents to _offer_ this at natural pauses — the first bundled-skill mention in the always-on guidance.
- `discern-survey-the-fleet` — read-only reconnaissance across all worktrees: per-effort intent, classification, cross-worktree file-collision detection, and recommendations that stay the owner's calls. A judgement layer over `discern status`'s fleet rows, not a wrapper of the verb.

## Consequences

- Materialization prunes the old names from agent skills directories via the ownership manifest — renames self-heal on the next `refresh`/`upgrade`, no migration step.
- An authored skill that shadowed a bundled one under an old name (`./skills/write-adr`) stops shadowing: it stands alone while the renamed built-in materializes beside it. Accepted — shadowing under the _new_ name restores the override, and the pre-launch install base is small.
- Historical ADRs keep the old names as a record; [ADR 0049](0049-bug-class-discipline-built-in.md) carries a rename note. The [install surface](../80-development/install-surface.md) tables the full set; other docs point at `templates/skills/` rather than hand-enumerating names.
- Nine descriptions now ride in every agent's context. Accepted for this size; a config-selected catalog (packs, or a `[skills]` selection list) is the escape hatch if the set grows further, and is deliberately _not_ designed here.

## Alternatives considered

- **No prefix** (the precedent of vendors shipping their own bundled skills without a prefix). Rejected: a vendor's skills are first-party defaults in its own product; discern's are a guest in someone else's agent, across several vendors at once — the guest wears the name tag, and the collision class disappears with it.
- **Dropping the prefix on `skills eject`** (an ejected copy becomes yours, so it sheds the badge). Rejected: override-by-name is the customization mechanism — an ejected copy renamed to drop the prefix would stop shadowing the built-in, and both would surface. Eject keeps the name.
- **A `discern:` namespace separator** rather than a hyphen. Rejected: skill names must stay valid directory names and slash-command tokens everywhere; the hyphen is the portable spelling.
