# ADR 0041: A self-describing MCP surface built on typed result schemas

**Status**: accepted; extends [ADR 0038](0038-official-mcp-sdk.md) and
[ADR 0028](0028-result-envelope-and-diagnostics.md)

## Context

[ADR 0038](0038-official-mcp-sdk.md) put `discern mcp` on the official MCP
TypeScript SDK, but as a like-for-like port of the hand-rolled surface: ten
tools, each returning its verb's `DiscernResult` as `structuredContent`, with
**no output schemas, no annotations, no server instructions, and no resources**.
A client connecting to the server learned a tool's _name_ and _description_ and
nothing machine-readable about what it returns or how it behaves. The shipped
agent guidance had to carry the entire "when to use which tool" story in prose,
because the protocol surface said none of it.

The SDK offers the missing pieces — `outputSchema`, `ToolAnnotations`, server
`instructions`, and `resources` — but `outputSchema` comes with a sharp edge:
**the SDK validates a tool's `structuredContent` against its `outputSchema` on
every call.** An output schema that doesn't match what the verb actually returns
turns a _valid_ call into an _error_. So the moment we advertise schemas, we
take on the same hazard the gate's guidance-currency check
([ADR 0034](0034-agents-md-untracked-currency-check.md)) guards against: two
descriptions of one thing that can drift. A schema hand-maintained next to a
result built elsewhere _will_ diverge, and the divergence surfaces as a broken
tool call in the field, not a failed build.

Two correctness gaps also sat under the surface we were about to formalize.
`discern prepare` and `discern test` returned a bare `{ok:false}` on failure —
their joined stage command ran through `runShellInherit`, which discards output
under the quiet `--json` rule
([ADR 0030](_superseded/0030-quiet-json-output.md)) — so the result an agent
reads carried no `steps[]` and no `diagnostics[]`, unlike `finish`. Baking a
schema over that hole would have enshrined it.

## Decision

The MCP surface is **self-describing**, and its output contract is **typed from
a single source**.

**One Zod source per result shape (the SSOT spine).**
`src/shared/result_schemas.ts` defines, once: an **envelope schema** that
mirrors exactly what `serializeResult` emits; a **per-verb `data` schema** for
each verb that carries `data` (`status`, `audit`, `doctor`, `scopes`,
`docs`/`help`, `finish`'s gate data, `ratchets`); and a **per-verb output
schema** — the envelope with `data` narrowed to that verb's shape. The shape is
tied to reality from both ends:

- **Compile time:** each verb's core types its `data` as `z.infer<…>` of its
  schema (the `status`/`doctor` shapes _moved into_ `result_schemas.ts` and the
  cores import the inferred types back; `finish`/`audit`/`scopes`/`docs` tie
  theirs via the data type or a `satisfies`). A core that drifts from its schema
  no longer compiles.
- **Run time:** a faithfulness test runs every verb across its modes (success,
  failure, refusal, dry-run, and the per-verb variants) and asserts the real
  `serializeResult` output validates against its schema; the envelope schema is
  locked to `serializeResult` by a maximal-result key check.

This is the MCP analog of the guidance-currency gate: the schema is safe only
because it is mechanically tied to the thing it describes. We do **not** loosen
a schema to make a call pass — a mismatch means the schema or the result is
wrong, and we fix the mismatch, never widen to `z.any()`.

**Every tool advertises `title`, `outputSchema`, and honest `annotations`.** The
annotations are truthful `ToolAnnotations` hints: read-only (`status`, `doctor`,
`scopes`, `audit`, `docs`, `help`), mutating (`finish`, `prepare`, `test`,
`ratchets` — they run commands / rewrite files), and destructive (`graduate` —
it tears down resources and moves the branch). `ToolAnnotations` is declared
locally because the SDK keeps that type behind a `types.js` subpath its package
`exports` map doesn't expose.

**The server ships `instructions`** — the native "when to use which tool" block,
loaded by capable clients on connect — carrying the strong MCP-first stance
(prefer the tools over the CLI) and made feature-aware (the docs/graduate lines
drop when their feature is off), mirroring the tool gating.

**`discern_ratchets` is exposed**, over a `ratchetsResult` core factored out of
the CLI path, annotated mutating and described as slow / on-demand — explicitly
**not** part of `finish`.

**Resources pair with the tools, they do not replace them.** Five resources —
`discern://status`, `discern://scopes`, `discern://config`, `discern://help` (+
a `{target}` template), and `discern://docs` (+ template) — are computed **fresh
on every read** (no subscriptions, no `listChanged`), serve the verb's `data`
payload rather than the full envelope, and are gated exactly like their tools
(the docs resource on the `docs` feature and on setup completion; help always).
Resources are application-driven and not reliably auto-injected across the ~80%
of clients, so the **tools stay the reliable path** and resources are the
elegant attachable surface beside them.

The explicit **no**s:

- **The `worktree` command group is NOT exposed** as tools or resources. They
  are hook-driven, and an agent must never hop between or prune the worktree it
  is sitting in. `graduate` is the one lifecycle op exposed, and it stays the
  only one.
- **No prompts, no progress / cancellation / logging / subscriptions, no
  Streamable HTTP.** Deferred — uneven client support, and they earn nothing for
  a local stdio tool today.

**Prerequisite fix:** `prepare` and `test` now run through the gate's job runner
(the machinery `finish` uses), so a failure carries the same `steps[]` +
`diagnostics[]` — closing the correctness hole _before_ its shape was baked into
a schema.

## Consequences

- **The advertised contract cannot silently drift from reality.** The SDK
  validates every call against the same schema the core is typed from and the
  faithfulness tests exercise; a drift is a compile error or a red test, never a
  field break. This is the lever that makes advertising schemas safe at all.
- **The next tranche can lean on the protocol.** With a real `instructions`
  block and typed schemas in place, the shipped guidance can be slimmed and the
  "when" leaned onto the server — the strategic payoff this groundwork unlocks
  (left to that tranche; the shipped guidance is untouched here).
- **`data` is now a typed surface, not `unknown`.** Shapes that were previously
  implicit (the audit `data` payload was a bare `Record<string, unknown>`) are
  pinned, which is stricter: a new `data` field must be modelled or the
  faithfulness test fails — the cost of the guarantee.
- **Resources are a bonus surface, not load-bearing.** Because client support is
  uneven, nothing depends on them; they add reach without moving the reliable
  path off the tools.
- **The worktree-lifecycle exclusion is a standing rule**, not an omission to
  revisit — re-exposing those verbs would let an agent operate on its own
  footing.

## Alternatives considered

- **Advertise output schemas hand-written next to the verbs.** The fast way to a
  self-describing surface, and the trap: two shapes that drift, surfacing as a
  broken call in the field. Rejected for the single-source tie — the whole
  point.
- **Skip output schemas; ship only annotations + instructions.** Avoids the
  validation hazard entirely, but throws away the machine-readable result
  contract that lets a client reason about what a tool returns. The hazard is
  worth taking _because_ it is mechanically contained.
- **Expose the worktree lifecycle for symmetry with the CLI.** Rejected on
  safety: a hook-driven verb an agent could aim at its own worktree is a
  footgun, and CLI/MCP symmetry is not a goal that outweighs it.
