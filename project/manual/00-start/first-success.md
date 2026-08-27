---
id: start-first-success
title: "First success"
description: "Move one representative project from installation through setup, an isolated change, Gate evidence, review, and authorized landing."
order: 30
publish: true
kind: tutorial
aliases:
  - "install"
  - "start-first-success"
  - "Quickstart: from install to a passing final check"
  - "quickstart"
  - "The decisions setup asks you to make"
  - "setup choices"
  - "setup model"
  - "setup consent"
  - "Walkthrough: watch one change from setup to landing"
  - "walkthrough"
  - "setup walkthrough"
  - "first session"
redirect_from:
  - "/docs/getting-started/quickstart"
  - "/docs/getting-started/setup-decisions"
  - "/docs/getting-started/walkthrough"
---

# First success

Move one representative project from installation through setup, an isolated change, Gate evidence, review, and authorized landing.

## Quickstart: from install to a passing final check

_Install the binary, let your agent set the project up, and take one change through the project's final quality check, called the Gate._

You need a Git repository and a coding agent. discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. An installed project does not need Deno or Node to run discern because the product is one self-contained binary. Once installed, discern makes zero network calls.

discern sets no hard minimum model. For setup, it recommends the strongest suitable reasoning model available because that model authors the final quality check, separate-task rules, maintained project guide, and instructions later sessions inherit. [Setup decisions](first-success.md) explains the long-term benefit, how to switch models, and which later choices remain yours.

### 1. Install the binary

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

When the installer prints `Next:`, continue to step 2. If it prints a `PATH` instruction instead, follow it and open a new shell. Run `discern --version`, then continue. There is nothing else to configure by hand.

### 2. Ask your agent to set the project up

In your project, tell your agent:

> Set this project up with discern.

