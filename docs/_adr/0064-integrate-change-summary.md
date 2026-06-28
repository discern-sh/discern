# ADR 0064: `integrate` reports what changed beneath the branch

**Status**: accepted. Extends the integrate verb
([ADR 0055](0055-integrate-verb.md)) with a structured result payload, built on
the result envelope + advisory hints of
[ADR 0028](0028-result-envelope-and-diagnostics.md) /
[ADR 0030](_superseded/0030-quiet-json-output.md), and reusing the
scope-classification SSOT of the changed-scopes verb.

## Context

[ADR 0055](0055-integrate-verb.md) gave the worktree lifecycle its middle verb:
`integrate` merges the latest `main` into the branch and re-materializes the
agent files in one step. Its result reported _that it ran_ — a `merge` step, a
`refresh` step, the convergent `ensure` steps — and a single generic hint ("run
`discern finish`"). It said nothing about **the content of the merge**.

That omission is the whole point of the operation. An agent working in a
worktree has a mental model frozen at its **fork point**. When `main` advances
underneath it and the agent integrates, a **textually-clean merge is a false
sense of safety**: git auto-merges hunk by hunk, so two edits to the same file —
or logically-coupled edits across files — merge without conflict while breaking
the combined semantics. The agent is given no signal that any of its assumptions
were just invalidated. The failure mode isn't "I can't see a changelog"; it's "I
don't know which of my own files just shifted under me." A weaker agent, told
only "merged main, run finish," sails straight into the semantic break.

The raw material to fix this is already in hand at merge time. `integrateMain`
computes how far `behind` the branch was and whether the merge was a
fast-forward, then discards everything richer — the commits, the files, and
crucially the **overlap** between what the agent changed and what `main`
changed.

## Decision

**`integrate` returns an `IntegrateData` payload summarizing what the merge
brought in beneath the branch — overlap-first — and surfaces it identically on
the CLI, in `--json`, and through the MCP tool.** The result spine of
[ADR 0027](0027-plan-apply-engine-execution.md) /
[ADR 0028](0028-result-envelope-and-diagnostics.md) means one computed object
renders to every surface; the human narration and the structured `data` can
never disagree on what happened.

The payload, from highest-value signal down:

- **`overlap`** — the files the branch **and** `main` both changed (the branch's
  own diff since the fork ∩ the files the merge brings in). This is the hot
  zone: the places a clean merge most likely hides a semantic conflict. It is
  the headline of the agent-facing hint ("⚠ … N file(s) you've changed are also
  changed by main: … — re-read them for semantic conflicts a clean merge can't
  catch") and the one list capped loosely, because it is already narrow and is
  what the agent must act on.
- **`scopes_incoming`** — the fire-scopes the incoming files fall in, classified
  through the **same** matcher the gate uses (`scopesForPaths`, factored out of
  `changedScopes` so the two can't drift). A broader "be wary of the `engine`
  scope" signal that survives even when the exact files differ.
- **`commits` / `files`** — what landed, each **capped** (10 / 20) with the
  pre-cap `*_total` and a `*_truncated` flag, so the agent always knows the true
  size without the full list flooding its context.
- **`range`** — the four SHA anchors that bound the integration: `base` (fork
  point), `before` (the branch tip / the agent's own work), `main` (the tip
  merged), `after` (the merged HEAD). These make a capped list a single
  deliberate `git` call instead of a dead end: when a list truncates, a hint
  hands back the exact command with the anchors **pre-substituted**
  (`git diff
  --stat <before>..<after>`, `git log --oneline <before>..<main>`),
  so even a weak agent pulls the full set in one round-trip rather than
  inferring the range.

**It works the same in `--dry-run`, as a prediction.** A preview can't merge, so
there is no `after` and the file delta is the three-dot `before...main`
prediction (changes on `main` since the fork) rather than the apply's two-dot
`before..after` (the real post-merge tree change, reflecting conflict
resolution). The `range`/commits/overlap/scopes are otherwise identical, so
`integrate --dry-run` answers "what _would_ land, and does any of it touch my
work?" before committing to the merge.

**Default-on, fail-open, and capped.** No flag: the user's instinct was right —
there is no case where an integrating agent doesn't want this, and it costs ~4
read-only git calls on a merge that already happened. Every git read fails open
to an empty result and the whole summary is wrapped so a hiccup degrades to the
old plain hint — on an apply the merge has already landed (
[ADR 0055](0055-integrate-verb.md)'s "a refresh can fail without losing the
merge" extended to the summary). Renames are decomposed to delete + add
(`--no-renames`) so every path is one matchable entry regardless of the user's
`diff.renames`, and the overlap matches on literal paths.

## Consequences

- **A clean merge stops being a silent risk.** The single most valuable line an
  integrating agent reads is now "these N files you touched also moved" — a
  directed action, not a discovery left to the next failing test.
- **Truncation is never a dead end.** Caps protect the agent's context; the
  `range` anchors + escape-hatch hints turn an overflow into one precise `git`
  call. This matters most in a busy repo, where the atomic-commit discipline
  discern itself encourages produces high merge churn.
- **The scope matcher gained one caller and lost its duplication.**
  `scopesForPaths` is now the single classifier behind both `changed-scopes` and
  `integrate`; a path-glob change moves both together.
- **`integrate`'s tool advertises a data-bearing `outputSchema`.** It joined the
  data verbs (`finish`/`status`/`start`/…) — `IntegrateOutputSchema` narrows the
  envelope's `data` to `IntegrateData`; the no-op (already-integrated) path
  simply omits `data`, which the optional field allows.
- **One more payload to keep faithful.** The wire schema, the engine type, and
  the human narration are three renderings of one object; the schema is derived,
  and the engine tests pin the overlap math, the capping/escape-hatch, the scope
  classification, and dry-run/apply parity.

## Alternatives considered

- **Dump the full commit + file lists.** Rejected — it floods the agent's
  context on exactly the busy-repo merges where the summary matters most. Caps +
  the `range` escape hatch give the full picture on demand without the flood.
- **Report counts only ("+7 commits, 41 files").** Rejected — the count is
  noise; the agent needs _which_ files, and specifically the overlap. A bare
  count doesn't change what the agent does next.
- **Compute overlap as a git command the agent runs.** Rejected — git has no
  single command for the intersection of two diffs, and offloading the set logic
  is exactly what a weaker agent gets wrong. discern computes it and hands back
  the answer; the `range` anchors remain for any deeper inspection.
- **Predict conflicts in `--dry-run` via `git merge-tree`.** Deferred, not
  rejected — a natural follow-up (git ≥2.38 can merge in the object store and
  report conflicts without touching the tree), kept out of this change so the
  irreducible core — surfacing what landed and the overlap — lands first.
