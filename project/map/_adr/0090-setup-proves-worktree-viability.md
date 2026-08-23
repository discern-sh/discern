# ADR 0090: setup proves the project runs in a worktree, and `smoke` joins the known capabilities

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** current spellings are `done` (formerly `finish`), `[jobs]` / `[jobs.<name>]` (formerly `[capabilities]` / `[checks.<name>]`), known/custom `job` (formerly gate `capability` / custom `check`), and `config set-job` (formerly `config set-capability` / `config set-check`); the decision and reasoning are unchanged.
> - **[ADR 0152](0152-slow-workflows-prove-write-authority-first.md) — readiness clarification:** `smoke` also covers the essential shared config/runtime dependencies needed for that fast boot, and remains the project's configurable readiness check; discern-owned predictable writes are probed internally rather than adding a second `[preflight]` concept, and prerequisites unique to one custom command stay with that command.
> - **[ADR 0313](0313-setup-completion-and-acceptance-bind-one-final-proof.md) — probe identity and order:** the structural probe now starts from the committed completion-marker `HEAD`, retains Proof for that commit, and precedes the final main-checkout Gate. An uncreatable probe blocks non-forced completion; only the explicit forced path skips it.
> - **[ADR 0317](0317-gate-commands-and-setup-applicability-are-separate-facts.md) — applicable denominator:** a new known job still auto-enrols in setup assurance as applicable and absent. A project may explicitly declare an absent lifecycle not applicable; that declaration changes setup coverage only and never skips the job when configured.

**Status**: accepted; builds on [ADR 0075](0075-setup-staged-handshake.md) (the staged handshake, stateless derived progress), [ADR 0078](0078-setup-pages-and-per-step-proof.md) (stateless pages, derived per-step proof, the two-lane rule), [ADR 0065](0065-setup-keeps-its-promises.md) (`setup done` is a proven gate), [ADR 0052](0052-worktree-sibling-placement.md) (worktree sibling placement), and [ADR 0017](0017-capabilities-model.md) (the closed known-job vocabulary, tied to its satellites by the forcing functions of [ADR 0051](0051-canonical-set-parity.md)).

## Context

`discern setup done` proves the gate green (ADR 0065) — but it proves it in the **main checkout**, the one place discern tells every agent _never_ to work. Every real task after setup happens in a **linked worktree** (ADR 0052/0058), and nothing guaranteed the project actually functions there.

Clean-room onboarding runs surfaced the gap concretely: setup completes green while runtime anchoring breaks silently in a copy. A worktree is a fresh checkout of the committed tree plus whatever `[worktree.setup]` produces — so anything a project needs that is **not tracked in git** does not travel: an untracked `.env` and its generated `APP_KEY`, an untracked dependency directory (`vendor/`, `node_modules/`), a dev server pointed at the original path, an app that assumes an absolute location. The machinery to fix any given project already existed — `[worktree].steps` (one-shot at creation), `[worktree].ensure` (convergent, every pass), `[worktree.resources.<name>]` (create/destroy), and `[worktree].inherit_env` — but setup neither configured it per-stack nor proved it. So "my app broke in the copy" could arrive weeks after a green setup, and the **first real task was the moment the user discovered it** — long after the capable setup agent was gone.

A second, smaller gap travelled with it: the gate had no known job meaning "the app boots." `format` / `lint` / `typecheck` / `test` / `build` all inspect code; none proves the thing _runs_. A boot check is also precisely what makes a worktree probe sharp — a fast command that fails when the app cannot start in a copy is exactly the anchoring detector the probe needs.

## Decision

**Setup proves the project is viable inside a worktree, structurally; and `smoke` — a fast "does it boot?" check — joins the known jobs.** One decision pair, because each half completes the other: the probe needs something that proves boot, and a boot check is only fully valuable if it is re-proven where the work lives.

