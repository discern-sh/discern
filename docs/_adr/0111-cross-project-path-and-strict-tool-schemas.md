# ADR 0111: The MCP surface refuses undeclared arguments, and `discern_start` takes a cross-project `path`

**Status**: accepted. Refines the `path` override of
[ADR 0062](0062-mcp-server-working-root.md) §2; builds on the MCP surface of
[ADR 0045](0045-mcp-is-core-infrastructure.md) and
[ADR 0041](0041-self-describing-mcp-surface.md).

## Context

A field report from a two-project setup — an agent session in project A making
a change in project B, a dependency that runs its own discern — surfaced two
defects with one call. The agent passed `path` (pointing into B) to
`discern_start`, and the call **succeeded while doing the wrong thing**: a
worktree minted in A, the project the server was rooted in.

Two independent causes lined up:

1. **`discern_start` was the only root-operating tool without `path`.**
   ADR 0062 §2 gave every root-operating tool the `path` override, resolved
   through `findRoot` — which climbs to the nearest `discern.toml` with no
   fence around the spawn project. So `discern_status`, `discern_finish`, even
   `discern_graduate` already operated on *any* discern project on disk when
   handed a path into it. `start` alone was carved out ("its root is the
   creation source, a separate concern") — the surface promised cross-project
   targeting on every verb except the one a line of work begins with, and an
   agent that learned `path` from the other fourteen tools reasonably inferred
   the fifteenth.

2. **Unknown arguments were silently stripped.** Tool schemas registered as
   Zod raw shapes; the SDK validates a call against an *open* object, which
   discards keys the shape doesn't declare. The agent's `path` never reached
   the handler, no error was raised, and the verb ran with different semantics
   than the caller asked for. For a mutating verb this is the worst failure
   shape an agent-facing surface has: agents recover well from loud refusals
   (the defensive-refusal principle of ADR 0062 §3) and badly from
   success-reports that mean something else.

The recovery in the field — drop the stray worktree, fall back to B's own
`discern` CLI — worked because the agent was attentive, not because the product
led it there. And discern's stated doctrine is that MCP is the primary surface,
with the CLI the fallback for an *unreachable* server, so "use the other repo's
CLI" cannot be the blessed cross-project path.

## Decision

### 1. Every tool's input schema registers closed

Registration wraps each tool's declared raw shape in `z.strictObject`
(`strictInput` in `server.ts`), so a call carrying an argument the tool does
not declare fails with a validation error naming the stray key — never
succeeds with the key stripped. `McpTool.inputSchema` becomes required: a
schema-less tool skips SDK validation entirely, which is the same hole in
another form; a genuinely argument-less verb must declare an empty shape and
face that trade-off explicitly.

A registry-driven guard (`tests/engine_mcp_test.ts`) calls every tool live
with an undeclared argument and asserts the loud refusal, so a new tool
auto-enrols. Landing the guard immediately caught two of our own tests still
passing a `to` argument left over from the removed `graduate_to` model —
silently stripped until then. The class was live in this repo's own suite.

### 2. `discern_start` declares `path`, with creation-target semantics

`start` gains the one `path` meaning it can coherently have: **create the
worktree for the discern project containing this path**. Resolution is the
same `findRoot` walk every other tool uses; the new worktree forks from the
*target* project's trunk under the *target* project's config; the
refuses-inside-a-worktree precondition evaluates against the target; and on
success the re-aim follows the new worktree exactly as for a same-project
start — deliberately an exception to §2's "one-call steer" rule, just as
graduate's `heldRootMissing` re-root already is, because a start's whole
contract is that the tools follow the line of work it opens.

### 3. Cross-project targeting is a supported scenario, not an accident

`findRoot`'s unfenced resolution is now the documented contract: `path` on any
root-operating tool may name *any* discern project on disk. This is what makes
a multi-repo application — several components, each its own discern-managed
repo — workable from one agent session, and the same capability covers the
dependency-repo case from the field report. The bundled guidance names the
scenario so agents are led there instead of improvising.

We explicitly do **not** fence `path` to the spawn project. The fence would
have made the surface self-consistent the cheap way — refuse everywhere — but
it removes a capability that already works, costs multi-repo users the natural
flow, and buys only a smaller record. Version skew between the projects is not
a real cost: discern is one binary, and the per-call version handshake already
flags a stale server.

## Consequences

- The field failure is impossible as reported: the same call now either
  creates B's worktree (declared `path`, resolved to B) or — had the argument
  stayed undeclared — refuses naming the stray key. Neither path mints a
  worktree in the wrong project silently.
- **Strictness is a compatibility ratchet on callers.** A client that was
  (knowingly or not) sending stray keys now gets refusals where it got quiet
  success. That is the point — the two in-repo test fixtures the guard caught
  prove the "quiet success" was already lying — but it is a behaviour change
  shipped to every project on the next upgrade.
- After a cross-project start, the held working root points at *another
  project's* worktree until the next lifecycle transition, and a
  cross-project graduate re-aims to *that project's* main checkout — the
  session's no-`path` default is then theirs, not the spawn project's.
  `discern_status` surfaces the active root (ADR 0062 §4), so the divergence
  stays one call from visible; an agent returning to the spawn project passes
  `path` or starts there anew.
- `start`'s `path` is a second deliberate exception to §2's one-call-steer
  rule. The rule survives for every read and gate verb; the exceptions are
  exactly the two lifecycle transitions ADR 0062 §1 already lets move the
  held root.

## Alternatives considered

- **Fence `path` to the spawn project; refuse cross-project everywhere.**
  Self-consistent and smaller, but strictly worse: see Decision §3.
- **Refuse `path` on `start` loudly with a pointer to the target project's
  own discern.** The minimum honest fix (and strictness alone delivers its
  refusal half), but it leaves the asymmetry: every verb cross-project except
  the entry point, with a drop-to-CLI story that contradicts MCP-as-primary.
- **Tolerate unknown arguments but warn in a hint.** Keeps old callers green
  while flagging the stray key. Rejected: a hint rides on a *success*
  envelope, so the wrong-semantics run still happens — the harm is the run,
  not the missing message.
