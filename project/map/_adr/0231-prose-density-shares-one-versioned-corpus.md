# ADR 0231: Prose density shares one versioned corpus

**Status**: accepted; extends [ADR 0057](0057-rate-standards.md)

## Context

The prose standard divided Vale's alert count by a built-in word count over the whole map. Its numerator and denominator did not describe the same corpus: the Vale staging layer blanked frontmatter and excluded every `_private` subtree, while the denominator counted both. A private planning archive could therefore change the reported density even though Vale inspected none of it. The mismatch surfaced when a private idea note woke the measurement: 136,516 words that carried no prose contract were silently diluting the rate.

The measuring instrument was also incomplete. CI pinned Vale's binary in workflow YAML, local runs used whichever binary Homebrew supplied, and `vale sync` resolved two package names to their latest releases. A package release could change the alert count on an unchanged corpus. Because the synced packages are ignored, neither Git nor the standard's declared inputs could identify which rules produced a recorded value.

Correcting the corpus raises the displayed rate from a ceiling of 10.95 to a measured 15.59 alerts per 1,000 linted words. The prose did not regress; the unit lost words that had never belonged in it. The owner sanctions that one-time correction under the exception for a mis-measured standard. The ceiling falls from the corrected value hereafter.

## Decision

The prose measurement emits both `prose` and `prose_words` from one staged corpus. The staging layer counts lexical words in the exact text Vale receives, after frontmatter is blanked and every `_private` subtree is excluded. `[standards.prose].per` names `prose_words`; it no longer asks the engine to derive a second corpus from a path glob.

The linting boundary does not otherwise change. The gate and standard continue to inspect the whole map except `_private`, including internal material and decision records under their configured styles.

Vale's binary version lives in `.vale-version`. CI reads that file, and one process wrapper rejects a different local version before linting. `.vale.ini` names immutable release archives for both style packages instead of floating package names. Tests enrol every authored Deno caller in the wrapper and hold both tracked pins.

The corrected ceiling is 15.59 alerts per 1,000 linted words, the measured 4,863 alerts over 312,085 words with the tracked toolchain and this record included. This is a unit correction, not headroom.

## Consequences

- Frontmatter and private notes affect neither side of the prose-density ratio. Adding, archiving, or expanding `_private` material cannot improve or breach the standard.
- A new `_private` subtree at any depth inherits the exclusion automatically.
- Vale measurements are comparable across local runs and CI. Upgrading the binary or a style package becomes an explicit repository change that remeasures the standard in daylight.
- The package archives remain ignored build material; the tracked URLs, not vendored rule files, are authoritative.
- A machine with the wrong Vale binary now gets one actionable version error before a misleading measurement.

## Alternatives considered

- **Keep the engine-derived word pathspec and add exclusions.** Rejected: it would leave two independently implemented corpus projections. The next metadata or audience rule could drift in only one again.
- **Limit the standard to the published manual.** Rejected: `_private` is the only map tier with no prose contract. Internal material and decision records still receive the configured Vale pass, so they stay in the density standard.
- **Commit the synced packages.** Rejected: immutable release URLs make the inputs reproducible without adding third-party rule trees to the repository.
