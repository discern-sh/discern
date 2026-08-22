# ADR 0232: `await` continuations spend the transport budget

**Status**: accepted for transport timing, retry continuity, branch arming, and follow-up policy. Its self-contained token representation and inherited no-Git-admin-state rule are superseded by [ADR 0243](0243-await-continuations-use-short-repository-local-handles.md). Supersedes [ADR 0227](_superseded/0227-await-bounds-follow-repository-evidence.md)'s evidence-priced timeout policy and the vendor timing claims in [ADR 0213](0213-await-blocks-on-authoritative-fleet-conditions.md). Uses the landed receipt notes from [ADR 0188](0188-the-receipt-relays-as-one-line.md) as durable acceptance evidence.

## Context

`await` exists to replace repeated polling with one blocking call. Its evidence-priced bounds worked against that purpose. A five-minute P90 estimate made the caller return after five minutes even when its transport could safely wait almost an hour. Success already returns immediately, so a shorter estimate saves no time when the condition becomes true. It only creates another tool call when the estimate is wrong.

Bounded retries also reset the question. `--trunk-moved` pinned the trunk at the start of each call, while `--landed` and `--green` pinned the branch tip then. If the condition crossed between two calls, the second call could take the new state as its baseline and wait forever for another change. Three retries were three separate observations, not one continuous watch.

There is no honest universal long MCP call. Current primary vendor evidence says:

