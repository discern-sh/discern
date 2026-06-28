# ADR 0065: `discern setup` proves its own completion and never destroys existing guidance

**Status**: accepted

Hardens the setup flow established by [ADR 0036](0036-unify-setup.md) (unify
init + bootstrap into `discern setup`) and the incompleteness signaling of
[ADR 0037](0037-setup-incompleteness-observable.md); revises the pre-setup verb
redirect 0036 introduced. Builds on [ADR 0034](0034-agents-md-untracked-currency-check.md)
(the generated agent files are gitignored build artifacts) and the
involve-don't-gate brief of [ADR 0044](0044-setup-involve-not-gate.md).

## Context

Running `discern setup` end-to-end with an unfamiliar agent (OpenAI Codex, in a
real Deno project) surfaced a cluster of defects that share one root: **the
scaffold prints promises its own structure does not keep at the moment it prints
them.** The brief is prose; the files and state behind it didn't match.

- **The brief prescribes an impossible order.** Step 8 tells the agent to run
  `discern finish` (the "prove the gate is green" proof ADR 0036 calls for)
  *before* `discern setup done`. But `finish` is one of the
  `BOOTSTRAP_GATED_VERBS` — it hard-redirects with *"this project isn't set up
  yet"* until `setup done` records `[meta].bootstrapped`. The proof step cannot
  execute in the order the brief gives. Worse, **no test caught it**: the engine
  test harness scaffolds with `bootstrapped = true` by default, so every gate
  test runs in the one state where the contradiction is invisible.

- **A pre-existing `CLAUDE.md`/`AGENTS.md` is silently destroyed.**
  `compileGuidelines` writes each agent file unconditionally. A project that
  already had a hand-authored `CLAUDE.md` (its real instructions) has it
  overwritten on the first `setup`/`refresh` — and because ADR 0034 makes those
  files gitignored, the original may not even be in version control to recover.
  This is the most serious defect: setup must never delete a user's work.

- **The brief says "flesh out the stub" of a `guidance.md` that was never laid.**
  `laySkeletons` seeds `docs/` and `TODO.md` only. The agent had to create
  `guidance.md` from nothing, and `setup done` could not catch its absence —
  `findSkeletonMarkers` only flags a `guidance.md` that *exists* and still
  carries a marker.

- **The scaffold links to files it doesn't create.** The seed `docs/README.md`
  links `_adr/README.md` and `_internal/`; neither is laid by setup. Dead links
  on day one.

- **The project name's casing is lost.** Skeleton fills reconstruct the display
  name from the *lowercased* slug (`displayNameFromSlug(slug)`), so
  `ListOfListsOfLists` becomes `Listoflistsoflists` in `TODO.md` — even though
  the correctly-cased `projectName` is in hand during a fresh scaffold.

- **One provider's write failure aborts all of refresh.** In
  `compileGuidelines` the skills job runs first and unguarded; a sandbox denial
  writing `.agents/skills` throws and takes down the *later* MCP-wiring and
  agent-file compile, even though `.claude/skills` already succeeded.

- **A documentation contradiction.** The brief states the agent files are "all
  gitignored build artifacts except `AGENTS.md`", while the shipped
  `.gitignore.fragment` (and ADR 0034) ignore `AGENTS.md`.

Each is a separate bug, but the unifying lesson is the one discern already
applies elsewhere: ADR 0044 makes "you can revert this" true by *backing it with
an atomic commit*; ADR 0037 makes "setup is done" true by *backing it with the
`setup done` gate*. Setup's brief and skeletons were not held to that bar — they
asserted without backing.

## Decision

**Every promise `discern setup` prints is backed by structure that exists when it
prints it, and setup never destroys existing user guidance.** Concretely:

1. **`discern setup done` proves completion structurally.** It runs, in order,
   `refresh` → `doctor` → `finish` (calling the result cores directly, which sit
   below the router/MCP gate, so no bootstrap bypass plumbing is needed) and
   records `[meta].bootstrapped = true` **only when doctor and finish are
   green** (markers must already be clear, as before). `--force` remains the
   escape hatch: it bypasses both the marker check and the gate and records
   completion regardless. The agent no longer runs `finish` as a separate
   pre-`done` step — `setup done` *is* the green-gate proof, so "the gate is
   real" can no longer be reported without being true.

2. **The gate's proof verbs are usable during setup.** `finish`, `prepare`, and
   `test` are removed from `BOOTSTRAP_GATED_VERBS` so the agent can iterate while
   wiring capabilities (Step 7). They are **not** silent: while
   `!bootstrapped` each carries a `hints[]` entry stating setup is unfinished and
   this output is indicative until `discern setup done` passes. `docs`,
   `graduate`, `integrate`, and `ratchets` stay gated — pre-setup they browse an
   empty tree or act on work that doesn't exist yet. This **revises ADR 0036's**
   uniform redirect: the "empty gate reads as a false all-green" risk it guarded
   against is now covered by ADR 0037's incompleteness signaling (the `status`
   banner, the session reminder, and the `setup done` gate), so gating the proof
   verbs only blocked their legitimate use.

