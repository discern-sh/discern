# ADR 0094: Final lifecycle checks require clean trees

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`, `finish` → `done`, `graduate` →
> `accept`, `integrate` → `update`, the retired product-category wording →
> `discern`, the gate, or the bar, the gate-pass artifact → the receipt, the
> shared-branch label → the trunk; the decision and reasoning are unchanged.

**Status**: accepted

## Context

discern's lifecycle has two kinds of feedback:

- fast iteration feedback, such as `prepare`, `test`, and targeted project
  commands, which is useful while a tree is still changing;
- final lifecycle feedback, such as a recorded `done` pass, standards, and
  acceptance, whose answer only matters for the tree that will actually be
  handed off or landed.

Agents tended to blur those two modes. A common sequence was to run `done` on
uncommitted work, receive a green result, commit afterward, and then ask
acceptance to land the branch. The later commit changed the tree from the one
`done` validated, so acceptance had to validate again. Standards had a similar
failure mode: because they are intentionally slow and outside `done`, running
them during ordinary dirty-tree iteration made repeat runs likely without
improving confidence in the final branch.

Acceptance also had an older convenience path that WIP-committed uncommitted
changes, removed the worktree, checked the branch out in the main checkout, and
soft-reset the WIP commit so those changes landed staged. That preserved bytes,
but it made acceptance both a final lifecycle operation and an implicit
dirty-tree transport mechanism.

## Decision

Final lifecycle operations now prefer a clean, committed tree:

- `done` still may be run on dirty work, but a dirty green run records no gate
  receipt and hints that agents should use `prepare` or `test` while iterating,
  then commit and run `done` again on the clean HEAD.
- `status` reports the current gate receipt state and only gives the
  ready-for-review hint when a clean ahead branch has a receipt honored at its
  current HEAD.
- non-dry-run `standards` require a clean worktree whenever standards are
  configured. `--dry-run` remains free to preview the plan, and `--force` exists
  only for standard authoring or debugging.
- `accept` refuses dirty worktrees. It no longer creates WIP commits, and no
  longer soft-resets them into the main checkout.

`update` remains the canonical way to bring the trunk into a worktree. It
performs its own preconditions and is idempotent, so guidance should tell agents
to call it directly instead of running preliminary git checks.

## Consequences

The efficient final path is now:

1. iterate with `prepare`, `test`, or targeted commands;
2. commit the intended final tree;
3. run `done` on the clean HEAD;
4. run standards as needed on the same clean tree;
5. accept only when the user explicitly asks for handoff or landing.

Acceptance becomes simpler and less surprising: it lands committed branch
history only. Moving uncommitted work between contexts is outside discern's
acceptance lifecycle.

Standard authoring keeps an escape hatch. A person adding or debugging a
standard can use `--force` to run the metric command before committing the
standard itself, but ordinary agent guidance should treat non-dry-run standards
as clean-tree checks.

## Alternatives considered

- **Keep dirty acceptance and improve the prose.** That would leave a feature
  whose existence invites agents to treat acceptance as a WIP handoff tool.
- **Make standards always clean-tree-only with no override.** That is simpler
  for agents, but awkward while designing a new metric command.
- **Automatically commit before final checks.** discern cannot know the user's
  desired commit boundary or message. The final commit is project work, not a
  discern side effect.
