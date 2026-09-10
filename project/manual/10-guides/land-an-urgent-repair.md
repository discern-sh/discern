---
id: guide-land-an-urgent-repair
title: "Land an urgent repair"
description: "Land a fix before its checks can finish, understand what you are accepting, and settle the checks afterwards."
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

Your app is down for the people using it, and the fix is a one-line change. The project's full checks take twenty minutes. You want the repair on the shared branch now and the checks done afterwards.

discern has a supported route for that moment. It lands the repair without waiting for Proof, records which checks it skipped, and keeps reminding the project until those checks are settled. You decide to take the route each time; nothing your agent says, and no standing permission, can take it for you.

## Starting state

The repair is committed in its own worktree and includes the current shared branch. The agent has run what it can: a focused test, `discern prepare`, or the checks that fit the time you have. Ordinary completion through `discern done` would produce Proof, and that is still the normal path when time allows.

Choose this route when waiting for the checks costs more than the risk of landing without them. A task that merely feels urgent does not qualify on its own; saying "urgent" in a request gives your agent no authority to skip anything.

## 1. Ask for the plan

Tell your agent:

> Land the outage fix now as an emergency. Show me exactly which checks it would skip and why, and wait for my approval before doing anything.

The agent runs `discern accept emergency` with a reason and no confirmation. That call changes nothing. It shows the repair, the shared branch it would land on, the reason, and every check that failed, never ran, or has evidence too old to count. If the repair is behind the shared branch, the agent updates it first and asks for a fresh plan.

If the project has review questions (checkpoints) that match the repair, the agent answers them first through a separate preparation step. An unanswered or unmet question still blocks the emergency route; urgency does not remove judgment the project asked for.

## 2. Decide

Read the plan as a list of what you are accepting. A test that never ran is unknown. A test that failed is a known problem you are choosing to live with for now. Ask the agent what each skipped check covers in terms of your app.

When you approve, say so plainly:

> Approved. Land it as an emergency with that reason.

The agent repeats the command with your confirmation and the token from the plan. The token expires after 15 minutes and stops matching if the repair, the shared branch, or the reason changes; a changed plan comes back for a fresh decision. Standing grants, earlier approvals, and permission to land ordinary work never cover this step.

## 3. Read what landed

The result says the repair is on the shared branch and that it landed without Proof. It carries an **emergency exception**: a permanent record of the checks that were skipped and your reason. The exception is a different kind of record from Proof and can never be mistaken for one.

Landing here is the same landing as any other: the shared branch moved. Publishing to users still follows your release process, and any branch protection or deployment approval outside discern keeps its own say.

## 4. Settle the outstanding checks

Until the skipped checks pass, `discern status` reports the exception as outstanding. Ask for the follow-up while the incident is fresh:

> Run the full checks on the landed fix and settle the outstanding emergency validation.

The agent runs `discern done --rerun` on the current shared branch, or on a later change that contains the repair, in every required context. A passing result settles the outstanding checks and the exception stops appearing in everyday status. The historical record stays: anyone reading the project's history can see that this repair landed first and was checked afterwards.

If the checks fail, you have found the cost of the shortcut early. The agent fixes the cause in an ordinary task and lands the correction with Proof.

## If discern itself cannot run

An installation that will not start cannot record an exception. If you must move the shared branch with plain Git, keep a note of what you moved, why, and which checks were not run, and ask your agent to inspect `discern status` and run current validation once discern works again. discern cannot vouch for a change that landed outside it.

## Completion

The repair is on the shared branch, the exception record names what was skipped, and a later passing run has settled the outstanding checks or a follow-up task is fixing what they found. [Proof](../20-understand/proof.md#from-green-to-live) shows where the exception sits among the ordinary states, and the [MCP and results reference](../30-reference/mcp-and-results.md#emergency-integration) lists the exact inputs your agent uses.