| Client             | Published behavior                                                                            | Configuration                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code        | `MCP_TOOL_TIMEOUT` defaults to 100,000,000 milliseconds; no maximum is published              | Per-server `timeout` in milliseconds ([MCP docs](https://code.claude.com/docs/en/mcp), [environment variables](https://code.claude.com/docs/en/env-vars))                                                                                                                    |
| Codex              | 60-second default; no maximum is published                                                    | `tool_timeout_sec` ([configuration reference](https://developers.openai.com/codex/config-reference), [schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json))                                                                                   |
| Gemini CLI         | 600-second default; no maximum is published                                                   | Per-server `timeout` in milliseconds ([configuration reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md), [client source](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/mcp-client.ts))        |
| Cursor CLI/ACP     | Current CLI build uses an effective fixed 60-second call timeout; progress does not extend it | No setting ([Cursor support](https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925/5))                                                                                                                                     |
| Cursor IDE Agent   | Cursor support reports around 60 minutes; no precise maximum is published                     | No documented setting ([Cursor support](https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925/5))                                                                                                                          |
| GitHub Copilot CLI | No default or maximum is published                                                            | Per-server `timeout` in milliseconds ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [SDK troubleshooting](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/mcp-debugging#timeout-errors)) |

The MCP TypeScript SDK's 60 seconds is itself an overridable default, not a protocol maximum ([SDK timeout documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md#timeouts)). Cursor CLI is the binding exception because it currently leaves that default and `resetTimeoutOnProgress = false` unchanged. The project-local `.cursor/mcp.json` also serves the IDE, whose longer duration is a separate client path rather than evidence that the CLI can wait longer.

## Decision

**One `await` call uses the longest reliable bound its configured transport declares. A not-met result returns a continuation that preserves the original question across calls.**

The native provider catalogue has a total timeout-capability record. Adding a provider fails compilation until it declares either a configurable budget or a surface-dependent budget governed by its shortest verified client path. Provider wiring passes an explicit server capability flag; `clientInfo`, environment markers, and other advisory identity signals do not change behavior, preserving [ADR 0166](0166-agent-identity-is-advisory-logbook-evidence.md).

Claude Code, Codex, Gemini, and Copilot are configured with a 3,600-second tool timeout. Their `await` calls use at most 3,300 seconds, leaving five minutes for delivery and cancellation. Cursor uses 45 seconds, leaving 15 seconds beneath the CLI/ACP limit. Its IDE could support a longer call, but both surfaces read the same committed entry and observed client names are not a reliable capability contract. The shared entry therefore uses the shortest verified path. An MCP server without a provider declaration also uses 45 seconds. The CLI defaults to 3,300 seconds and has no MCP transport cap; an explicit CLI timeout remains exact.

An explicit MCP timeout below the profile limit remains exact. A larger request is sliced at the safe limit, and `requested_timeout_seconds` records what the caller asked for. `timeout_seconds` and `timeout_basis` report the call that actually ran. A zero-second check still evaluates once, then recommends the profile maximum for a continuation.

The logbook remains a wake signal, never a clock or verdict. Duration priors no longer shorten calls. `await` still returns as soon as the authoritative condition holds, so spending the available budget is strictly better than returning at an estimate.

On "not yet", `data.resume` carries a versioned, repository-bound, self-contained token. It records the condition, trunk, original trunk baseline, the latest observed branch tip, and whether that work was ever outside the trunk. `--resume <token>` is mutually exclusive with condition flags. It restores that transition instead of taking a fresh baseline. The returned hint uses the token and tells the caller to continue until the condition holds or the user stops the watch; discern imposes no retry-count limit.

Both branch conditions follow the live branch tip. A tip already reachable when the watch begins does not satisfy `--landed`: a new worktree starts at the trunk but has landed no work. The condition arms after observing branch work outside the trunk, then succeeds when that tip becomes reachable. A receipt note also proves the landing.

A branch may still commit, pass, land, and be deleted between evaluations. Acceptance attaches a structured receipt note to the validated landed commit before deleting the worktree and branch. A resumed branch wait searches the trunk ancestry added after its original baseline for a matching receipt note, and requires the receipt's head to match the commit carrying the note. A fresh `--green` or `--landed` call can use the newest matching receipt to recover an already-deleted accepted branch. If note recording failed and no evaluation observed the branch's transition, `await` does not guess.

Met hints inspect the caller's checkout. They prescribe `start` from the main checkout and `update` from an existing worktree. A live green receipt adds `--from` with the immutable observed commit, never the branch name that acceptance may delete. A refusal carries no continuation and points at recovery. Only a not-met result carries `data.resume`.

## Consequences

- Long-capable clients can cover ordinary gates, including work that moves around the sixteenth minute, with one call.
- Cursor and unknown clients use more calls, but every call resumes one watch. Cursor's strict profile covers its 60-second CLI/ACP path even when the same project config opens in its longer-lived IDE path. A trunk move or landing in the round-trip gap is not lost.
- A predecessor that accepts before its dependent begins can still be identified by its branch-bound receipt note.
- Agents must not shorten a supported long call for progress narration. The wait itself is the monitoring mechanism and returns early.
- Agents must not stop after an arbitrary number of not-met results. A watch ends when its condition holds, the user stops it, or the surrounding task no longer needs the dependency. An `ok: false` refusal carries no continuation.
- Continuation tokens are opaque command data, not secrets. They are rejected when malformed, mixed with a new condition, or used against a different repository or trunk.
- Projects refreshed after this change receive the provider timeout and capability declarations. Existing sessions must restart to load changed MCP configuration.
- Receipt-note recording remains fail-open for acceptance. Its rare failure can make an entirely gap-hidden green landing unprovable, but it cannot make `await` report a false success.

## Alternatives considered

- **Keep repository P90 bounds.** Rejected because a condition already returns early. An estimate below the transport budget only creates retries.
- **Use one provider-agnostic long call.** Rejected because Cursor CLI currently kills calls at 60 seconds.
- **Use one provider-agnostic 45-second call.** Rejected because it spends unnecessary round trips and tokens on four configurable clients.
- **Select the bound from detected client identity.** Rejected because identity is advisory and can be forged. Provider-written server capability flags state the transport contract directly.
- **Treat any trunk movement after a vanished branch as a green landing.** Rejected because unrelated work can move the trunk. A landed receipt note identifies the validated branch without inference.
- **Stop after a fixed number of continuations.** Rejected because retry count says nothing about whether the watched work is still meaningful or close to completion.
