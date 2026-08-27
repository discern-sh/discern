# ADR 0346: Machine facts are typed advisories

**Status**: accepted. Extends the typed config authority from [ADR 0026](0026-typed-config-schema.md), the one-result projection model from [ADR 0028](0028-result-envelope-and-diagnostics.md), provider registry ownership from [ADR 0031](0031-typed-provider-integration.md), and canonical-set parity from [ADR 0051](0051-canonical-set-parity.md).

## Context

Several agent-facing instructions carried machine facts only inside prose or weak metadata. A scope could say it was previewable without naming a command. Provider trust guidance embedded paths, keys, flags, and recovery operations in sentences. Generated hint, tip, and registry inventories had members but did not consistently declare which authority owned their framing.

Those shapes could describe intent, but they could not guarantee an executable next action. A renderer or test either copied the literal again or parsed prose to recover it. A renamed path or future registry member could therefore leave terminal, JSON, Model Context Protocol (MCP), and generated Markdown projections disagreeing.

## Decision

Machine facts in agent-facing advisories live in typed records, and human wording projects from those records.

A scope's optional `preview` field is a command or ordered command list. It replaces the Boolean `previewable` field. Scope classification returns `preview_actions` records containing the scope and expanded command. `impact`, `status`, Gate plans, successful Gate results, terminal output, JSON, Markdown, and MCP consume those records. The Gate reports preview actions but does not execute them. `doctor` checks that each statically named leading executable resolves without running the command.

Provider registry members own `TrustGate` records with explanation prose and typed recovery actions. Each action owns its literal path, configuration key, configuration value, command flag, or environment variable as a typed fact. Setup, doctor, JSON, MCP, and generated integration references use the shared data and rendering projections; they do not extract literals from prose.

[`GENERATED_INVENTORY_POLICIES`](../../../src/shared/generated_inventory_policy.ts) owns framing for the hint inventory, tip inventory, and registry atlas. Each policy names the member-wording authority, renderer, documentation exposure, and guarding tests. Generated-artifact enrollment links an inventory to its framing policy. The canonical-set guard recognizes future inventory artifacts and rejects missing or inconsistent policy enrollment.

The new `preview_actions` and `provider_trust` result fields are additive. The config change is intentionally not inferred or migrated: `previewable = true` does not contain enough information to choose a truthful read-only command. The config schema and `discern config set-scope` reject the retired Boolean form and name `preview` as the replacement.

## Consequences

- Every reported preview has a concrete worktree command, while the result explicitly states that discern did not run it.
- Changing a provider path, key, value, flag, or trust action once updates machine projections and human references together.
- A future generated inventory must declare its wording and framing authority, renderer, documentation exposure, and tests before code generation passes.
- Result consumers that ignore unknown additive fields remain compatible. Projects using `previewable = true` must choose and configure a read-only preview command before their config validates.
- Static executable availability is checkable without performing the preview. Dynamic shell-leading expressions remain advisory because resolving them would require execution.

## Alternatives considered

- **Keep `previewable` and add prose naming likely commands.** Rejected because the Boolean still cannot project an executable action or enroll renamed commands.
- **Parse paths, keys, and flags out of provider prose.** Rejected because wording changes would become schema changes and punctuation would carry machine semantics.
- **Copy literals into each surface-specific renderer.** Rejected because duplicated facts are the drift class this decision removes.
- **Give each generated inventory an independent banner convention.** Rejected because a future inventory could render without declaring documentation and test ownership.
- **Automatically translate `previewable = true`.** Rejected because no general command can be derived safely from a Boolean.
