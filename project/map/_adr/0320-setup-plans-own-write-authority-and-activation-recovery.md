# ADR 0320: Setup plans own write authority and activation recovery

**Status**: accepted; extends the staged handshake of [ADR 0075](0075-setup-staged-handshake.md), the real-operation preflight of [ADR 0152](0152-slow-workflows-prove-write-authority-first.md), the advisory Logbook boundary of [ADR 0160](0160-local-logbook-advisory-readers.md), and the vendor-security boundary of [ADR 0193](0193-discern-does-not-enforce-the-vendor-security-boundary.md).

## Context

Setup crosses several boundaries that are individually clear but easy for a first-time agent to conflate. Owner consent allows discern to perform a named act. A provider or operating environment decides whether the current process may write ordinary and Git-administration paths. Recorded landing authority may later authorize a fast-forward. The Logbook is advisory metadata. None implies another.

Earlier setup checked its plan read-only and then discovered some denied writes only after checkout, scaffold work, refresh, doctor, Gate jobs, or landing had begun. Gate and Standards already solve the corresponding slow-workflow problem with a tiny real-operation preflight, but their admin-state target registry is not setup's complete effect model. Copying a local path list into each setup command would make every new effect a chance to forget the probe.

Provider activation presented a second composition problem. Setup writes project integration in one session, while Model Context Protocol (MCP), hooks, trust, and instructions commonly load only when another session starts. Generic advice can honestly ask for a restart, but it cannot claim the provider granted authority or infer that the restart worked from generated files. Repeated raw Git and low-level recovery steps also obscure setup's recorded phase after interruption.

Doctor had a related first-run self-reference. It treated the absence of a historical Logbook event as a failed recorder even when the enabled store was valid and simply empty. In a sandbox, an advisory Logbook denial could then turn doctor red and make setup appear blocked by metadata it does not require.

## Decision

**Setup's effect plan is the authority for required write probes, and the provider registry is the authority for post-restart activation recovery. Setup state supplies the bounded continuation between them.**

### Required setup writes

- `SETUP_EFFECT_COMMANDS` owns the effectful boundary: `begin`, `done`, and `accept`. `SETUP_REQUIRED_EFFECT_KINDS` owns effect membership. Every `SetupRequiredEffect` must carry a non-empty tuple of `PlannedWriteTarget`s. `setupPlannedWrites` flattens the invocation's plan; no command maintains a second probe list.
- Each command settles consent and its cheap read-only preconditions, computes its complete discern-owned effect plan, then passes the derived targets to the shared `preflightPlannedWrites` real-operation boundary before its first mutation or slow project command. Declarative answers and selected providers are resolved once; the executor consumes the same resolved value the preflight planned.
- `setup begin` covers its selected scaffold filesystem paths and the branch, index, ref, object, reflog, and commit surfaces its Git plan requires. Denied isolated-branch authority refuses with no checkout or scaffold and never degrades to in-place setup. `--allow-dirty` remains the explicit in-place selection.
- `setup done` covers refresh outputs, completion-config replacement, commit and common Git state, and the throwaway-worktree root before refresh, doctor, Gate, Standards, or worktree viability starts. The embedded Gate still probes the validation state belonging to the checkout in which it runs.
- `setup accept` covers checkout materialization, merge and ref advancement, Proof-note state, and branch deletion after read-only landing preconditions and before checkout changes.
- `setup verify` and every dry run stay strictly read-only and perform no write probe. Probe success is never cached across invocations. A successful probe leaves no temporary entry, does not modify an existing marker, and proves only that the representative writes worked at that point in that invocation. A later denial or partial effect remains ordinary recovery, not contradiction.
- A denial uses the existing `write_access` error and `write-access` diagnostic with the exact path and a retry command preserving the caller-authored selection. The command leaves setup phase state unchanged.
- Advisory Logbook recording never enters a required setup plan. A provider or environment denial for Logbook-only storage warns and disables recording for the current process; it does not gate setup. The same Git area is required only when the selected setup command actually plans a branch, commit, worktree, ref, note, or landing effect.

### Resumable bootstrap and activation

- Setup records its phase and dedicated branch. Bare `discern setup` and `discern status` project the exact current phase and bounded discern command that continues it. Recovery does not instruct an agent to reconstruct discern-owned branch, commit, completion, or landing effects with raw Git.
- Each native provider registry entry owns one exact local activation recovery. `activationCheck` derives whether the check is an MCP status call or the canonical CLI check from the provider's declared integration kind, and supplies `discern status --json` as the CLI fallback.
- `setup done` returns and renders, for each configured provider, `check_kind`, exact `check`, provider-owned `recovery`, and `cli_fallback`. Only the exact check in a fresh session confirms activation. A failed check serves the one local recovery and fallback; generated integration files are not activation evidence.
- Generic setup prose stays provider-neutral. Provider entries may name their real trust, reload, or fresh-session step. If a future provider cannot expose a deterministic local check, its registry contract must represent that state honestly and fall back to CLI rather than infer success.

### Doctor and authorization language

- Doctor validates whether Logbook storage and observation are configured and operable. It distinguishes healthy-but-empty, recording disabled, schema invalid, unwritable, and an event expected but absent. Zero prior events is healthy on a first invocation.
- Environment-refused Logbook storage is warning severity. It names the environmental cause and consequence—recording disabled for this process—and never blocks setup by itself. Invalid schema and an absent event after the canonical observer should have recorded one remain distinct diagnostics.
- Product messages keep four concepts separate: owner consent, provider authorization, discern's recorded landing authority, and point-in-time write authority observed by a preflight. discern may request the provider permission required for its planned command, but cannot grant, persist, or bypass it.

## Consequences

- Predictable setup denials arrive before checkout, scaffold, refresh, doctor, project jobs, Standards, worktree probes, or landing effects, with one copyable retry.
- Future setup effects auto-enroll because construction requires their targets and the parity guard binds every effect kind to an effectful subcommand. An effect without derivable targets cannot be added locally around the boundary.
- Setup write plans remain broader than Gate validation state but reuse the same filesystem operation semantics and structured refusal. Logbook availability remains advisory even when its path happens to share a Git directory with required setup effects.
- An interruption or provider restart has one state-derived continuation. Completed setup phases do not need to be replayed as low-level mutations, though a failure after the first irreversible effect can still require the command's explicit partial-effect recovery.
- Every configured provider auto-enrolls in activation parity. Setup output cannot claim a restart succeeded merely because files were generated.
- The up-front probes add small filesystem and Git-admin operations. They deliberately prefer a few reversible operations to discovering a predictable denial after expensive or partial work.

## Alternatives considered

- **Use Gate's admin-state registry as setup's target list.** Rejected because it covers validation markers, not setup's branch, scaffold, commit, worktree-root, merge, note, and deletion effects.
- **Maintain one probe list per setup command.** Rejected because effect and authority membership would drift; the plan itself must carry the writes.
- **Probe during `setup verify` or cache success.** Rejected because provider authority can differ in the later invocation, and verify's fixed contract is read-only.
- **Make Logbook health a required setup write.** Rejected because recording is advisory and its failure must not acquire enforcement merely by sharing Git storage.
- **Teach generic provider permission steps.** Rejected because generic templates cannot truthfully describe every host's trust or approval mechanism.
- **Infer activation from generated files.** Rejected because configuration can exist while the current provider session has not loaded or trusted it.
- **Recover with raw Git commands.** Rejected for discern-owned effects because setup already has phase state, idempotent commands, and the authority to preserve its dedicated branch and evidence.
