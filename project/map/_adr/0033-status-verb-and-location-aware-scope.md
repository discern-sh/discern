# ADR 0033: `status` — a read-only orientation verb with a location-aware default

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `finish` → `done`, `graduate` → `accept`, `scopes` → `impact` where it names the verb, the shared-branch label → the trunk; the decision and reasoning are unchanged. **Current-state note.** The `discern start` follow-up referenced here as a TODO has shipped ([ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md)). The location-based tool _visibility_ mentioned here was later retired ([ADR 0062](0062-mcp-server-working-root.md)), though the defensive refusals remain.

**Status**: accepted; builds on [ADR 0028](0028-result-envelope-and-diagnostics.md) (the result envelope) and [ADR 0030](_superseded/0030-quiet-json-output.md) (quiet `--json`); relates to [ADR 0029](0029-best-practices-audit.md) (the audit) and [ADR 0025](0025-worktree-resources.md) (per-worktree resources)

## Context

discern had two setup-facing verbs, and an agent starting a session had no cheap way to ask the most basic question of all: _where am I, what changed, and what should I do next?_

- **`doctor`** answers _"is it correctly installed and wired?"_ — health and validation. Its answer changes only when the install or config changes.
- **`audit`** answers _"is the setup any good?"_ — quality and coaching against a best-practices checklist ([ADR 0029](0029-best-practices-audit.md)). Its answer changes rarely, as the project's practices mature.

Neither answers the _situation_: which branch this is, whether the tree is dirty, how far it sits from the trunk, which scope gates a change would fire, which worktrees are in flight. An agent reconstructed that by hand from `git status`, `git branch`, `discern impact`, `discern identity`, and a read of `discern.toml` — several calls, each a partial view, none of it the orientation a session actually needs up front.

Two forces shaped the design:

1. **It must be safe to call reflexively.** If orientation runs the gate, runs tests, measures standards, or probes a resource, it is too slow and too side-effecting to call at the top of every session — and it would blur into `done`. Orientation has to be _pure observation_.
2. **The useful view depends on where you stand.** From inside a worktree the relevant frame is _this_ worktree's own state. From the main checkout — the supervisor's seat — the relevant frame is the whole fleet of worktrees in flight. A single fixed layout serves one seat badly.

## Decision

Add **`discern status`** — a third orientation verb, distinct from the other two: **`status` answers _"what's true right now, and what should I do next?"_** (situation/orientation, changes every commit).

### `status` is pure observation

