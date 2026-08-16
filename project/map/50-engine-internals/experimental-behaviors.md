---
description: Environment-only trials, their activation rules, and the current experiments.
order: 70
aliases:
  - experimental behaviors
  - experimental environment variables
  - DISCERN_EXPERIMENTAL_MCP_PRELOAD
  - DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS
---

# Experimental behaviors

_Environment-only trials that gather evidence without adding a stable project setting._

Experimental behaviors are off unless their registered environment variable carries its exact activating value: `1` for a switch, or the syntax its row states for a valued experiment. Empty, absent, and other values stay off. These controls sit outside `discern.toml`: they may change, disappear, or become a supported feature without a config migration.

The registry in [`experimental.ts`](../../../src/shared/experimental.ts) owns every variable name and each activation rule. [`experimental_environment_enrolment_test.ts`](../../../tests/experimental_environment_enrolment_test.ts) scans authored TypeScript for the `DISCERN_EXPERIMENTAL_*` namespace and compares this page with the registry. A new variable therefore has to enter the registry and this reference together. The [canonical-set registry](../../../scripts/canonical_sets.ts) enrolls the set and its runtime guards.

An experiment belongs here only while discern is gathering evidence about a narrow behavior. It does not belong in the config template, generated config schema, feature canon, public integration guide, or compiled agent instructions. Promotion to a supported feature requires its own stable configuration and documentation decision. Removal can delete the registry member, consumer, tests, and this row as one change.

## Current experiments

The first experiment affects Model Context Protocol (MCP) schema loading at startup. The second caps how long one `await` call holds.

| Behavior               | Environment variable                                | Runtime effect                                                                                                                                                                                                                                                                                                                 | Off behavior                                                      |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Schema startup loading | `DISCERN_EXPERIMENTAL_MCP_PRELOAD=1`                | On `discern refresh`, the shared `.mcp.json` entry receives `"alwaysLoad": true` when the project configures Claude Code and `"deferTools": "never"` when it configures GitHub Copilot. A project using both gets both fields.                                                                                                  | The next refresh removes both fields from discern's server entry. |
| Await call cap         | `DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS=<seconds>` | An automatic `await` bound becomes the smaller of the caller profile's transport-safe bound and the given positive whole number of seconds. When the cap decides the bound, the result reports `timeout_basis: "experimental-cap"`, and a "not yet" answer still carries a lossless resume handle. An explicit CLI `--timeout` stays caller-owned. | Automatic bounds return to the transport-safe profile values.     |

## Evaluating the schema loading experiment

Run `discern refresh` from a process that carries the registered value, then begin a new agent session so the client reads the rewritten server entry. Inspect `.mcp.json` to verify the provider projection. Measure the client outcome separately: whether the model can select a discern tool before tool search, together with startup latency and context use.

To roll back, remove the value, run `discern refresh` again, and confirm that the `.mcp.json` diff removes the experimental fields. A client may cache MCP configuration for a session, so begin another session before judging the off behavior.

The experiment changes which discern MCP schemas a supporting client exposes to its model at session start. It does not change the server's tool inventory, MCP `tools/list`, or tool availability.

Only providers named in project config contribute a field. A project with Claude Code alone receives `alwaysLoad`. One with GitHub Copilot alone receives `deferTools`. Either registration order receives the same combined entry when a project uses both. The experiment leaves Cursor's separate `.cursor/mcp.json`, Codex's TOML, and Gemini's settings file untouched.

These fields are client-specific and version-sensitive. Claude Code and Copilot CLI currently accept the combined entry. MCP defines neither property, and other clients reading `.mcp.json` may treat them differently. Git tracks the file as project configuration, so a refresh from an environment without the flag removes the experimental fields. Use the switch only for local evaluation. Durable team behavior needs a stable supported setting.

[ADR 0254](../_adr/0254-mcp-preload-remains-an-environment-only-experiment.md) records the decision and removal criteria.

## Evaluating the await call cap

The cap exists for callers whose model-side prompt cache expires during a long idle hold. A call that answers "not yet" inside the cache window costs one cheap continuation turn; a call that outlives the window makes the next model turn a cold start. Set the value a margin below the provider's cache lifetime, in whole seconds.

No refresh is involved: the engine reads the value on every `await`, from the environment of the process that runs it — the MCP server's for tool calls, the shell's for the CLI. Run an `await` with the value set and confirm `data.timeout_basis` reports `experimental-cap`; remove the value and the basis returns to the caller profile. The cap only ever shortens a call — a value at or above the profile's transport-safe bound changes nothing — and slicing is lossless either way, so the worst a wrong value costs is extra round trips.

[ADR 0288](../_adr/0288-the-await-call-cap-is-an-environment-only-experiment.md) records the decision and removal criteria.
