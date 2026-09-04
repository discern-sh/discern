---
id: guide-delegate-work
title: "Delegate substantial work"
description: "Shape substantial work into owned seams, dispatch it deliberately, and inspect decisions in one place."
order: 90
publish: true
kind: guide
aliases:
  - "guide-delegate-work"
  - "The Desk"
  - "interactive worktree manager"
  - "fleet dashboard"
  - "worktree picker"
  - "desk tips"
  - "tip line"
  - "Bundled Skills"
  - "built-in skills"
  - "bundled playbooks"
  - "skill catalog"
---

# Delegate substantial work

Use this guide when a goal deserves a fresh coding-agent task, several independent streams, or staged work that will build on an earlier result. The outcome is a set of self-contained briefs, one owned worktree per stream, a declared landing order, and a return path that does not make the person relay status between agents.

The person controls dispatch and every landing decision. A planning agent may prepare the briefs and offer to launch them, but it does not start sessions, worktrees, or sub-agents until the person accepts the stated topology.

## Starting state

- The person and planning agent have discussed a broad goal, its constraints, and why it matters.
- No delegated session has started yet.
- The planning agent can inspect the project instructions, relevant code and docs, current fleet, and available capacity.
- Any unresolved choice that would change the deliverable is either answered by the person or assigned to the receiving agent with a required rationale.

## 1. Ask the agent to use the delegation Skill

**Person:** Ask the planning agent to use `discern-delegate-work`.

**Planning agent:** State the goal as one observable result. Identify the concrete changes, exclusions, likely files, and decisions. Challenge a proposed split when its streams would edit the same authority or generated output.

The Skill is the operating procedure for prompt design, dispatch consent, staged dependencies, and adversarial review. This guide keeps the person-facing decisions visible.

## 2. Choose the smallest topology that fits

**Planning agent:** Present the proposed topology before writing or launching tasks.

| Work pattern                                              | Task arrangement                                                         | Landing rule                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| One bounded outcome                                       | One brief, one session, one worktree                                     | That branch proves and lands under its own authority.                                |
| Independent internal investigations with one final change | One brief that asks the receiving agent to use sub-agents when available | The receiving task owns one branch and one final Proof.                              |
| Independent delivery streams with disjoint files          | One brief, session, and worktree per stream                              | Fix an order; each later stream updates after earlier landings.                      |
| A later stage must include an earlier unlanded tree       | One brief per stage                                                      | Earlier stages stop green and stay available; the final composed branch alone lands. |

When files or registries overlap, merge the streams or put the shared authority in an earlier stage. Parallel edits to one source of truth postpone the collision rather than removing it.

## 3. Make every brief stand alone

**Planning agent:** Write each brief for a fresh agent that has no access to this conversation. Include:

- a title and one-line human outcome;
- the literal worktree name to pass to `discern_start`;
- the first orientation and re-root actions;
- background that the repository does not record;
- ordered required changes anchored in real files, tests, and existing patterns;
- owned files, exclusions, and sibling work already in flight;
- unresolved decisions the receiving agent must make and explain;
- measurable and user-visible completion conditions;
- the `discern_prepare`, commit, `discern_done`, and acceptance sequence;
- landing authority, or an instruction to stop at Proof when none is recorded.

For a saved programme brief, include the final move into the adjacent `_done/` directory. For multiple streams, give each one a key such as `1A` and a literal slug-first worktree name such as `billing-1a`.

## 4. State dependencies without making a person the messenger

For an independently landed dependency, the later brief names the earlier branch and waits for it to be landed. For below-trunk composition, it waits for the earlier branch to become green.

**Planning agent:** Put an exact returned worktree selector into the dependent brief after the earlier task starts, and retain its branch for a landing watch that may begin after cleanup. Tell the receiving agent to use `discern-await-the-fleet` and follow the met result's composition hint. Do not guess identity from the requested name.

The waiting agent receives the commit or trunk transition from repository evidence. The person can leave both tasks running without carrying “ready” messages between them.

## 5. Return dispatch to the person

**Planning agent:** Present every finished brief as a complete copyable block. Outside the briefs, state:

- how many sessions and worktrees will start;
- whether one receiving session will use sub-agents;
- which streams run together and which wait;
- shared capacity or setup requirements;
- the within-wave landing order;
- the authority each landing branch must satisfy.

Offer to dispatch if the environment supports it, then wait.

**Person:** Review the briefs and topology. Launching them, or explicitly accepting the dispatch offer, authorizes only that described set. A changed stream count, dependency, or ownership boundary returns for a new decision.

**Planning agent:** After launch, record each returned branch and path. A result that is still preparing a worktree is not a branch identity for a dependent task.

## 6. Inspect decisions from the Desk

**Person:** From the main checkout, run bare `discern`.

