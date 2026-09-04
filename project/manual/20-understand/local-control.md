---
id: explanation-local-control
title: "Local control"
description: "Understand local evidence, network/model boundaries, write authority, and what discern deliberately does not secure or decide."
order: 80
publish: true
kind: explanation
aliases:
  - "explanation-local-control"
  - "Trust & your data"
  - "trust"
  - "privacy"
  - "telemetry"
  - "network"
  - "security"
---

# Local control

Adding a tool to a serious project raises questions before the first run. What does it send, and to whom? What does it decide on its own? What may it write? For a tool that sits in the middle of your development workflow, those answers should be short and checkable.

discern is a local, deterministic program. It contains no AI model, needs no API key, makes no network requests of its own, and sends no telemetry. Its verdicts come from running the commands your project declares, and its records stay on your machine. The intelligence in your workflow comes from your coding agents; discern supplies the working conditions, the checks, and the evidence.

## No model inside

The verdict of the project's final quality check (the gate) is the result of your project's own commands, run the same way every time. That's what makes the answer reproducible: however many times the gate runs, the same tree gets the same treatment, with no model variance and no per-run cost. Where the practice needs judgment, a [checkpoint](checkpoints.md) question, the judgment comes from the coding agent operating discern and is recorded as declared. discern never calls a model to decide anything.

The boundary is worth stating precisely, because it describes discern itself and nothing more. Your coding agents reach their own model providers. Your project's commands, and any checkpoint command you configure, do whatever they do, network included. discern doesn't constrain them, and "no model inside" never means your agents stopped using one. It means the practice adds no model dependency, key, or hosted service of its own, and discern's own commands run without a network.

## What stays on your machine

The **Logbook** is discern's local activity record. With recording on, each run appends one line of metadata: the command, branch, outcome, duration, change size, and measured standard values. No code, no prompts, no command output, no file contents, and no checkpoint rationales enter it. It lives inside the repository's Git administrative area, and it never leaves the machine: an architectural test in discern's own gate keeps network interfaces out of the logbook's code path, so adding one would fail discern's own build.

The record has one switch, `[project].logbook = false`, and sealing or removing its history requires a terminal-confirmed owner action. What the record powers, and what its analysis can and can't support, is the subject of [Evidence and improvement](evidence-and-improvement.md).

Proof takes the same stance. A landed change's evidence is recorded as a durable note in your repository, locally, by default. Sharing Proof history with a remote is a separate, explicit configuration, carried by your ordinary Git transport rather than by discern, and there is no push mapping: publishing evidence stays a distinct act. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) holds the exact commands.

## What discern may write

Write authority follows one rule: placement is consent. A file at its standard discern location carries permission because putting it there was the decision; a path you pointed a config key at is licensed because you supplied the path. Everything else is off-limits, and an architectural test rejects writes outside the declared surface. In practice the footprint is the root `discern.toml`, the visible `discern/` folder, each configured agent's declared files, marked regions of shared files such as `.gitignore`, generated outputs, and a worktree's own environment file.

Effectful commands compute a plan before applying it, so `--dry-run` is a faithful preview that changes nothing, and a command that will touch Git state proves it has permission at that boundary before starting. An interrupted operation leaves a state that can be resumed or repaired.

Leaving is part of the contract: `discern uninstall` removes discern's wiring and keeps what you authored. The instructions, map, skills, and scripts remain ordinary files at the paths you chose.

The binary itself is one self-contained file that needs only `git` and a POSIX `sh` beside it, and its releases are verifiable: the installer checks the published checksum before replacing anything, and [Platforms and providers](../30-reference/platforms-and-providers.md) records the signing and provenance details per platform.

## What discern does not secure or decide

The boundaries matter as much as the assurances:

- **It is not a sandbox.** discern doesn't restrict what your coding agent may read, run, or change; the agent's own permission system governs that. Configure that boundary there.
- **It doesn't certify security or correctness.** Green establishes that the declared checks passed for one exact tree. It doesn't establish that the software is secure, correct, or fit for production, and running locally doesn't vet your dependencies or providers.
- **It doesn't ship.** discern neither deploys nor pushes on your behalf. Everything after landing belongs to the project's own release process.
- **It doesn't decide what lands.** A passing gate makes a change eligible; the authority stays with you. [Proof](proof.md) explains how that decision is recorded and verified.

[Files and ownership](../30-reference/files-and-ownership.md) is the complete inventory of what discern writes and who owns each file. [The logbook](../30-reference/logbook.md) lists every recorded field. To weigh these boundaries before installing, read [Evaluate discern](../00-start/evaluate-discern.md).
