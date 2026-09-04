---
id: start-evaluate-discern
title: "Evaluate discern"
description: "Decide whether discern's practice, local boundary, and authority model fit your project before you install anything."
order: 20
publish: true
kind: explanation
aliases:
  - "start-evaluate-discern"
  - "orientation"
  - "introduction"
  - "start here"
  - "is discern right for me"
---

# Evaluate discern

More of your project's implementation arrives from coding agents, and you're the person who answers for the result. Before you install a tool that will sit inside that workflow, you want three questions settled: what it changes about the work, what it asks of you, and where its authority stops. This page answers them so you can decide without installing anything.

## What discern changes

discern installs an engineering practice into a repository. After setup, every coding session in that project inherits the same working conditions:

- **A definition of done the project owns.** The final quality check (the gate) runs the checks the project declares: its own format, build, lint, typecheck, test, and smoke commands. An agent's confidence doesn't decide when work is finished; the project's checks do.
- **A workspace per task.** Each task runs in an isolated Git worktree, so unfinished work never sits on your shared branch and parallel tasks don't collide in one checkout.
- **Evidence instead of assertions.** A finished change comes back with [Proof](../20-understand/proof.md): a record that this exact commit passed the declared checks. Passing produces evidence; it never grants permission. Landing on the shared branch waits for authority you supply, once per change or as a recorded standing grant.
- **Context that survives the session.** Project instructions, reusable skills, and a maintained project guide (the map) are ordinary files in the repository. A new session, or a different coding agent, starts already knowing the project.

The practice is stack-neutral: discern ships none of your toolchain and runs the commands your project declares. It works with Claude Code, Codex, Gemini, Cursor, and GitHub Copilot, and switching among them keeps the instructions and checks you've invested in.

## What it asks of you

A capable coding agent does the operating; you direct it in plain language. Your unavoidable work is judgment. Setup is a one-time agent session, usually 20 to 40 minutes. During it you confirm what setup may write and answer the questions repository evidence can't settle. Daily use adds one recurring moment: reading a change's Proof and deciding whether it lands.

If nobody on the project works through a coding agent, discern has no operator, and it isn't the right tool yet.

## Where its boundary sits

discern is one self-contained local binary with no model inside. It makes no network calls of its own, requires no API key or account, and runs no service. Install it once at the root of each Git repository. Setup adds the root `discern.toml`, the visible `discern/` folder, marked sections in `.gitignore` and `.gitattributes`, agent instruction files, and configuration for the coding tools you selected. Its activity record (the logbook) stays on your machine and holds metadata about discern's use; it doesn't record your code.

One installation serves an entire monorepo. Its root configuration can give different packages or services their own checks. A folder that is itself a separate Git repository can have its own discern installation. Adding another `discern.toml` to an ordinary nested folder has no effect.

The boundary also limits what it can promise. discern verifies what your declared checks verify: it doesn't review design, find every defect, or secure the project. It also places no boundary around your coding agent, whose own provider and network behavior stay governed by that tool. [Local control](../20-understand/local-control.md) draws these lines precisely.

## How it leaves

Trying discern doesn't take your work hostage. `discern uninstall` removes discern's wiring and generated integration files and leaves the authored instructions, map, and deferred-work ledger in place as ordinary Markdown, still useful without discern. The binary never updates itself; [upgrades run when you choose](../10-guides/maintain-or-remove-discern.md).

## Decide

discern fits when a Git repository is receiving real work from coding agents and you want that work to arrive proved, isolated, and landed on your terms. It isn't a fit today if the project isn't in Git, or if no coding agent operates in it. It's also the wrong tool if you want a hosted dashboard over a team: discern runs locally, for the person responsible for the repository.

If it fits, [Install and set up discern](first-success.md) takes one repository through install, setup, and a first reviewed change. If it doesn't, you've spent five minutes and installed nothing.