The Desk groups the fleet by current state and offers valid actions for the selected worktree. Use it to start a task, open a configured coding-agent CLI found on `PATH`, inspect a branch, or record a one-worktree landing grant. It owns child sessions it launches.

Treat the desk as a decision surface. A tip below status is advisory, and a clean worktree remains occupied. Use `discern status --verbose` when you need the full evidence behind a row.

The selected task determines which actions are available, recommended, disabled, or require confirmation. This guarded projection keeps their labels and command evidence aligned with the live desk registry:

<!-- BEGIN DESK ACTION REGISTRY -->

| Id             | Group  | Contextual label                                                                | Command evidence                     | Confirmation                                                     |
| -------------- | ------ | ------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `recovery`     | Work   | Show recovery steps                                                             | `discern status --all`               | None                                                             |
| `retry_setup`  | Manage | Retry setup                                                                     | `discern worktree setup`             | No by default; Retry                                             |
| `done`         | Work   | Run final checks                                                                | `discern done`                       | No by default; Run                                               |
| `accept`       | Review | Run final checks, then land on &lt;trunk&gt; / Review and land on &lt;trunk&gt; | `discern accept`                     | No by default; Land                                              |
| `update`       | Manage | Update branch from &lt;trunk&gt;                                                | `discern update`                     | No by default; update                                            |
| `agent`        | Work   | Continue with an agent                                                          | `<configured-agent>`                 | None                                                             |
| `follow_up`    | Work   | Start a follow-up from this task                                                | `discern start --from <branch>`      | None                                                             |
| `scripts`      | Work   | Run a Project Script                                                            | `discern scripts <name>`             | No by default; Run                                               |
| `jump`         | Work   | Open a shell                                                                    | `<user-shell>`                       | None                                                             |
| `inspect`      | Review | Review Proof and changes                                                        | `git diff`                           | None                                                             |
| `rename`       | Manage | Change task title                                                               | `discern worktree rename <title>`    | No by default; Change                                            |
| `grant`        | Manage | Pre-authorize landing once green                                                | `discern desk`                       | No by default; Allow                                             |
| `revoke_grant` | Manage | Revoke landing pre-authorization                                                | `discern desk`                       | No by default; Revoke                                            |
| `reclaim`      | Manage | Reclaim checkout, keep branch (work contained in &lt;later-branch&gt;)          | `discern worktree prune --contained` | No by default; Reclaim                                           |
| `park`         | Manage | Park checkout, keep branch                                                      | `discern worktree park <path>`       | No by default; Park                                              |
| `drop`         | Danger | Drop worktree and branch                                                        | `discern worktree drop <path>`       | No by default; Drop, then type the branch before discarding work |

<!-- END DESK ACTION REGISTRY -->

Grant and revoke remain person-only actions inside `discern desk`. Every lifecycle action rechecks current state after confirmation.

Broken, setup-incomplete, and Git-unreadable tasks recommend **Show recovery steps**. The read-only detail names the failed command, verified identities, unavailable facts, and one next step. **Retry setup** appears only when the setup journal makes replay safe. **Park** removes a clean healthy checkout and its resources while retaining the branch and task wording. **Reclaim** retains a contained stage's branch because a live successor carries its work. **Drop** remains the destructive path for an effort the person intends to discard.

## 7. Review returned work independently

When a task reports green, **person or reviewing agent:** inspect the branch diff against the trunk, compare every deliverable with the brief, exercise the real outcome, and read its current Proof. Check for scope drift, a weakened test or policy, a hand-edited generated file, an uncured defect class, and decisions made without the required owner input.

Send focused feedback back to the same worktree. Any resulting commit stales its Proof, so the receiving agent must run the final gate again. A green report remains unlanded until the recorded authority covers the final changed paths and any separate variance or standard proposal.

## The bundled catalog

### Bundled Skills

`discern skills list` shows the effective bundled and project-authored skills. Name the relevant skill in a brief instead of copying its full procedure. Delegation commonly composes with `discern-await-the-fleet`, `discern-cure-a-bug`, `discern-write-adr`, and `discern-teach-the-project`. [Create and manage skills](create-and-manage-skills.md) covers customization and exclusions.

## Completion

Delegation is ready when the person has reviewed the full brief set, each stream owns disjoint in-flight files or a stated stage boundary, every literal worktree name and dependency is known, dispatch authority is explicit, and the landing rule is written into each brief. It is complete when every returned branch has been reviewed against its brief and either landed under verified authority or remains at current Proof for a person to decide.

Use [Coordinate parallel tasks](coordinate-parallel-tasks.md) for worktree composition, [Wait for another task](wait-for-another-task.md) for a dependency procedure, and [Proof, review, and authority](../20-understand/proof.md) for the landing boundary.
