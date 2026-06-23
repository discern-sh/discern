# ADR 0030: `--json` is quiet — the envelope is the entire machine output

**Status**: accepted; **extends
[ADR 0028](0028-result-envelope-and-diagnostics.md)**; refines
[ADR 0004](0004-structured-finish-json.md)

## Context

ADR 0028 made every verb return one `DiscernResult` and render it three ways
(human text, `--json`, MCP). The `--json` rendering was defined as "the single
JSON object on **stdout**, human narration to **stderr**" (the stream split of
ADR 0004), and it explicitly kept **live streamed job output as a side-channel**
on stderr — "you cannot render post-hoc bytes from a settled object."

That is clean Unix hygiene, and stdout genuinely is pure JSON (a verb's envelope
is the only thing written there). But it does not serve the consumer the whole
machinery exists for. The agent loop ADR 0028 sells — _act → read-error → fix_ —
runs through a **shell tool that captures stdout and stderr combined**. From
that seat, `discern finish --json` is ~600 lines of streamed job output followed
by one JSON line. The capped (16k) diagnostic output ADR 0028 carefully bounds
is defeated by an uncapped parallel stream on stderr. "Clean stdout" buys the
agent nothing, because nothing the agent uses reads stdout in isolation.

Two further problems compound it:

1. **No single chokepoint.** "`--json` silences output" was implemented in two
   philosophies across four places: the installer's `Logger` _suppresses_ every
   human method in JSON mode (correct), while the engine's `Out`, the job
   runner, and `runShellInherit` merely _reroute_ to stderr. The envelope itself
   was printed by hand-rolled `console.log(JSON.stringify(serializeResult(…)))`
   at four-plus sites. Behaviour could (and did) diverge per verb.

2. **Useful information lived only in the human renderer.** The gotchas-doc
   pointer (on failure) and the success nudges (hold the ratchets, start the dev
   server, update the docs) were emitted as stderr prose and appear nowhere in
   the envelope — so going quiet would lose them.

## Decision

**In `--json` mode the `DiscernResult` envelope is the _entire_ program
output.** All discern-authored human narration _and_ all captured/streamed
subprocess output are **suppressed**, not rerouted. Combined `stdout`+`stderr`
of any `<verb> --json` is exactly one JSON object. Only an uncaught runtime
crash (a stack trace + non-zero exit) may still reach stderr — every
_controlled_ condition already rides in the envelope
(`ok`/`error`/`message`/`diagnostics`).

This rests on three structural commitments:

### One silence rule

The engine adopts the contract the `Logger` already honours: in JSON mode every
human method is a no-op. The job runner is handed a `quiet` flag and **withholds
its sink** — because `spawnJob` always pipes a child (never inherits),
withholding the write means no banner, no streamed line, and no buffered dump
reaches any fd, while `result.output` still feeds the failure diagnostic.
`runShellInherit` discards child output in quiet mode rather than forwarding it
to stderr.

### One emission chokepoint

A single `emitResult(result)` is the _only_ code that serializes an envelope to
stdout; `Logger.result` delegates to it and every hand-rolled `console.log`
emission is removed. `serializeResult` remains the one wire-shape definition;
`emitResult` is the one print site.

### `hints` — promote advice into the envelope

A `hints?: string[]` field is added to `DiscernResult`. Advice that was
human-only is moved into it: the gotchas-doc pointer on a failed gate, the
ratchets / dev-server / docs nudges on a clean one. Going quiet then loses
nothing — the agent receives the advice in machine-readable form, which is
strictly better than parsing it back out of prose.

### Steer agents through the compiled guidance, not detection

Agents do not know to pass `--json`. The discern-native fix is that discern
**compiles the agent instruction files** (`AGENTS.md`/`CLAUDE.md`/…): the
built-in guidance is the single source of truth for _how to invoke discern_, so
it tells agents to use `--json` (and points at `discern mcp`, the channel with
no stream problem at all). We **reject environment-variable agent-detection**
(the Laravel `agent-detector` approach): a hardcoded table of competitors'
private env vars rots, makes output format depend on ambient state (a human in
an agent shell would silently get JSON), is non-deterministic under test
(discern's own gate runs inside agents), and contradicts the rule that the
shipped surface stays generic. If a default-on is ever wanted, it must be an
_explicit_ knob (`DISCERN_JSON` / `[output]`), never a sniff.

## Consequences

- **`discern finish --json` is safe to capture combined** — it delivers ADR
  0028's own goal. A clean run collapses to one line; a failing run is bounded
  by the 16k diagnostic cap because there is no longer a parallel uncapped
  stream.
- **Regression is made impossible structurally.** An architectural test asserts,
  for _every_ `--json` verb (enumerated from the verb registry), that combined
  stdout+stderr parses to exactly the envelope; a source-level guard asserts
  envelope emission happens only through the one chokepoint. A new verb that
  prints a stray line, or hand-rolls emission, fails the gate.
- **Humans lose live progress under `--json`.** Acceptable: `--json` is machine
  mode; the default human path is unchanged and still streams.
- **MCP is unaffected** — its tool result was already only the envelope.
- **Refines, does not break, ADR 0028's shape.** The envelope gains an optional
  `hints`; the side-channel ADR 0028 left on stderr is silenced in JSON mode.

## Alternatives considered

- **Keep rerouting to stderr; tell agents to `2>/dev/null`.** Rejected: relies
  on invocation hygiene the agent doesn't apply, and the whole point is to not
  depend on the consumer separating streams.
- **Environment-variable agent-detection (auto-flip to JSON).** Rejected for the
  reasons above — rot, spookiness, non-determinism, generic-surface violation.
- **TTY-based auto-JSON (emit JSON when stdout isn't a terminal).** Rejected:
  switching _format_ on a pipe is more astonishing than dropping colour, and it
  misfires both ways (a human redirect gets JSON; an agent on a PTY does not).
