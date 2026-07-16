# The isolated-worktree workflow

_Throwaway git Worktrees so an agent never works in the main checkout._

> **New here?** Start with the [orientation tier](../00-orientation/) —
> [concepts](../00-orientation/concepts.md) and
> [what setup added to your repo](../00-orientation/after-setup.md) — before the
> mechanism below. Sharing the repo with people?
> [Working with a team](team-workflow.md) covers cloning and collaboration.

This subtree covers the Worktree lifecycle. The `discern worktree ...`
subcommands provision and tear down an isolated `git worktree` (and its branch)
per change, each with a **deterministic dev-server port** and any number of
project-declared **resources** — external things (a database, an emulator, a
container, a queue) that must exist for exactly the life of the Worktree. The
git mechanics are generic; the resources are the only stack-specific part,
declared as `[worktree.resources.<name>]` tables in `discern.toml`. A fresh
install declares none, so a Worktree round is a clean no-op until a project
wires one. The workflow is core — always wired, with no configuration attached;
a session that never runs `start` never uses it
([ADR 0011](../_adr/0011-adopt-worktree-workflow.md),
[ADR 0025](../_adr/0025-worktree-resources.md),
[ADR 0101](../_adr/0101-retire-the-features-toggles.md)).

The lifecycle is driven by hooks in `.claude/settings.json`: `SessionStart` →
[`worktree ensure`](../../../src/engine/worktree/lifecycle.ts) (idempotent
setup + resource `ensure` + `[worktree.setup].ensure`), `WorktreeCreate` →
[`worktree create`](../../../src/lib/worktree_hooks.ts) (reads the hook's JSON
payload, adds the worktree, then runs first-time setup — which creates the
resources and runs `[worktree.setup]`: the one-shot `steps`, then the convergent
`ensure`), `WorktreeRemove` →
[`worktree remove`](../../../src/lib/worktree_hooks.ts) (tears it down). Those
two hook entries parse their payload in the binary itself — no `jq`
([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). A create whose
branch already exists (unlanded work from an earlier worktree of the same name)
is refused up front, and a failed create discards only what it created — never a
pre-existing branch or its commits. An agent on the **main checkout** that needs
its own Worktree runs [`start`](../../../src/engine/worktree/lifecycle.ts): it
mints a fresh id — from an optional caller-supplied **name**, normalised to a
branch-safe slug (else a random `<adjective>-<noun>` codename), always tailed
with random hex so two same-named Worktrees never collide — creates the Worktree
on its own `agent/` branch at the sibling location, sets it up, and reports the
path to move into (with a note when the name was normalised or fell back) — the
agent-initiated counterpart to the `WorktreeCreate` hook, and the first-class
alternative to squatting in another line of work's Worktree
([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md),
[ADR 0109](../_adr/0109-worktree-start-optional-name.md)). The new branch forks
from the **trunk** (`[project].main_branch`) explicitly — never from whatever
branch the main checkout happens to be parked on, so a parked checkout can't
poison a fresh Worktree with off-trunk commits (the `WorktreeCreate` hook
applies the same rule); `--from <ref>` branches from any ref instead, for
building on unlanded or experimental work. Over MCP, `discern_start` also takes
`path` — an absolute path into **any discern project on disk** — and creates the
Worktree _for that project_, forking its trunk under its config, the server's
working root following the new Worktree exactly as for a same-project start: the
cross-project entry point that makes a multi-repo application workable from one
agent session
([ADR 0111](../_adr/0111-cross-project-path-and-strict-tool-schemas.md)).
Uncommitted changes in the main checkout stay there (an advisory line says so).
`start` refuses — in plain language, cleaning up anything partially created — a
repo with no commits yet ("make your first commit first"), a `discern.toml` that
is not at the git repository's root (a Worktree is a whole-repository checkout;
the gate and analysis verbs still work under that nested shape
([ADR 0115](../_adr/0115-nested-root-verbs-work-or-refuse.md))), and an unknown
or ambiguous `--from` ref; `discern doctor`'s **repository shape** check flags
the first two layouts before a `start` ever trips on them. It only ever
_creates_ a Worktree to inhabit; it never adopts or prunes an existing one. When
`main` advances under a long-running Worktree,
[`update`](../../../src/engine/worktree/lifecycle.ts) brings it into the branch,
re-materializes the agent files + skills, and re-runs `[worktree.setup].ensure`
so a merge that changed a lockfile leaves the worktree's dependencies current —
all in one step. `update --from <ref>` pulls **any ref** into the worktree
instead of the trunk — the pull axis of the landing model, how multi-phase work
composes below the trunk — with every guarantee intact: the same clean-tree
precondition, the conflict abort, the re-materialize step, and the change
summary (computed against the resolved ref, whose tip is the summary's `main`
anchor). It merges only into a tracked-clean tree: tracked edits that have not
been committed must be committed or stashed first, while untracked local/session
scratch files are left alone. When the branch already contains the source
nothing merges, but the refresh + `ensure` convergence **still runs** — so after
a conflict is resolved by hand (`git merge`, fix, commit), re-running
`discern update` restores everything the aborted merge skipped. It is the
deterministic inverse of accept, and what the gate's merge check
([ADR 0050](../_adr/0050-merge-check-fail-fast.md)) points a behind branch at
([ADR 0055](../_adr/0055-update-verb.md),
[ADR 0059](../_adr/0059-worktree-setup-ensure.md)). When a change is done,
[`accept`](../../../src/engine/worktree/lifecycle.ts) validates the exact tree
it is about to land — running the whole gate, or skipping the re-run when the
recorded receipt proves the agent's own `done` already passed this commit
([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)) — then lands the
branch on the **trunk** — the single push target of the landing model
([ADR 0110](../_adr/0110-the-landing-model.md)): the trunk is fast-forwarded to
the **validated commit** — never a branch name resolved at merge time, so a
commit made while the validation ran is refused rather than landed untested —
always cleanly (the gate proved the branch contains the trunk), then the
Worktree removed, and the merged branch deleted. Composition happens on the pull
axis instead: `start --from` and `update --from` build on any ref, so
multi-phase work assembles below the trunk and only the finished whole crosses
to it. Before any git runs, acceptance refuses — read-only and mutation-free —
without the `--confirmed` attestation: the fact that the owner has accepted this
landing, or gave standing pre-authorization. The refusal re-serves the review
moment (relay the receipt, then re-run with `--confirmed`) so the highest-stakes
act never lands on a consent that lived only in an agent's own summary — the
landing counterpart to `setup begin`'s scaffold attestation, sharing its
`awaiting_consent` refusal slug
([ADR 0134](../_adr/0134-accept-attests-consent.md),
[ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).
Acceptance also refuses — naming the way back — when the main checkout is parked
on a branch other than the trunk, and never silently switches it. After landing,
it runs `discern refresh` in the trunk checkout it leaves behind, so generated
guidance, materialized skills, and provider integrations match the landed
sources ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md)), and
it prints [the receipt](../20-quality-gate/the-receipt.md) for the landed tree —
the landing record, pasteable into a PR body. Its main-checkout precondition
also cares about tracked changes, not untracked local scratch; the worktree
precondition is stricter because acceptance refuses any tracked, not staged,
staged, or untracked worktree change before it removes the checkout;
[`worktree drop <id|path>`](../../../src/engine/worktree/lifecycle.ts) — run
from the main checkout — is the sanctioned removal for **abandoned work**: it
tears down the worktree's resources, removes the worktree, and deletes its
branch, refusing without `--force` when the worktree holds uncommitted changes
or commits not on the trunk (naming exactly what a forced drop would discard). A
worktree whose git state cannot be read — a missing or damaged checkout — fails
**safe** the same way: unknown state is itself a blocker, never treated as
clean, and unlanded commits are still named from the branch ref in the main
repo. A `git worktree lock`ed worktree is refused outright — not even `--force`
removes one (the lock protects checkouts and their ignored files on
removable/network media; `git worktree unlock` is the only way through), and
`accept` applies the same refusal at plan time, before anything lands. It is
deliberately CLI-only, with no MCP tool: the MCP surface aims at the caller's
_own_ worktree, every other worktree is another line of work an agent must never
remove (the fleet ownership rule), so discarding work is a human supervisory
action — `status` hints carry the command to the human, and
[the desk](the-desk.md) offers it interactively.
[`worktree prune`](../../../src/engine/worktree/lifecycle.ts) sweeps stale
Worktrees and **reclaims the resources of any Worktree that vanished without a
clean teardown** (the garbage-collection safety net); it only ever removes
fully-merged, clean worktrees — discarding real work is `drop`'s job, behind its
explicit `--force`. That eligibility is judged twice: by the read-only scan the
confirmation prompt shows, and again per candidate just before each removal — so
a worktree or orphan that gains work while the prompt waits is skipped, not
swept. [`status`](../../../src/engine/status/status.ts) uses the same ordinary
Git-clean boundary as prune for its local and fleet `clean` fields: tracked
changes and untracked non-ignored files make a Worktree dirty, while ignored
provider-local/generated files stay out of the signal. Status also tells the
truth about **abandoned and broken work**: a fleet member whose checkout carries
no project config (the signature of a creation that crashed mid-checkout) is
flagged `broken` with the `worktree drop` removal hint; a member git cannot run
inside at all is flagged `git_unavailable` and rendered `unreadable` — its
per-checkout fields are absent, never fabricated as clean; a member idle for a
week that still holds uncommitted changes or unlanded commits gets a hint to
resume it or drop it; unlanded `agent/*` branches with **no worktree** are
listed (`data.unlanded_branches`) with the pull-axis recovery (`start --from` /
`update --from`); a missing trunk reports `ahead` as an honest null, never a
fabricated `0 ahead`. And when the worktree the tools aim at stays pristine
while the main checkout accumulates changes — the signature of an agent editing
the trunk while the gate runs elsewhere — `status` and `done` both raise an
explicit **silent-divergence** warning naming the fix (`cd <worktree> && …`
prefixes, and the `path` parameter on discern's MCP tools).
[`identity`](../../../src/engine/worktree/identity.ts) resolves a Worktree's
stable identity (id / site / branch / port / db / worktree / resource). The
**deterministic port** hashes from the Worktree's id; `start` re-rolls a
freshly-minted id whose port would collide with a live sibling's (best-effort —
a crowded band never fails the start, and two `start`s racing in the same
instant can still mint the same port: there is no cross-process lock, by design
— re-roll one with a recorded `DISCERN_WORKTREE_ID` if it ever happens). **Env
plumbing** flows through `[worktree].env_files` (default
`[".env", ".env.local"]`, the dotenv override convention): `inherit_env` values
are read from the main checkout's env files and written into the new Worktree's
— creating its env file when absent, so a declared value always arrives — while
the port and resource handles are recorded into an existing env file only. The
env writers re-assert after the one-shot `[worktree.setup].steps`, so a scaffold
that rewrites the env file wholesale (`cp .env.example .env`) can't erase what
setup just delivered. `status` fleet rows derive id/port from identity when
nothing is recorded, so an env-file-less project still reads honestly.

