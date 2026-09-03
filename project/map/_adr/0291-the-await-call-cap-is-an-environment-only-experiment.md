# ADR 0291: The await call cap is an environment-only valued experiment

**Status**: accepted; follows the experiment discipline of [ADR 0254](0254-mcp-preload-remains-an-environment-only-experiment.md).

## Context

`await` holds one call for the longest bound its transport verifiably survives: 55 minutes for clients whose MCP tool timeout discern configures, 45-second lossless slices for strict and unknown clients. Those numbers live in the native timeout-policy registry and encode transport facts only.

A second, independent ceiling exists on the caller's side: model providers expire prompt caches after an idle window, and a call that outlives that window makes the caller's next model turn a cold start over its full context. Cache lifetimes differ per provider and per account tier, and change at the vendor's discretion, so discern cannot detect a caller's true window — only the user knows it. The waiting machinery already answers "not yet" with a `resume` handle that preserves the original question, so ending a call early is lossless by construction; several cheap continuation turns inside the cache window can cost far less than one cold start after it.

The open question was who owns the number: project config, per-provider defaults baked into the registry, or the user's environment.

## Decision

`DISCERN_EXPERIMENTAL_AWAIT_CALL_SECONDS` caps the automatic bound of one `await` call. It is the registry's first valued experiment: it activates only on a positive whole number of seconds, and every other value stays off.

The engine takes the minimum of the caller profile's transport-safe bound and the cap. The cap can only shorten a call, never lengthen one — transport safety stays owned by the timeout-policy registry, and the environment expresses only economics. When the cap decides the bound, the result reports `timeout_basis: "cache-window"`, so the trial is observable from the envelope alone. An explicit CLI bound stays caller-owned and uncapped; a tool request above the effective bound is sliced to it with the question preserved, as strict-client requests already are.

The explicit *no*s:

- No `discern.toml` setting. A cache lifetime is a property of the user's provider account, not of the project.
- No per-provider cache-lifetime table in the timeout-policy registry. Third-party cache behavior drifts silently and varies by tier; discern does not maintain it.
- No change to any default bound. The generated public environment-variable reference names the experimental control and its activation syntax; evaluation guidance remains on the contributor experimental-behaviors page.

If evidence shows the cap earns a stable home, promotion — for example a declared per-provider cache policy beside the transport policy — is its own decision.

## Consequences

- A user whose provider expires caches quickly can keep long waits inside the window; the worst a wrong value costs is extra lossless round trips.
- The experiment registry now carries two activation rules — the exact-value-`1` switch and the valued syntax — and its guards enroll both.
- `timeout_basis` gains the stable value `cache-window` in the published result schema. The value names the economic constraint rather than the temporary delivery mechanism, so it remains accurate if the control later moves beyond an environment variable.
- The value must reach the process that runs the wait — the MCP server's environment for tool calls, the shell's for the CLI — which is the usual friction of environment-only controls.
