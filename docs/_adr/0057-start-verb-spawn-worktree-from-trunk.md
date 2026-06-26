# ADR 0057: `discern start` — spawn a worktree from the main checkout, and a status guardrail that points at it

**Status**: accepted. Completes the entry of the worktree lifecycle alongside
[ADR 0011](0011-adopt-worktree-workflow.md) (the workflow), respects the
sibling-placement convention of [ADR 0052](0052-worktree-sibling-placement.md),
and extends the location-aware status verb of
[ADR 0033](0033-status-verb-and-location-aware-scope.md).

## Context

discern isolates every line of work in its own linked worktree, and wraps the
_transitions_ of a worktree's life in deterministic verbs:
[`integrate`](0055-integrate-verb.md) brings `main` in, and `graduate` hands the
branch back. But the **first** transition — _get into a worktree at all_ — had a
hole. The Claude Code `WorktreeCreate` hook creates the worktree
([ADR 0040](0040-worktree-hooks-in-the-binary.md)), and that hook fires only
when an orchestrator drives it. An agent invoked directly on the **main
checkout** had no first-class way to spin up its own isolated worktree.

With no affordance, agents improvise badly. The motivating incident: an agent on
the trunk ran `discern status`, saw an idle, up-to-date worktree that belonged
to _another_ agent (one that simply hadn't started working yet), and **moved in
to work there** — squatting in someone else's line of work was its only option.
The guidance already said "never start work in a worktree you didn't create"
([ADR 0011](0011-adopt-worktree-workflow.md)), but a prohibition without an
alternative just leaves the agent stuck.

Two gaps, then: no verb to _create_ a worktree to inhabit, and no nudge that
tells an agent on the trunk to use it.

## Decision

### 1. `discern start` — a first-class lifecycle verb

Add **`discern start`** (the tool **`discern_start`**): run from the main
checkout, it mints a fresh worktree, creates it on its own `agent/<id>` branch
at the configured sibling location, runs its first-time setup, and reports where
it landed. It is a naming-convention sibling of `finish` / `graduate` /
`integrate`, and follows the same plan/apply shape
([ADR 0027](0027-plan-apply-engine-execution.md)): a `startResult` core returns
a `DiscernResult` the CLI `--json`, the human renderer, and the MCP tool all
render; `--dry-run` previews and touches nothing.

**Minting an id.** discern had no id generator — Claude Code's hook supplies the
worktree _name_, and every other identity value derives from it
([identity.ts](../../src/engine/worktree/identity.ts)). `discern start` mints
its own through a new `generateWorktreeId`: a readable
`<adjective>-<noun>-<hex>` id in the spirit of the existing names, sanitized to
the same rules a `DISCERN_WORKTREE_ID` override obeys. The random hex tail makes
it unique. Before using the id, `start` verifies the derived branch and
directory are both free, so it always _creates_ a worktree and never adopts one.

**The engine/feature split holds.** _Where_ a worktree lands is the feature
layer's `resolveWorktreeRoot` ([ADR 0052](0052-worktree-sibling-placement.md)),
never the stack-neutral engine. So `startResult` takes the placement root as a
parameter; the dispatcher and the MCP server resolve it and pass it in — exactly
as the `worktree:prune` wiring already does. One engine core,
`createAndSetupWorktree`, holds the "create the worktree, then set it up"
sequence, shared by `discern start` and the `WorktreeCreate` hook so they can't
drift.

### 2. Return a path; re-root yourself

The MCP server has a single root checkout and **cannot relocate the agent's
session** to a worktree it just created. So `discern_start` does not pretend to
move: it returns the new worktree's absolute path in `data.path` plus a hint,
and its description tells the agent it **must re-root** — start a session rooted
there (or `cd` in) and continue from inside it, never back in the main checkout.

The inverse risk is an agent _already_ inside a worktree calling `discern_start`
and creating a pointless sibling. Two guards: the tool is
**`mainCheckoutOnly`**, so a server rooted in a worktree does not register it
(it is absent from `tools/list` and from the instructions); and `startResult`
refuses defensively via `assertNotInWorktree`, mapping to the same
`precondition_failed` envelope `graduate` / `integrate` use, in case it is ever
invoked anyway.

### 3. A status guardrail on the trunk

`discern status` ([ADR 0033](0033-status-verb-and-location-aware-scope.md)),
when rooted in the main checkout with worktrees enabled, now **leads its
next-steps** with a loud `START_HERE_HINT`: this is the trunk, not an isolated
worktree — run `discern start` and move into your own, never adopt an existing
idle one. It rides in `hints[]` (the `--json` / MCP channel), placed before the
fleet-ownership rule so the constructive action comes first.

It is **agent-facing only**. A human running `discern status` from the main
checkout is supervising their fleet, not starting work — so the interactive
human renderer filters it out, exactly as it does the fleet-ownership rule. The
human-vs-agent split is structural (the rendered text vs. the `hints[]`
channel), not a heuristic, so there is no false-positive nagging of a person at
the CLI.

## Consequences

- An agent that finds itself on the trunk has an obvious, first-class way into
  its own isolated worktree: `discern status` points at `discern start`, which
  creates the worktree and tells it where to go. The squat-in-another's failure
  mode no longer has "no other option" behind it.
- `discern start` only _creates_ a worktree to inhabit. It never hops into,
  adopts, or prunes an existing one — that boundary keeps it complementary to
  the unexposed `worktree:*` lifecycle verbs and to `graduate` / `integrate`,
  which operate _on_ the current worktree.
- discern now owns a worktree-id generator. Only `discern start` uses it; every
  other path still derives identity from an externally supplied name, so the
  frozen identity derivation
  ([identity.ts](../../src/engine/worktree/identity.ts)) stands unchanged.
- The MCP surface gains its first **location-gated** tool. The precedent — hide
  a tool whose precondition the server's own root already fails — is reusable
  for any future main-checkout-only or worktree-only verb.

## See also

- [ADR 0011](0011-adopt-worktree-workflow.md) — the worktree workflow `start`
  completes the entry to.
- [ADR 0052](0052-worktree-sibling-placement.md) — the sibling placement
  convention `start` resolves through the feature layer.
- [ADR 0055](0055-integrate-verb.md) — `integrate`, the middle transition;
  `start` is the same plan/apply, lifecycle-verb shape applied to the entry.
- [ADR 0033](0033-status-verb-and-location-aware-scope.md) — the location-aware
  status verb the trunk guardrail extends.
- [ADR 0045](0045-mcp-is-core-infrastructure.md) — the MCP surface the
  return-path-and-re-root wrinkle lives on.
