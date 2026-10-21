# ADR 0428: The `.gitignore` block re-includes ignored integration files

**Status**: accepted; amends [ADR 0093](0093-upgrade-reconciles-gitignore-block.md), since refresh now reconciles the block too

## Context

discern writes each selected coding agent's Shared integration files, such as its MCP configuration, hooks, and rules files, and expects Git to track them. A bare clone, a cloud agent's only view, then carries discern's wiring ([ADR 0128](0128-enumerated-ownership-tracked-guidance.md)).

A compatibility probe installed discern into a freshly generated project whose default `.gitignore` excluded two agent tool folders. Many editor and tool `.gitignore` templates do the same. Every layer missed it:

- The read-only `setup verify` said nothing.
- `setup begin`'s machinery commit ran `git add` without `--force`, so it failed with Git's raw message on the first excluded file.
- The tracked-refresh plan considers only tracked paths, so refresh went on regenerating copies only that checkout had, silently.
- `discern doctor` had no such check.

Git also stages a tracked file beneath an ignored folder but still exits 1, which broke update's regeneration commit for any project that had once force-added such a file.

## Decision

**discern's own block re-includes exactly its files.** [`trackedSharedProviderPaths`](../../../src/lib/artifact_ownership.ts) is every Shared file a provider declares. It excludes skills directories, where Git ignores discern's own entries by design, and agent files, which the setup agent commits itself. When the project's root `.gitignore` excludes one of the configured agents' files, the managed block appends the fewest rules that re-include it. For a folder rule, the block re-includes the folder, then ignores its contents again, then re-includes discern's files, because Git cannot re-include a file inside an excluded folder. Everything else the project's rule matched stays ignored. A project line that happens to match an exception stays the project's: ownership is judged against the block without its exceptions.

**The exceptions follow from tracked content alone.** [`gitignore_patterns.ts`](../../../src/lib/gitignore_patterns.ts) evaluates the root `.gitignore` purely, so every checkout renders the same block. Git would also apply this machine's global and clone-local excludes, and a Git process in every refresh plan would cost `status` and the gate. A parity test holds the matcher, and the property that the exceptions admit nothing else, to Git's own `check-ignore`. The block keeps its place unless a project rule after it excludes an integration file; it then moves to the end, because the last matching rule wins.

**Refresh keeps the block current.** The exceptions depend on the configured agents, so refresh, setup, and upgrade all reconcile the block, and the tracked-refresh plan reports a stale one. Adding a coding agent whose folder the project ignores is handled by the next refresh.

**Nobody is asked.** The consent footprint already lists the integration files setup commits; it now says when the project's rules exclude them and that the block re-includes just those files. discern never edits the project's own rules.

**A file with someone else's entries goes to the coding agent.** An integration file that already exists, untracked, holding content discern did not write, may carry personal settings or credentials. Setup adds discern's entries but leaves that file out of its machinery commit, names it in `setup verify` and `begin`, and the agent commits it if the other entries are safe to share or moves the personal ones to the tool's user-level settings first. It asks the owner only when the file does not settle it. This holds whether or not an ignore rule matched the file.

**What the block cannot override is forced once.** A nested `.gitignore` or this machine's excludes can still match. Setup stages those files with `--force`, since the project's rules allow them and no ignore rule applies to a tracked file. Update's regeneration commit forces its paths too: they come from `git status`, which never lists an ignored untracked file, so the flag admits nothing new. Doctor's `integration files` check warns about any untracked integration file Git still ignores, with `discern refresh` as the fix for a root rule and a one-time `git add --force` for any other.

## Alternatives considered

- **An owner decision at setup**, with a flag and a recorded keep-local list. It interrupted setup at its most sensitive point with a question most owners cannot answer, and added a configuration key for an edge case. The template rule it asked about was almost never a deliberate choice about discern's files.
- **Always force-add.** Tracked files inside an ignored folder are invisible state: a plain `git add` exits 1 on them, and a coding agent added later is ignored again.
- **Edit the project's own rule.** That is harder to review and undo than lines in discern's block, and needs knowledge of the owner's intent the block does not.
- **Ask Git for the exceptions.** It would make the block depend on each machine's excludes, so checkouts would disagree about a tracked file.
- **Recognize known templates.** discern is stack-neutral, and the next template would still fail.

## Consequences

Setup in such a project asks nothing and never fails its machinery commit on an ignore rule. The block grows only in projects whose rules exclude an integration file.

A project cannot keep a configured agent's integration file out of Git with a rule after discern's block, because the block moves below it. Leaving the agent out of `[project].agents` is the way to keep its files untracked.

A file that held someone else's entries stays visible and uncommitted until the agent resolves it.

Ignore rules that exclude an agent file, such as `AGENTS.md`, are outside the block's exceptions: the setup agent commits those files itself.
