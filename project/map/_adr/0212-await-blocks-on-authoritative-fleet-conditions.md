# ADR 0212: `await` blocks on authoritative fleet conditions, with the logbook as wake signal only

**Status**: accepted; builds on [ADR 0160](0160-local-logbook-advisory-readers.md)'s advisory-only boundary and [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md)'s begin events; extends the landing model of [ADR 0110](0110-the-landing-model.md)

## Context

The owner routinely fans work out across parallel worktrees in dependency waves. A wave-2 agent whose brief builds on a wave-1 stream had two bad options: poll `discern status` in a loop, burning a harness round-trip per poll and guessing at intervals, or wait for a human. Everything needed for a better primitive already existed. The logbook file under the git common dir receives one append per verb completion anywhere in the fleet — it is already a local event bus — and ADR 0210's begin events plus duration priors say what is running and how long it typically takes.

One architectural line bounds the design: ADR 0160 fixes every logbook reader as advisory. A verb whose *verdict* came from recorded history would cross it — history can tear, lag, or be disabled outright, and a false "your dependency is ready" costs a dependent branch built on nothing.

A second force bounds the defaults: a blocking call dies when it outlives the *calling harness's* tool-call budget, and those budgets vary by an order of magnitude across the agent surfaces discern supports. A default that ignores them returns nothing at all — the process is killed and the caller learns less than a fast "not yet" would have told it.

## Decision

**`discern await` (MCP: `discern_await`) blocks until one fleet condition holds, then reports the observed state and the next step.** Exactly one condition per call:

- `--green <branch>` — the branch's worktree (resolved from the registered worktree list) holds an **honored gate receipt**: a green `done` recorded against its current clean HEAD.
- `--landed <branch>` — the branch's work is **reachable from the trunk**. The tip sha is pinned at call start, because acceptance deletes the branch as it lands; the sha outlives the ref. A branch already missing at call start is an honest refusal — there is nothing left to pin, and the refusal names the likely reading (never started, or already landed).
- `--trunk-moved` — the trunk ref differs from its position at call start.

**Conditions ground in authoritative state; the logbook only wakes and advises.** "Landed" is a git ancestry read; "green" is a receipt inspection. The wait loop watches the logbook month files and the git refs (`refs/heads` and `packed-refs`) purely as wake signals, re-evaluating on any event, with a slow polling fallback because file watching is platform-flaky. With `[project].logbook = false` every condition still works through polling alone — only the retry *advice* degrades, to a flat default labelled as such at the point of use. `await` never gates anything, never blocks another verb, and holds no state beyond its own process: no locks, no daemon, no git-admin writes.

**A landing this call watched satisfies `--green` — vacuous reachability never does.** Only a validated tree crosses to the trunk, so an observed unreachable→reachable transition on the watched tip proves the gate held, and the whole green-to-landed window can otherwise fit between two wakes. But a tip reachable from the start proves nothing: a freshly forked branch is trivially an ancestor of the trunk, and a wave-dispatched dependent awaiting a sibling that has not yet committed must keep waiting. A caller asking "did it arrive?" after the fact uses `--landed`, which answers the literal reachability question immediately.

**Timing out is not a failure.** The envelope stays `ok: true` with `met: false`, the observed state, and `retry_after_seconds` priced from ADR 0210's evidence: in-flight work with a duration prior suggests the remainder of its typical run (floored at 30s), in-flight work without a prior a 60s check-back, a quiet fleet a 300s backoff, a disabled logbook the labelled flat default. Bounded calls compose into an arbitrarily long watch, with the caller told when to come back each time. The **CLI exits 124** on "not yet" — the shell convention for a timed-out command — so `discern await … && discern update` reads naturally and scripts can branch three ways (0 met, 1 refused, 124 not yet) while the envelope never calls the wait a defect. `await` is itself begin-recorded (deliberately not a pure-observation verb), so a blocked agent's fleet row reads `running: await` with no extra wiring.