**Proving a copy works.** The same create → setup → removal cores back a further
use: `setup done`'s **worktree-viability probe**
([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)). Setup proves the
gate in the main checkout — the one place an agent never works — so before it
records completion it also creates a THROWAWAY Worktree from the current branch
(via [`probeWorktreeViability`](../../../src/engine/worktree/lifecycle.ts)),
runs the gate inside it, and tears it down win or lose. A project that passes in
the main checkout but breaks in a copy — an env-anchored app whose untracked
`.env`, dependency dir, or absolute-path assumption never travels — fails setup
with a named `worktree_probe` stage, so the wiring that makes a copy viable
(`[worktree].steps` / `ensure` / `resources` / `inherit_env`) is fixed while a
capable agent is present, not discovered on the first real task. `smoke` — a
fast "does it boot?" [Capability](../00-orientation/glossary.md#capability) —
makes that probe sharp: because `discern done` runs it wherever the gate runs,
every finish re-proves the app boots in a Worktree too.

**Where they land.** `WorktreeCreate` places each checkout under
`[worktree].root`: by default a **sibling** of the repo
(`<repo>.worktrees/<name>`), visible and adjacent rather than nested inside it
(a nested worktree is an anti-pattern — recursive tools double-count it, and a
walk-up to the repo root mis-resolves the worktree's `.git` file). A relative
`root` resolves against the repo root (`.claude/worktrees` nests them inside the
repo); an absolute one is used as-is. The engine stays location-agnostic — it
discovers existing Worktrees from git's own registry, never a hardcoded path —
so only the create hook and `worktree prune`'s orphan sweep know the convention
([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).

Each effectful lifecycle verb — `start`, `worktree` (setup), `update`,
`worktree teardown`, `worktree prune`, and `accept` — takes a `--dry-run` that
prints the plan (what it _would_ create, destroy, reclaim, move, or merge) and
touches nothing, plus a `--json` serialization of plan + results
([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)). The destructive ones
— prune's GC and acceptance's remove / checkout or fast-forward dance — are
inspectable before they act.

## Leaves

| File                                 | Covers                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [team-workflow.md](team-workflow.md) | The collaborator story: cloning with or without discern, the one-minute path to full function, and working alongside agent worktrees without colliding.                                                                                          |
| [the-resources.md](the-resources.md) | Per-worktree resources: the config seam, the create/reuse/destroy lifecycle, the ledger + orphan GC, identity, ownership/namespacing, and the runtime-discovery contract.                                                                        |
| [the-desk.md](the-desk.md)           | The human's interactive surface: bare `discern` opens a decision-ordered picker over the fleet — land, update, inspect, run a worktree-local Project Script, jump in, or drop, unless `--plain`, CI, or non-terminal streams select static help. |

> **Status: partial.** `the-resources.md` is written; the remaining lifecycle /
> identity / integration leaves are still stubs — fill them with the
> [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md)
> skill.

## See also

- [concepts.md](../00-orientation/concepts.md) — where Worktrees sit in the
  loop.
- Why discern adopted this workflow
  ([ADR 0011](../_adr/0011-adopt-worktree-workflow.md)).
- Generalizing the db/dev-server adapters into per-worktree resources with
  orphan GC ([ADR 0025](../_adr/0025-worktree-resources.md)).
- Placing Worktrees in a configurable sibling directory instead of nested
  `.claude/worktrees` ([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).
- `update`, the third verb in the worktree lifecycle: bring `main` into the
  branch and re-materialize in one deterministic step
  ([ADR 0055](../_adr/0055-update-verb.md)).
- `start`, the verb that spawns a Worktree from the main checkout, and the
  `discern status` guardrail that points an agent on the trunk at it
  ([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md)).
- `[worktree.setup].ensure`, the convergent bucket that re-runs every pass
  (creation, session start, update) to keep the worktree's environment current
  with the tree ([ADR 0059](../_adr/0059-worktree-setup-ensure.md)).
- Acceptance refreshes the checkout it leaves behind
  ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md)).
- The landing model: pull from any ref (`start --from` / `update --from`), land
  only on the trunk ([ADR 0110](../_adr/0110-the-landing-model.md)).
- Bare `discern` opens the operator's desk, the human's interactive surface over
  the fleet ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md)).
