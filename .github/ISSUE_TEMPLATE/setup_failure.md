---
name: Setup failure
about: "`discern setup` did not complete"
title: ""
labels: setup
---

<!--
Setup is a staged handshake (welcome → verify → begin → done). Telling us where
it stopped, plus the `discern doctor --json` output, is usually enough to see
what went wrong.
-->

## Where setup stopped

Which step were you (or your coding agent) on when it failed?

- [ ] `discern` / `discern setup` (the welcome)
- [ ] `discern setup verify` (the consent conversation)
- [ ] `discern setup begin` (the scaffold)
- [ ] `discern setup done` (proving the gate)
- [ ] `discern setup accept` (landing the setup branch)

## What you asked your agent to do

The instruction you gave, and what it reported back.

## `discern doctor --json`

<!-- Run this in the project you were setting up and paste the whole object. -->

```json
```

## The failing output

The error or message that stopped setup (paste the command's output).

## Environment

- discern version (`discern --version`):
- OS / architecture (and WSL, if on Windows):
- Coding agent and model, if known:
- Is the project a git repository? Which branch was checked out?
