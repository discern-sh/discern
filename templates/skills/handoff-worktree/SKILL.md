---
name: handoff-worktree
description: Migrate the current worktree's branch into the main repository so the user can review, test, and continue work there. Runs `discern graduate`, which commits the work as needed, destroys the worktree's resources and removes the worktree directory, then checks the branch out in the main repo as the latest commit. Requires the branch already contains the latest main (it stops and points you to `discern finish` if not) and refuses to run if the main checkout has uncommitted changes. Use whenever the user signals they want to take over a worktree session — phrases like "handoff worktree", "handoff this", "finish up and move it back to main", "I'll take it from here", "move this branch out of the worktree", or "graduate this branch". Trigger this even if the user does not explicitly say "skill" — the intent is what matters.
---

# Handoff Worktree

The mechanical work — integrating the latest main, destroying the worktree's resources, committing as needed, removing the worktree, checking the branch out in main, and soft-resetting any WIP commit — is done by the harness:

```
discern graduate
```

That one command is the single, deterministic implementation. Your job is to **run it** and **relay the outcome** to the user. Do not try to replicate its logic step-by-step with individual `git` commands — the recipe is the source of truth and is much faster and safer than reasoning through git one step at a time.

## How to use it

**First, commit the work.** Before running the handoff, make sure all of the branch's changes are committed with a clear, conventional message — this is the commit the user will review, test, and merge, so write a real message, not a placeholder. Do this *after* the quality gate has passed, so the commit captures any formatting the gate applied. If `git status` shows anything uncommitted (or untracked-but-wanted), stage and commit it now:

```bash
git add -A && git commit -m "<concise, descriptive message>"
```

A clean tree means the handoff migrates your commit **intact**, and the user lands on the branch in main with it as `HEAD` — ready to test and fast-forward merge. (If you leave anything uncommitted, the recipe still WIP-commits then unstages it so it lands staged — a safety net, not the intended path.)

**Then run the handoff** with no arguments, from inside the worktree:

```bash
discern graduate
```

The recipe integrates main, prints its plan, then a line per step it executes, then a final summary. It exits `0` on success and non-zero on any unrecoverable error.

After it finishes:

1. **On success**, paraphrase the summary back to the user — which branch they're on, where, and that their work is the latest commit on it (ready to test, then fast-forward merge into `main`, or extend with follow-up commits first). If you had to leave changes uncommitted, note that they landed staged rather than committed. Then carry on collaborating from the main repo — this session continues; no need to start a new one. The shell's working directory is reset automatically when the worktree disappears.

2. **On failure**, the recipe exits with a clear message on stderr. The most common cause is the **main-merged gate**: if `main` advanced during the session, the recipe stops *before* touching anything and points you to run `discern finish` (which is where you integrate main) first, so a stale branch is never graduated. Other causes include: the main checkout has uncommitted changes (the user must commit or stash them — don't do it for them), not in a worktree, detached HEAD, or the branch is checked out elsewhere. Read the error, summarise it in plain language, and if it's the gate, run `discern finish` (commit, `git merge main`, re-run) before retrying. For anything ambiguous, pause for the user's direction.

## When the recipe is missing or fails to run

`discern graduate` requires the `discern` binary and a harness-configured project (a `discern.toml`). If the command reports that it is missing — for example you're in a project that doesn't have the harness — mention this and ask how the user wants to proceed rather than improvising a manual handoff; a silent manual handoff loses the fault tolerance the recipe provides.

## Caveats to keep in mind after a successful handoff

These don't usually need to be surfaced to the user, but stay aware of them as you continue working in the session:

- Any absolute paths you cached earlier that pointed inside the worktree are now stale. Re-resolve from the main repo path when needed.
- For load-bearing files you read pre-handoff, re-read them if you're about to edit — your in-context view might be slightly out of date.
- Any background processes that were running inside the worktree (dev servers, file watchers) will have died when the directory was removed. Mention this only if the user seems to expect one to still be running.
- The worktree's resources (e.g. its database and any dev-server link) are destroyed as part of the handoff, so the worktree's preview URL stops resolving.

## What not to do

- Don't re-implement the handoff logic inline with individual `git` commands. The recipe is deterministic and tested — use it.
- Don't skip the commit step and lean on the WIP safety net — commit the work with a real message first so it graduates as a proper commit the user can test and merge.
- Don't pass flags to the recipe (it accepts none beyond `-h`). If it fails, read the message and act on it (commit/resolve for the merge gate) or defer to the user.
- Don't tell the user to start a fresh session after the handoff. This session continues from the main repo path.
- Don't work around the dirty-main-checkout refusal by stashing the user's changes for them — let them commit or stash their own main-repo work first, then re-run.
