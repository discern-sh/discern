---
id: start-first-success
title: "Install and set up discern"
description: "Take one repository from installation through setup to a first real change: proved by the Gate, reviewed by you, and landed with your authority."
order: 30
publish: true
kind: tutorial
aliases:
  - "First success"
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

# Install and set up discern

This tutorial takes one repository from a bare install to a first landed change. At the end, your project has a final quality check it defines (the Gate), an isolated workspace for each task (a worktree), and shared instructions every future coding session inherits. You will have watched one real change pass the Gate, read its evidence, and made the landing decision yourself.

Your coding agent does the operating throughout. You install one binary, answer setup's questions, review what it built, and keep the decisions that stay yours: what the setup may write, and what lands on your shared branch.

## Before you begin

You need:

- a Git repository you're comfortable experimenting in. Any language or stack works, because the checks come from the project's own commands.
- a supported coding agent: Claude Code, Codex, Gemini, Cursor, or GitHub Copilot. [Platforms and providers](../30-reference/platforms-and-providers.md) lists versions and prerequisites.
- macOS, Linux, or Windows through WSL 2.

Plan for a real working session. Installing takes a minute; setup usually takes 20 to 40 minutes of agent effort and a meaningful number of tokens, because the agent studies your repository and writes the context future sessions inherit. That inheritance is why discern recommends your strongest reasoning model for setup. Stay reachable: the agent needs your answers at the start and your decision at the end.

## 1. Install the binary

This step is yours. Run the installer in a shell:

<!-- discern-workflow:command -->

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

**Expected result:** The installer prints `Next:` and tells you to hand the rest to your coding agent.

**If this fails:** A `PATH` instruction instead of `Next:` means the binary landed somewhere your shell doesn't search. Follow the printed line, open a new shell, and confirm with `discern --version`. For anything else, see [Setup and integrations](../40-troubleshooting/setup-and-integrations.md).

<!-- /discern-workflow -->

The install adds one self-contained executable. Your repository doesn't need Deno, Node, or any other runtime for discern itself, and nothing touches the repository until setup does, with your consent.

## 2. Ask your agent to set the project up

In a session opened in your project, tell your agent:

> Set this project up with discern.

The agent runs `discern`, reads the welcome, and relays a consent message before anything is written. Expect it to cover:

- the model recommendation, and how to switch models first if you want to;
- the project name it found in your repository's own evidence, for you to confirm or correct;
- which installed coding tools it will wire up;
- where isolated task workspaces will live (by default a sibling folder, `<repo>.worktrees`);
- the expected time and token investment;
- what your go-ahead authorizes: authoring on a separate branch. It does not authorize landing.

Answer in plain language. For a safe technical choice, "use your recommendation" is a recorded answer; decisions about cost, data, access, or new dependencies always wait for your words.

## 3. Setup works on its own branch

With your consent, the agent begins on a new `discern-setup` branch, so everything setup produces arrives as an ordinary branch diff you can read. The agent studies how the project already works, wires the project's own commands into the Gate's format, build, lint, typecheck, test, and smoke jobs, marking any that don't apply, and writes the instruction source, the maintained project guide (the Map), and a ledger for deferred work. It narrates each stage and commits as it goes.

Setup is real engineering work, and your repository may push back. A check that fails, or a formatter that fights a generated file, surfaces as a Gate diagnostic that names the failing command and the recovery, and the agent iterates. An interrupted setup resumes: `discern setup` reports the recorded phase and continues without repeating finished writes.

The agent returns to you only for decisions the code can't settle, such as a wrong project name, a file that points outside the repository, or a consequential choice about the project's intent.

## 4. Setup proves itself

When the authoring is committed, the agent runs `discern setup done`. discern diagnoses the authored setup for completeness, exercises it in a throwaway worktree, and runs the full Gate. Success returns Proof, discern's evidence that one exact commit passed the declared checks, as a single line:

