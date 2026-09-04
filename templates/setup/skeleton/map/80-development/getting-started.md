# Getting started

_Cloning, setting up, and running the project locally for the first time._

> This doc is a skeleton. The `discern setup` command (and the `discern-document-subsystem` skill, when filling the `80-development` subtree) writes it from the project's actual stack. Look for the `<!-- setup fills this -->` marker.

This is the path from a fresh clone to a running project and a first green gate. The discern commands are the same on every stack; the stack-specific steps (installing dependencies, configuring the environment, running the app) are filled in below.

## The discern loop

These work the same regardless of language or framework:

- **`discern start`** creates an isolated worktree and returns its path. Re-root with the agent's native worktree tool or work at that path explicitly (see the worktree note in the project instructions).
- **`discern prepare`** is the fast inner loop — applies fix-stage jobs, regenerates declared artifacts, completes refresh convergence, then runs check-stage jobs; no other build jobs or tests.
- **`discern done`** is the full gate — (in a worktree) a fail-fast merge check first, then fixers and build, then checks and tests in parallel, then any scope `gate`s that fired. Run it before declaring a change done.
- **`discern doctor`** checks `discern.toml` and its schema version, setup provenance, job commands and format semantics, Git attributes and repository shape, Project Scripts, `sh` and Git versions, instruction and skill sources, the gotchas page, and each configured provider's integration and worktree automation.

## Setting up

<!-- setup fills this -->

_(The stack-specific steps: prerequisites to install, how to fetch dependencies, environment/config setup, how to start the app, and what a first `discern done` should produce. Keep these aligned with the `[jobs]` and `[worktree]` settings in `discern.toml`.)_
