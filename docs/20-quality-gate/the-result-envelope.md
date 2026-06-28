# The result envelope & the MCP surface

_Every verb returns one shape; `discern mcp` serves that shape to agents with a
typed, self-describing contract._

## The `DiscernResult` envelope

Every `discern` verb computes one **`DiscernResult`** — the uniform
`{ok, verb,
…}` shell defined in
[`src/shared/result.ts`](../../src/shared/result.ts). Its human text, its
`--json`, and its MCP tool result are three _renderings_ of that one object,
never re-derived in parallel
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)). The fields:

| Field               | When present  | What it carries                                                            |
| ------------------- | ------------- | -------------------------------------------------------------------------- |
| `ok`                | always        | Did the verb succeed? The one field every consumer can rely on.            |
| `verb`              | always        | The verb that produced this result (`"finish"`, `"status"`, …).            |
| `dry_run`           | previews      | `true` when nothing was applied — the uniform "is this a preview?" signal. |
| `plan`              | previews      | The plan that _would_ run (mutually exclusive with `steps`).               |
| `steps`             | apply         | The steps that ran and how each turned out.                                |
| `diagnostics`       | on failure    | Normalized failures — the structured "why" (see below).                    |
| `data`              | verb-specific | The verb's own payload (`status`'s situation, `doctor`'s checks, …).       |
| `hints`             | advisory      | Agent-facing "what next" advice — never errors.                            |
| `error` / `message` | refusals      | A machine-stable slug plus a human sentence when the verb refused.         |

`serializeResult` is the **one** place the wire shape is defined; it drops
undefined fields, so a clean refusal serializes to just
`{ok, verb, error,
message}`. Under `--json` the envelope is the **entire**
output ([ADR 0030](../_adr/_superseded/0030-quiet-json-output.md)).

## `diagnostics[]` — the structured "why"

A failed gate command yields a normalized {@link Diagnostic} so an agent loops
**act → read-error → fix** instead of re-running and scraping stderr. Layered by
how much discern knows about the tool:

- **Tier 0 (always):** `tool`, `severity`, `message`, `reproduce_cmd` (the exact
  command to re-run the failure in isolation), and `output` (the captured
  combined stdout+stderr, tail-capped).
- **Tier 1 (opt-in):** when a capability/check declares a diagnostics `format`,
  discern parses the output into `file` / `line` / `col` / `rule`.
- **Tier 2 (derived):** `fix_available` when a wired fixer may resolve it.

`finish`, `prepare`, and `discern test` all run through the gate's job runner,
so a failure from any of them carries the same `steps[]` + `diagnostics[]` —
there is no opaque `{ok:false}`.

## One typed source for every shape

The result shapes are defined **once** as Zod schemas in
[`src/shared/result_schemas.ts`](../../src/shared/result_schemas.ts)
([ADR 0041](../_adr/0041-self-describing-mcp-surface.md)): an **envelope
schema** that mirrors `serializeResult`, a **per-verb `data` schema**, and a
**per-verb output schema** (the envelope with `data` narrowed). This is the
single source the MCP server advertises and the verbs are typed against:

- **Compile time** — each verb's core types its `data` as `z.infer<…>` of its
  schema, so a core that drifts from its schema does not compile.
- **Run time** —
  [`tests/result_schemas_test.ts`](../../tests/result_schemas_test.ts) runs
  every verb and asserts its real `serializeResult` output validates against its
  schema.

This matters because the MCP SDK **validates a tool's result against its
declared output schema on every call** — an out-of-date schema would turn a
valid call into an error. Tying the schema to the type and proving it with a
test is the MCP analog of the gate's generated-file currency check
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)): a schema is
only safe because it is mechanically tied to what it describes.

## `discern mcp` — the agent-native surface

`discern mcp` ([ADR 0038](../_adr/0038-official-mcp-sdk.md)) serves the verbs to
a coding agent over the Model Context Protocol on the official TypeScript SDK,
over stdio. Each tool is a thin adapter over a verb's result-returning core; the
result is rendered as `{ content, structuredContent, isError }`, the same
`DiscernResult` the CLI prints.

**Tools.** The exposed set mirrors the work verbs: `discern_status`,
`discern_finish`, `discern_prepare`, `discern_test`, `discern_ratchets`,
`discern_doctor`, `discern_audit`, `discern_changed_scopes`, `discern_docs`,
`discern_help`, `discern_graduate`. Each advertises:

- a **`title`** (a short human label) and a **description**;
- an **`outputSchema`** — its per-verb schema from `result_schemas.ts`, which
  the SDK validates `structuredContent` against on every call;
- honest **`annotations`** — `readOnlyHint` for the pure-observation verbs
  (`status`, `doctor`, `changed_scopes`, `audit`, `docs`, `help`); not-read-only
  for the ones that run commands or rewrite files (`finish`, `prepare`, `test`,
  `ratchets`); and `destructiveHint` for `graduate` (it tears down resources and
  moves the branch).

A tool is **gated like its verb**: a feature-disabled tool is not registered
(absent from `tools/list`), and the bootstrap-gated verbs (the gate verbs and
`discern_docs`) refuse with `not_set_up` until the project is set up.
`discern_ratchets` is **slow and on-demand** — it runs the metric commands, so
it is not part of `discern_finish`; check it explicitly.

The worktree lifecycle verbs (`worktree`, `worktree:*`) are **deliberately not
exposed** — they are hook-driven and an agent must never hop between or prune
the worktree it is in. `discern_graduate` is the one lifecycle op on the
surface.

**Instructions.** The server advertises an `instructions` block — the native
"when to use which tool" guide capable clients load on connect: orient with
`discern_status`, gate with `discern_finish` (`discern_prepare`/`discern_test`
while iterating), learn discern via `discern_help`, read the project's docs via
`discern_docs`, audit with `discern_audit`, graduate with `discern_graduate`. It
is feature-aware (the docs/graduate lines drop when their feature is off).

**Resources.** Alongside the tools, five readable resources are computed fresh
on every read and serve the verb's `data` payload (not the full envelope):

| URI                                          | Content                              | MIME                   |
| -------------------------------------------- | ------------------------------------ | ---------------------- |
| `discern://status`                           | a live `status` snapshot             | `application/json`     |
| `discern://changed-scopes`                   | the changed scopes                   | `application/json`     |
| `discern://config`                           | the resolved `discern.toml`          | `application/json`     |
| `discern://help` · `discern://help/{target}` | discern's own docs (index · one doc) | JSON · `text/markdown` |
| `discern://docs` · `discern://docs/{target}` | the project's docs (index · one doc) | JSON · `text/markdown` |

Resources are gated like their tools (the `docs` resource on the `docs` feature
and on bootstrap; `help` always). They are application-driven and not reliably
auto-injected across clients, so the **tools stay the reliable path** and
resources are the attachable surface beside them.
