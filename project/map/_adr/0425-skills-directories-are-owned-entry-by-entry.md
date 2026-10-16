# ADR 0424: Skills directories are owned entry by entry

**Status**: accepted; amends the skills-directory clauses of [ADR 0128](0128-enumerated-ownership-tracked-guidance.md) and [ADR 0020](0020-dissolve-discern-dir.md)

## Context

discern materializes its effective skill set into each configured coding agent's skills directory, such as `.claude/skills/` and the shared `.agents/skills/`. Those directories belong to the coding agents, and other tools install skills there too. A compatibility probe ran discern beside a third-party skill installer and found four consumers that treated each directory as wholly discern's:

- The managed `.gitignore` block ignored both directories outright. A tool installed after discern wrote its skills into ignored paths, and nothing reported it.
- The `tracked_artifacts` gate stage failed on any tracked file beneath them. A project that committed another tool's skills failed `discern done`. The repair hint untracked the whole directory, so fresh clones and worktrees lost those skills.
- `discern uninstall` deleted both directories recursively.
- Refresh replaced a foreign entry that shared a name with one of discern's skills.

Refresh already kept an ownership record, `.discern-materialized.json`, to prune only what it had placed. The other consumers ignored it.

## Decision

**The ownership record is the only evidence of ownership inside a skills directory.** discern owns the entries the record names and two control files: the record and an ignore file. Every other entry belongs to whoever placed it. [`src/lib/skill_ownership.ts`](../../../src/lib/skill_ownership.ts) answers every ownership question: materialization, the `tracked_artifacts` stage, its repair hint, `discern doctor`, and `discern uninstall` all read it. A dangling symlink no longer counts as discern's, and a corrupt record owns nothing.

**Each skills directory carries its own ignore file.** Materialization writes `.gitignore` inside the directory, rendered from the owned names: one anchored, escaped rule per entry and per control file. The file ignores itself. The root block keeps only machine-local provider state, and `discern upgrade` drops the old directory rules with the rest of the marked block. A nested file follows the record exactly, needs no tracked change when the skill set changes, and differs per worktree as each worktree's materialization does. ADR 0020 kept skills directories out of the part-ignored state because a directory-wide rule had silently untracked authored skills; a rule rendered for each recorded entry cannot reach an entry the record does not name. The inventory classifies each skills directory as Shared, and declares the record and the ignore file as Generated files of their own.

**Refresh refuses to replace what it did not place.** An unrecorded entry that holds an effective skill's name is a conflict. Refresh leaves it untouched and reports how to free the name, and `discern done` blocks at its `skills` stage. An unrecorded entry byte-identical to discern's output is adopted, because claiming it loses nothing. An ignore file discern did not write is also a conflict. The skills currency check projects the materialization plan, so it can never classify an entry differently from refresh.

**`discern doctor` checks the ignore posture.** It asks Git, independent of the index, about every entry. It warns when an ignore rule hides another tool's skill, naming the rule, or when one of discern's entries is not ignored.

**A guard enrolls every consumer.** Whole-directory ownership always starts with code that reads a skills-directory path from the provider registry. [`tests/skill_dir_consumers.ts`](../../../tests/skill_dir_consumers.ts) enrolls each shipped reader by call site with a declared posture, and only the ownership module may decide ownership. Every shipped importer of that module either imports only constants or names the behavioural test proving it leaves foreign entries alone. No shipped string literal may spell a skills-directory path outside the provider registry.

Agent instruction files keep their whole-file ownership; that question is separate.

## Alternatives considered

- **Root-block rules per entry.** A prefix rule could cover bundled skills, which share a prefix, but authored skills would each need a line. Every authored-skill change would then rewrite the tracked `.gitignore`, and branches adding different skills would conflict there. A prefix rule would also ignore a foreign entry that happens to share the prefix.
- **Keep the directory rule and negate foreign entries.** discern cannot name a tool installed later, so its skills would stay hidden.
- **The clone-wide exclude file in Git's administrative directory.** All worktrees share it, while their skill sets can differ per branch, and nothing in the working tree would explain the rules.
- **Replace a same-name foreign entry, as before.** That overwrites content discern did not write, without telling anyone.

## Consequences

A project can commit another tool's skills beside discern's, and the gate, fresh clones, worktrees, and uninstall all keep them. A tool installed later shows up in `git status` instead of disappearing into an ignored path.

After upgrading, a checkout's discern skills are visible to Git until the next refresh writes the nested ignore file. Setup, upgrade, worktree setup, and acceptance all materialize skills, and `discern doctor` reports the gap meanwhile.

A name conflict now blocks the gate until the owner frees the name. That costs a decision. It replaces a silent overwrite, or a foreign skill shadowing one of the project's own skills unnoticed.

Changes under a skills directory still classify into the instructions landing scope. That governs review, not ownership, so another tool's skill changes also go to the owner.
