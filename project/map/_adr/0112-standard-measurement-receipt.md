# ADR 0112: a measurement receipt lets check → pin measure once

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `graduate` → `accept`, the gate-pass artifact → the receipt; the decision and reasoning are unchanged. **Extended by [ADR 0133](0133-standards-join-the-gate.md):** a green gate run over a clean committed tree now records this receipt too (durations included, merged into a same-HEAD receipt rather than clobbering a fuller one), so `done` → `--pin` → `accept` measures once — and the recorded values double as the baseline the gate's input-keyed replay stands on. Auto-pin stays rejected: recording is a read-side cache; capturing a gain remains the explicit `--pin`. **Operational amendment ([ADR 0152](0152-slow-workflows-prove-write-authority-first.md)):** `standards` now proves the measurement receipt is writable before measuring; `standards --pin` also proves the config and Git commit surfaces before measuring or replaying. The receipt remains best-effort only against failures that arise after that point-in-time probe. **Path amendment ([ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md)):** The worktree-local measurement receipt now resolves as `discern/standard-measurements`, beneath Discern's Git-admin namespace. Its identity and cache semantics are unchanged.

**Status**: accepted. Extends [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md) (`standards --pin`) and [ADR 0067](0067-accept-validates-the-landed-tree.md) (the gate receipt's identity model), building on the named-metric standards ([ADR 0003](0003-named-metric-standards.md)).

## Context

The intended capture flow is check → pin: run `discern standards`, read the green result's pinnable-slack hints, then run `discern standards --pin` to capture the gain. But verbs are stateless, so the pin re-ran every measurement the check had just paid for — on the same clean HEAD, guaranteed to produce the same numbers. A project with a slow measurement suite (a full coverage run, a release build) paid double on its most common capture path. Efficiency, not correctness: the double-run could never pin a wrong value, only waste the first run.

The tempting fix — auto-pin after a green check — was rejected on product grounds. The never-loosen rule makes the two failure modes asymmetric: pinning too late costs nothing (slack just waits), while pinning too eagerly locks in a transient mid-branch high that the branch itself then trips over, and the only way back is the hand-edit loosening the whole discipline treats as a last resort. A check must stay a read; pinning is a policy commitment, taken deliberately.

## Decision

**A green `standards` check over a clean tree records a measurement receipt — its per-standard measured values against the exact HEAD — and a `--pin` on that same clean HEAD replays those values instead of re-measuring.**

- **The gate receipt's model, verbatim.** Same home (a single file, `discern-standard-measurements`, in the per-worktree git admin dir — untracked, worktree-local, self-cleaning), same identity rule (honored only while it names the current HEAD and the tree is fully clean), same fail-closed posture. Any commit, amend, or uncommitted edit silently invalidates it; a red check clears it; a `--force` check over a dirty tree records nothing, because its values describe a tree no pin will ever see.
- **A cache, never an authority.** Every shortfall — missing, stale, dirty, malformed, a planned standard the receipt does not name — is a cache miss the pin answers by measuring fresh, never an error. The file's content is parsed defensively: anything mis-shaped reads as absent.
- **Only the measurements are cacheable.** A standard's verdict has two halves, and the never-loosen comparison reads `main`'s baseline — which can advance while the branch's HEAD stands still. The replay re-runs exactly that half live (one cheap `git show` per standard) and reuses only the measured values; the measured-vs-limit half needs no re-run because the same clean HEAD fixes both the values and the limits, and only an all-green check records a receipt.
- **The blast radius of a corrupt receipt is a wrong-but-tighter pin.** Pin structurally only tightens (`pinnedLimit` demands strictly tighter), so a tampered or stale-but-matching receipt can at worst pin a limit to a wrong value on the tight side — the same exposure as a flaky measurement, with `margin` as the existing mitigation.

## Consequences

- **The capture path measures once.** check → pin runs the measurement suite a single time; with ADR 0106's carry-forward, done → check → pin → accept runs the gate zero extra times and the measurements once.
- **The check's hint can promise the reuse.** A green check that recorded a receipt says so: capture with `--pin` reuses these measurements. When recording was skipped (dirty `--force` run, I/O hiccup), the hint falls back to the old wording and the pin quietly measures fresh — the promise is only made when it will be kept.
- **Auto-pin stays rejected.** The check remains a pure read of the tree (the receipt lives inside `.git`, invisible to the working tree and the gate); capturing a gain remains an explicit, deliberate verb.
- **A second cache to keep truthful.** The invalidation conditions are each pinned by an engine test (moved HEAD, red check, malformed file, dirty `--force`, live never-loosen vs an advanced main), so an unsound honor is a gate failure, not a silent wrong pin.

## Alternatives considered

- **Auto-pin after a green check (or with an opt-out flag).** Rejected: it converts every green check into a policy commitment, captures transient mid-branch highs that the never-loosen rule makes expensive to undo, breeds `discern.toml` conflicts across parallel worktrees, and inverts the consent model for the one hard-to-reverse operation in the system. Defaults are the product; the explicit one-shot already exists as `--pin` itself.
- **Have the pin trust the check's hints (pass values as arguments).** Puts the measured numbers on the untrusted command line, where a typo or a stale copy-paste pins a fabricated value; the receipt keeps the evidence chain inside the engine, keyed to the commit it describes.
- **Cache inside the check too (a check that skips re-measuring).** A check's job is to measure; a self-caching check invites exactly the staleness debates the receipt model avoids by being one-directional — the check writes, only the pin reads.
