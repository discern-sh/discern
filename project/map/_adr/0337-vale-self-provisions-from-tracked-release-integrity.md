# ADR 0337: Vale self-provisions from tracked release integrity

**Status**: accepted. Extends the versioned prose instrument in [ADR 0231](0231-prose-density-shares-one-versioned-corpus.md) and uses the repository lifetime established by [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md).

## Context

The prose standard pins Vale 3.15.2 because its alert count is a comparative measurement. The wrapper checked that pin but launched `vale` from `PATH`. A Homebrew upgrade replaced the local executable with 3.18.0, so the wrapper correctly refused and exposed the missing installer. Hosted lanes instead repeated versioned downloads without verifying their content.

Using the newer binary is not harmless: Vale 3.17 changed which scoped and inline rules fire, altering this repository's alert count without a prose change. The binary's version and bytes therefore need tracked authorities across macOS, Linux, and Linux inside Windows Subsystem for Linux.

Per-worktree caches duplicate immutable bytes; a user cache crosses repository ownership. Git's common administration directory already provides the required shared repository lifetime.

## Decision

`.vale-version` remains the sole version authority. `.vale-assets.json` maps each native release platform to its asset suffix and SHA-256 checksum without repeating the version. The platform set is coupled to the native build-target registry.

`deno task vale:sync` is the only provisioning path. It derives the release URL, verifies the archive before extracting `vale`, checks its reported version, and records its installed digest. It publishes under the content-addressed project-development cache `discern-development/toolchains/` in the Git common directory. A per-content lock converges concurrent setup; invalid cache state is repaired from verified bytes.

Prose callers validate that cache's marker, digest, and version; they never resolve Vale from `PATH`. `[repository].ensure` and every hosted Gate or Standards lane call the same task. Homebrew and hosted system directories do not install Vale. Native Windows remains unsupported; WSL resolves the Linux asset.

Guards reject raw provisioning and require one pinned setup per hosted measurement. Tests exercise a newer fake Vale on `PATH`, corrupt cache state, concurrent installers, and a bad archive checksum.

## Consequences

Homebrew upgrades no longer affect the prose instrument. Local setup and CI execute the same verified bytes without `sudo`; worktrees reuse the first download.

First provisioning needs GitHub release access and POSIX `tar`. A checksum error fails closed, including a version change without matching asset metadata.

Different pins can coexist, but old binaries remain until explicit cache cleanup. Each entry contains only the executable and marker, so no eager pruning is added.

## Alternatives considered

- **Keep using Homebrew and teach maintainers to pin or downgrade.** Rejected because the formula is an ambient, mutable authority and hosted Linux and WSL still need a separate path.
- **Accept any installed Vale whose output currently passes.** Rejected because version changes alter the measured alert population and invalidate comparison with the recorded standard.
- **Vendor Vale binaries in Git.** Rejected because four large third-party executables would enter repository history when immutable release assets already provide a verifiable distribution surface.
- **Cache under each worktree or in a user-global directory.** Rejected respectively because identical downloads multiply across the fleet, or because ownership crosses repository boundaries. Git common state gives the required sharing and cleanup boundary.
