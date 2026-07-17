# ADR 0014: A versioned, reversible migration system for upgrades

> **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** The older Recipe references below describe the then-current command and install surfaces. Project-owned executables are now Project Scripts under `discern script`; the migration-system decision is unchanged.

**Status**: accepted

## Context

discern has two ways to push a change into an installed project:

- **`upgrade`** refreshes _managed_ files. It walks the new `templates/` tree and, per file, compares three hashes — the on-disk bytes, the kit's new bytes, and the manifest's recorded hash — to decide skip / overwrite / preserve-as-`.new`. Seed files are never touched.
- **`upgrade`** (ADR 0009) rewrites a project's `discern.toml` from the 0.x shape to 1.0. Its rules are hardcoded to that one jump, and it detects whether it applies by sniffing the file's content.

This pairing carries every 1.0 install correctly, but it was built for two narrow jobs: _content edits to managed files_ and _one known config jump_. The larger, structural changes now planned — renaming or splitting engine recipes, reorganising the docs tree, evolving the `discern.toml` shape again, and eventually renaming the kit itself (its name and the `bin/agent`/`.discern/` layout are still provisional) — hit limits that are structural, not incidental:

- **`upgrade` cannot remove or rename.** It only ever writes files present in the _new_ templates; a managed file dropped from templates is left on every consumer's disk forever. Renaming, splitting, or deleting a recipe or skill is therefore unsafe — consumers silently accumulate orphans.
- **Seed files cannot evolve structurally.** Upgrade skips them; only `discern.toml` has any evolution path, through the bespoke `upgrade`. A change to the docs tree, the guidelines format, the `.claude` hooks, or the config shape beyond that one jump cannot reach an existing install.
- **Migration is a one-shot, not a sequence.** The install records no schema version, so there is nowhere to step _from_. A second migration would mean more content-sniffing, with no record of where any given install actually sits.
- **The two mechanisms are uncoupled and order-dependent.** A user can refresh the engine and forget to migrate the config; 0009 could only paper over this with an advisory nudge.
- **Apply is not transactional.** Files are written one by one with no staging or rollback, and the manifest is rewritten only on success — so a failure mid-apply can leave a half-upgraded engine that breaks `bin/agent` itself.

The project is still pre-adoption: one internal consumer, no public release. As ADR 0009 argued for the config shape, this is the cheapest the cost will ever be. The machinery to make large upgrades safe is far better built **before** the first large upgrade than reconstructed around a botched one afterwards.

## Decision

Adopt a **versioned, reversible migration system** layered above the existing file sync. The managed/seed classification, the per-file hash model, and the `.new` preservation rule are kept unchanged. What is added is a version anchor, an ordered migration runner, the ability to remove files, and transactional safety.

1. **A schema version anchors every install.** The manifest records a monotonic integer `schema_version`, distinct from `kit_version` (which stays a display/semver field and drives no logic). `setup` stamps the current version; `upgrade` reads the recorded one, brings the install forward, and re-stamps. This generalises the precedent already set by `CONFIG_DOC_VERSION`, which versions the config _document_ and refuses an unknown major.

2. **Migrations are an ordered chain, not a one-shot.** Each migration is a small, idempotent step (`from → to`) that describes and applies its change. `upgrade` computes the delta between the install's `schema_version` and the kit's current version and runs the intervening steps in order. A step may edit `discern.toml` (via the existing comment-preserving editor), **delete or rename managed _and_ seed files**, rewrite content inside user-owned files, and merge `.claude/settings.json`. This is where renames, tree reorganisations, and the eventual kit rename live. The bespoke 0.x→1.0 `upgrade` is **retired, not ported**: the current shape is declared schema v1 and the chain starts clean (the sole pre-adoption consumer is migrated by hand once).

3. **`upgrade` reconciles orphans.** Independently of the chain diffs the manifest's recorded managed paths against the new templates and removes any that vanished — but only when the on-disk copy is _pristine_ (matches the recorded hash); an edited orphan is left in place with a warning. The manifest already carries the prior path list, so this needs no new state. Orphan removal handles _deletions_; a rename that must carry user edits forward is an explicit migration step, never delete-then-recreate.