`status` does git **reads**, file reads (`.env`, config), and identity derivation only. It **never** runs the gate, runs tests, measures standards, probes resource readiness, or creates/destroys anything. It reports what the gate **would** fire (the wired capabilities/checks and the scope gates the current change triggers, reusing the gate's own `planScopeGates` selection) and what **changed** (reusing the `scopes` classification) — but it never asserts a pass/fail it did not verify. Its `hints[]` are advisory next-steps ("run `discern done`", "looks ready to accept"), phrased as observation-plus-suggestion, never as a claim that the gate passed. A regression test pins the property: running `status` against a dirty worktree leaves the tree byte-for-byte unchanged and provisions no resource.

It is the same one-`DiscernResult`-rendered-three-ways spine as every other verb ([ADR 0028](0028-result-envelope-and-diagnostics.md)): a single `statusResult` core feeds the CLI, the `--json` envelope, and the `discern_status` MCP tool, and goes quiet under `--json` ([ADR 0030](_superseded/0030-quiet-json-output.md)). `status` is **always on** (like `doctor`), behind no feature toggle.

### The default scope is location-aware

This is the load-bearing design choice, and it is a **principle, not an inconsistency**:

- **In a linked worktree** → the **local** view (this worktree's own identity/git/scopes/gate). The fleet is omitted unless `--all` is passed.
- **In the main checkout** (worktrees enabled, ≥1 live worktree) → the **fleet** view, led by a cheap row-per-worktree table that **always includes the main checkout itself**, so nothing is hidden. Leading with the fleet omits the heavy local-only blocks (`scopes`, `gate`), which mean little from the seat that supervises rather than edits.
- **Worktrees off, or no worktrees** → the local view everywhere (a fleet is meaningless), with a hint from the main checkout that no worktrees are active.

`--all` forces the fleet in (a worktree surveying its siblings → local **plus** fleet); `--local` forces local-only; the two together is a refusal. The result `data` is **discriminated** by `location` and the presence of `fleet`, so a consumer reads the shape it got rather than guessing.

The fleet rows are deliberately **cheap** — branch, clean?, changed-file count, ahead/behind the trunk, a **last-activity** timestamp, and a best-effort id/port read from each worktree's `.env`. `status` does **not** run per-worktree changed-scope classification across the fleet; the supervisor view needs dirty/ahead/behind, not a full per-worktree gate analysis. The single-worktree local view is where `scopes` and the `gate` block belong.

### `status` marks the current fleet row — "clean" is never "available"

The fleet is a supervisor's read-only survey of the work in flight, not a pool of workspaces to claim. An agent once read it the other way. From the main checkout it saw another agent's worktree show up clean and current, took "clean" to mean "free", and started work inside it. That is a category error. `clean` is a **git** fact: no uncommitted changes. Availability is an **occupancy** fact: no live effort owns it. A worktree can sit pristine and still belong to an agent who is planning or reading, having written nothing yet.

So `status` never claims occupancy, which it cannot know. It marks ownership **structurally** instead: a worktree exists, so a line of work owns it. Every row carries `is_current`. It reads true for the row the call roots in — the main row from the main checkout, the current worktree's row under `--all` — and false for the rest. The honest signals are "this row is yours" and "this row is another effort's". No row ever reads as free. The human table flags the current row and captions the others as separate lines of work. A `--json`-only hint carries the same rule to an agent the moment it reads the fleet. The rule itself lives in the always-on guidance. This only reinforces it.

Reading occupancy straight from a session stays out of scope, for the reason last activity stops at git-and-filesystem evidence (below). A live session that writes nothing lives in the agent's own transcript, outside the worktree and in vendor-specific locations, and the engine stays agent-agnostic. The path forward for "an agent on `main` needs its own worktree" is the `discern start` follow-up in `TODO.md`: create a fresh one, never adopt an existing.

### Last activity is git-and-filesystem evidence, not conversation state

A row's **last activity** is the latest of two signals: the most recent **HEAD movement** (the per-worktree reflog — which captures commits, checkouts/resets, **and the worktree's own creation**) and the newest **mtime among uncommitted files**. Reading the reflog's creation entry is the load-bearing detail: a worktree spawned _today_ off a week-old branch point has a HEAD **commit** time from last week, so commit-time alone would make a fresh spawned-for-discussion worktree (no commits, no edits) read as stale — the opposite of the signal an operator wants. The reflog is appended only on HEAD _movement_, never on reads, so a read-only `status` (which itself shells out to git) never disturbs it.

We deliberately do **not** try to detect an _ongoing conversation that writes no files_ (an agent session open for days with no commits or edits). That state lives in the agent's own transcript, **outside** the worktree and in **vendor-specific** locations (e.g. one agent keeps `~/.../projects/**/*.jsonl`), and the engine is deliberately agent-agnostic — it hardcodes no agent's on-disk conventions. Coupling last-activity to a particular vendor's transcript would violate that and rot. The git+filesystem evidence (creation, commits, edits) covers the overwhelming majority of "is this worktree active?" judgements; the no-write-conversation case is the acknowledged gap.

### Single source of truth for the git/identity reads

The cheap per-checkout snapshot (branch, cleanliness, changed-file count, ahead/behind) lives as **one** helper, `gitSnapshot`, in `worktree/git.ts`; the fleet survey is **one** helper, `listWorktreeFleet`, that reuses the existing `parseWorktreeList` and `gitSnapshot` so a fleet row and the local block can never disagree on how a worktree is measured. Its cleanliness is ordinary Git-clean — tracked changes and untracked non-ignored files count, ignored files do not — so a clean fleet row is safe to reason about for teardown/prune decisions without hiding untracked review work. The behind-count / "contains the latest main" distinction reuses the canonical `assertMainMerged`; worktree identity reuses `resolveIdentity`. `status` composes existing readers; it re-implements no git plumbing.

## Consequences

- **Agents get a reflexive orient-on-start call.** One `discern status` (or the `discern_status` tool) replaces a handful of ad-hoc git/config probes with one structured, location-appropriate answer — and it is cheap and safe enough to run every session.
- **The three orientation verbs now partition cleanly**: `doctor` = health, `audit` = quality, `status` = situation. None overlaps another, and the docs and guidance can teach the distinction in one breath.
- **The result shape is conditional.** Consumers must branch on `location` and the presence of `fleet`/`gate`/`scopes`. That is the cost of a location-aware view; it is documented in the data contract and the tool description, and the discriminants are explicit.
- **`status` reports what the gate _would_ do, not what it _did_.** It can say "the branch is clean and contains main" but never "the gate passed" — that remains `done`'s word. This is a deliberate honesty boundary, reinforced by the hint wording and the pure-observation test.
- **A new read-only seam exists in `worktree/git.ts`.** `gitSnapshot` / `listWorktreeFleet` are now the canonical cheap readers; future read-only views (a richer dashboard, a CI summary) build on them rather than re-parsing porcelain.
- **The fleet says which row is yours, never which is free.** `is_current` marks the caller's own row. Every other row is another line of work. "Clean" stays a git fact, never an availability claim. Ownership is structural: a worktree's existence means a line of work owns it, so `status` never guesses session liveness. The always-on guidance and a `--json`-only hint both carry the rule. Adopting another line's worktree is the mistake this closes. `discern start` (see `TODO.md`) is the path for an agent on `main` that needs its own.

## Alternatives considered

- **Fold orientation into `doctor`.** Rejected: `doctor` validates the install and is meant to be stable; mixing in per-commit situational state would muddy both its purpose and its output, and tempt it toward running things to "check" them.
- **One fixed layout regardless of location.** Rejected: a worktree-shaped view from the main checkout buries the fleet an operator needs, and a fleet-shaped view from a worktree pays to survey siblings the agent didn't ask about. The location-aware default serves the seat you are actually in; the flags cover the exceptions.
- **Classify changed scopes for every worktree in the fleet.** Rejected as too costly for a reflexive call — it would run the scope classification N times. The fleet stays cheap (dirty/ahead/behind); the local view carries the deep analysis.
- **Make `status` assert gate health (run the gate when clean).** Rejected outright: it would make orientation slow and side-effecting, collapse the distinction from `done`, and let `status` claim a pass it never verified.
