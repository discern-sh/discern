# ADR 0110: The landing model — pull from any ref, land only on the trunk

> **Landing-authority amendment (2026-07-28; [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md)):** The stop-after-green consequence below is now conditional. Without current-conversation consent or a machine-verified standing or effort grant, the agent relays the receipt and waits. A verified recorded grant may route the finished branch directly to `accept`. The trunk-only topology and validated-tree rules stand.

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `graduate` → `accept`, `integrate` → `update`, the retired product-category wording → `discern`, the gate, or the bar, the shared-branch label → the trunk; the decision and reasoning are unchanged. **Configuration amendment ([ADR 0153](0153-repository-owns-shared-checkout-convergence.md)):** The single landing target now lives at `[repository].trunk`; references below to `[project].main_branch` preserve the original schema spelling.

**Status**: accepted — supersedes the configurable-destination decision of [ADR 0046](_superseded/0046-graduate-destination-and-skill-removal.md) (its removal of the handoff-worktree skill stands), and extends the update verb of [ADR 0055](0055-update-verb.md) / [ADR 0064](0064-update-change-summary.md).

## Context

discern turns the git-worktree workflow into one coherent product, so _how work accumulates_ is part of the product itself, not something left to raw git. Two seams had worn through:

1. **The shipped `accept --to branch` default was a trap with no second act.** ADR 0046 gave `accept` a configurable destination (`[worktree].accept_to = "branch" | "trunk"`, default `"branch"`), landing the finished branch checked out in the main checkout "for review". But no verb could land it from there: `status` on the parked checkout advised running `discern start`, and once anything returned the main checkout to the trunk, the unlanded `agent/*` branch became invisible. The "review" landing also parked the main checkout off-trunk, which poisoned every new worktree created from its HEAD (fixed separately — worktrees now fork from the trunk). ADR 0046 explicitly deferred "accept an arbitrary branch name as the destination" as a distinct feature; this ADR resolves that deferral — by placing the flexibility on the other axis.

2. **Multi-phase and experimental work had no blessed composition path.** `update` pulled only the trunk, and `start` forked only from the main checkout's HEAD, so building phase two on an unlanded phase-one branch meant hand-run git merges — exactly the raw-git workflow discern exists to absorb.

## Decision

**Compose from any ref on the pull axis; land only on the trunk on the push axis.** The model is deliberately asymmetric:

- **Push — `accept` — is trunk-only.** There is exactly one place work lands: the trunk (`[project].main_branch`), fast-forwarded to the branch tip, the worktree removed, the merged branch deleted, the trunk checkout refreshed (ADR 0098). `[worktree].accept_to` and `--to` are removed; a schema 16→17 migration drops the key from existing configs. `accept` refuses — with the way back named — when the main checkout sits on a branch other than the trunk: it never silently switches a checkout someone parked deliberately.
- **Pull — `start --from <ref>` and `update --from <ref>` — is unrestricted.** A worktree may fork from any ref and merge any ref into itself, through one shared resolver that refuses unknown and ambiguous names. Absent the flag, `start` forks from the trunk and `update` pulls the trunk — the everyday defaults, needing nothing passed. The ADR 0064 change summary keeps working against an arbitrary source: its `range.main` anchor is documented as "the incoming tip" (the wire field name is kept).

The "trunk" is never a special object: it is whichever worktree is the current assembly point. Work flows _up_ a tree of branches by being pulled together and gated — an integrator worktree `start --from`s a phase branch, pulls sibling branches in with `update --from`, resolves any conflict once with every part in view, and runs the gate on the combined tree. Only the finished whole crosses to the trunk, once.

The explicit *no*s:

- **No arbitrary push destination.** Letting `accept` target other branches would reintroduce the divergence a single landing target exists to prevent: multiple "land here" targets are how agent-heavy repos drift into a tangle of half-landed branches. Pulling never mutates a shared target, so there is no concurrent-landing race and no fast-forwarding a branch checked out in another worktree — and the integrator gates the _combined_ tree, the state actually worth validating.
- **No review landing.** Review of in-flight work happens while its worktree exists (the branch is visible, `status` lists it); the review _artifact_ is a separate concern, out of this ADR's scope. A user can always drop to raw git and merge wherever they like — the blessed path is a product, not a cage.

## Consequences

- One landing target keeps a repo coherent: every finished line of work reaches `main` the same way, always a clean fast-forward (the acceptance gate already proves the branch contains the trunk).
- The main checkout stays on the trunk in steady state, which is also what keeps `start`'s trunk-forking default meaningful and the fleet survey honest.
- Existing installs migrate: schema 16→17 deletes `[worktree].accept_to` (and its doc comment) from the config; the config schema names the dead key with a friendly `discern upgrade` pointer until they do.
- Composition below the trunk is now first-class, so the flexibility ADR 0046 deferred lands on the pull side: phases, experiments, and integrator worktrees are ordinary `start --from` / `update --from` calls with every existing guarantee (clean-tree precondition, conflict abort to a clean tree, re-materialize, change summary) intact.
- Anyone who relied on `--to branch` as a review gate loses it; the equivalent review moment is the still-live worktree plus the explicit-user-request rule on `accept` (unchanged: agents stop after a green `done` run and wait).
