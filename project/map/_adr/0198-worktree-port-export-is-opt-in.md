# ADR 0198: Worktree port export is opt-in

**Status**: accepted

## Context

Every discern worktree has a deterministic development port as part of its identity. The port is always available through `discern identity --port` and the `@port@` setup token. The `[worktree].port` setting has a narrower effect: it writes `DISCERN_WORKTREE_PORT` into a configured env file.

Fresh configs enabled that write even when a project had no tooling that read the variable. This made a derived identity value look like a provisioned resource and introduced env-file churn for projects that did not need it.

## Decision

Fresh configs ship with `[worktree].port = false`. A project enables it when its development tooling consumes `DISCERN_WORKTREE_PORT`.

The setting controls only env-file export. Deterministic port derivation, `discern identity --port`, and `@port@` remain available while it is false. Schema 23 does not rewrite the setting in existing installs.

## Consequences

- A fresh worktree does not write an unused port variable into an env file.
- Projects with concurrent dev servers opt in with one explicit setting.
- Existing installs keep their current env-file behaviour.
- Documentation must distinguish port identity from port export.

## Alternatives considered

- **Keep export on by default.** Rejected because most projects do not consume the variable, while the identity remains discoverable without exporting it.
- **Remove the setting and always derive on demand.** Rejected because env-file export is useful to project tooling that cannot invoke discern directly.
