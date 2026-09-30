---
id: guide-land-an-urgent-repair
title: "Land an urgent repair"
description: "Land a fix before its tests and other checks finish, see exactly what you're skipping, and settle those checks afterwards."
order: 25
publish: true
kind: guide
aliases:
  - "guide-land-an-urgent-repair"
  - "emergency integration"
  - "emergency landing"
  - "accept emergency"
  - "hotfix"
  - "land without Proof"
  - "outstanding validation"
  - "skip the checks"
---

# Land an urgent repair

When a fix can't wait for your tests and other checks, you can land it now and check it afterwards. discern shows you every check you'd skip, and lands the fix only once you approve. It keeps a permanent record of the skipped checks, and reminds you until a later run settles them.

Only you can choose this route, and you choose it fresh each time: no permission you set up in advance covers it.

## Before you start

Say your recipe app is down for everyone, and the fix is one line. Your tests take twenty minutes, and you want the fix on `main` now.

Your agent has committed the fix in its own **worktree**, a separate copy of the project on its own branch, with the latest `main` brought in. It has also run what it could, such as a focused test. Keep other tasks' unlanded work out of that worktree, because it would land with the fix, unchecked.

The usual path, `discern done`, records **Proof** of which of your project's commands passed on one exact commit. Take the emergency route only when waiting for those checks costs more than landing without them.

## Ask for the emergency plan

Tell your agent:

> "Land the outage fix now as an emergency. Show me which checks it would skip and why, and wait for my approval before doing anything."

Your agent runs `discern accept emergency` with a reason. This first call changes nothing and returns a plan:

```text
Emergency plan for `agent/outage-fix-6c55e3`: land 1 commit on main now, skipping 2 checks. Reason: The recipe app is down for everyone; the fix is one line

`a90500f1fca0` Treat a missing search as empty

stale: job format
stale: job test
```

The plan lists each commit it would add to `main` and each check it would skip: `failed`, `unrun` if it never ran, or `stale` if its results are for an older version. Here, the formatter and the tests last ran before the fix.

A failing **standard**, one of your project's measured limits, is listed with the skipped checks, and its limit stays the same unless you approve a new one separately.

If the fix touches files a **checkpoint** watches, your agent answers that review question first, because urgency doesn't remove a judgment your project asked for. An unmet answer shows in the plan, and landing then also needs your **variance**, your permission to land despite that answer.

## Decide

Read the plan as a list of what you're accepting. A check that didn't run is unknown, and one that failed is a known problem you're taking on for now. Ask your agent what each skipped check covers in your app. To approve, say so plainly:

> "Approved. Land it as an emergency with that reason."

Your agent runs the command again with your confirmation and the plan's approval token. The token expires after 15 minutes, and a change to the plan, such as a moved `main`, needs your approval again.

## What an emergency landing records

The result says the fix is on `main` and landed without Proof: an **emergency landing**. discern keeps a permanent record of the skipped checks and your reason. It's separate from Proof, and nothing reads it as a pass.

Otherwise it's an ordinary landing: discern cleans up the worktree as usual. discern doesn't push or deploy, so your release process, branch protection, and deployment approvals still apply.

## Settle the outstanding checks

Until the skipped checks pass, `discern status` shows them as outstanding. Ask for the follow-up while the incident is fresh:

> "Run the full checks on the landed fix and settle what the emergency skipped."

Your agent runs `discern done --rerun` on the current `main`, or on a later change that contains the fix. A passing run that covers the skipped checks settles them, and removing a check from the project doesn't. If the checks fail, your agent fixes the cause in an ordinary task.

## If discern itself can't run

If you must move `main` with plain Git because discern won't start, note what you moved, why, and which checks didn't run. discern can't vouch for a change that landed outside it, so have your agent run those checks once discern works again.

## You're done when

The fix is on `main` with an emergency record of what was skipped. Either a passing run has settled those checks, or a follow-up task is fixing what failed.

[From green to live](../10-understand/proof.md#from-green-to-live) shows where emergency landings fit. The [results reference](../30-reference/mcp-and-results.md#emergency-integration) has the exact inputs.
