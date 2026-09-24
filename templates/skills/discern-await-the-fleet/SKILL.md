---
name: discern-await-the-fleet
description: Wait for another workstream with one blocking `discern_await` call — a sibling branch green, its work landed, or the trunk moved — then compose what arrived. Use when a task depends on another agent's in-flight work; when the user says "wait for", "watch", or "check back on" a branch, worktree, sibling agent, or the trunk; when a brief names a dependency to await; or when tempted to poll status, sleep, or ask the user to relay readiness. Not for sub-agents inside your own session. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Await the fleet

When your work depends on another workstream — a sibling worktree still running, or a landing that hasn't reached the trunk yet — `discern_await` holds one blocking call until the dependency is real, then names your next step. It replaces guessed status polling, sleep loops, and a human relaying "it's done" between sessions. The verb is read-only: it blocks only your call, holds no lock, and gates nothing.

_If the user adds their own instructions or context when invoking this skill, those take precedence. Everything below yields to what they tell you in the moment._

---

## 1. Name the condition

Pass exactly one condition per call. Choose it from what your work actually needs, not from which sounds strongest:

| Your task needs                                     | Condition                    | It holds when                                                                                   |
| --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| To build on the sibling's tree before it lands      | `green` (a worktree selector) | The selected branch holds a passing full-gate Proof on its current clean commit, or its work lands |
| The sibling's work present beneath yours, via trunk | `landed` (a worktree selector) | The selected branch's observed work is reachable from the trunk                                  |
| To react to any trunk movement at all               | `trunk_moved` (no selector)   | The trunk ref differs from where it stood when the watch began                                   |

`green` is the bar for composing below the trunk: it proves the work passed its gate, not merely that a branch exists. A sibling that hasn't committed yet is not green — the watch keeps waiting, which is correct, not stuck. `landed` answers the literal arrival question and is the right condition when you only need the work in the trunk before continuing.

## 2. Resolve the exact worktree

Await an exact stable selector from `discern_start` or the sibling's `discern_status` fleet row: its worktree id, absolute path, local branch, or full local ref. Prefer the id while the checkout is live; retain the exact branch when a new `landed` watch may begin after acceptance has removed the checkout. These forms resolve to the same live worktree, including one temporarily detached from its branch while discern validates it. A display title, requested name, prefix, or paraphrase is not identity, so never guess one. Ambiguity is a refusal, never a fleet-order choice.

If the dependency may already hold, call `discern_await` anyway: a condition that is already true returns met immediately. Do not pre-check with your own status or Git reads — the verb is the check.

## 3. Spend one call, and hold it quietly

Wait from your effort's worktree if it has one, or from the main checkout if your work hasn't started yet. Pass that checkout's absolute path to every `discern_await` call. Call `discern_await` with the one condition and omit the timeout: discern holds the call for the longest bound the transport reliably supports, and returns the moment the condition holds.

Do not surface progress updates until it returns. On `data.met: false`, continue with `data.resume` without surfacing an update; repeat without a fixed limit until met, stopped, or unneeded. Never resume `ok: false`; follow its recovery hint. Report only when the condition holds, the watch is unnecessary, or a refusal/error needs action. Always respond to new user input.

In a shell or script, the same watch composes on exit codes: `discern await --landed <worktree> && <next step>` proceeds only on met (0 met, 1 refusal, 124 not yet), and `--timeout 0` checks once without blocking.

## 4. Follow the met hint

A met result names your next step — take it literally instead of improvising:

- **Green, met live** — compose from the immutable observed commit the hint names (`discern_update` with `from` in your worktree, or `discern_start` with `from` before one exists), never from the branch name, which acceptance may delete out from under you.
- **Landed, or trunk moved** — bring the trunk in with `discern_update`, or start your worktree from it.

Then verify the dependency actually arrived in your tree — the files or behavior your brief depends on exist where it said — before building anything on top.

## 5. Refusals route forward

A refusal (`ok: false`) means the watch as posed cannot be answered, and it carries the recovery: follow its hint rather than retrying or resuming. The common ones: `green` for a branch whose checkout is gone refuses toward the stage now containing the work, or toward `landed` for the plain arrival question; a branch missing at call start refuses with the likely reading — never started, or already landed and cleaned up.

Relay the observed state without asking the user to reconstruct the watch:

> I waited for <condition>. The observed state is <observed_state>. I <next_action>.

## 6. When not to await

- **Your own branch.** Run your gate or do the work; awaiting yourself never returns.
- **A sub-agent or background task inside your own session.** Your own session already tracks those; `discern_await` watches other worktrees and the trunk.
- **Something only the user can supply.** A review, a decision, a credential — report what you need and stop; don't hold a call against a human.
- **A validation slot or a place in the landing queue.** `discern_done` explains a wait for a validation slot and names the setting that binds it; `discern_accept` explains a wait for its landing turn. `discern_await` watches outcomes (green, landed, trunk moved), never capacity.
- **A watch made unnecessary mid-wait** — the plan changed, the dependency got cut. Say so and move on; that is a valid end to the watch.

---

## Done when

- The dependency was expressed as one grounded condition against an exact returned worktree selector — never a display title, guessed name, polling loop, or sleep.
- One blocking call, resumed as needed, held the whole watch with nothing surfaced in between.
- On met, the hint's composition step ran and the arrived work is verifiably present beneath yours.
- On refusal, its recovery hint was followed or the situation reported — the condition was never blindly restarted.
