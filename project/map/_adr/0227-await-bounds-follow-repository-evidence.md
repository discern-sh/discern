# ADR 0227: `await` bounds follow repository evidence

**Status**: superseded by [ADR 0232](0232-await-continuations-spend-the-transport-budget.md). This was the intermediate replacement for the timeout and retry policy in [ADR 0213](0213-await-blocks-on-authoritative-fleet-conditions.md).

## Context

ADR 0213 gave MCP a 45-second default and the CLI a 100-second default. The MCP number treated the official TypeScript SDK's 60-second request default as a client ceiling. That premise did not survive use. The [SDK documents the value as a per-request default that callers can override](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md#timeouts), [GitHub's Copilot SDK documents a five-minute MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/mcp-debugging#timeout-errors), and owner tests have completed gates longer than five minutes through every supported client. The server does not own a universal transport budget.

The fixed slice also made the logbook advice feed back on itself. `await` is begin-recorded so fleet status can show that a branch is waiting. The fleet activity reader projected one unmatched begin per branch, always the newest. Once `await` began, it replaced the older in-flight `done` in that projection. The first 45-second timeout therefore had no `done` evidence and recommended 60 seconds. The next call saw the preceding `await` duration as its prior, subtracted the new call's elapsed time, and fell to the 30-second floor. A real gate with a stable two-and-a-half-minute history was invisible to the timing consumer.

The costs of a short and long bound are asymmetric. A short bound forces another tool call while the same work continues. A long bound does not delay success because every condition returns as soon as authoritative state changes; it matters only when the condition remains unmet or the caller has its own tighter request budget.

## Decision

**An omitted `await` timeout follows this repository's live activity and observed verb durations on both CLI and MCP. An explicit timeout remains an exact caller-owned bound.** The result reports `timeout_seconds` and `timeout_basis`, so the choice is inspectable. Zero remains the check-once form.

The logbook projection preserves every fresh unmatched begin on each branch, oldest first. Its existing compact `running` field remains the newest action for fleet status. Timing consumers choose from the complete `inFlight` set instead of inheriting that display choice. This is the class boundary: overlapping invocations on one branch do not structurally erase each other before a consumer applies its own selection rule.

For a branch condition, timing considers active actions on the watched branch. For `--trunk-moved`, it considers the fleet. It excludes `await` because waiting cannot make the watched condition true. Among actions whose verbs have completed duration samples, the action with the longest estimated remainder prices the call. An unpriced action is used only when no priced action is active, so a short coordination query cannot obscure known long-running work and an unknown helper cannot replace stronger evidence.

Each verb's duration prior carries the median, nearest-rank P90, and sample count. Status keeps the median as its compact "typical" reading. `await` uses:

```
max(30 seconds, P90 duration - elapsed time)
```

P90 is an upper-bound estimate rather than a typical-case estimate. It spends one open request to avoid repeated slices across the ordinary tail, while authoritative state still ends the call early. The current config epoch supplies samples when available; the bounded recent history remains the fallback, following the existing logbook rule.

Evidence-free cases have explicit fallbacks:

- active work with no completed sample: 600 seconds;
- no active work: 300 seconds;
- logbook turned off: 300 seconds, labelled `logbook-off`.

On "not yet", the same calculation runs again against current activity. `retry_after_seconds` is the suggested length of another bounded wait, not a delay before retrying. The result's `running` block identifies the selected action and carries its branch and elapsed time. When samples exist, it adds the median, P90, and sample count. This is intentionally different from status's newest-action display: status can say `running: await` while the timing evidence says `verb: done`.

Client cancellation still flows through the request abort signal and ends the wait promptly. discern does not claim to extend or bypass a caller-owned MCP request budget. A constrained client passes an explicit shorter timeout; clients that support longer calls can use the evidence-priced default.

## Consequences

- A repository with a two-and-a-half-minute gate history can make one suitably bounded call instead of stepping through 45, 60, and 30 seconds.
- CLI and MCP now share one policy. Vendor timeout research no longer creates product defaults that drift as clients change.
- The output explains both the bound this call used and the evidence behind another wait. Agents do not need to infer whether a number came from history or a fallback.
- Concurrent begin events become a richer internal projection. Existing status output stays compact and compatible because its `running` view remains the newest action.
- A P90 estimate can still be exceeded, and a condition that never becomes true can hold until the bound. That is why explicit timeouts and the bounded fallbacks remain part of the contract.
- The 600-second first-run bound favors fewer coordination calls over a quick answer when work has no history. It becomes irrelevant after the first completed sample and always returns early on a met condition.

## Alternatives considered

- **Keep 45 seconds for MCP and make only retry advice adaptive.** Rejected because 60 seconds is an SDK default, not a cross-client ceiling. The fixed first slice recreates the repeated-call problem even when the caller supports the repository's real runtime.
- **Use the median remainder.** Rejected because a median is a good compact description and a poor upper bound. Half the observed runs can exceed it, making retries routine by construction.
- **Use the longest historical duration.** Rejected because one stalled or interrupted outlier could hold an impossible condition for too long. P90 retains tail awareness without letting one sample dominate a mature history.
- **Stop begin-recording `await`.** Rejected because status should show that the branch is actively waiting. Preserving concurrent begins fixes the information loss without sacrificing that visibility.
- **Special-case `done` as the only timing verb.** Rejected because `--landed` and `--trunk-moved` can depend on other active verbs, and future coordination actions should enroll without changing a hand-maintained list. The only excluded action is the passive wait itself.
- **Rely on MCP progress notifications to defeat client timeouts.** Rejected as the timeout policy because progress is client-negotiated and cannot raise a caller's hard budget. Progress can accrete as observability without changing the evidence-priced bound.
