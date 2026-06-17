# Code conventions

*The rules the tooling enforces, and the conventions to follow when writing code here.*

> This doc is a skeleton. The `/bootstrap` skill (and the [`document-subsystem`](../../.ai/skills/document-subsystem/SKILL.md) skill, when filling the `80-development` subtree) writes it from the project's actual stack and the Conventions section of the project guidelines. Look for the `<!-- /bootstrap fills this -->` marker.

This doc is the detailed companion to the **Conventions** section of the project guidelines (`.ai/guidelines/<slug>.md`). The guidelines hold the short, agent-facing form; this doc holds the full reasoning and examples. Keep the two in step, and keep both aligned with what the `[slots]` in `icculus.toml` actually enforce — the written rule and the enforced rule must never disagree.

## What the gate enforces

<!-- /bootstrap fills this -->

_(The concrete rules the `fix` and `check` slots apply: formatter and its settings, linter rules, static-analysis or type-check level, any architecture rules. For each, say what it checks and how to satisfy it. This is the section a contributor consults when the gate rejects their change for a style or analysis reason.)_

## Conventions to follow

<!-- /bootstrap fills this -->

_(The conventions the tooling can't fully enforce but the project still holds: naming, structure, error-handling style, documentation expectations, testing approach. Cross-reference [testing.md](testing.md) for the test-specific rules.)_