1. **`smoke` is a sixth known job, on the `test` stage.** Its semantics are distinct from every other known job: not "run tool X" but "prove the app boots in THIS checkout" — a FAST, side-effect-light command (a framework's inspire/about, a CLI `--version`, a script that loads config and exits), never an e2e suite (that belongs in `[jobs.<name>]`). It rides the `test` stage rather than a dedicated one, so every `discern done` — which already runs inside worktrees during normal work — re-proves boot wherever the gate runs, at minimal blast radius. The forcing functions (ADR 0051) auto-enrol it into assurance, `doctor`, derived progress, `config set-job`, and the config codegen; a sixth known job honestly turns a five-wired config's `full` coverage verdict into `partial` (5 of 6).

2. **`setup done` gains a fourth completion-proof leg: a worktree probe.** A new lifecycle core, `probeWorktreeViability`, creates a THROWAWAY worktree exactly as `discern start` does, runs a caller-supplied probe inside it, and tears it down win or lose — reusing the same create (`addWorktree` + `worktreeSetup`) and removal (`removeWorktreeSafely`) cores the rest of the lifecycle uses, so the probe exercises precisely what a real worktree does: its `[worktree.setup]` steps/ensure, its resources, its env inheritance. After `refresh → doctor → done` passes in the main checkout, and when `[features].worktrees` is on, `setup done` probes a worktree and runs the gate core inside it. A red probe blocks `done` with a named `worktree_probe` stage and leaves `[meta].bootstrapped` unrecorded; `worktree_proven` rides the `--json` envelope and the human render.

3. **The brief gains a Step 8** — "Prove the project runs in a worktree" — walking the agent through the same probe (`discern start` → `discern done` in the copy) and the `[worktree]` wiring for whatever a fresh copy is missing, with a stack-keyed readiness table. The old Step 8 (record/summarise) becomes Step 9.

The load-bearing design choices, and the explicit *no*s:

- **Derived proof, not self-report** (ADR 0075/0078). The probe is run BY the engine and cannot be faked. The brief's Step 8 gets **no** derived per-step predicate in `setup_checks.ts`: the agent's manual probe is a throwaway with no on-disk residue to check, so `done`'s structural probe is the real, unfakeable gate — the manual step is the agent's chance to get the wiring right first.

- **The probe branches from the CURRENT HEAD, never `main`.** During setup the work sits on the unlanded `discern-setup` branch; a probe from `main` would see a repo without discern at all. Branching from HEAD (the default of `git worktree add`) captures the agent's own just-authored config.

- **Honest skips, never false failures.** Worktrees-off skips the probe (nothing to prove); an _uncreatable_ probe (an unborn branch — no commit to branch from) is a skip, not a red; `--force` skips the whole proof, the probe included. `worktree_proven` is reported `true` only when the probe actually ran green, so the completion output never over-claims coverage it did not earn.

- **Per-vendor provisioning stays out of discern's ethos.** No Herd, vhost, or DNS integrations. A project's worktree needs are `[worktree.resources.<name>]` the agent authors per-project, or a TODO for the user. Anything with cost or data implications (a database, a paid service) is a genuine decision left with the user, never wired silently — the two-lane rule (ADR 0078) applied to provisioning.

- **`smoke` is not mandatory.** An absent known job stays "knowably absent" (ADR 0017); the probe runs the whole gate, so a project with no `smoke` still has its `format`/`lint`/`test` re-proven in a worktree.

## Consequences

- **The first real task can no longer be the moment the app breaks in a copy.** A project whose app is env-anchored either genuinely works in its first real worktree, or its user was told during setup — while a capable agent was present to fix or record it — exactly what remains.

- **The guarantee is continuously maintained, not asserted once.** Normal work already runs `discern done` in worktrees, and `smoke` now re-proves boot there on every run — so a later change that breaks worktree viability is caught by the gate, not months later by a user.

- **More surface, held by existing disciplines.** A new lifecycle core, a fourth proof leg, a sixth known job, and a new brief step are new moving parts — kept coherent by the forcing functions (which auto-enrol `smoke`), the probe reusing the create/remove cores, and the parser-validated brief spine.

- **`setup done` now creates and destroys a worktree** (a refresh + gate inside it). Bounded: one throwaway worktree at the end of a one-time setup, skipped entirely when worktrees are off or `--force` is used.

## Alternatives considered

- **A dedicated `smoke` gate stage instead of riding `test`.** Rejected: adding a stage ripples through `STAGES`, every stage-group builder, `prepare`/`test` inclusion, and the forcing functions, for no behavioral gain — `smoke` on the `test` stage already runs on every `done`, in and out of worktrees.

- **Have the agent attest worktree viability (self-report).** Rejected by the governing lesson of ADR 0075/0077/0078: everything structurally enforced happened reliably; everything merely advised degraded. The probe is engine-run.

- **Branch the probe from `main`.** Rejected: pre-land, `main` has no discern at all, so the probe must branch from the current unlanded HEAD to see the agent's own config.

- **Provision per-vendor (Herd, a vhost, a database) inside discern.** Rejected as outside discern's stack-neutral ethos; those become `[worktree.resources.<name>]` the agent authors, or a TODO for the user.

- **A derived per-step predicate for the brief's Step 8.** Rejected: the manual probe is a throwaway with no on-disk residue to check, and `done`'s structural probe is the real, unfakeable gate — a Step 8 predicate would be redundant and unprovable.
