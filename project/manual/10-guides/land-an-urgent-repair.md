---
id: guide-land-an-urgent-repair
title: "Land an urgent repair"
description: "Land a fix before its checks finish, see exactly what you're skipping, and settle the checks afterwards."
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

When a fix can't wait for your project's full checks, you can land it now and run the checks straight afterwards. discern shows you every check you'd skip, and lands the fix only after you approve that plan. It keeps a permanent record of what was skipped, and reminds you until a later run settles it.

Say your recipe app is down for everyone, and the fix is one line. The full checks take twenty minutes. You want the fix on `main` now, and the checks done after.

Only you can choose this route, and you choose it fresh each time. No request from your agent, earlier approval, or standing permission can choose it for you.

## Before you start

The fix is committed in its own **worktree**, a separate copy of the project on its own branch. It includes the latest `main`. Ideally it holds nothing else: any other task's unlanded work in it lands with the fix, also unchecked, and the plan names that task. Your agent has run what it could in the time, such as a focused test or `discern prepare`.

The usual path, `discern done`, produces **Proof**: discern's record of which checks passed on exactly which commit. When there's time, use it. Take the emergency route only when waiting for the checks costs more than landing without them. Calling something urgent doesn't give your agent permission to skip anything.

## Ask for the plan

Tell your agent:

> Land the outage fix now as an emergency. Show me which checks it would skip and why, and wait for my approval before doing anything.

The agent runs `discern accept emergency` with a reason. This first call changes nothing. It shows the fix, each commit it would add to `main`, any other task whose unlanded work comes with it, the `main` commit it would land on, your reason, and every check that failed, didn't run, or has results too old to count. If `main` has moved on, the agent updates the fix first and asks for a new plan.

A fix that breaks one of your project's **standards**, such as a limit on duplicated code, lands with that standard among the skipped checks, and the limit stays as it was. If you agree the limit itself should change, the agent records the new limit and its reason first. The plan then shows the old and new limit, and asks you to approve that change on its own, as an ordinary landing would. A fix can't redefine or delete a standard this way.

Your project may have **checkpoints**, review questions for certain kinds of change. If one applies to the fix, the agent answers it first, in a separate preparation step. An unanswered or unmet question still blocks the emergency route. Urgency doesn't remove a judgment your project asked for.

## Decide

Read the plan as a list of what you're accepting. A check that didn't run is unknown. A check that failed is a known problem you're choosing to live with for now. Ask your agent what each skipped check covers in your app.

To approve, say so plainly:

> Approved. Land it as an emergency with that reason.

The agent runs the command again with your confirmation and the plan's approval token, plus a separate token for each limit change you approved. The token expires after 15 minutes. It also stops working if anything in the plan changes, such as the fix, `main`, or the reason. A changed plan comes back to you for a new decision.

## Read what landed

The result says the fix is on `main`, and that it landed without Proof. That's an **emergency landing**. discern keeps a permanent record of the skipped checks and your reason. The record is a different kind from Proof, and nothing reads it as a pass.

In every other way, it's an ordinary landing. `main` now includes the fix, and discern cleans up the worktree as usual. discern doesn't push or deploy. Getting the fix to your users still follows your release process, and any branch protection or deployment approval outside discern still applies.

## Settle the outstanding checks

Until the skipped checks pass, `discern status` and the desk show the emergency's checks as outstanding. Ask for the follow-up while the incident is fresh:

> Run the full checks on the landed fix and settle the outstanding emergency checks.

The agent runs `discern done --rerun` on the current `main`, or on a later change that contains the fix. A passing run that covers the skipped checks settles them, and the emergency stops showing in everyday status. Removing a check from the project doesn't settle it. The record stays in the project's history, so anyone can see that this fix landed first and was checked afterwards.

If the checks fail, you've found the cost of the shortcut early. The agent fixes the cause in an ordinary task, which lands with Proof.

## If discern itself can't run

If discern won't start, it can't record an emergency landing. If you must move `main` with plain Git, write down what you moved, why, and which checks didn't run. Once discern works again, ask your agent to check `discern status` and run the checks. discern can't vouch for a change that landed outside it.

## You're done when

The fix is on `main`, and its emergency record names what was skipped. Either a later passing run has settled those checks, or a follow-up task is fixing what they found.

[From green to live](../20-understand/proof.md#from-green-to-live) shows where an emergency landing sits among the ordinary stages. The [MCP and results reference](../30-reference/mcp-and-results.md#emergency-integration) lists the exact inputs your agent uses.