The agent runs `discern`, which starts a staged setup ([ADR 0075](https://discern.sh/docs/decisions/0075-setup-staged-handshake)). Before writing, its consent message covers the `discern.toml` and `discern/` footprint, coding-tool integrations, removal behavior, model, evidence-backed project name, separate-workspace location, and expected time and tokens. Confirm each item in plain language; the agent records that the complete exchange happened ([ADR 0086](https://discern.sh/docs/decisions/0086-setup-serves-relay-messages-and-a-consent-attestation)).

`setup verify` is read-only. Later commands check their planned write targets before effects and preserve the setup phase on denial ([Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)).

Setup stays on `discern-setup` until landing. After proving existing workflows together, the agent explains where later agents start, that area's responsibility, one important rule, and any other distinct area. Correct a substantive misunderstanding, or say “use your recommendation.”

Keep routine green output concise; use SARIF and JUnit XML only when they preserve exit status and improve failures. File-only and inherently verbose formats stay off that path.

### 3. Verify setup in an isolated checkout

`discern setup done` commits, diagnoses, and proves completion in a separate working copy. Repeating it unchanged returns the same [Proof](../20-understand/proof.md) without another Gate. A failed transaction removes only its still-owned marker tip; otherwise the retained state names recovery ([ADR 0090](https://discern.sh/docs/decisions/0090-setup-proves-worktree-viability), [ADR 0351](https://discern.sh/docs/decisions/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips)).

The result explains where later agents start, which other areas have distinct responsibilities, one important rule setup found, which checks now run, and what remains open. It also carries the precise branch, check, guide, and instruction inventories for technical review. Then it's your turn:

1. **Review and land.** Preview with `discern setup accept --dry-run`, or leave the proved branch for later. Do not restart before landing.
2. **Start a fresh session.** Inspect its registered tools before opening external documentation.
3. **Verify activation.** Invoke the exact provider-local action served by acceptance. If it is missing, use that provider's local recovery or `discern doctor`; `discern improvement --json` remains optional after success.

<!-- discern-workflow:procedure -->

## 4. Take a change through the Gate

In the fresh session, ask for a small, real change. The agent takes it through the same isolated lifecycle every time.

**Before you start:**

- Setup's `discern-setup` branch is reviewed and landed.
- The coding agent is running in a fresh session.

**Steps:**

1. **Start the worktree.** The agent runs `discern start`, then re-roots at its returned isolated checkout path on an `agent/…` branch.
2. **Make the change.** It edits and checks the requested work inside that worktree.
3. **Run the full Gate.** It runs `discern done`. The Gate runs the format, build, lint, and test commands declared in `discern.toml`. A failure gives the agent the failing command and its output.
4. **Report the result.** On green, the agent ends its report with the one-line Proof and waits. Read the full Proof with `discern status --verbose`.

**You are done when:** The reviewed branch and its Proof have been authorized, and `discern accept` has fast-forwarded the trunk.

<!-- /discern-workflow -->

Review the branch. When you authorize landing, the agent runs `discern accept`, which fast-forwards your trunk to the reviewed branch and removes the worktree ([ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model)). Acceptance reuses the Proof while the branch remains unchanged. A later commit invalidates the Proof, so the agent must run `discern done` again.

To drive the handoff yourself, run bare `discern` from the main checkout. The human view over work in progress ([the Desk](../10-guides/delegate-work.md)) can start the task, open a configured coding-agent CLI found on `PATH` in its new worktree, and present the valid actions through review and landing.

The change stays in its worktree until the Gate passes and recorded authority permits landing.

<!-- discern-workflow:branch-choice -->

**Choose what happens next**

- **Recommended:** Follow the [walkthrough](first-success.md) through one complete session.
- **Something went wrong:** Match the symptom in the [FAQ](../40-troubleshooting/README.md) to its fix.

<!-- /discern-workflow -->

## The decisions setup asks you to make

_Setup turns one repository study into a dependable way for future coding sessions to work. The agent handles the technical authoring; this page explains the choices that still belong to you._

### Choose the model for the repository study

discern recommends the strongest suitable reasoning model because setup creates the final quality check (the Gate), separate-task rules, maintained project guide (the Map), and instructions later sessions inherit. A stronger model is more likely to find hidden boundaries and preserve existing workflows.

The agent reports its current provider/model identifier, or `unreported`, as advisory context. To switch, select another model, open a fresh project session, and repeat the setup request. The current agent stops without writing. To continue here, say so plainly.

### Confirm what the project is called

Before writing the guide or instructions, setup proposes the strongest name supported by the README or project metadata; a checkout directory is a fallback. Confirm or correct it. When you have no preference, **“use your recommendation”** records your choice of the proposal.

### Know which choices remain yours

The agent handles routine, reversible branch work. It waits for missing product intent, cost, credentials, new dependencies, broader access, destructive effects, shared or durable data, future-work policies, exceptions, and landing.

Each applicable decision begins with its practical outcome, then gives a recommendation, every option's consequence, your authority, the reversal boundary, and recovery. For a safe reversible technical choice, **“use your recommendation”** records your direction. Consequential choices never use that route. An absent trigger produces no question or wait.

### Inspection stays inside the project

A project file can point to another checkout, database, or machine-local path. Setup reports the source, destination, and apparent role without opening it. The agent asks before a specific outside inspection; declining leaves the destination unread.

### Review what later sessions will inherit

Before landing, the handoff explains where later agents start, other areas with distinct responsibilities, one important rule, active checks, and open work. The proof that the finished change passed the project's checks (Proof) belongs to the exact commit and grants no landing authority. You may land, leave for review, or decline.

After landing, open a fresh provider session, inspect its registered tools, and invoke the exact local action shown. A missing action routes to local recovery or `discern doctor`.

Return to the [quickstart](first-success.md) for the shortest setup path, or follow the [walkthrough](first-success.md) for the branch and verification sequence.

## Walkthrough: watch one change from setup to landing

_The [quickstart](first-success.md) gives you the commands. This tour explains the handoffs: why the flow pauses, changes branches, or asks you to restart a session._

### Setup asks before it writes

Tell your coding agent:

> Set this project up with discern.

The agent runs `discern`. In a repository without an install, discern serves a welcome with the model recommendation, switch route, and lasting outcome. [Setup decisions](first-success.md) explains the owner boundary.

The selected agent runs `discern setup verify`. Read its consent message before answering. It reports the self-declared provider/model identifier, or `unreported`, proposes a project name from repository evidence, and names paths, coding agents, separate-workspace location, expected investment, removal, and confirmation authority. Correct a wrong project name, model path, or agent set first.

Reply in plain language, for example:

> Continue with this model. Set up Codex and Claude Code in this repository, keep the proposed worktree location, and begin the isolated setup branch.

The agent attests that consent happened when it begins ([ADR 0086](https://discern.sh/docs/decisions/0086-setup-serves-relay-messages-and-a-consent-attestation)). `verify` remains read-only. Each later effectful command checks its plan-derived writes before its first effect. Denial preserves the phase, and success is point-in-time rather than provider authorization; see [Setup command boundaries](../40-troubleshooting/setup-and-integrations.md).

### Setup builds on its own branch

`discern setup begin` creates and checks out `discern-setup` from your repository's trunk. The setup files therefore appear as an ordinary branch diff. Your agent records the project's real format, lint, build, typecheck, test, and smoke commands and any known lifecycle that does not apply in `discern.toml`. It then fills the project instructions and initial map pages while those checks are live, including the seeded record of the adoption decision.

discern commits its scaffolded wiring before the handoff. Final completion commits the marker before producing [Gate Proof](../20-understand/proof.md). Those commits keep your Git identity as author and add `discern <done@discern.sh>` as a co-author. Agent-authored commits stay unchanged ([ADR 0203](https://discern.sh/docs/decisions/0203-discern-co-authors-only-commits-it-composes)).

Watch the branch rather than the main checkout. The agent makes small authoring commits as it completes the staged setup brief. [What setup added](after-setup.md) explains each group in the diff.

The agent narrates each major stage with its owner benefit. It handles routine reversible authoring without asking for file-by-file permission. It waits only when repository evidence cannot settle product intent or a new quality protection needs a consequential effect. It also waits for substantive corrections to where later agents should start, and for owner decisions about cost, durable data, broader access, policies that bind future work, or unsafe merges.

If a project file points outside the repository, the agent reports the destination and its apparent role before reading it. You can authorize that specific inspection or keep the boundary in place. A missing conflict or outside reference produces no synthetic question or wait.

After interruption, run `discern setup` or `discern status`; the recorded phase, branch, and continuation avoid replaying completed writes. Stable step ids preserve resumption while their registry orders evidence and smoke before final documentation.

### Setup verifies the checkout can reproduce

After the authored files are committed, `discern setup done` refreshes, commits `[meta].bootstrapped = true`, and diagnoses and probes that same commit in a temporary worktree. The main-checkout Gate runs last and records its canonical Proof ([ADR 0090](https://discern.sh/docs/decisions/0090-setup-proves-worktree-viability), [ADR 0313](https://discern.sh/docs/decisions/0313-setup-completion-and-acceptance-bind-one-final-proof)).

Success returns structured Proof and its relay line; unchanged replay is read-only. A failed leg removes only its still-owned marker tip, retaining changed state with recovery. `--force` is unproved and cannot use setup acceptance ([ADR 0351](https://discern.sh/docs/decisions/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips)).

A failure retains its actionable diagnostic. A pass explains the starting area, its responsibility, other boundaries, one project rule, active checks, and open work from canonical inventories ([ADR 0317](https://discern.sh/docs/decisions/0317-gate-commands-and-setup-applicability-are-separate-facts)).

An unlanded result stops at the landing choice. After `discern setup accept`, start fresh and invoke its exact provider-local activation action; use the served recovery or `discern doctor` if needed. Generated files alone do not prove activation ([Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)).

`discern setup accept --dry-run` validates Proof without moving a ref. Apply lands its commit and records the durable note. A moved trunk is merged and proved on `discern-setup` first; invalid evidence returns to `discern setup done` with trunk untouched.

### The first change uses the daily loop

In the fresh session, ask for a small change. After `discern status`, the agent runs `discern start` from the main checkout and re-roots at its returned worktree path on an `agent/…` branch.

The agent edits and tests in that worktree. During iteration it can run `discern prepare`, the shorter loop of fixers, regenerations, and checks. For the intended final commit, it runs `discern done`. The full Gate runs the repository's configured commands and any triggered scope gates or Standards.

On green, discern records a Proof for the clean commit. The agent reports the change in its own words, ends with the one-line Proof, and waits. Read the full Proof with `discern status --verbose`, then review the branch. If you request another commit, the Proof becomes stale and the agent must run `discern done` again.

When you approve the landing, the agent runs `discern accept`. It fast-forwards the reviewed branch onto the trunk, destroys any worktree resources, removes the worktree directory, and deletes the merged branch ([ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model)).

If any step differs from this tour, start with the [FAQ and troubleshooting guide](../40-troubleshooting/README.md).
