# ADR 0070: An agent that reads the canonical AGENTS.md is modelled as "reuse-canonical"

**Status**: accepted; extends
[ADR 0034](0034-agents-md-untracked-currency-check.md) (the one-canonical-file
model) and [ADR 0043](0043-registry-derived-agent-parity.md) (registry-derived
aggregators)

## Context

discern compiles one canonical agent file — `AGENTS.md` (codex) — that holds the
full guidance body, and emits each other configured agent's file as a
`@AGENTS.md` **pointer** (Claude Code's `CLAUDE.md`, Gemini's `GEMINI.md`), so
the body lives in exactly one place and the mirrors can't drift (ADR 0034/0043).

Agents such as Cursor and GitHub Copilot change the shape of the problem: each
reads the canonical `AGENTS.md` **natively**, with no file of its own. So for
those agents discern should emit no provider-specific guidance file: not a
duplicate body, not even a pointer. The registry had no way to say that. Every
`Provider` carried a `guidanceFile` discern _writes_; the only states were
"canonical full body" and "pointer mirror".

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
  `canonical` and `pointer`: discern writes no provider-specific file for it. If
  a configured set contains a reuse-canonical provider but no canonical
  provider, the renderer emits that path once as the canonical full-body file.
- `emitsGuidanceFile(gf)` is the ONE predicate ("does this entry write its own
  provider file?"), false only for a reuse-canonical entry. Every consumer gates
  on it:
  - `emittedGuidancePaths(files)` — the shared core behind
    `allGuidanceFilePaths()` — collapses reuse-canonical entries into the
    canonical path when a canonical provider is present, and emits that path
    when no canonical provider is configured, so `AGENTS.md` appears once;
  - `renderAgentFiles`'s pure core `agentFileContents(files, body)` gives that
    synthesized canonical path the full body and points mirrors at it;
  - the writer (`compileGuidelines`) writes the rendered map, so it cannot skip
    a synthesized canonical file by re-checking provider rows.
- The gitignore/neutral-scope satellites read the deduped aggregators, so a
  reuse-canonical provider's read path stays covered (the canonical provider
  contributes it) without a second rule.

The explicit *no*s:

- **No re-aiming a second `path` at `AGENTS.md` without the flag.** That is the
  trap above; the flag + the `emitsGuidanceFile` gate is what prevents the leak.
- **Exactly one provider stays `canonical`.** A parity guard asserts it, and
  that a reuse-canonical provider's `path` equals that one canonical path (it
  genuinely reuses the canonical, not an arbitrary file).
- **No provider-specific duplicate.** Cursor and Copilot can be configured
  without Codex and still get `AGENTS.md`; they still do not get their own
  separate guidance file.

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
- **A reuse-canonical-only set still gets guidance.** If only Cursor or Copilot
  is configured, `AGENTS.md` is emitted with the full compiled body instead of
  silently producing no guidance files.

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
