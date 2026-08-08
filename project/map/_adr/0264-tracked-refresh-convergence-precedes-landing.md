# ADR 0264: Tracked refresh convergence precedes landing

**Status**: accepted; generalizes the currency check from [ADR 0034](0034-agents-md-untracked-currency-check.md), extends the receipt boundary from [ADR 0067](0067-accept-validates-the-landed-tree.md), narrows the post-landing refresh from [ADR 0098](0098-accept-refreshes-the-landing-checkout.md), and extends update regeneration from [ADR 0247](0247-generated-artifacts-regenerate-never-merge.md)

## Context

`discern refresh` maintains more tracked state than compiled Agent files. Its tracked effects include the managed `.gitattributes` block, provider MCP and settings entries, hooks, app worktree configuration, project rules, and the maintained ADR index. Materialized skills and Git-local receipt transport are separate local effects.

The gate checked several of those artifacts independently, but not the complete set. In particular, changing a `[generated]` path changed the expected `.gitattributes` block without making `done` red. A branch could therefore earn a clean gate receipt and land with stale committed attributes. Acceptance then ran the full refresh **after** fast-forwarding the trunk. That repaired the main checkout's bytes but could not put them into the already-validated commit, so it left the trunk checkout dirty. Its tracked-clean baseline was sampled after refresh; because the checkout was already dirty, the later check skipped instead of attributing the mutation.

This was a sequencing defect, not an attributes-only defect. Any tracked writer absent from the pre-landing currency checks could follow the same path. Adding one filename check would preserve the class.

Three constraints bind the repair:

- `done` remains observational for refresh artifacts. It must show the pending effect, not overwrite a hand edit or auto-commit derived output.
- An honored receipt proves the gate that issued it. A newer engine may add a cheap invariant that an older receipt never checked, so acceptance still needs current boundary preconditions.
- Acceptance cannot undo a completed fast-forward when local convergence fails. The safe design must prevent tracked refresh work before that boundary and confine post-landing refresh to local effects.

## Decision

**A branch may earn or use landing proof only when the current read-only tracked-refresh plan is empty.** The plan is the final net set of byte and mode effects an ordinary `discern refresh` would apply to files already tracked by Git.

The plan and apply paths share their transformations:

- Provider MCP, hooks, worktree-app, and project-rules writers run through one ordered reconciler. Live refresh gives it real file effects; the planner gives it an in-memory overlay. Co-owners see earlier proposed writes in either mode.
- Agent files use the same renderer as refresh and include executable-bit drift because refresh normalizes them to `0644`.
- `.gitattributes` uses its existing pure file plan, and the ADR index uses its existing expected-state computation.
- The plan reports final paths, effect kind, and whether bytes or mode change. A malformed or unreadable tracked input is a planning error and fails closed.
- Missing or not-yet-adopted outputs retain the existing policy: status may advise their first materialization, but a new standalone output does not become a convergence failure until the project tracks it. A first discern registration inside a shared MCP file remains setup/refresh work even when that container is tracked. The planner runs the same MCP writer against `HEAD` to distinguish that case from deletion of a committed registration; later in-place drift and deletion are guarded.

The lifecycle binds that one predicate at these points:

1. `status` remains read-only and returns `pending_tracked_refresh` plus any `tracked_refresh_plan_errors`. Focused legacy fields for guidance, hooks, and the ADR index remain compatible projections.
2. `done` evaluates the plan as a fail-fast precondition and again after all gate jobs, immediately before result and receipt construction. A non-empty or unprovable plan fails as `refresh_drift`, names the exact paths, and prescribes `discern refresh` → review → commit → `discern done`.
3. `accept` repeats the current plan before the fast-forward on both paths, including an honored receipt. This preserves old receipts while preventing them from bypassing a newer cheap invariant.
4. After a successful fast-forward, acceptance records tracked cleanliness immediately. It materializes only local/ignored Agent artifacts, then runs repository ensure and smoke. It never invokes a tracked refresh writer in the receiving checkout. Any tracked dirt present immediately after checkout, or introduced later by ensure/smoke, is reported without undoing the landing.
5. `update` remains the effectful convergence boundary inside a worktree. After a real merge it commits every tracked path the live refresh actually changed, not only Agent files, the ADR index, and `.gitattributes`. On an already-up-to-date pass it does not create a bookkeeping commit: it reports the exact refreshed tracked paths and leaves them for review and an intentional commit.

The explicit noes: `done` does not run or commit refresh; `accept` does not repair tracked artifacts after landing; the gate does not infer currency from a hand-maintained filename list; provider files are not wholesale-generated or allowed to discard user-owned keys; and this decision does not try to police external `.gitattributes` rules outside discern's managed block.

## Consequences

- A green `done` result has a concrete convergence meaning: rerunning refresh cannot change a tracked artifact. A clean green run can therefore stamp a receipt without hiding derived work.
- The original relocation case now fails before the expensive gate and names `.gitattributes`. Running refresh in the worktree produces the reviewable diff that belongs in the branch commit.
- Old receipts remain useful. Acceptance still skips the expensive gate, but current cheap invariants can refuse them non-destructively.
- Post-landing refresh can no longer dirty the trunk with a tracked file. The main checkout still gets its checkout-local skills, and repository ensure/smoke retain their fail-open-after-landing behavior.
- Update's regeneration commit is slightly broader but safer: enrollment comes from paths the shared live reconciler actually changed after a clean merge. Shared provider files keep user content through their merge functions before being staged.
- Status and `done` pay for a read-only provider reconciliation. The work is file reads and in-memory transforms, substantially cheaper than any declared gate job, but it is more work than the old collection of partial checks.
- First-materialization policy remains asymmetric by design. A missing artifact that has not yet been adopted is advisory; malformed tracked input and drift in an adopted tracked artifact block.

## Alternatives considered

- **Add `.gitattributes` to the existing gate checks.** Rejected because MCP settings, worktree-app config, project rules, and the next tracked refresh writer would retain the same hole.
- **Run full refresh inside `done`.** Rejected because a gate would erase or rewrite evidence before the agent reviewed it, and a mutating check cannot prove the committed tree without another commit-and-gate lap.
- **Keep full post-landing refresh and auto-commit its changes on trunk.** Rejected because acceptance would land a commit the gate never validated, then manufacture a second commit nobody reviewed. It also races other work landing on the shared trunk.
- **Trust any honored receipt without a current preflight.** Rejected because receipts deliberately survive engine upgrades; making their meaning depend forever on the issuing binary would strand every newly added cheap safety invariant.
- **Never write tracked refresh output during update.** Rejected because update is already the explicit merge-and-converge operation. Regenerating after composition and committing those derived paths is what makes the merged branch the tree the next `done` validates.
