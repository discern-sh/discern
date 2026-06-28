# ADR 0065: `discern setup` keeps its promises

**Status**: accepted

Hardens the setup flow established by [ADR 0036](0036-unify-setup.md) (unify
init + bootstrap into `discern setup`) and the incompleteness signaling of
[ADR 0037](0037-setup-incompleteness-observable.md); revises the pre-setup verb
redirect 0036 introduced. Builds on
[ADR 0034](0034-agents-md-untracked-currency-check.md) (the generated agent
files are gitignored build artifacts) and the involve-don't-gate brief of
[ADR 0044](0044-setup-involve-not-gate.md).

## Context

Running `discern setup` end-to-end with an unfamiliar agent (OpenAI Codex, in a
real Deno project) surfaced a cluster of defects that share one root: **the
scaffold prints promises its own structure does not keep at the moment it prints
them.** The brief is prose; the files and state behind it didn't match.

- **The brief prescribes an impossible order.** Step 8 tells the agent to run
  `discern finish` (the "prove the gate is green" proof ADR 0036 calls for)
  _before_ `discern setup done`. But `finish` is one of the
  `BOOTSTRAP_GATED_VERBS` — it hard-redirects with _"this project isn't set up
  yet"_ until `setup done` records `[meta].bootstrapped`. The proof step cannot
  execute in the order the brief gives. Worse, **no test caught it**: the engine
  test harness scaffolds with `bootstrapped = true` by default, so every gate
  test runs in the one state where the contradiction is invisible.

- **An existing agent file wasn't carried into the tracked source.**
  `compileGuidelines` regenerates each agent file from the compiled guidance, so
  a project that already had a hand-authored `CLAUDE.md`/`AGENTS.md` saw it
  replaced without its content first being folded into the tracked `guidance.md`
  the pipeline reads from.

- **The brief says "flesh out the stub" of a `guidance.md` that was never
  laid.** `laySkeletons` seeds `docs/` and `TODO.md` only. The agent had to
  create `guidance.md` from nothing, and `setup done` could not catch its
  absence — `findSkeletonMarkers` only flags a `guidance.md` that _exists_ and
  still carries a marker.

- **The scaffold links to files it doesn't create.** The seed `docs/README.md`
  links `_adr/README.md` and `_internal/`; neither is laid by setup. Dead links
  on day one.

- **The project name's casing is lost.** Skeleton fills reconstruct the display
  name from the lowercase slug (`displayNameFromSlug(slug)`), so
  `ListOfListsOfLists` becomes `Listoflistsoflists` in `TODO.md` — even though
  the correctly-cased `projectName` is in hand during a fresh scaffold.

- **One provider's write failure aborts all of refresh.** In `compileGuidelines`
  the skills job runs first and unguarded; a sandbox denial writing
  `.agents/skills` throws and takes down the _later_ MCP-wiring and agent-file
  compile, even though `.claude/skills` already succeeded.

- **A documentation contradiction.** The brief states the agent files are "all
  gitignored build artifacts except `AGENTS.md`", while the shipped
  `.gitignore.fragment` (and ADR 0034) ignore `AGENTS.md`.

Each is a separate bug, but the unifying lesson is the one discern already
applies elsewhere: ADR 0044 makes "you can revert this" true by _backing it with
an atomic commit_; ADR 0037 makes "setup is done" true by _backing it with the
`setup done` gate_. Setup's brief and skeletons were not held to that bar — they
asserted without backing.

## Decision

**Every promise `discern setup` prints is backed by structure that exists when
it prints it; existing guidance is adopted rather than replaced; and a fresh
setup runs isolated on its own branch.** Concretely:

1. **`discern setup done` proves completion structurally.** It runs, in order,
   `refresh` → `doctor` → `finish` (calling the result cores directly, which sit
   below the router/MCP gate, so no bootstrap bypass plumbing is needed) and
   records `[meta].bootstrapped = true` **only when doctor and finish are
   green** (markers must already be clear, as before). `--force` remains the
   escape hatch: it bypasses both the marker check and the gate and records
   completion regardless. The agent no longer runs `finish` as a separate
   pre-`done` step — `setup done` _is_ the green-gate proof, so "the gate is
   real" can no longer be reported without being true.

2. **The gate's proof verbs are usable during setup.** `finish`, `prepare`,
   `test`, and `ratchets` are removed from `BOOTSTRAP_GATED_VERBS` so the agent
   can iterate while wiring capabilities — and test a ratchet it wires — during
   Step 7. They are **not** silent: while `!bootstrapped` each carries a
   `hints[]` entry stating setup is unfinished and this output is indicative
   until `discern setup
   done` passes. `docs`, `graduate`, and `integrate`
   stay gated — pre-setup they browse an empty tree or act on branch work that
   doesn't exist yet. This **revises ADR 0036's** uniform redirect: the "empty
   gate reads as a false all-green" risk it guarded against is now covered by
   ADR 0037's incompleteness signaling (the `status` banner, the session
   reminder, and the `setup done` gate), so gating the proof verbs only blocked
   their legitimate use.

