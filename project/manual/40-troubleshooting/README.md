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

Something failed, refused, or doesn't look right. Before you search anywhere (including here), look at the result in front of you. discern designs every failure to carry its own recovery: what went wrong, and the next valid action. Most problems end there. This section is for the rest. It helps you match a symptom to its class, check the cause without making anything worse, and know when the next step is a person's decision rather than another retry.

## Before anything else

These reads are safe in any state and resolve most confusion:

### Read the result you already have

A failed result carries a message, a next-step instruction, and diagnostics with the exact command that reproduces each problem. Agents read the same envelope structurally: `--json` for fields, `--markdown` for prose. That's why "give the agent the result" is a complete instruction.

### Ask `discern status` where you are

`discern status` is read-only. It reports the current state and the next valid action, from a mid-setup phase to a worktree's Proof state to fleet-wide conditions that need attention. When a session has lost the thread of where it was, this is the re-entry point. If the same loop keeps recurring across sessions, `discern patterns` reports it once the local evidence supports a finding.

### Start with `discern doctor`

`discern doctor` diagnoses the installation itself: config parsing, binary compatibility, job commands that resolve, agent integrations, and repository health. Every failed check names its fix. It's the first stop when the problem smells like "discern, here" rather than "this change". Capture `discern doctor --json` when filing a report.

## Find the symptom

| What you're seeing                                                    | Where to go                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Setup or an agent connection won't begin, resume, or take effect.     | [Setup and integrations](setup-and-integrations.md).                        |
| A configured check failed: build, lint, tests, a scope's gate.        | [Fix a red Gate](../10-guides/fix-a-red-gate.md), the working procedure.    |
| The Gate refused, rewrote files, or withheld Proof.                   | [Gate and Proof](gate-and-proof.md).                                        |
| A Standard or checkpoint stopped the change.                          | [Gate and Proof](gate-and-proof.md).                                        |
| A worktree command refused, or cleanup failed or left something.      | [Worktrees and resources](worktrees-and-resources.md).                      |
| A removed path or branch came back.                                   | [Worktrees and resources](worktrees-and-resources.md).                      |
| A task was interrupted, or a dropped branch is needed back.           | [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md). |
| MCP tools are missing or stale, or a long wait ran out.               | [MCP, terminal, and docs](mcp-terminal-and-docs.md).                        |
| A docs page won't resolve, or output renders badly.                   | [MCP, terminal, and docs](mcp-terminal-and-docs.md).                        |
| discern crashed, or you found `discern-…` files and `.git/discern`.   | [Crashes and local state](crashes-and-local-state.md).                      |
| discern needs upgrading, tidying its files, or removing.              | [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md).   |

## Recover without making it worse

The symptom pages share a few rules. They're the difference between a bounded recovery and a new problem:

- **Repeat the named command, don't improvise around it.** discern's effectful commands re-check their preconditions and converge from whatever state they observe. The safe retry is the _same_ command after its named blocker is fixed; a hand-rolled equivalent in raw Git skips those checks.
- **Edit sources.** A generated file's owner rewrites it, so a hand-edit to the generated copy is overwritten by design. The result names the source, or the regeneration command, that owns the change.
- **Let lifecycle commands own deletion.** Worktree paths, branches, and discern's runtime state under `.git` all have verified-ownership cleanup. A recursive delete or a hand-removed Git entry bypasses every check that made cleanup safe.
- **Never clear a symptom by weakening protection.** Loosening a Standard, deleting a check, or forcing past a refusal makes the number green by removing what it measured. If a limit genuinely must move, that's an owner decision, made on the trunk.
- **Don't poll.** A wait that runs out returns a continuation to resume. A queued test run starts when a slot frees. Loops with sleeps recreate machinery that already exists.

## When to stop

Some next steps belong to a person, and no amount of retrying substitutes. Authorizing a landing or a checkpoint variance, approving a Standard limit move, confirming a reclaim or prune, and any consent a provider's own interface asks for are all decisions. A green Gate doesn't land work, and evidence doesn't grant authority; [Proof](../20-understand/proof.md) explains who decides what. And when a failure recurs identically after its named recovery, or arrives with no next step at all, stop routing around it. Capture the result and [report it](crashes-and-local-state.md#discern-crashed).
