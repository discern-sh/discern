# Getting started

*Cloning, setting up, and running the project locally for the first time.*

> This doc is a skeleton. The `discern setup` command (and the [`document-subsystem`](../../.claude/skills/document-subsystem/SKILL.md) skill, when filling the `80-development` subtree) writes it from the project's actual stack. Look for the `<!-- setup fills this -->` marker.

This is the path from a fresh clone to a running project and a first green gate. The harness commands are the same on every stack; the stack-specific steps (installing dependencies, configuring the environment, running the app) are filled in below.

## The harness loop

These work the same regardless of language or framework:

- **`discern worktree`** sets up an isolated checkout for a change (see the worktree note in the project guidelines).
- **`discern prepare`** is the fast inner loop — applies the fix-stage capabilities, then the check-stage capabilities; no build, no tests.
- **`discern finish`** is the full gate — fixers and build, then checks and tests in parallel, then any scope `gate`s that fired, then (in a worktree) the merge check. Run it before declaring a change done.
- **`discern doctor`** verifies the install is sound (dispatcher executable, hooks present, every configured capability resolvable, git worktree support, required tools on PATH).

## Setting up

<!-- setup fills this -->

_(The stack-specific steps: prerequisites to install, how to fetch dependencies, environment/config setup, how to start the app, and what a first `discern finish` should produce. Keep these aligned with the `[capabilities]` and `[worktree]` settings in `discern.toml`.)_
