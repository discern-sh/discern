# ADR 0194: Standing pre-authorization is a recorded, machine-checked grant — `[landing]`, covered landings, and the desk's effort grant

**Status**: accepted — extends [ADR 0134](0134-accept-attests-consent.md) (the consent gate stays; one of its consent sources gains a verifiable referent) the way ADR 0134 extended [ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md). Builds on [ADR 0110](0110-the-landing-model.md) (the landing model), [ADR 0067](0067-accept-validates-the-landed-tree.md)/[ADR 0116](0116-receipts-vouch-only-for-the-pinned-tree.md) (receipts and the validated tree), [ADR 0119](0119-bare-discern-opens-the-operators-desk.md)/[ADR 0151](0151-the-desk-starts-tasks-and-opens-agents.md) (the desk), [ADR 0172](0172-hints-compile-from-a-registry.md) (the hint registry), and [ADR 0160](0160-local-logbook-advisory-readers.md)/[ADR 0162](0162-logbook-day-one-vocabulary.md) (the logbook). Leans on [ADR 0193](0193-discern-does-not-enforce-the-vendor-security-boundary.md) for one explicit _no_.

## Context

Five shipped surfaces assert that a standing pre-authorization can stand in for a per-landing conversation — the consent registry's doc comment, the `accept` refusal message, its hint, the MCP tool description, and the worktree guidance — **and nothing records one.** The concept resolves to the agent's memory of a conversation, which is exactly the substrate ADR 0086 showed degrades: everything structurally enforced happened reliably; everything living in an agent's recollection compressed away. `--confirmed` currently attests _either_ consent source, so a half-remembered "the owner said it's fine last week" is indistinguishable from consent given this conversation.

The trust model's practical leak is meanwhile on the owner's side, not the agent's. When the landing ceremony costs more than the change — a note dropped into a private docs folder, a typo fix — the owner routes around the system ("skip the worktree, just do it on main"), and the bypassed landing is invisible to the receipt, the logbook, and every audit surface. A trust model that prices small delegations out of its own front door manufactures the bypasses it exists to prevent.

Two prior decisions box in any fix. ADR 0134: no config to disable the consent gate — a switchable consent gate is not a consent gate. ADR 0101: no subsystem toggles — a knob must earn its existence. And ADR 0134's timing argument applies once more: narrowing the meaning of a shipped attestation is free before launch and a breaking semantic change after it.

## Decision

**Standing pre-authorization becomes a recorded grant that `accept` checks, instead of a phrase an agent remembers.** Consent has three sources, each entering through a channel matched to its lifetime, and every landing records which one it used.

1. **`[landing]` is a new config section; `pre_authorized` lists the scopes granted standing pre-authorization.** Entries are scope names from `[scopes]`. The section activates by presence (ADR 0101: absent or empty is byte-identical to today's behavior — this is not a toggle, it is a grant that does not exist until the owner writes it). At enforcement time the grant is read from **the trunk's committed `discern.toml` only** — the same trunk-read the never-loosen standards check uses — so a branch can never grant itself trust.

2. **A covered landing needs no attestation.** `accept` succeeds without `--confirmed` when every changed path in the validated tree classifies into a granted scope. Any path left uncovered — including one no scope matches at all — fails closed to the conversational path: a wrong classification can only revoke autonomy, never extend it (the direction principle 5 requires). There is **no second flag**: an attestation asserts a fact only the caller can know (the owner accepted, in this conversation), while a standing grant is machine-checkable end to end, so demanding an assertion for it would add a lie-shaped surface in the same semantic field as `--confirmed` and invite the two to be used interchangeably. `--confirmed` accordingly **narrows to conversation consent only**, and the five surfaces re-point their "standing pre-authorization" phrase at the recorded grant.

3. **The desk grants one effort.** The owner can pre-authorize a single worktree's landing from the desk — the per-effort complement to the standing grant, for "land this one when green" said in advance. The grant is stored git-side, outside any branch-writable tree, so an agent cannot forge it; it is granted only at the desk (the human at the TTY _is_ the consent moment, the same logic as the desk's existing land action, ADR 0134); and it dies with the worktree — cleared on landing or drop.