> **Proof:** The Gate passed for `discern-setup` at `4561b231d9c4` · 26 files changed (+1758 −0) vs `main` · View the full Proof: `discern status --verbose`

The agent relays a handoff with that line: where future sessions will start, which checks are now active, one important rule it found, and what remains open. Then it waits.

Green is not landed. The proved work is still on `discern-setup`, and your shared branch is unchanged until you decide. That separation holds for every change from now on: the Gate supplies the evidence, and the landing decision stays with you.

## 5. Review and land setup

Read the branch diff before you land it. [After setup](after-setup.md) explains what each file in the diff is for and who maintains it. To preview the landing without changing anything, have the agent run `discern setup accept --dry-run`.

When the account looks right, the agent runs `discern setup accept`. It validates the Proof against the branch tip, fast-forwards your trunk (the project's shared branch), and deletes the setup branch. You can also leave the proved branch for later, or decline it and keep your repository as it was.

## 6. Restart your agent

Coding tools load MCP servers, hooks, and project instructions when a session starts, so the session that ran setup can't use what it wired. Open a fresh session in your project.

The acceptance result names the activation check for each coding tool: invoke one of discern's registered MCP tools, such as `discern_status`, and confirm it answers. If the tool is missing, the same result carries that provider's recovery steps, and `discern doctor` diagnoses the installation. Generated files in the repository don't prove the session loaded them.

<!-- discern-workflow:procedure -->

## 7. Take one change through the Gate

In the fresh session, ask for a small real change with a visible result, such as a helper function and its test. The agent takes it through the same loop it will use for every future task.

**Before you start:**

- Setup's branch is reviewed and landed.
- The agent is running in a fresh session that passed its activation check.

**Steps:**

1. **Start the workspace.** The agent runs `discern start`, which creates an isolated worktree on an `agent/…` branch and reports its path; the agent moves its own work there.
2. **Make the change.** The agent edits in the worktree, iterating with `discern prepare`, the fast fix-and-check loop, then commits the result.
3. **Run the Gate.** On the clean commit, the agent runs `discern done`. A failure names the failing command and its first diagnostic; green records Proof for that commit.
4. **Hand the work back.** The agent reports what changed, ends with the proof line, and waits for your decision.

**You are done when:** the agent's report ends with a proof line for a clean commit on its `agent/…` branch.

<!-- /discern-workflow -->

The worktree keeps unfinished work off your trunk, and the main checkout stays clean while the task moves. `discern start` reports where the workspace is; moving there is the agent's own step.

## 8. Review and decide

This decision is yours, and the practice is built around it. From the worktree, `discern status --verbose` opens the full Proof: which commands ran, what they covered, and the diffstat for the exact commit. Read the change itself with `git diff main...<branch>`, and exercise the new behavior if it warrants it.

The Gate has already done the routine verification, so spend your review on what it can't judge: whether the behavior is right, the design fits, and the change belongs in the project.

When you say to land it, the agent runs `discern accept`. discern verifies your authority, fast-forwards the trunk to the reviewed commit, removes the worktree, and deletes the merged branch. The Proof is preserved as a durable note on the landed commit, so the evidence outlives the branch.

## What you now have

Look at the repository: `git log` shows the landed setup and your first change at the tip of the trunk, each carrying its proof note. No worktree or task branch remains. The next session you open inherits the instructions, the Map, and the Gate, without you re-explaining anything.

That is the working loop you'll repeat: the agent proves a change in isolation, you review evidence instead of reconstructing checks, and landing happens with your authority.

<!-- discern-workflow:branch-choice -->

**Choose what happens next**

- **Do real work:** [Finish and land a change](../10-guides/finish-and-land-a-change.md) is the complete daily procedure, including handing work back and re-proving it.
- **Understand the evidence:** [Proof](../20-understand/proof.md) explains green versus landed, staleness, and landing authority in depth.
- **Something didn't match:** [Troubleshooting](../40-troubleshooting/README.md) routes from the symptom you observed to its recovery.

<!-- /discern-workflow -->
