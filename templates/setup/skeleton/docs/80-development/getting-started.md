# Getting started

*Cloning, setting up, and running the project locally for the first time.*

> This doc is a skeleton. The `discern setup` command (and the `discern-document-subsystem` skill, when filling the `80-development` subtree) writes it from the project's actual stack. Look for the `<!-- setup fills this -->` marker.

This is the path from a fresh clone to a running project and a first green gate. The harness commands are the same on every stack; the stack-specific steps (installing dependencies, configuring the environment, running the app) are filled in below.

## The harness loop

These work the same regardless of language or framework:

- **`discern start`** creates an isolated worktree for a change and moves you into it (see the worktree note in the project guidelines).
- **`discern prepare`** is the fast inner loop — applies the fix-stage capabilities, then the check-stage capabilities; no build, no tests.
- **`discern finish`** is the full gate — (in a worktree) a fail-fast merge check first, then fixers and build, then checks and tests in parallel, then any scope `gate`s that fired. Run it before declaring a change done.
- **`discern doctor`** verifies the install is sound (dispatcher executable, hooks present, every configured capability resolvable, git worktree support, required tools on PATH).

## Setting up

<!-- setup fills this -->

_(The stack-specific steps: prerequisites to install, how to fetch dependencies, environment/config setup, how to start the app, and what a first `discern finish` should produce. Keep these aligned with the `[capabilities]` and `[worktree]` settings in `discern.toml`.)_
