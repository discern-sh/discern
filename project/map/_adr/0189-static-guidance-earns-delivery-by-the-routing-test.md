# ADR 0189: static guidance earns delivery by the routing test

**Status**: accepted; gives the guidance-words ceiling its admission rule, builds on the moment-of-need channels of [ADR 0172](0172-hints-compile-from-a-registry.md) and [ADR 0185](0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md), and continues the practice [ADR 0188](0188-the-receipt-relays-as-one-line.md) applied to one sentence.

## Context

discern now delivers operating knowledge to agents through three channels: the compiled guidance (static — read once at session start, decaying over a long session), the result envelope (hints, refusals, and messages arriving at the exact moment of a call), and the self-describing tool surface (descriptions and parameter schemas, always in an MCP session's context).

The static channel was governed only by a word ceiling, and the ceiling was being outgrown rather than enforced: the measured count tracked 825 → 900 in a week, with the limit raised twice — every addition individually justified, no addition ever asked to justify its _channel_. Meanwhile the logbook kept showing that static words don't survive to their moment: `skipped-prepare` fired on ten branches while the prepare line sat in both static surfaces, and the unchanged-tree rerun loop only ended when a refusal ([ADR 0185](0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md)) replaced prose. Delivery at the moment of need also asks nothing of a model's recall, which matters because discern serves every coding agent, not only the strongest.

## Decision

A sentence earns a place in the bundled guidance templates only by the **routing test**: it must be needed _before_ the first relevant tool call, and that call must be unable to deliver it. Mechanics that an envelope, a refusal, or a tool description already carries belong to that channel alone.

Two standing exemptions, both because no verb-mediated channel can arrive in time:

- **The channel-down fallback.** The CLI troubleshooting path is read when the MCP channel is unavailable, so it must be static.
- **Destructive-class rules that verb-bypassing edits can violate** — working on the trunk, adopting another effort's worktree. A file edit calls no verb first, so static prose (and session hooks) are the only channels that can pre-empt it. These rules may repeat across surfaces; the redundancy is protective, and weaker models lean on it.

The ceiling is pinned at the routed value and moves only for sentences that pass the test.

## Consequences

- The guidance reads as pre-call policy; mechanics live where they fire. A change to a verb's mechanics no longer needs a guidance edit.
- The behaviour detectors act as the guidance's regression suite: a detector that keeps firing indicts a delivery channel, and the response ladder is enforce > refuse > hint > static prose — never more static words.
- The shipped corpus is registry-guarded (`tests/guidance_corpus_guard_test.ts`), so routing prose between channels cannot strand a stale command, tool, or skill reference.
- The test is applied in review, recorded here and beside the standard in `discern.toml`; it is judgment, not lint — a machine cannot decide what a call can deliver.
