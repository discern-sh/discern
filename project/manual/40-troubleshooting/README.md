---
id: troubleshooting-index
title: "Troubleshooting"
description: "Match an observable symptom to the smallest safe recovery, starting from the result in front of you."
order: 0
publish: true
kind: troubleshooting
aliases:
  - "troubleshooting-index"
  - "FAQ and troubleshooting"
  - "faq"
  - "setup problems"
  - "doctor"
  - "something went wrong"
  - "error recovery"
redirect_from:
  - "/docs/getting-started/faq"
---

# Troubleshooting

Something failed, refused, or doesn't look right. Before you search anywhere (including here), look at the result in front of you: discern designs every failure to carry its own recovery, naming what went wrong and the next valid action. Most problems end there. This section is for the rest: recognizing which class a symptom belongs to, checking the cause without making anything worse, and knowing when the next step is a person's decision rather than another retry.

## Before anything else

These reads are safe in any state and resolve most confusion:

### Read the result you already have

A failed result carries a message, diagnostics with the exact command that reproduces each problem, and a next-step instruction. Agents read the same envelope structurally (`--json` for fields, `--markdown` for prose), so "give the agent the result" is a complete instruction.

### Ask `discern status` where you are

`discern status` is read-only and reports the current state and the next valid action — including mid-setup phase, a worktree's Proof state, and fleet-wide conditions that need attention. When a session has lost the thread of where it was, this is the re-entry point. If the same loop keeps recurring across sessions, `discern patterns` reports it once the local evidence supports a finding.

### Start with `discern doctor`

`discern doctor` diagnoses the installation itself: config parsing, binary compatibility, job commands that resolve, agent integrations, and repository health. Every failed check names its fix. It's the first stop when the problem smells like "discern, here" rather than "this change." Capture `discern doctor --json` when filing a report.

## Find the symptom

| What you're seeing                                                                       | Where to go                                                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Installation, setup, or an agent connection can't begin, resume, or take effect          | [Setup and integrations](setup-and-integrations.md)                        |
| A configured check failed — build, lint, tests, a scope's gate                           | [Fix a red Gate](../10-guides/fix-a-red-gate.md), the working procedure    |
| The Gate refused, rewrote files, flagged a Standard or checkpoint, or withheld Proof     | [Gate and Proof](gate-and-proof.md)                                        |
| A worktree command refused; cleanup failed or left something; a path or branch came back | [Worktrees and resources](worktrees-and-resources.md)                      |
| A task was interrupted, or a branch was dropped and its work is needed back              | [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) |
| MCP tools are missing or stale; a wait ran out; docs won't resolve; output renders badly | [MCP, terminal, and docs](mcp-terminal-and-docs.md)                        |
| discern crashed, or you're wondering about `discern-…` temp files and `.git/discern`     | [Crashes and local state](crashes-and-local-state.md)                      |
| discern needs upgrading, formatting its own files, or removing from the project          | [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md)   |

## Recover without making it worse

The symptom pages share a few rules worth internalizing, because they're the difference between a bounded recovery and a new problem:

- **Repeat the named command, don't improvise around it.** discern's effectful commands re-check their preconditions and converge from whatever state they observe, so the safe retry is the _same_ command after its named blocker is fixed — not a hand-rolled equivalent in raw Git.
- **Edit sources.** A generated file's owner rewrites it, so a hand-edit to the generated copy is overwritten by design. The result always names the source, or the regeneration command, that owns the change.
- **Let lifecycle commands own deletion.** Worktree paths, branches, and discern's runtime state under `.git` all have verified-ownership cleanup. A recursive delete or a hand-removed Git entry bypasses every check that made cleanup safe.
- **Never clear a symptom by weakening protection.** Loosening a Standard, deleting a check, or forcing past a refusal makes the number green by removing what it measured. If a limit genuinely must move, that's an owner decision, made on the trunk.
- **Don't poll.** A wait that runs out returns a continuation to resume; a queued test run starts when a slot frees. Loops with sleeps recreate machinery that already exists.

## When to stop

Some next steps belong to a person, and no amount of retrying substitutes: authorizing a landing or a checkpoint variance, approving a Standard limit move, confirming a reclaim or prune, and any consent a provider's own interface asks for. A green Gate doesn't land work, and evidence doesn't grant authority — [Proof](../20-understand/proof.md) explains who decides what. And when a failure recurs identically after its named recovery, or arrives with no next step at all, stop treating it as your problem to route around: capture the result and [report it](crashes-and-local-state.md#discern-crashed).
