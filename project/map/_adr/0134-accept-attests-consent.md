# ADR 0134: Landing attests consent — `accept` requires a `--confirmed` attestation

> **Consent-source amendment (2026-07-28; [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md)):** `--confirmed` now attests only that the owner accepted this landing in the current conversation. Standing scope grants and one-effort desk grants are recorded and checked directly; a covered landing needs no flag. Every applied landing still requires one verified consent source. The broader standing-pre-authorization meaning in the original decision below is historical.

**Status**: accepted — extends [ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md)'s `--confirmed` pattern from the fresh-scaffold act to the landing act. Builds on [ADR 0110](0110-the-landing-model.md) (the landing model: land only on the trunk) and [ADR 0028](0028-result-envelope-and-diagnostics.md) (one result envelope per verb). Reinforces, and does not revise, ADR 0110's entry contract — the explicit-user-request rule it already states becomes structural.

## Context

Landing is discern's most consequential act: `accept` fast-forwards the trunk to a branch tip, removes the worktree, and deletes the branch. Until now it was guarded only by a guidance sentence — _relay the receipt, wait, land only once your owner asks_. ADR 0086 taught the governing lesson from repeated clean-room runs: **everything structurally enforced happened reliably; everything merely advised degraded under an agent's final-answer compression.** An agent under context pressure drops the prose and lands on a consent that exists only in its own summary.

The asymmetry was backwards. `setup begin` — scaffolding a fresh install, a _less_ destructive act than landing — already refuses without `--confirmed` (ADR 0086), forcing the consent moment into the transcript. Host-side destructive-tool prompts don't cover an allowlisted tool or the CLI path, so the highest-stakes act had the weakest guard. And retrofitting a required flag post-launch breaks every caller — so pre-launch is the free moment to add it.

## Decision

**`accept` requires an explicit `--confirmed` attestation; without it, it refuses read-only and re-serves the review moment.** The attestation asserts a fact about the conversation — _the owner has accepted this landing, or gave standing pre-authorization_ — so a pre-authorized agent passes it in its single call and pays zero extra round-trips. The refusal round-trip fires exactly when the agent could not truthfully attest, which is the moment that should interrupt.

1. **The refusal is the outermost gate, and mutation-free.** It fires before any git runs — cheaper than the preconditions, and genuinely touching nothing. The envelope carries the shared `awaiting_consent` slug (single-sourced with `setup begin` in `src/shared/consent.ts`), the relay instruction, and hints that point at the receipt affordances the review moment already owns (the honored receipt on `discern status`, the raw-diff command) plus the recovery: re-run with `--confirmed`.

2. **A dry-run needs no attestation.** `--dry-run` previews and never lands, so the gate is `!dryRun && !confirmed` — mirroring ADR 0086's `setup begin`.

3. **Flows that already collected consent pass it in.** The desk's interactive "Land?" prompt _is_ the acceptance, and the setup-flow landing (`setup
   accept`) collected its consent in the setup handshake; both pass the attestation internally rather than double-refusing. (`setup accept` is a separate main-checkout path that never routes through the worktree accept core, so it is unaffected regardless.)

The explicit **no**s:

- **No reason/description parameter.** Boolean-only. A captured reason is purely additive later and belongs to the owner's agent-observability roadmap (task metadata across the lifecycle); building it here would overreach the decision.
- **No config to disable the gate.** A switchable consent gate is not a consent gate. There is no toggle.
- **Not a cryptographic guarantee.** Like ADR 0086's flag, a determined agent can pass `--confirmed` without holding the conversation. Accepted: the value is that the refusal forces the relay moment into the transcript for the honest majority, not a proof of consent.

## Consequences

- The highest-stakes act now matches the fresh-scaffold act: structure, not advice, at the read-only→destructive boundary. The asymmetry is fixed.
- **Consent-gated verbs are a legible class.** `setup begin` and `accept` share one refusal slug and one registry (`CONSENT_GATED_VERBS`); a parity test holds every member to the same refusal contract, so a future gated act enrols by adding one registry entry — and fails the gate until it refuses correctly.
- **Every existing caller passes `--confirmed`.** The CLI verb, the MCP tool, the desk, and every test that lands now carry the attestation; a confirmed call is byte-identical to the prior success path. This is the one-time cost the pre-launch timing exists to absorb.
- More surface to keep coherent: a flag, an MCP field, and a refusal envelope — held together by the shared slug/registry and the parity/behaviour tests.

## Alternatives considered

- **Keep the prose-only status quo.** Rejected: ADR 0086's evidence is that advice degrades under compression, and landing is precisely where a dropped sentence is most expensive. Structure beats advice at the highest-stakes act.
- **Add a reason/description parameter now.** Deferred, not rejected: it is additive later and part of the observability roadmap. Boolean-only is the whole v1 surface, so the flag ships without waiting on that design.
- **A config toggle to enable/disable the gate.** Rejected: a consent gate that can be switched off is not a consent gate.
- **Gate later, after the preconditions pass.** Rejected: the consent refusal should be the cheapest, first thing an agent confronts, and must fire even when the tree is otherwise ready to land — exactly the moment to interrupt.
