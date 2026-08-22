# ADR 0040: The worktree hooks parse their payload in the binary (no jq)

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** current pointers use `standards` (formerly `ratchets`), `accept` (formerly `graduate`), and known/custom `job` (formerly gate `capability` / custom `check`); the decision and reasoning are unchanged.
> - **[ADR 0052](0052-worktree-sibling-placement.md) — placement:** the `<cwd>/.claude/worktrees/<name>` placement this record encodes was later replaced by a configurable sibling default (`[worktree].root`); the layering split below — adapter in the feature layer, engine location-agnostic — is exactly what kept that change contained to one resolver.
> - **Hook naming:** the verbs ship as `discern worktree hook create` / `discern worktree hook remove` — the shipped settings template is the live authority; the parse-in-binary decision stands.

**Status**: accepted

## Context

discern's isolated-worktree workflow is driven by three Claude Code hooks wired into `.claude/settings.json` ([ADR 0011](0011-adopt-worktree-workflow.md)). Two of them — `WorktreeCreate` and `WorktreeRemove` — receive a JSON payload on stdin (`{name, cwd}` and `{worktree_path}` respectively). The original hooks were raw shell one-liners embedded in the settings JSON: each piped the payload through **`jq`** to extract its fields, and `WorktreeCreate` additionally ran `git worktree add` inline before handing off to `discern worktree setup`.

```sh
input=$(cat); name=$(printf %s "$input" | jq -r .name); cwd=$(... jq -r .cwd)
dir="$cwd/.claude/worktrees/$name"
if [ ! -e "$dir/.git" ]; then git -C "$cwd" worktree add "$dir" -b "agent/$name" 1>&2; fi
(cd "$dir" && discern worktree setup 1>&2); printf %s "$dir"
```

That made `jq` a hard runtime dependency of discern for every end user who drives the worktree workflow through a coding agent — a second tool to install and a second thing to go wrong, surfacing only at hook-fire time. The dependency was not fundamental: it existed only because a settings-JSON string cannot parse JSON on its own. But the program the hook shells into — `discern` — is a JSON-native binary that is _already invoked by the same hook_. The worktree-creation and field-parsing logic also lived as an untested shell string, split awkwardly between the hook (`git worktree add`) and the binary (via `discern worktree setup`).

## Decision

The two payload-bearing hooks become thin dispatches to the binary, which reads its own stdin: `WorktreeCreate` → **`discern worktree create`**, `WorktreeRemove` → **`discern worktree remove`**. Each verb reads the hook's JSON payload from stdin, parses it natively (no `jq`), and does the work the shell used to:

- `worktree create` derives `<cwd>/.claude/worktrees/<name>` and branch `<branch_prefix><name>` (the prefix read from config, not substituted into the settings template), creates the linked worktree (idempotently — a re-fired hook is a no-op on the `git worktree add`), runs the existing `worktree` setup inside it, and writes **only** the worktree path to stdout (no trailing newline, as the old `printf %s` did) so Claude Code reads it as the result. All setup narration goes to stderr, mirroring the old `… 1>&2`.
- `worktree remove` reads `worktree_path` and runs the existing `worktree teardown`, swallowing any error so the event never fails (the old hook's trailing `|| true`); a stranded resource is reclaimed later by `worktree prune`.

**Layering.** The adapter lives in the FEATURE layer ([`src/lib/worktree_hooks.ts`](../../../src/lib/worktree_hooks.ts)), not the stack-neutral engine. The agent-agnosticism guard ([`tests/agent_agnostic_test.ts`](../../../tests/agent_agnostic_test.ts)) forbids any `.claude` path in `src/engine/**`; the `.claude/worktrees` convention and the coupling to Claude Code's hook JSON shape are Claude-Code-specific, so they sit beside `src/lib/skills.ts` (which already owns `.claude/skills` materialization). The engine keeps a convention-free `addWorktree(mainRepo, dir, branch)` git helper that the adapter calls with an explicit directory.

**git stays a hard requirement and is now asserted.** `git` is irreducible to the worktree workflow, standards, acceptance, and `status`. `discern doctor` gained an explicit `git` check (it previously verified only `sh` and configured job commands), reporting the resolved `git --version` as triage context, plus an environment summary line (discern version · os/arch · git) for bug reports.

## Consequences

- **`jq` is no longer a discern dependency** — for end users or for developing discern. Its entire footprint was these two hooks; the contributor `Brewfile` and the human-setup docs drop it, leaving `git` (+ a coding agent) as the only external runtime requirement. The engine-hook tests no longer skip when `jq` is absent, and assert the rendered `.claude/settings.json` contains no `jq`.
- **The hook contract is stable and trivial.** The settings entries are now fixed verb names; worktree-creation logic evolves in tested TypeScript (`tests/engine_hooks_test.ts` drives the rendered hooks end-to-end), not in a JSON-escaped shell string. The `{{branch_prefix}}` token is gone from the settings template (still used by `discern.toml.tmpl` and the guidance).
- **Single source of truth for worktree creation.** The `git worktree add` step moved out of the shell and into the binary, beside the setup it precedes.
- **A new coupling is made explicit, not added.** The binary now knows Claude Code's hook JSON shape — but the shell hook already hard-coded `.name` / `.cwd` / `.worktree_path`; the coupling moved into one tested, clearly-named module rather than being newly introduced.

## Alternatives considered

- **Keep `jq`, and have `doctor` require it.** Surfaces the dependency instead of removing it — strictly more for every user to install and maintain, for a need that the already-invoked binary erases. Rejected.
- **Write a `jq`-free shell fallback in the hook** (e.g. `sed`/`grep` JSON scraping). Trades one fragile, untested shell string for a worse one; brittle on arbitrary JSON. Rejected.
- **Put the adapter in the engine.** Fails the agent-agnosticism guard (the engine builds no `.claude` path) and would entangle the stack-neutral core with one agent's hook contract. Rejected in favour of the feature layer.
