# ADR 0335: Operation policy enrolls faithful previews

**Status**: accepted. Extends the plan/apply execution model in [ADR 0027](0027-plan-apply-engine-execution.md) and activates the preview policy recorded by [ADR 0330](0330-every-command-path-declares-its-operation-effects.md).

## Context

discern's plan/apply guard proved a strong contract once a command registered `--dry-run`: the preview changed no compared project or Git-admin state, and apply reported no discern-owned operation absent from the plan. The enrollment trigger was the flag itself. A new writer could omit the flag and remain outside the class.

[`OPERATION_EFFECTS`](../../../src/shared/operation_effects.ts) already classifies every live command path and assigns its preview obligation. That policy could close the reverse hole, provided the command tree was checked against it rather than treated as the source of intent.

`refresh` exposed the missing behavior. Its tracked-refresh projection described generated files used by status and the Gate, while the command also materialized ignored Skills, reconciled provider integrations, maintained checkout-local Git configuration, and removed stale artifacts. Previewing only the tracked projection would understate the command's effects. A second approximate compiler would risk disagreeing with apply.

Some plans also contain project-authored commands. discern can name the invocation, but cannot predict the internal effects of an arbitrary shell command without running it. The Gate additionally learns new scope and generated-file facts after fixers run, so requiring preview and apply to be byte-identical would either execute effects during preview or reject safe runtime refinement.

## Decision

The `preview` field in `OPERATION_EFFECTS` is the authority for preview enrollment:

- `none` is reserved for observations with no mutation owned by discern;
- `disclose` records a reviewed exemption from the standalone faithful-preview class. The command must name its explicit output, owned boundary, or project or external invocation at the relevant command or containing-plan surface without claiming to predict opaque internals; and
- `required` means the live command path registers `--dry-run` and returns the uniform preview envelope.

The operation-effect class guard holds policy and the built command tree in both directions. Every live path has one policy; every `required` path has the flag; and a flag without compatible required policy also fails. A planted, freshly named writer proves that classification alone enrolls the missing-preview failure.

Each required path has a real fixture. The fixture snapshots the project and Git administration before and after preview, preserving only the existing narrow Git index stat-cache exception and append-only Logbook evidence. Engine-plan members also prove that every applied discern-owned step appears in the plan. Apply may skip work or refine later runtime facts; it may not perform an unlisted effect. A planted escaped effect proves the guard fails in that direction.

`refresh` computes one complete read-only typed plan. It composes the instruction compiler, provider integration overlay, materialized-Skill planner, maintained architecture decision record index, merge attributes, and proof-note transport planner. The plan retains create, update, and removal operations plus bounded planning errors. Human, Markdown, JSON, and Model Context Protocol (MCP) previews project that plan; the executor consumes its retained operations; and status and the Gate derive their tracked-only view from the same authority.

The complete write set and its tracked-convergence projection remain distinct. A byte-identical Agent-file rewrite stays in the executable plan because apply performs it, but it is absent from tracked drift; a changed first-install integration may be exempt from that drift policy while still entering lifecycle apply's changed-file accounting so commands such as `update` leave a clean committed result.

`skills eject`, exposed by the new reverse guard as an existing required member without a flag, follows the same shape. Its prospective authored-Skill overlay plans the copied tree, optional config persistence, and every provider materialization target before apply.

Project-authored jobs, setup, resource, ensure, Project Script, and Standard commands remain a bounded exception. A containing plan names the invocation and its actor; the command's author owns any domain-specific preview and idempotence inside that process. Explicit-output observations such as document export disclose their caller-selected target. `prepare` discloses its fixer and refresh boundary rather than running those effects during a preview. Neither exemption can repaint a mixed path such as `done`, which owns plan-able discern writes, as a pure runner.

## Consequences

A future preview-required writer cannot ship by omitting `--dry-run`. Adding the policy member enrolls both the flag parity check and the faithful-preview fixture table.

`discern refresh --dry-run` and MCP `discern_refresh` with `dry_run: true` show tracked and checkout-local targets, integrations, materialized Skill trees, removals, and planning errors while writing nothing. Applied refresh results report the plan-bound steps they attempted. `skills eject --dry-run` provides the same guarantee for its owned targets.

Dynamic Gate truth is preserved. Preview never runs fixers, tests, Standards, or arbitrary project commands to predict their output; apply may omit or refine planned work as runtime facts change. The permanent prohibition is an applied Discern effect absent from the preview.

The command and result additions are additive. Existing project configuration and stored state need no migration.

## Alternatives considered

Keeping `--dry-run` as the enrollment trigger was rejected because it tests only commands that already chose to participate. Maintaining a second writer list in the parity test was rejected because it would duplicate `OPERATION_EFFECTS` and recreate the same drift under another name.

Reusing only `planTrackedRefresh` was rejected because tracked convergence deliberately excludes ignored materialization and checkout-local integration state. Re-running refresh writers inside a temporary directory was rejected because path- and Git-dependent integration behavior would no longer describe the selected checkout.

Demanding equality between dry-run and apply plans was rejected because it would make the Gate execute effects during preview or freeze facts that legitimately change after fixers. Predicting arbitrary project-command internals was rejected for the same reason and because those effects are outside discern's closed world.
