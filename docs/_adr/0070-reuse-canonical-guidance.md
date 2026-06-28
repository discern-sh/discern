# ADR 0070: An agent that reads the canonical AGENTS.md is modelled as "reuse-canonical", emitting nothing

**Status**: accepted; extends
[ADR 0034](0034-agents-md-untracked-currency-check.md) (the one-canonical-file
model) and [ADR 0043](0043-registry-derived-agent-parity.md) (registry-derived
aggregators)

## Context

discern compiles one canonical agent file — `AGENTS.md` (codex) — that holds the
full guidance body, and emits each other configured agent's file as a
`@AGENTS.md` **pointer** (Claude Code's `CLAUDE.md`, Gemini's `GEMINI.md`), so
the body lives in exactly one place and the mirrors can't drift (ADR 0034/0043).

The next agents discern will model — Cursor, Copilot, Google Antigravity —
change the shape of the problem: each reads the canonical `AGENTS.md`
**natively**, with no file of its own. So for those agents discern should emit
_nothing_: not a duplicate body, not even a pointer. The registry had no way to
say that. Every `Provider` carried a `guidanceFile` discern _writes_; the only
states were "canonical full body" and "pointer mirror".

The naïve workaround — point a second provider's `guidanceFile.path` at
`AGENTS.md` — is a trap. The aggregators (`allGuidanceFilePaths`,
`agentArtifactPaths`) and the writer all iterate the configured providers; a
second provider whose `path` is `AGENTS.md` would leak a duplicate `AGENTS.md`
into the gitignore/neutral-scope sets and make the writer emit the file two or
three times. The duplicate is silent and exactly the kind of drift the
single-source policy forbids.

## Decision

**A provider that reads the canonical file natively is modelled explicitly as
`guidanceFile.reuseCanonical = true`, and every emit site and aggregator gates
on a single predicate so the file is produced and counted exactly once.**

- `GuidanceFile` gains `reuseCanonical?: boolean`. Its `path` names the
  canonical file it _reads_ (`AGENTS.md`), but it is mutually exclusive with
  `canonical` and `pointer`: discern writes nothing for it.
- `emitsGuidanceFile(gf)` is the ONE predicate ("does discern write a file for
  this entry?"), false only for a reuse-canonical entry. Every consumer gates on
  it:
  - `emittedGuidancePaths(files)` — the shared core behind
    `allGuidanceFilePaths()` — skips reuse-canonical entries and collapses
    duplicate paths, so `AGENTS.md` appears once;
  - `renderAgentFiles`'s pure core `agentFileContents(files, body)` skips them,
    so the content map has no entry for them (a Map keyed by path also can't
    hold a path twice);
  - the writer (`compileGuidelines`) skips them and deduplicates writes by path.
- The gitignore/neutral-scope satellites read the deduped aggregators, so a
  reuse-canonical provider's read path stays covered (the canonical provider
  contributes it) without a second rule.

The explicit *no*s:

- **No re-aiming a second `path` at `AGENTS.md` without the flag.** That is the
  trap above; the flag + the `emitsGuidanceFile` gate is what prevents the leak.
- **Exactly one provider stays `canonical`.** A parity guard asserts it, and
  that a reuse-canonical provider's `path` equals that one canonical path (it
  genuinely reuses the canonical, not an arbitrary file).
- **No vendor is added here.** This phase builds the model and proves it with a
  synthetic reuse-canonical provider in tests; Cursor/Copilot/Antigravity adopt
  it in later plans by setting one flag.

## Consequences

- **Adding a canonical-reading agent is one flag.** `reuseCanonical: true` (plus
  the registry entry) wires it end-to-end: it gets the shared skills dir and the
  guidance it reads (`AGENTS.md`), and discern writes nothing redundant.
- **The duplicate-`AGENTS.md` failure mode is structurally impossible.** The
  single `emitsGuidanceFile` gate and the path-keyed content map mean a
  reuse-canonical provider cannot leak a second write or a second aggregator
  entry — and a parity guard fails the build if the canonical invariant is ever
  broken.
- **The pure cores are testable without an install.** `emittedGuidancePaths` and
  `agentFileContents` take the guidance entries as input, so a synthetic
  reuse-canonical set proves "no duplicate write, correct aggregator output,
  gitignore coverage" directly.
- **A reuse-canonical agent depends on the canonical being configured.** If only
  a reuse-canonical agent is configured and codex is not, no `AGENTS.md` is
  emitted and it has nothing to read. Acceptable now (codex is in
  `DEFAULT_AGENTS`, and the later vendor plans pair the two); a future plan may
  emit the canonical whenever a reuse-canonical agent is present.

## Alternatives considered

- **Make `guidanceFile` optional (absent ⇒ reads the canonical).** Rejected:
  `guidanceFile.path` is read across the renderer, the writer, doctor, the init
  prompt, and the aggregators; making it optional scatters `?.`-guards
  everywhere for a state better expressed as one flag on the existing shape
  (mirroring how `canonical`/`pointer?` are already modelled there).
- **A distinct `GuidanceFile` union variant with no `path`.** Cleaner in the
  abstract, but the same wide `.path` read-surface would need a discriminant
  check at every site; a boolean flag plus one shared predicate is the lighter
  tie.
- **Let a reuse-canonical provider point at `AGENTS.md` and dedupe downstream
  only.** Rejected: the dedup would have to be re-implemented in each aggregator
  and the writer, and forgetting one reintroduces the silent duplicate. The
  single `emitsGuidanceFile` gate is the one place the decision lives.
