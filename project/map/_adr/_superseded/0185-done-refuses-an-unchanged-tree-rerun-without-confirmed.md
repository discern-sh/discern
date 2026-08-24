# ADR 0185: done refuses an unchanged-tree rerun without --confirmed

> **Superseded by [ADR 0319](../0319-current-green-proof-composes-and-red-reruns-stay-explicit.md).** The last-run marker, unchanged-red refusal, and explicit-probe evidence survive. The unconditional unchanged-green refusal and `--confirmed` as the preferred Gate spelling do not.

**Status**: superseded; extended the receipt marker of [ADR 0067](../0067-accept-validates-the-landed-tree.md), left the advisory boundary of [ADR 0160](../0160-local-logbook-advisory-readers.md) intact, and deliberately stayed outside the consent-gated class of [ADR 0086](../0086-setup-serves-relay-messages-and-a-consent-attestation.md)/[ADR 0134](../0134-accept-attests-consent.md).

## Context

The logbook's own detectors surfaced two behaviour loops around `done`. Same-tree flakes: the exact same tree run repeatedly until a red verdict flipped green with no change in between — retry-until-green, which teaches agents that red is negotiable. Redundant green reruns: full gate runs repeated on a tree whose receipt already stood, at roughly 200 seconds each with the test stage taking 92% of gate wall time. Both are the same underlying act — asking an unchanged tree for a changed verdict — and neither rerun is ever the correct move without a reason the record can hold.

No existing state could support a guard. The gate receipt ([ADR 0067](../0067-accept-validates-the-landed-tree.md)) deliberately records only the latest green run over a clean tree and clears on red, so it cannot say "this tree was already judged". The logbook records every run, red included, but it is advisory by charter: [ADR 0160](../0160-local-logbook-advisory-readers.md) commits that no logbook reader ever gates a command.

## Decision

`done` keeps its own memory and refuses the literal rerun:

- Every completed gate run writes a **last-run marker** — `discern/last-gate-run` beside the receipt in the per-worktree Git admin area, registered in `GIT_ADMIN_STATE` — holding the end-of-run tree identity and the verdict. End-of-run, because the fix stage may rewrite files and the verdict belongs to the tree the check and test jobs actually read.
- The identity is `HEAD` plus a **working-state fingerprint**: the tracked diff plus every status-reported path (untracked enumerated individually) with size and mtime. The logbook's coarser diff-only fingerprint stays as documented — an advisory reader tolerates a collision that a refusal cannot.
- A `done` invocation on an identity equal to the marker refuses read-only, before any job or fixer runs, with the slug `unchanged_tree_rerun` and a verdict-specific hint: a red tree points at fixing the reported failure, a green one at `discern status`, both at `discern done --confirmed` for the deliberate rerun. The refusal fails open on every uncertainty — no marker, unreadable git state, corrupt marker — and `--dry-run` never refuses.
- `--confirmed` attests the rerun is deliberate. The flag name is recorded in the logbook event on both surfaces, so the `confirmed-rerun` detector can name the habit when probing becomes routine, and same-tree flake findings gain labeled evidence.

The logbook is not consulted by the refusal: the marker is gate-owned state, so [ADR 0160](../0160-local-logbook-advisory-readers.md)'s advisory boundary holds — the detectors that motivated this guard still never gate anything.

`done` does not join `CONSENT_GATED_VERBS`. That class refuses unconditionally until an owner's consent arrives, and its class test probes exactly that contract; this gate is conditional on tree state and satisfied by the caller's own attestation, not the owner's. Sharing the flag spelling keeps one attestation idiom; sharing the slug or the registry would misstate both contracts.

## Consequences

- A literal rerun now costs one read-only refusal instead of a full gate run, and a flake probe is an explicit, recorded act rather than an invisible retry.
- Output-parity flows that legitimately re-run an unchanged state (rendering the same verdict in both output modes) must attest with `--confirmed`; the engine suite already does.
- A same-size, same-millisecond rewrite of an untracked file can still collide fingerprints and refuse a genuinely changed tree — `--confirmed` is the escape, which is why the refusal is an attestation gate and not a hard block.
- If confirmed reruns become routine, the cure is diagnosing the unstable check; the detector's finding says so.