**Defaults sit just under the ceiling that would kill the call, with explicit headroom.** The per-surface research (July 2026, across the five native providers) found, for MCP tool calls: Cursor's CLI/ACP path enforces the reference TypeScript SDK's 60s request timeout with no configuration knob and no progress-notification extension — the binding floor; Codex CLI defaults to 300s (`tool_timeout_sec`), Copilot CLI to 180s, Gemini CLI to 600s, and Claude Code has no wall-clock default on stdio tool calls (a ~30-minute idle window, with auto-backgrounding of main-conversation calls at 2 minutes). For shell invocations: Claude Code's Bash tool defaults to 120s (model-raisable to 600s), Cursor auto-backgrounds at 30s rather than killing, Gemini kills after 300s of *silence*, Codex's classic exec defaults to 10s but is model-raisable without clamp and its unified exec backgrounds instead of killing. Hence:

- **MCP default: 45s** — 25% under the 60s floor no client configuration can raise, covering spawn, wait, and serialization.
- **CLI default: 100s** — ~17% under the 120s binding blocking default; surfaces that background rather than kill still deliver the result.

The numbers live in one zero-import module beside the verb so the CLI help and both surfaces name the same values; re-derive them from fresh vendor research if a floor moves.

**Plan/apply does not apply.** ADR 0027's split exists so an effectful verb can preview its mutations; `await` mutates nothing and therefore joins the pure-query verbs (`identity`, `impact`) outside the plan machinery — no `--dry-run` (`--timeout 0` is the "check once, right now" form). The verb name is imperative-shaped despite being read-only, a deliberate reading of ADR 0120's rule in the spirit of `done`'s exception: `await` names an act the verb genuinely performs — holding the caller — not a question it answers.

The explicit *no*s: no `--idle`, no combining of conditions, no MCP push notifications, no dependency registry (building on a sibling via `start --from` *is* the declaration, per ADR 0110), and no reading the logbook for truth — ever.

## Consequences

- A delegated agent whose brief says "wait for `agent/…` to go green, then build on it" does so with one `discern await` call per bounded slice, gets the follow-up named (`update --from <branch>` to compose below the trunk, or `update` after a landing), and is never left guessing how long to sleep.
- The advisory boundary holds under scrutiny: deleting the logbook changes no verdict, only the quality of the retry advice.
- The vendor-derived defaults are a maintenance liability by construction — they encode other products' ceilings as of July 2026. The cost is contained: two constants in one module, with this record holding the derivation and margins.
- Exit 124 collides with nothing discern uses (0 success, 1 failure/refusal) and inherits the `timeout(1)` prior, but scripts written against generic "nonzero means failed" semantics will treat "not yet" as failure; `&&`-composition still does the right thing (not-yet does not proceed).
- A post-landing `--green` call started after the branch already landed (branch kept, no honored receipt) waits rather than answering met — the price of refusing vacuous reachability. `--landed` answers that question immediately, and the docs steer the two uses apart.
- The MCP tool can block for its full timeout; strict clients survive it by construction of the default, and a cancelled call aborts the wait cleanly through the request's abort signal.

## Alternatives considered

- **Deriving the default timeout from `[gate].timeout`** (owner-proposed: sit a few seconds under the configured job timeout). Rejected: `[gate].timeout` is a per-command budget inside the *sibling's* gate, while this wait spans queueing plus that gate's whole wall clock — and often starts before the sibling's gate has begun — so no config key of this project bounds it. The principle the idea gestures at is right and is the rule adopted: a default sits just under the ceiling that would kill the call, and the ceiling that kills `await` is the caller's own harness budget, never a number in `discern.toml`. For the timing *advice*, the logbook's empirical priors beat any config-derived bound.
- **Conditions read from the logbook** (a `verb: done, outcome: ok` event as "green"). Rejected on ADR 0160's line: history as evidence, never verdict. An event can be absent (logbook off), stale (receipt since invalidated by a new commit), or torn; git and the receipt are the ground truth the gate itself maintains.
- **One long-lived call with MCP progress notifications** instead of bounded slices. Rejected for v1: the strictest client's timeout cannot be configured and ignores progress notifications entirely, so a single long call cannot be made portable. Bounded slices compose everywhere; push-style delivery can accrete later without changing the contract.
- **`met: false` as `ok: false`** (timeout as error). Rejected: it would force an error slug and recovery hint onto a normal outcome, record spurious failures in the logbook, and teach agents that waiting is a defect. The exit code carries the scripting distinction instead.
- **Satisfying `--green` by reachability alone** (no transition requirement). Rejected after the test suite caught it: a freshly forked branch's tip is already reachable from the trunk, so a dependent dispatched before its sibling's first commit would be told "green" instantly and build on nothing.
