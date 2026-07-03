# ADR 0091: Rescue generated content before overwrite

**Status**: accepted

Builds on [ADR 0034](0034-agents-md-untracked-currency-check.md), which makes
the agent files untracked build artifacts;
[ADR 0065](0065-setup-keeps-its-promises.md), which adopts pre-existing
setup-time guidance before the first compile; and
[ADR 0087](0087-prefix-and-expand-bundled-skills.md), which shrinks but cannot
eliminate skill-name collisions.

## Context

`discern refresh`, `discern integrate`, `discern upgrade`, and worktree setup
all route through the same artifact rewrite path: render guidance into provider
agent files and materialize skills into provider skills directories. Those
outputs are intentionally gitignored build artifacts (ADR 0034), so a direct
edit to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/skills/`, or
`.agents/skills/` has no git history to recover from if discern overwrites it.

That is not theoretical. Claude Code's memory shortcut appends to `CLAUDE.md`,
and coding agents commonly edit the instruction file they are reading. Users can
also drop authored skills into `.claude/skills/`, which is the same directory
discern materializes bundled skills into. ADR 0065 protects the first setup run
by adopting pre-existing agent files into `guidance.md`, but after setup the
compiler still overwrote generated files unconditionally, and skills
materialization recursively deleted a directory whose name matched a managed
skill before recreating it.

The safety fix has three product constraints:

- A routine source or template edit must not produce rescue noise for every
  generated file. Most divergence is legitimate: the render changed.
- Generated output must not be re-imported into `guidance.md`. That would mix a
  stale render back into the source of truth and recreate the setup-side
  pollution failure ADR 0065 avoided.
- Rescues must be discoverable without making every refresh dirty the git tree.
  A dirty marker file would force attention, but it would also block the same
  `finish`/`integrate`/`graduate` workflow users are trying to complete.

## Decision

**Artifact rewrite rescues user content into an ignored, non-agent-loaded
directory before overwriting; it uses local baselines to keep normal source
changes quiet.**

1. **Guidance writes are baseline-aware.** After a successful write,
   `compileGuidelines` records the rendered bytes it just emitted in local
   baseline metadata under `.discern-rescue/`. Before a later write, it compares
   three things: the on-disk file, the previous rendered baseline, and the new
   render. Missing files and byte-identical files write as before. A file that
   equals the previous baseline while the new render differs is treated as a
   normal source/template change and is overwritten without rescue noise. A file
   that differs from the previous baseline, or has no baseline yet, is scanned
   for on-disk hunks that the new render does not carry; only those hunks are
   written to `.discern-rescue/generated/<file>.rescued.md` before the generated
   file is overwritten.

2. **Rescue is a side path, not an import.** The compiler never edits
   `guidance.md` from generated output. A rescue file explains that durable
   guidance belongs in `guidance.md`, leaving the user or agent to intentionally
   fold in the real instruction and discard stale generated context.

3. **Managed skill-name collisions move aside.** Materialization records a
   fingerprint for each skill entry it writes. On the next run, it may delete or
   replace only an entry whose fingerprint proves it is still discern's own
   materialization. A managed-name entry with different or unknown content is
   renamed into `.discern-rescue/skills/<skills-dir>/<name>` and the managed
   skill is recreated. A later run sees the recreated managed skill in place, so
   rescues do not stack.

4. **Discovery is through the result envelope and `status`.** Mutating verbs
   that call the compiler surface rescue hints in their result, and
   `discern status` lists rescue artifacts until they are handled. The hint
   tells the user where the content went and where durable content belongs:
   `guidance.md` for guidance and `[skills].dir` for authored skills.

5. **The rescue store is ignored.** `.discern-rescue/` is added to the shipped
   `.gitignore` fragment and to discern's own ignore file. It is local recovery
   state, not part of the tracked project footprint and not an agent instruction
   location.

The explicit no: discern does not create a marker file that is visible to git.
The status hint is the durable attention mechanism; git dirtiness remains
reserved for tracked project work or local files the project deliberately leaves
visible.

## Consequences

- A user or agent who put a memory in `CLAUDE.md` before `discern integrate`
  still has that memory after the merge-triggered refresh. The generated file is
  current again, and `discern status` points at the rescued content until it is
  reconciled.
- Routine guidance edits stay quiet after the first baseline is recorded. The
  compiler can tell "the source changed" from "the generated file was edited"
  without tracking the generated files in git.
- The first run on an install that predates the baseline metadata is
  conservative. If an on-disk generated file diverges from the new render and no
  baseline exists, discern rescues the hunks absent from the new render rather
  than risking deletion. That can include stale generated text in rare upgrade
  cases, but it preserves the user's untracked content and keeps the rescue
  review local and explicit.
- Skill cleanup remains self-healing for entries discern can prove it owns, but
  an ambiguous or edited entry is moved aside. This trades a small amount of
  ignored local residue for never deleting a user's authored skill directory.
- The one-root `discern.toml` footprint remains intact. `.discern-rescue/` is
  ignored recovery/cache state like materialized agent files, not configuration
  or source.

## Alternatives considered

- **Dirty the tree with a marker file.** Rejected after discussion: it would be
  obvious, but it would also make `finish`, `integrate`, and `graduate` fail
  until the marker was staged or deleted. The product signal belongs in
  discern's own result/status surface.
- **Automatically import rescued text into `guidance.md`.** Rejected: generated
  files contain built-in guidance plus rendered source. Importing from them
  would pollute the source with stale generated output and make future compiles
  worse.
- **Keep deleting managed skill-name collisions.** Rejected: ADR 0087's
  `discern-` prefix lowers accidental collisions but does not make a colliding
  directory safe to delete. The provider skills directory is also a legitimate
  user-authored location.
- **Track the generated files in git.** Rejected by ADR 0034. The source remains
  `guidance.md` and config; generated files stay build artifacts guarded by
  currency checks and now by rescue-on-overwrite.