3. **A fresh setup adopts any existing agent file into `guidance.md`.** Before
   the first compile, on a fresh install (no `discern.toml` yet — so any agent
   file on disk is the user's, never one discern generated), each pre-existing
   `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` has its content folded into the tracked
   `guidance.md` source under a labelled heading, deduped by content. The
   compile then re-emits it as part of the generated body, so existing
   instructions flow into the author-once → compile-everywhere pipeline rather
   than being replaced by it. Duplicate content is harmless — the agent
   reconciles it in Step 4.

4. **Setup ships what it references.** `laySkeletons` lays a marked
   `guidance.md` stub (so "flesh out the stub" is literally true, and the
   existing `findSkeletonMarkers` check enforces it — no second code path) and
   the `_adr/` skeleton (`README.md` + `0000-template.md`, the canonical ADR
   format the design-principles template already depends on). The `_internal/`
   reference is softened to forward-reference the `document-subsystem` skill
   that owns it. A fresh-scaffold architectural test forbids the class: every
   relative link in a scaffolded doc must resolve, and every file the brief says
   to "flesh out" must be laid carrying a marker.

5. **Skeleton fills use the correctly-cased project name.** The display name
   comes from `InitConfig.projectName` (casing preserved from the directory),
   falling back to slug title-casing only on a `--force` resume where the fresh
   config isn't in hand.

6. **`refresh` isolates per-artifact failures.** The skills and agent-file jobs
   in `compileGuidelines` are wrapped like the MCP job already is; a failure in
   one is recorded and reported, and the others still run. The result reports
   partial success rather than throwing.

7. **The agent files are uniformly gitignored build artifacts.** The brief's
   "except `AGENTS.md`" carve-out is removed, settling the contradiction in
   favour of the shipped `.gitignore.fragment` and ADR 0034. `AGENTS.md`,
   `CLAUDE.md`, and `GEMINI.md` are all generated, all gitignored; the tracked,
   reviewable source is `guidance.md`.

8. **A fresh setup runs on its own branch.** In a git repo, a fresh
   `discern
   setup` requires a clean working tree (it refuses uncommitted
   _tracked_ changes, pointing at `--allow-dirty`) and creates + checks out a
   dedicated `discern-setup` branch before writing anything — so the several
   commits setup makes never land on the user's current branch, and the whole
   effort is trivial to roll back (delete the branch) or land (merge it) when
   they're ready. `--allow-dirty` opts out of both the check and the branch;
   `--dry-run`, a re-run/`--force`, and a non-git directory are no-ops.

The explicit **no**s:

- **Incompleteness signaling is untouched (ADR 0037).** The loud "SETUP STARTED
  — NOT FINISHED" frame, the tail-survivable footer, and the `setup done` gate
  all stand. Making `setup done` run the gate _strengthens_ it: completion is
  now proven, not asserted.
- **`setup done` does not weaken to a warning.** A red doctor or finish blocks
  completion (short of `--force`). If the install is unhealthy or the gate is
  red, setup genuinely is not done.
- **No new schema or CLI interactivity.** The completion marker stays
  `[meta].bootstrapped`; `discern setup` the command stays non-interactive.

## Consequences

- The brief's prescribed flow is executable end-to-end, and a regression test
  drives it from the **un-bootstrapped** state — the state the prior suite never
  exercised — so the contradiction cannot silently return.
- Setup can run over a project that already has its own agent instructions:
  their content is folded into `guidance.md` and re-emitted, with any duplicates
  the agent tidies in Step 4. A guard test asserts a pre-existing `CLAUDE.md`'s
  content reaches both `guidance.md` and the recompiled file.
- A fresh setup is isolated on its own branch, so experimenting is low-stakes
  and rollback is one `git branch -D`. The cost is a little friction: a dirty
  repo must commit/stash (or pass `--allow-dirty`) before setup will run.
- `setup done` is slower — it runs the full gate, including tests — but that
  cost buys a real definition-of-done, and it is a one-time event that already
  asked the agent to run `finish` by hand.
- Un-gating the proof verbs (`finish`/`prepare`/`test`/`ratchets`) leans on ADR
  0037's signaling to carry the "not done yet" message; the per-command hint
  makes that explicit at each call site rather than relying only on `status`.
- The single-source discipline holds: the `_adr/` skeleton is shared with the
  `write-adr` skill via a byte-identity guard, so the canonical format lives in
  one place even though it is laid from two.
- `doctor` blocking `setup done` means an environment problem (a capability tool
  not yet on PATH) can hold completion. This is intended — the brief tells the
  agent to clear `doctor` in Step 8 — but it does couple completion to
  environment health, which `--force` exists to override when needed.

## Alternatives considered

- **Reorder the brief: `setup done` first, then `finish`.** Rejected — it marks
  setup complete _before_ proving the gate, the opposite of what the proof step
  is for, and `setup done` refuses while markers remain anyway.
- **Keep `finish` gated; let only `setup done` run it internally.** Rejected as
  insufficient: the agent still needs `finish`/`prepare`/`test` to iterate while
  wiring capabilities in Step 7, and blocking them there is the exact footgun
  that surfaced. Un-gating with a hint serves both.
- **Detect a pre-existing agent file by a generated-file sentinel rather than
  the fresh-install gate.** Rejected: the canonical agent file is full-bodied,
  but its mirrors are bare `@AGENTS.md` pointers carrying no sentinel, so a
  generated pointer would be misread as the user's content. "No `discern.toml`
  yet ⇒ nothing discern generated" is unambiguous and needs no content sniffing.
- **Isolate setup in a worktree instead of a branch.** Rejected: setup runs at
  the bootstrap moment, before discern's worktree workflow is configured (there
  is no `discern.toml` yet), and a plain branch needs no per-worktree resources
  or config — it is the lighter, always-available isolation here.
- **Soften the `_adr/` reference too, like `_internal/`.** Rejected: the design
  principles name "write an ADR" as their override mechanism, so the ADR format
  and template should exist from the first commit, not only after the
  `write-adr` skill is first run.
- **Flip `AGENTS.md` to tracked.** Rejected here: it would reverse ADR 0034 and
  change the shipped gitignore for every project. The contradiction is settled
  in favour of the existing decision; revisiting 0034 is a separate question.
