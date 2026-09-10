---
title: Change the landing plan
description: Hold, withdraw, revoke, or reorder an effort without discarding its validation evidence.
order: 125
aliases:
  - hold an effort
  - withdraw an effort
  - reprioritize the queue
---

# Change the landing plan

Queue decisions change what may land next. They preserve candidate evidence and do not remove a checkout. Stopping a command does not imply any of these decisions.

| Action         | Effect                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `hold`         | Keep approval and evidence while excluding the effort from landing. Independent work can proceed.                                 |
| `resume`       | Remove that hold. Current evidence, dependencies, and permission still govern eligibility.                                        |
| `withdraw`     | Remove the effort from the landing plan and remove its queue approval.                                                            |
| `revoke`       | Remove queue approval and prevent an ambient grant from restoring it. Fresh explicit approval can authorize the unchanged source. |
| `reprioritize` | Replace the order of eligible efforts, preserving source dependencies.                                                            |

Preview an action from main or the effort's worktree with `accept hold --target <effort-id> --dry-run`. Review the returned target, affected efforts, and before/after order. After the owner instructs the change, repeat the command with `--confirmed --expected <expected_state>`. The token pins the reviewed queue. A changed queue requires another preview; repeating an already established decision changes nothing.

For `reprioritize`, repeat `--order <effort-id>` for every eligible effort in the desired order. A required source dependency must precede its dependent. Holding or withdrawing it does not authorize the dependent to bypass it. Dependency facts describe recorded source relationships; they cannot infer every semantic dependency in the project.

An approval and a passing Proof have separate lifetimes. Failed validation removes an effort from eligible order while preserving its approval. Fresh complete evidence lets it re-enter behind work already eligible. A restored exact predecessor removes only the resolved ordering reason; source, policy, and evidence failures still apply.

Use `accept --target <effort-id> --dry-run` to inspect the resulting landing plan. The preview leads with the selected effort's own verdict, then lists the queue in order — the same list `discern status` shows — with the single reason each other effort waits. Apply rechecks those facts before each transition. Each earlier effort in the queue needs its own current evidence and authority. An entry whose recorded work is already on the trunk offers its own withdrawal or reconciliation in its row.

Acceptance assesses the requested effort together with its earlier separately authorized efforts. Later unrelated candidates do not require validation assessment. [The planner](../../../src/engine/landing_queue/planner.ts) obtains its short publication claim after expensive assessment, then rechecks the observed records and trunk. Publication also checks current authority and checkout state. Expiry refuses publication and leaves evidence intact; retry acceptance for the same effort. A lost reservation does not itself require another gate.
