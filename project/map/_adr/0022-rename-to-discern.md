# ADR 0022: Rename the harness to discern

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`, `finish` → `done`; the decision and
> reasoning are unchanged.

> **Project Script vocabulary amendment
> ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** The
> older Recipe reference below describes the then-current command
> implementation; the naming decision is unchanged.

**Status**: accepted

## Context

The harness shipped under a working title that its own surface flagged as
provisional: the README carried a "working name … pending a final name"
blockquote, the glossary defined the core noun as "a working placeholder pending
a final one," and both [ADR 0014](0014-versioned-migration-system.md) and
[ADR 0019](0019-single-binary-ts-engine.md) named "the eventual kit rename" as
planned-but-deferred work. The name was always meant to be replaced before a
public launch; only the choice of replacement was still open.

The project is pre-release: one self-hosting consumer (this repo), no published
binaries, no external installs. As
[ADR 0009](0009-one-point-zero-drop-backward-compat.md) and
[ADR 0014](0014-versioned-migration-system.md) both argued about earlier
breaking changes, this is the cheapest the cost of a rename will ever be — there
is no installed base whose config files, environment variables, or muscle memory
a rename would disturb.

## Decision

**Adopt `discern` as the harness's final public name, and apply it as a hard
rename with no back-compatibility shim.**

- **One name, everywhere.** The CLI verb is `discern` (`discern done` reads as
  an instruction); the root config is `discern.toml`; the recipe and worktree
  environment is `DISCERN_*` (including the `DISCERN_METRIC` protocol token);
  the release assets, installer, config schema, docs, ADRs, bundled guidance,
  and bundled skills all carry the new name. The project homepage is
  **discern.sh**.
- **Hard rename, no shim.** The binary recognises only `discern.toml` and
  `DISCERN_*`; it does not also read the old spellings as a fallback. A shim was
  rejected: with no installed base it would be permanent complexity guarding a
  population that does not exist, and giving every name two spellings is exactly
  the debt the single-source-of-truth discipline exists to prevent.
- **Clean slate in the tree; history is the record.** Every occurrence of the
  prior working title is removed from the tracked tree — code, config, the
  config schema, docs, ADRs, templates, and skills — verified by a `git grep`
  sweep that lands at zero. The prior name is deliberately not repeated even
  here; it survives in version-control history (the rename commit and everything
  before it) for anyone who needs the provenance.
- **The working-copy folder and the GitHub slug are handled out of band.** The
  on-disk repository directory is left as-is — a run-from-source launcher points
  at it by absolute path — and the GitHub remote rename to `jackwh/discern` is a
  manual step the maintainer performs separately. Only the in-tree references to
  the slug are updated here.

Why `discern`: it reads as an instruction at the command line, has no
same-category tool collision, is claimable on Homebrew core, carries a
"discerning developer" brand, and its `discern.sh` domain is registrable.

## Consequences

- The "working name" hedges are gone. The README and glossary no longer call the
  name provisional, and the forward-looking notes in
  [ADR 0014](0014-versioned-migration-system.md) and
  [ADR 0019](0019-single-binary-ts-engine.md) — which anticipated this rename —
  now point here, where it is recorded.
- No migration step ships for the rename. The
  [migration chain](0014-versioned-migration-system.md) exists to carry
  _installed_ projects across breaking changes; with no installs to carry, this
  is a source change rather than a schema migration, and the schema version is
  unchanged.
- Commit history still contains the old name. This is accepted: history is the
  provenance record, and rewriting it is neither necessary nor desirable.
- Anything outside this repository that referenced the old name — the GitHub
  remote, external links, bookmarks — breaks when the remote is renamed. That is
  inherent to any rename and is cheapest to absorb now, pre-release.

## Alternatives considered

- **A back-compatibility shim** — having the binary also accept the previous
  config filename and environment-variable names as fallbacks. Rejected:
  pre-release there is no population to support, and a permanent alias for every
  name is precisely the dual-spelling debt the project's single-source-of-truth
  discipline exists to avoid.
- **Keep the old name in the historical ADRs as the on-the-record name.**
  Rejected: the brief was written fresh, with no occurrence of the prior title
  anywhere in the tracked tree. Git history preserves the provenance, so the
  former name stays recoverable without keeping it in the docs.
- **Defer the rename until just before launch.** Rejected: the cost only rises
  as the install base grows from zero, and the provisional name was already
  leaking into every doc and decision record. Doing it now, pre-release, is the
  cleanest moment.
