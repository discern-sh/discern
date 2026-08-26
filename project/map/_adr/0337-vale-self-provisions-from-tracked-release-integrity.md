# ADR 0337: Vale self-provisions from tracked release integrity

**Status**: accepted. Extends the versioned prose instrument in [ADR 0231](0231-prose-density-shares-one-versioned-corpus.md) and uses the repository lifetime established by [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md).

## Context

The prose standard pins Vale 3.15.2 because its alert count is a comparative measurement, not merely a lint opinion. The wrapper checked that pin but still launched `vale` from `PATH`. A Homebrew upgrade replaced the local executable with 3.18.0, so the wrapper correctly refused the measurement and left no repository-owned way to obtain the required version. Hosted lanes had the opposite half of the contract: each downloaded the pinned archive independently, without checking its content, extracted it into a system directory, and repeated its platform-specific URL in workflow text.

Using the newer binary would not be a harmless local convenience. Vale 3.17 changed which scoped and inline rules fire over the existing corpus, materially changing this repository's alert count without a prose change. The exact binary is part of the standard's measuring instrument. Its version and bytes therefore need tracked authorities, while installation must work on macOS, Linux, and Linux inside Windows Subsystem for Linux without depending on a package manager's current formula.

Linked worktrees add a placement trade-off. A cache inside each checkout is isolated but downloads the same immutable bytes for every task. A user-level cache shares bytes across unrelated repositories and makes ownership and cleanup ambiguous. Git's common administration directory already provides a repository lifetime shared by main and every linked worktree.

## Decision

`.vale-version` remains the sole version authority. `.vale-assets.json` maps every native release platform to its Vale release-asset suffix and SHA-256 checksum without repeating the version. The platform set stays coupled to the native build-target registry, so a future supported target must provide its measuring binary too.

`deno task vale:sync` is the only provisioning path. It derives the immutable release URL from the two tracked authorities, verifies the archive before extracting only the `vale` executable, checks the version reported by that executable, and records its installed digest. It publishes under the content-addressed `discern/repository-toolchains/` entry in the Git common directory. A per-content directory lock makes concurrent worktree setup converge; an invalid binary or marker is repaired from verified release bytes.

Authored prose callers resolve that exact cache path and validate its marker, digest, and reported version before execution. They never resolve a same-named binary from `PATH`. `[repository].ensure` and every hosted Gate or Standards lane call the same task. The Homebrew dependency manifest does not install Vale, and hosted lanes do not write it into a system directory. Native Windows remains unsupported; the WSL lane resolves the Linux asset inside WSL.

Structural guards scan executable configuration for raw synchronization, release downloads, version variables, or a Homebrew Vale dependency. A separate automation guard requires one pinned setup for every hosted `done` or `standards` run. Behavioral tests place a deliberately newer fake Vale on `PATH`, corrupt a valid cache, race two installers, and supply a bad archive checksum.

## Consequences

Homebrew upgrades no longer affect the prose instrument, and a machine needs no separately managed Vale installation. Local setup and CI execute the same verified bytes without `sudo`; worktrees reuse the repository cache after the first download.

The first provisioning of a version and platform needs GitHub release access and a POSIX `tar`. A checksum error fails closed. Updating `.vale-version` without the matching asset checksums cannot silently run old metadata against a new release.

Content-addressed placement lets worktrees on different pins coexist, but old pinned binaries remain until `discern uninstall` removes the Git-admin namespace or a maintainer clears the owned cache. Vale releases are infrequent and each cache entry contains only the executable and a small marker, so eager pruning is not added.

## Alternatives considered

- **Keep using Homebrew and teach maintainers to pin or downgrade.** Rejected because the formula is an ambient, mutable authority and hosted Linux and WSL still need a separate path.
- **Accept any installed Vale whose output currently passes.** Rejected because version changes alter the measured alert population and invalidate comparison with the recorded standard.
- **Vendor Vale binaries in Git.** Rejected because four large third-party executables would enter repository history when immutable release assets already provide a verifiable distribution surface.
- **Cache under each worktree or in a user-global directory.** Rejected respectively because identical downloads multiply across the fleet, or because ownership crosses repository boundaries. Git common state gives the required sharing and cleanup boundary.
