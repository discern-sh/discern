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

discern makes **zero network calls** and ships **no telemetry**. Nothing about your code, your usage, or your project is phoned home or uploaded, and it works fully offline. A newer version arrives only when you re-run the installer.

One thing is measured, and it stays on your machine: the logbook, below, records discern's own use — with its own switch and a one-command deletion path.

## The logbook: local history, one switch

With recording on and the project's `discern.toml` readable, discern records one line for each CLI verb run and each Model Context Protocol (MCP) invocation resolved to that project; a call outside every discern project records nothing. Each line holds names and numbers only: the verb, branch, outcome, duration, change size, and each quality standard's measured value. Possible coding-agent identity signals may also appear: environment marker names (values dropped) and the MCP client's declared name, title, and version. Those clues cannot prove which agent drove a run. No code, prompts, command output, or file contents enter the logbook. Any line is safe to read aloud in a meeting. Read it with `cat .git/discern/logbook/*.jsonl`, delete it by removing that directory, or turn it off with `logbook = false` under `[project]`. Turning recording off also turns off the features that read it; [what it powers](../70-reference/the-logbook.md#what-it-powers) is the list.

The logbook never leaves the machine, and that claim is held by a check rather than a promise: a test in discern's own quality gate proves the logbook's code can reach no network interface, so a change that gave it one would fail discern's own build. [The logbook](../70-reference/the-logbook.md) reference lists every recorded field.

## Receipt notes: local proof, optional transport

A green landing records a DSSE-compatible note under `refs/notes/discern`. Its Base64 payload separates structured proof facts from human presentation and excludes runtime telemetry ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)). `signatures: []` is unsigned; discern does no signing or identity verification today. A future policy decides which signing keys to trust.

Older bare and pre-correction notes still read. The note is authored by `discern <done@discern.sh>` unless `DISCERN_NO_ATTRIBUTION` asks Git to use the repository identity instead. Delete one with `git notes --ref=discern remove <commit>`, or delete the local channel with `git update-ref -d refs/notes/discern`.

This local record is default-on. It changes no remote setting and sends nothing anywhere. `[repository].receipt_notes = "fetch"` is the separate opt-in for transport: refresh adds an extra fetch mapping into `refs/discern/remotes/<remote>/notes`. The mapping remains valid when a remote has no receipt note, including before its first publication and after deletion. Your ordinary `git fetch` can carry the remote receipt history. discern still makes no network request.

There is no push mapping. Configuring one would change plain `git push`, so publishing stays explicit. GitHub stores the ref but does not show it on commit pages. Branch and tag CI triggers ignore a notes-only push; raw push webhooks may still observe it. [Receipt notes](../20-quality-gate/receipt-notes.md) has the commands and recovery.

## It runs your commands, and only when you run the gate

discern's trust model is the same class as a `Makefile` or an npm `scripts` block: it runs the commands **you** wrote in your own `discern.toml`. The gate runs your `format` / `lint` / `test` commands; a scope gate or a standard runs the command you gave it. discern adds none of its own beyond built-in git and file operations.

The read-only verbs (`discern status`, `discern doctor`, `discern improvement`, and the docs browser and CLI help) run none of your commands and change none of your files; each run appends its line to the local logbook above unless switched off. The commands in your config run when you invoke a gate verb: `discern done`, `prepare`, `test`, or `standards`. A glance at your project executes nothing, and everything the gate will run is in one file you can read.

## A small, checkable footprint

The full list of files discern writes is short, and a test fails the moment any command writes outside it. [Files & ownership](../70-reference/artifact-ownership.md) is the complete inventory. In brief: one committed `discern.toml`, one visible `discern/` folder of your own content, a marked block in your agents' config files and `.gitignore`, and a handful of generated files — the agent files committed so every agent can read them, the materialized skills ignored. Git-admin state holds validation caches and the local records above. `discern uninstall` removes the wiring and keeps your content.

## The binary is one self-contained file

discern is a single file on your `PATH`. It's large (more than 100 MB) because it carries its own JavaScript runtime — which is also why an installed project needs no Node, no Deno, and nothing else to run the gate. What lands in your project is configuration and text.

## Release downloads are verifiable

The installer downloads the binary and its published SHA-256 checksum, then refuses to replace an existing installation unless they match. Public GitHub releases also carry build-provenance attestations for each binary and checksum.

macOS binaries are signed with Developer ID and accepted by Apple's notary service before publication. Gatekeeper can verify a copy downloaded through a browser. Apple's notarization ticket cannot be stapled to a standalone executable, so that first Gatekeeper assessment needs network access. The command-line installer does not add the quarantine attribute.

## What discern does not do: restrict your agent

discern does not limit what your coding agent can read, run, or change. That is your agent's own permission system, and you configure it there. discern's job is the quality gate and the workflow around it; deciding what an agent may touch is a separate control, and it stays entirely in your hands.

## See also

- [Files & ownership](../70-reference/artifact-ownership.md) — the enforced footprint, who owns each file, and how to remove it.
- [Design principles](design-principles.md) — sovereign inside, deferential outside (7); the footprint is provable (13).
