# ADR 0234: Tips are the desk's human advisory channel

**Status**: accepted. Builds on [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) (the desk), [ADR 0172](0172-hints-compile-from-a-registry.md) (the hint registry), and [ADR 0207](0207-hint-follow-through-is-declared-and-episode-based.md) (episode-based follow-through). Amends the plain register's rendering of _hint_ ([ADR 0228](0228-the-feature-canon-carries-a-plain-language-register.md)).

> **Placement amendment (2026-08-04):** The tip now follows the root status line in the same header group, with a yellow `Tip` label. Unlanded and reclaimed-branch facts follow in separate groups. Selection, wrapping, and session stability are unchanged.

## Context

discern's primary users are coding agents, and nearly every surface aims at that reader: the verbs, the tools, the hints, the compiled guidance. The human's one guaranteed surface is the desk — bare `discern` ([ADR 0119](0119-bare-discern-opens-the-operators-desk.md)). Between those two facts sits an undiscovered feature set. The capabilities built for the human — `patterns`, `improvement`, `standards`, desk grants, `coupling`, and their kin — reach only the person who already knew to ask. The documentation records them, but documentation answers questions the reader already has. Nothing in the product ever volunteers capability to the person running it.

The desk therefore gains a single per-session **tip**: one line that teaches a human one thing discern can do. Making that a first-class concept forces a vocabulary decision first. The plain register ([ADR 0228](0228-the-feature-canon-carries-a-plain-language-register.md)) rendered _hint_ as "a tip", so the word was already spoken for. Decided with the owner on 2026-07-30; this record is the contract the implementation waves build against.

## Decision

**A hint advises an _agent_, inside the result envelope of the verb that made it relevant ([ADR 0172](0172-hints-compile-from-a-registry.md)). A tip teaches a _human_, ambient at the desk. The two concepts keep separate registries, separate registers, and separate delivery.**

The plain register now renders _hint_ as "an advice note", retiring "tip" from that role so the new concept carries the word without collision. The glossary gains its "tip" entry in the wave that ships the feature, not before. The glossary defines shipped concepts, and the glossary↔lexicon bijection guard forces the plain rendering decision into whichever change adds the term — deferral costs nothing, while an early entry would document a feature the tree does not carry.

### The desk slot

One dim tip line renders at the foot of the desk header. The desk chooses it once per session, and it stays stable across board redraws. The line wraps at the resolved terminal width and never truncates. Narrow embedded terminals — coding-agent GUI sidebars — are the norm among discern's users, and a clipped sentence teaches nothing.

### The boundary

Tips educate about capability; they never alarm about state. Alarms belong to hints, to `status`, and to the desk header itself. A tip may read context to be _timely_ — surfacing while its subject is newly relevant — but it must stay useful when ignored. A tip is never the only route to an action, and a human who never reads one loses only the education.

### Selection

Selection is deterministic, never random. The order:

1. Contextual tips whose predicate currently holds, among the unseen.
2. Unseen tips in authored order — the authored order is a designed onboarding curriculum, not incidental file order.
3. Rotation from the tip shown longest ago.

No tip repeats until the applicable pool exhausts.

### `since` tags and upgrades

A tip may carry a `since` version. Entries newer than the seen-state file's baseline version render with a "New in \<version\>" prefix and rank first among unseen tips, so an upgrade surfaces the features it brought. A fresh install writes the current version as its baseline. To a day-one user everything is new, so nothing renders as "New in" — a flag on every line would mark nothing.

### The register

The tip register addresses a beginner, and a mechanical guard polices it — the guard lands with the tip inventory. Command names stay in code spans, and each concept takes a translation on first use: the plain register's "quote the names, translate the concepts" rule at one-line scale. The user who already knows the vocabulary is the user who least needs a tip.

### Seen-state and measurement

Seen-state lives per repository beside the logbook under the git common dir, shared by the repository's worktrees. The logbook records shown tip ids from day one, before any reader consumes them, per its vocabulary discipline. A patterns follow-through family — landing in its own wave — measures tip → adoption on the episode model of [ADR 0207](0207-hint-follow-through-is-declared-and-episode-based.md). Adoption counts on **any** surface, not only the desk: a human who reads a tip and then directs an agent to act on it has followed through, because directing an agent is how humans most often act here.

### Enrolment

Every human-discoverable feature in the canon needs a claim from at least one tip, or a recorded deliberate absence with a reason — the forcing-function discipline ([ADR 0051](0051-canonical-set-parity.md)) applied to discoverability. No feature ships dark.

## Consequences

- "Hint" and "tip" become disjoint concepts with disjoint audiences, so a sentence using either word has one meaning on every surface. The price is a wordier plain rendering — "an advice note" — across the canon's plain accounts, paid once in the vocabulary sweep that precedes the feature.
- The desk gains its first ambient teaching surface, and the authored tip order becomes a maintained curriculum. The enrolment guard turns "we forgot to tell anyone" into a gate failure instead of a retrospective.
- Deterministic selection makes every tip reachable by test: a given seen-state, context, and version yields one predictable line.
- Recording shown ids from day one means follow-through evidence accumulates before the detector exists, so the detector's first run already has history to read.
- A human who never opens the desk never meets a tip. Accepted: the desk is the one surface a human can count on, and the other surfaces stay agent-first by design.
- The measurement rule — adoption on any surface — can conflate a tip's effect with an agent's independent habit. The episode model's censoring rules bound that ambiguity without removing it.

## Alternatives considered

- **Random selection.** Rejected: it repeats tips before the pool exhausts, no test can pin its output, and it discards the curriculum — the one ordering a designer controls.
- **Truncating the tip line.** Rejected: the narrow embedded terminals discern's users live in would clip most tips mid-sentence. Wrapping costs a second line; truncation costs the message.
- **A disable knob.** Deferred until real demand exists. One dim line per session is a small ambient cost, and the follow-through data will argue the case for or against a knob better than speculation can.
- **Reusing the hint registry for tips.** Rejected: the delivery semantics differ (ambient at the desk versus attached to the result that made the advice relevant), and so do the audience and the register. One registry serving both would strain the schema of each — the same reasoning that kept hints out of the glossary registry ([ADR 0172](0172-hints-compile-from-a-registry.md)).
