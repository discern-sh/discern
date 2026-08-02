---
aliases:
  - experimental behaviors
  - experimental environment variables
  - DISCERN_EXPERIMENTAL_MCP_PRELOAD
---

# Experimental behaviors

_Environment-only trials that gather evidence without adding a stable project setting._

Experimental behaviors are off unless their registered environment variable has the value `1`. Empty, absent, and other values stay off. These switches sit outside `discern.toml`: they may change, disappear, or become a supported feature without a config migration.

The registry in [`experimental.ts`](../../../src/shared/experimental.ts) owns every variable name and the activation rule. [`experimental_environment_enrolment_test.ts`](../../../tests/experimental_environment_enrolment_test.ts) scans authored TypeScript for the `DISCERN_EXPERIMENTAL_*` namespace and compares this page with the registry. A new variable therefore has to enter the registry and this reference together. The [canonical-set registry](../../../scripts/canonical_sets.ts) enrolls the set and its runtime guards.

An experiment belongs here only while discern is gathering evidence about a narrow behavior. It does not belong in the config template, generated config schema, feature canon, public integration guide, or compiled agent guidance. Promotion to a supported feature requires its own stable configuration and documentation decision. Removal can delete the registry member, consumer, tests, and this row as one change.

## Current experiments

The first experiment affects Model Context Protocol (MCP) schema loading at startup.

| Behavior               | Environment variable                 | Runtime effect                                                                                                                                                                                                                 | Off behavior                                                      |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Schema startup loading | `DISCERN_EXPERIMENTAL_MCP_PRELOAD=1` | On `discern refresh`, the shared `.mcp.json` entry receives `"alwaysLoad": true` when the project configures Claude Code and `"deferTools": "never"` when it configures GitHub Copilot. A project using both gets both fields. | The next refresh removes both fields from discern's server entry. |

## Evaluating an experiment

Run `discern refresh` from a process that carries the registered value, then begin a new agent session so the client reads the rewritten server entry. Inspecting `.mcp.json` proves the provider projection, but not the client outcome. For this experiment, measure whether the model can select a discern tool before tool search, together with startup latency and context use.

Removing the value is only the first half of the rollback. Run `discern refresh` again and confirm its `.mcp.json` diff removes the experimental fields. A client may cache MCP configuration for a session, so begin another session before judging the off behavior.

The experiment changes which discern MCP schemas a supporting client exposes to its model at session start. It does not change the server's tool inventory, MCP `tools/list`, or tool availability.

Only providers named in project config contribute a field. A project with Claude Code alone receives `alwaysLoad`. One with GitHub Copilot alone receives `deferTools`. Either registration order receives the same combined entry when a project uses both. The experiment leaves Cursor's separate `.cursor/mcp.json`, Codex's TOML, and Gemini's settings file untouched.

These fields are client-specific and version-sensitive. Claude Code and Copilot CLI currently accept the combined entry, but MCP does not define either property and other clients reading `.mcp.json` may treat them differently. Git tracks the file as project configuration, so a refresh from an environment without the flag removes the experimental fields. Use the switch only for local evaluation. Durable team behavior needs a stable supported setting.

[ADR 0253](../_adr/0253-mcp-preload-remains-an-environment-only-experiment.md) records the decision and removal criteria.
