# ADR 0278: WSL support is proven by a hosted WSL 2 gate lane that publication requires

**Status**: accepted

## Context

discern ships macOS and Linux binaries only. The platforms reference tells Windows users to run the Linux binary inside Windows Subsystem for Linux 2 (WSL 2), and the engine leans on POSIX facilities (`sh -c` jobs, `cksum`, git worktrees) that a native Windows port would have to re-prove one by one. Before launch, nothing exercised that documented Windows path: development happens on macOS, routine CI runs on Ubuntu, and the macOS gate repeats at release — so the one platform story resting purely on a claim was the Windows one.

GitHub's hosted Windows runners have carried nested virtualization since their 2024 hardware refresh, which lets a hosted job provision WSL 2, but GitHub labels nested virtualization experimental and offers no support commitment. A WSL 2 environment also differs from the Windows-side checkout in exactly the ways that can hide or invent failures: the runner checks out onto NTFS with Windows line endings and file modes, reachable from WSL only through the slow 9P bridge, while a real WSL user clones straight onto the Linux file system.

## Decision

A `wsl-gate` composite action proves the documented Windows path on every release. It provisions WSL 2 Ubuntu on a hosted `windows-2025` runner, copies only `.git` from the Windows checkout onto the WSL ext4 file system, lets git materialize the working tree there (LF, native modes — the tree a WSL user's clone gets), installs Deno with the official installer script the way a WSL user would, installs the pinned Vale, and runs the same `discern done` plus clean-tree assertion the other lanes run. The gate runs as an unprivileged user, not the distribution's root default: root ignores file-permission bits, which silently defuses the suite's permission-sabotage tests, and a real WSL user is unprivileged anyway.

The lane's lifecycle mirrors the macOS gate: routine CI once the repository is public, repeated at release. Because Windows has no build row for the gate to ride — WSL users download the Linux binary — the release workflow runs it as a standalone job and the publish job requires it.

Explicitly not chosen: no native Windows release or port, no self-hosted Windows runner, no WSL 1, and no running the gate on the Windows-side checkout through `/mnt/c`. A `workflow_dispatch` trigger runs the lane on demand while the repository is private.

## Consequences

- The "run the Linux binary inside WSL" claim is machine-verified before every publication; a POSIX assumption that WSL breaks surfaces as a failed release gate, not a user report.
- Publication now depends on a runner feature GitHub calls experimental. A runner-image regression can block a release with no repository defect; the remedy is a re-run, and if the image breaks durably, consciously dropping the requirement is an owner decision.
- The lane pays for fidelity with speed: Windows runner minutes bill at 2x, and the toolchain installs cold inside the WSL VM on every run. A 45-minute timeout bounds a hung provisioning step.

## Alternatives considered

- **A native Windows port** — forecloses nothing by its absence and would demand re-proving every POSIX assumption; no demand evidence justifies that surface today.
- **A self-hosted Windows runner** — a real, supported WSL machine, but standing infrastructure to patch and a trust boundary to defend once the repository is public.
- **Running the gate on `/mnt/c`** — avoids the copy step but measures the 9P bridge and NTFS semantics users are steered away from, so it would be slower and prove the wrong environment.
- **WSL 1** — officially supported on hosted runners but a syscall-translation layer, not the Linux kernel WSL users get by default.