4. **`upgrade` is transactional, git-first.** It refuses to run against a dirty working tree unless `--allow-dirty`, so any failed or regretted upgrade is recoverable with `git checkout`; consumers are git repositories and this matches the worktree-native philosophy. It validates the result (a dry parse / `doctor` pass) before stamping the new `schema_version`, and the manifest is written last, only on full success. A staged-write-and-swap apply is later hardening, not a v1 requirement.

5. **Migration folds into `upgrade`.** Bringing an install up to date is one command: run pending migrations, then sync files (orphan prune included), then validate and stamp. `upgrade --check` survives for inspection and the `doctor` nudge, but the happy path no longer depends on the user running two commands in the right order.

6. **The lifecycle is tested, not just the transform.** The authority is a fixture-based test over the existing scaffold-and-shell-out harness, asserting the keystone invariant — **"upgrade ≡ fresh init"**: an old install brought forward by `upgrade` matches a fresh `setup` at the same version. Managed files and the schema are byte-identical (proven via the manifest's recorded hashes); a _seed_ a migration transforms converges in **shape**, not byte-for-byte — a comment-preserving config edit need not reproduce the template's exact formatting, and the seed is the user's, not the kit's. Alongside it: idempotency (a second `upgrade` is a no-op), edit-preservation (a hand-edited file still becomes `.new`), orphan removal (pristine removed, edited kept), and per-step composition (`v1→v3 == v1→v2→v3`), all run against a small committed corpus of installs pinned at each past schema version. Because the repo self-hosts, the root install is a live consumer: `selfcheck` is extended so its `schema_version` must be current, exercising the chain on a real install on every gate run.

**Rollout.** Land the foundation first and independently of any content change: the `schema_version` anchor (1), orphan reconciliation (3), the git guard (4), and the convergence harness (6) — at which point `upgrade` is a verified no-op on a current install. The migration runner (2) and its fold into `upgrade` (5) follow. The chain's first real step is a deliberately small smoke test — backfilling `[project].main_branch` (schema 1→2) — which proves the pipeline end-to-end and unlocks the convergence corpus on a real transform. The kit rename lands later as a further step, validated by the same convergence test.

## Consequences

- Large, structural upgrades become safe and reliable: recipes can be renamed or removed, the docs tree and config shape can evolve, and the kit can eventually be renamed — each as a tested migration step rather than a manual cleanup every consumer must perform.
- There is one honest answer to "is this install fully up to date?" — its `schema_version` — and one command that gets it there. The 0009 footgun (engine ahead of config) is closed by construction.
- The cost is a new invariant to uphold: **every change that alters an installed file's path, shape, or required content needs a migration step and a corpus fixture**, and the convergence test must stay green. This is deliberately the same discipline as the `selfcheck` drift gate — it makes "did you ship this to consumers?" a gate failure rather than a later surprise.
- Retiring the 0.x→1.0 `upgrade` rather than porting it means a 0.x `discern.toml` is no longer auto-handled. This is acceptable _only_ because of the pre-adoption window and the one hand-migrated consumer; the same choice would be unacceptable post-release. It revises the migration mechanism recorded in ADR 0009 while leaving the rest of that decision (the 1.0 shape itself) intact.
- `upgrade` refusing a dirty tree is a small new friction for the common "edit and upgrade together" flow, paid down by `--allow-dirty` and by recoverability. Git becomes a hard dependency of the safe-upgrade story (it already is for the worktree workflow).
- A monotonic `schema_version` decoupled from `kit_version` means most releases need no migration and bump nothing. The two version axes must not be conflated, or the runner will run spurious or missing steps.

## Alternatives considered

- **Extend `upgrade` with more hardcoded jumps.** Rejected: without a version anchor on the install, each addition compounds the content-sniffing problem, and there is still no record of where an install sits and no way to remove files.
- **Drive migrations off `kit_version` (semver).** Rejected: not every release migrates and not every migration is a major; coupling the two makes the runner either over- or under-run. A dedicated monotonic integer is unambiguous.
- **Make `upgrade` fully transactional now (staged write + atomic swap, no git dependency).** Deferred: the git-clean guard delivers nearly all the recoverability for almost none of the cost, given consumers are git repos. The staged-swap design is worth doing later, not a prerequisite for the anchor and the chain.
- **Keep `upgrade` and `upgrade` separate, just document the order.** Rejected: the order you must remember is the defect; 0009 already showed the nudge is not enough.
