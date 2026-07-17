---
description: What discern does and does not do on your machine — no network, no telemetry, your commands only.
order: 30
aliases:
  - trust
  - privacy
  - telemetry
  - network
  - security
---

# Trust & your data

_What discern does and does not do on your machine, on one screen._

discern runs locally and keeps a small, visible footprint. Here's what that means in practice.

## No network, no telemetry

discern makes **zero network calls** and ships **no telemetry**. Nothing about your code, your usage, or your project is measured, phoned home, or uploaded, and it works fully offline. discern never updates itself: a newer version arrives only when you re-run the installer.

## It runs your commands, and only when you run the gate

discern's trust model is the same class as a `Makefile` or an npm `scripts` block: it runs the commands **you** wrote in your own `discern.toml`. The gate runs your `format` / `lint` / `test` commands; a scope gate or a standard runs the command you gave it. discern adds none of its own beyond built-in git and file operations.

The read-only verbs (`discern status`, `discern doctor`, `discern improvement`, and the docs and help browsers) only observe; they never run the commands in your config. Those run when you run a gate verb: `discern done`, `prepare`, `test`, or `standards`. So a glance at your project never executes anything, and what the gate will run is all in one file you can read.

## A small, checkable footprint

The full list of files discern writes is short, and a test fails the moment any command writes outside it. [Files & ownership](../70-reference/artifact-ownership.md) is the complete inventory. In brief: one committed `discern.toml`, one visible `discern/` folder of your own content, a marked block in your agents' config files and `.gitignore`, and a handful of generated files — the compiled agent files committed so every agent can read them, the materialized skills ignored. `discern uninstall` removes the wiring and keeps your content.

## The binary is one self-contained file

discern is a single file on your `PATH`. It's large (more than 100 MB) because it carries its own JavaScript runtime — which is also why an installed project needs no Node, no Deno, and nothing else to run the gate. What lands in your project is configuration and text.

## What discern does not do: restrict your agent

discern never limits what your coding agent can read, run, or change. That is your agent's own permission system, and you configure it there. discern's job is the quality gate and the workflow around it; deciding what an agent may touch is a separate control, and it stays entirely in your hands.

## See also

- [Files & ownership](../70-reference/artifact-ownership.md) — the enforced footprint, who owns each file, and how to remove it.
- [Design principles](design-principles.md) — sovereign inside, deferential outside (7); the footprint is provable (13).