4. **Every landing records its consent source** — conversation, standing grant (and which scopes), or effort grant — on the receipt line and in the logbook, from day one. Evidence before inference (ADR 0162): the patterns detector and grant suggestions build on data that starts accruing at launch.

5. **Lifecycle envelopes are authority-aware.** `start` states the effort's landing authority up front; a green `done` says either "relay the receipt and stop" or "covered by the standing grant for these scopes — land it", computed from the verified grant at that moment; `status` shows the same. Static guidance keeps its non-autonomy rule — the acceptance-instruction test is amended deliberately and narrowly so that only a runtime hint whose firing condition is a machine-verified grant may present `accept` as the next step. This is the routing test (ADR 0192) applied to trust: authority is delivered at the moment it is true, never as standing prose.

The explicit *no*s:

- **No gate toggle.** ADR 0134 stands: the consent gate itself remains unconditional. This record gives one consent source a referent; it adds no switch.
- **No size bounds** (`max_files`, diff-line caps). Counts give the _appearance_ of policy — a three-file change can rewrite the release pipeline. Grants bind to meaning (scopes), never magnitude.
- **No wildcard in v1.** Entries are scope names, not patterns — `"*"` would falsely imply globbing. Repo-wide standing autonomy erases the review moment entirely and waits for a real request; `"all"` is the reserved spelling if it ever lands. The desk's effort grant covers "just land this one" in the meantime.
- **No agent-run verb ever writes a grant.** Grants enter through surfaces a human drives: the trunk's committed config (owner-instructed, in daylight, in trunk history — the standards-limit pattern) or the desk's TTY. Agent-run verbs only ever read authority.
- **No enforcement at the vendor boundary** (ADR 0193), and **still not cryptographic** — ADR 0134's accepted limitation stands. A determined agent can lie with `--confirmed`; the value of this design is that the honest paths are now checkable, distinguishable, and on the record.

## Consequences

- **Default-inert**: an install without a `[landing]` section behaves byte-identically to today. The one behavioral change is opt-in, which is what makes shipping this at launch safe.
- The bypass incentive inverts: the cheapest way to land a small delegated change is now _through_ the worktree flow, where it is receipted and logged — not around it.
- `--confirmed` is born meaning exactly one thing. Deferring this would have shipped the ambiguity and forced a post-launch semantic migration.
- The audit trail gains a dimension (consent source), and the patterns work — a pre-authorized-landings detector, "consider granting `docs`" suggestions — has data from day one.
- **Scope definitions become consent-bearing.** A carelessly wide scope now widens a grant; `[scopes]` carries trust weight it did not have, and the config reference and template comments must say so.
- The acceptance-instruction test loses its absolute form; its amendment must stay narrow enough that static prose can never present `accept` as autonomous.
- `accept` gains a second success path that must stay coherent with ADR 0067/0116: the covered path still lands only the validated sha of a green, receipted tree.

## Alternatives considered

- **A second attestation flag** (`--pre-authorized`). Rejected: no information content (the fact is machine-checkable), and two flags in one semantic field invite interchangeable use — the failure mode the design must exclude.
- **An omnibus `[policy]` section.** Rejected: discern's sections name concepts (`[gate]`, `[standards]`, `[worktree]`), and a rules-bag section accretes unrelated knobs. `[landing]` names the act it governs (ADR 0110's vocabulary) and future acts earn their own sections.
- **Storing the effort grant in the worktree.** Rejected: anything under a branch-writable tree is agent-forgeable; the grant lives in git-side state like the logbook (ADR 0165).
- **Deferring the whole feature past launch.** Rejected: the five surfaces would launch promising a concept with no home, the schema would owe a migration forever, and the attestation's meaning would need narrowing after callers exist — all three costs are zero before launch.