3. **Setup preserves a pre-existing agent file by migrating it into
   `guidance.md`.** Before the first compile, any agent file that already exists
   and is **not** discern-generated (detected by the absence of the base
   guidance's "Generated files — don't hand-edit" sentinel) has its content
   folded into `guidance.md` — the tracked source — under a labelled heading.
   The compile then re-emits it as part of the generated body, so the user's
   instructions survive in both the reviewable source and the generated file.
   Identical files (a `CLAUDE.md` and `AGENTS.md` with the same bytes) migrate
   once. The bias is explicit: **over-preserve rather than ever lose** — a
   duplicated paragraph the agent reconciles in Step 4 is recoverable; a deleted
   file is not.

4. **Setup ships what it references.** `laySkeletons` lays a marked
   `guidance.md` stub (so "flesh out the stub" is literally true, and the
   existing `findSkeletonMarkers` check enforces it — no second code path) and
   the `_adr/` skel (`README.md` + `0000-template.md`, the canonical ADR format
   the design-principles template already depends on). The `_internal/`
   reference is softened to forward-reference the `document-subsystem` skill that
   owns it. A fresh-scaffold architectural test forbids the class: every relative
   link in a scaffolded doc must resolve, and every file the brief says to "flesh
   out" must be laid carrying a marker.

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

The explicit **no**s:

- **Incompleteness signaling is untouched (ADR 0037).** The loud "SETUP STARTED
  — NOT FINISHED" frame, the tail-survivable footer, and the `setup done` gate
  all stand. Making `setup done` run the gate *strengthens* it: completion is now
  proven, not asserted.
- **`setup done` does not weaken to a warning.** A red doctor or finish blocks
  completion (short of `--force`). If the install is unhealthy or the gate is
  red, setup genuinely is not done.
- **No new schema or CLI interactivity.** The completion marker stays
  `[meta].bootstrapped`; `discern setup` the command stays non-interactive.

## Consequences

- The brief's prescribed flow is executable end-to-end, and a regression test
  drives it from the **un-bootstrapped** state — the state the prior suite never
  exercised — so the contradiction cannot silently return.
- Setup is safe to run over an existing project with its own agent instructions:
  the worst case is content duplicated into `guidance.md` for the agent to tidy,
  never content lost. A guard test scaffolds a pre-existing `CLAUDE.md` and
  asserts its content survives in both `guidance.md` and the recompiled file.
- `setup done` is slower — it runs the full gate, including tests — but that cost
  buys a real definition-of-done, and it is a one-time event that already asked
  the agent to run `finish` by hand.
- Un-gating the proof verbs leans on ADR 0037's signaling to carry the
  "not done yet" message; the per-command hint makes that explicit at each call
  site rather than relying only on `status`.
- The single-source discipline holds: the `_adr/` skel is shared with the
  `write-adr` skill via a byte-identity guard, so the canonical format lives in
  one place even though it is laid from two.
- `doctor` blocking `setup done` means an environment problem (a capability tool
  not yet on PATH) can hold completion. This is intended — the brief tells the
  agent to clear `doctor` in Step 8 — but it does couple completion to
  environment health, which `--force` exists to override when needed.

## Alternatives considered

- **Reorder the brief: `setup done` first, then `finish`.** Rejected — it marks
  setup complete *before* proving the gate, the opposite of what the proof step
  is for, and `setup done` refuses while markers remain anyway.
- **Keep `finish` gated; let only `setup done` run it internally.** Rejected as
  insufficient: the agent still needs `finish`/`prepare`/`test` to iterate while
  wiring capabilities in Step 7, and blocking them there is the exact footgun
  that surfaced. Un-gating with a hint serves both.
- **Detect a pre-existing agent file by "fresh install ⇒ any agent file is the
  user's".** Rejected in favour of the generated-file sentinel: the sentinel is
  uniform across fresh installs and `--force` re-runs (it never re-migrates
  discern's own output) and degrades safely — an unrecognised file is treated as
  the user's and preserved.
- **Soften the `_adr/` reference too, like `_internal/`.** Rejected: the design
  principles name "write an ADR" as their override mechanism, so the ADR format
  and template should exist from the first commit, not only after the `write-adr`
  skill is first run.
- **Flip `AGENTS.md` to tracked.** Rejected here: it would reverse ADR 0034 and
  change the shipped gitignore for every project. The contradiction is settled in
  favour of the existing decision; revisiting 0034 is a separate question.
