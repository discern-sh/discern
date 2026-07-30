# ADR 0076: The engine commits discern machinery it scaffolds

> **Commit-attribution amendment (2026-07-28; [ADR 0203](0203-discern-co-authors-only-commits-it-composes.md)):** The setup-wiring and setup-completion commits now pass through the shared discern commit boundary. They keep the invoking user's author and committer identity and add the `discern-bot` co-author trailer by default. Agent-authored commits remain outside that boundary. The ownership and fail-open decisions below stand.

> **Identity amendment (2026-07-30; [ADR 0203](0203-discern-co-authors-only-commits-it-composes.md)):** The co-author identity is now `discern <done@discern.sh>`. The ownership, retry, and attribution semantics below are unchanged.

> **Retry-evidence amendment (2026-07-28):** Before the first setup-wiring commit attempt, discern records the setup branch, HEAD, whole index tree, and every machinery candidate's stage-0 mode and blob ID in worktree Git-admin state. A resumed `begin` never re-derives or re-stages that set. It retries only when the branch, HEAD, staged set, index tree, and every candidate's worktree and index bytes still match the record. The commit consumes those staged bytes. After hooks and signing run, discern compares the actual commit tree with the recorded tree. If a hook staged extra bytes, a compare-and-swap ref update removes the commit while leaving the index and worktree intact. A matching commit clears the record. Any drift skips safely and leaves the files for the agent to commit.

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `docs` → `map` where it names the command, config, or tree, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged. **Job-model vocabulary amendment ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use gate `capability` / custom `check` → known/custom `job`; the decision and reasoning are unchanged. **Glossary vocabulary amendment ([ADR 0169](0169-the-launch-glossary-canon.md)):** Current pointers use `Co-managed seed` / co-managed file → `Shared file`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

`discern setup begin` scaffolds discern's own wiring into the project: the `discern.toml`, the shared `.gitignore` block, and — per configured agent — the MCP-server and session-hook files (`.mcp.json`, `.claude/settings.json`, `.codex/config.toml`, `.gemini/settings.json`, …). On a fresh install it does this on a dedicated, throwaway `discern-setup` branch created off a clean tree ([ADR 0065](0065-setup-keeps-its-promises.md)), then hands the coding agent a brief to author the rest (jobs, guidance, the map). Historically the engine _wrote_ those machinery files but left **committing** them to the agent — consistent with the setup interaction model, where the agent narrates its work and makes a per-stage atomic commit ([ADR 0044](0044-setup-involve-not-gate.md)).

That split breaks in a real cold run. A coding agent's safety classifier refuses to commit `.mcp.json` / `.claude/settings.json`: pre-approving an MCP server (and committing pre-approved hooks) is a permission-widening change agents are correctly trained to be cautious about. So the agent punts to the human or strands the files, and `discern setup done` ends on a dirty tree with discern's own essential wiring uncommitted — the opposite of the seamless, promise-keeping setup [ADR 0036](0036-unify-setup.md) and [ADR 0065](0065-setup-keeps-its-promises.md) set out to deliver.

The root cause is that discern relied on the **agent** to commit discern's **own** output. There was already a precedent for the engine owning such a commit: `setup done` auto-commits the `[meta].bootstrapped` marker it writes (best-effort, fail-open, pathspec-limited to `discern.toml` after proving that file's HEAD diff is exactly the marker line). Unrelated tracked, staged, or untracked local work neither blocks that marker commit nor gets swept into it. The pressure was to extend that ownership backward to `begin`.

## Decision

The engine commits discern machinery it scaffolds. After `begin` scaffolds and records provenance, and before it prints the brief, it commits **exactly** the machinery — the config, the `.gitignore` block, the per-agent MCP + hooks files, and any app-managed worktree-lifecycle config an agent declares (Codex's `environment.toml`) — as one `discern: scaffold wiring` commit on the `discern-setup` branch. The committed set is derived from the scaffold outcome (the written seed paths ∪ the MCP-wired paths ∪ the worktree-app-wired paths), minus the authored-content seeds — the union of every category discern itself scaffolds, so a category that ships later (the way worktree-app wiring joined MCP wiring) only has to flow into that outcome once to be covered here.

The explicit **no**s:

- It commits **only** discern's machinery — never `git add -A`. The authored-content seeds the agent fills (`guidance.md`, the map skeletons, `TODO.md`, and the optional `brief.md`) are deliberately left uncommitted as the agent's to write and commit. The generated agent files (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`) are gitignored and never force-added.
- It runs **only** when `begin` created the isolated `discern-setup` branch — a fresh install in a clean git repo. When setup proceeds in place (no branch: `--allow-dirty`, a `--force` re-run, or outside a git repo), the engine commits nothing and the agent commits as before.
- It is **best-effort and fail-open**: a commit failure (e.g. commit signing) never fails `begin`; the agent can still commit by hand. The outcome surfaces as `machinery_committed` in the JSON envelope and a line in the human handoff, mirroring how `done` reports `marker_committed`.

If the first machinery commit fails, its staged evidence is the only authority for an automatic retry. A later `begin` does not infer ownership from a file's path: user edits, staged changes, deletion, an unrelated staged path, a different HEAD, or malformed/missing evidence all make the retry a no-op. An unchanged retry commits the recorded staged blobs and removes the evidence.

This is a deliberate carve-out from "the agent makes the commits" ([ADR 0044](0044-setup-involve-not-gate.md)): discern commits its **own** wiring, which the agent's classifier won't; the agent commits the content it authors.

## Consequences

- A coding agent driving a cold setup — especially a cautious auto-mode one — never has to commit a permission-widening config file, because discern's own wiring is already committed when the brief is handed over. Setup no longer ends on a dirty tree of discern's essentials.
- The machinery lands in one reviewable, revertible commit, isolated on the throwaway `discern-setup` branch and separate from the agent's authored-content commits — clean history, easy rollback.
- One consistent rule now spans the setup lifecycle: the engine commits its own output (`begin`'s machinery, `done`'s marker); the agent commits what it authors. Both paths are best-effort and fail-open. The marker is pathspec-limited; a resumed machinery commit is staged-index-limited by persisted blob evidence.
- discern now writes to the user's git history during `begin`. The cost is bounded: it is one commit, on a branch built for exactly this, gated on the clean-tree precondition that branch already requires, and trivially reverted.
- "Machinery" versus "authored content" is now a contract. A new scaffolded machinery file is committed automatically once it flows through the scaffold outcome; a new **authored** seed must be added to the exclusion set or it would be swept into the commit. A guard test pins the committed set to exactly the machinery and asserts the authored seeds stay uncommitted, so the contract can't drift silently.

## Alternatives considered

- **Leave the commit to the agent (the status quo).** Fails precisely for the cautious classifiers that most need setup to "just work" — the permission-widening commit is the one they refuse.
- **Instruct the agent harder, in the brief, to commit the MCP files.** A brief can't reliably override a safety classifier, and shouldn't try: the caution is correct in general. The fix is to not ask the agent to make that commit at all.
- **Tell the user to commit it manually.** Reintroduces the manual step zero-config setup exists to remove, and a dirty-tree handoff is exactly what [ADR 0065](0065-setup-keeps-its-promises.md) set out to end.
- **Commit everything (`git add -A`) at `begin`.** Would sweep the agent's authored canvas (`guidance.md`, the docs tree, `TODO.md`) into discern's commit, conflating discern's wiring with the user's content and pre-empting the agent's own atomic commits. Rejected: discern commits only what discern owns.
