# ADR 0094: Final lifecycle checks require clean trees

**Status**: accepted

## Context

discern's lifecycle has two kinds of feedback:

- fast iteration feedback, such as `prepare`, `test`, and targeted project
  commands, which is useful while a tree is still changing;
- final lifecycle feedback, such as a recorded `finish` pass, ratchets, and
  graduation, whose answer only matters for the tree that will actually be
  handed off or landed.

Agents tended to blur those two modes. A common sequence was to run `finish` on
uncommitted work, receive a green result, commit afterward, and then ask
graduation to land the branch. The later commit changed the tree from the one
`finish` validated, so graduation had to validate again. Ratchets had a similar
failure mode: because they are intentionally slow and outside `finish`, running
them during ordinary dirty-tree iteration made repeat runs likely without
improving confidence in the final branch.

Graduation also had an older convenience path that WIP-committed uncommitted
changes, removed the worktree, checked the branch out in the main checkout, and
soft-reset the WIP commit so those changes landed staged. That preserved bytes,
but it made graduation both a final lifecycle operation and an implicit
dirty-tree transport mechanism.

## Decision

Final lifecycle operations now prefer a clean, committed tree:

- `finish` still may be run on dirty work, but a dirty green run records no
  gate-pass receipt and hints that agents should use `prepare` or `test` while
  iterating, then commit and run `finish` again on the clean HEAD.
- `status` reports the current gate-pass receipt state and only gives the
  ready-for-review hint when a clean ahead branch has a receipt honored at its
  current HEAD.
- non-dry-run `ratchets` require a clean worktree whenever ratchets are
  configured. `--dry-run` remains free to preview the plan, and `--force` exists
  only for ratchet authoring or debugging.
- `graduate` refuses dirty worktrees. It no longer creates WIP commits, and no
  longer soft-resets them into the main checkout.

`integrate` remains the canonical way to bring the integration branch into a
worktree. It performs its own preconditions and is idempotent, so guidance
should tell agents to call it directly instead of running preliminary git
checks.

## Consequences

The efficient final path is now:

1. iterate with `prepare`, `test`, or targeted commands;
2. commit the intended final tree;
3. run `finish` on the clean HEAD;
4. run ratchets as needed on the same clean tree;
5. graduate only when the user explicitly asks for handoff or landing.

Graduation becomes simpler and less surprising: it lands committed branch
history only. Moving uncommitted work between contexts is outside discern's
graduation lifecycle.

Ratchet authoring keeps an escape hatch. A person adding or debugging a ratchet
can use `--force` to run the metric command before committing the ratchet
itself, but ordinary agent guidance should treat non-dry-run ratchets as
clean-tree checks.

## Alternatives considered

- **Keep dirty graduation and improve the prose.** That would leave a feature
  whose existence invites agents to treat graduation as a WIP handoff tool.
- **Make ratchets always clean-tree-only with no override.** That is simpler for
  agents, but awkward while designing a new metric command.
- **Automatically commit before final checks.** discern cannot know the user's
  desired commit boundary or message. The final commit is project work, not a
  harness side effect.
