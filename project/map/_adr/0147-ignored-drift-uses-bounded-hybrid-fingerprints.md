# ADR 0147: Ignored-file drift uses bounded hybrid fingerprints

**Status**: accepted

## Context

Acceptance warns before removing a worktree when ignored files differ from its setup baseline. The first implementation collapsed ignored paths to top-level directories before hashing every file beneath them. A nested ignored build output could therefore read unrelated tracked files. One observed `app/` label expanded to about 1.7 GB and 40,000 files. The desk can pay the cost twice because it plans again after confirmation.

Exact Git paths remove unrelated files, but build directories can still be enormous. Metadata avoids byte cost but treats identical rebuilt trees as changed when timestamps or file identities differ. This best-effort data-loss warning is not an integrity proof, so it needs a deliberate bound.

## Decision

Ignored-file baselines keep the exact roots reported by Git. Every root receives a metadata fingerprint from its relative paths, kinds, sizes, modification timestamps, file identities, and symlink targets. One aggregate budget of 16 MiB and 2,048 entries upgrades eligible roots to content fingerprints, prioritising standalone files and then smaller directories. Inspection honours the baseline's chosen mode. A root cannot become an unbounded content scan merely because it grew later.

The scanner compares baseline and current roots as a union, so additions, changes, and removals all count. Only the changed exact labels collapse to their top-level directory for the human report. Setup reuses valid baselines before any filesystem snapshot runs. The new version replaces an older or invalid baseline on the next worktree setup.

There is no attempt to make oversize metadata-only roots byte-exact. Reusing a desk preview after a confirmation prompt is also rejected: acceptance still rechecks current state, but the bounded scan makes that safety affordable.

## Consequences

- The 16 MiB and 2,048-entry budgets bound content I/O independently of repository size. Large ignored trees still cost one metadata walk proportional to their entry count.
- Small ignored files and generated trees retain content-sensitive, low-noise comparison within the shared budget.
- The advisory can miss a same-size edit inside a metadata-only tree when its modification timestamp and file identity are also preserved. This is the accepted limit.
- Deleted ignored roots now report as drift, and a repeated setup no longer performs a snapshot it will discard.
- Presentation remains compact (`app/`, not every nested member) without making the presentation label the inspection boundary.

## Alternatives considered

Hashing only the exact ignored roots still makes a dependency cache or build tree scale with total bytes. Pure metadata makes identical rebuilding noisy. Project-specific exclusions require every stack to classify disposable outputs correctly and leave the generic default unsafe when it does not.
