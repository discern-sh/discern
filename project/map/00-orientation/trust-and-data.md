---
description: "What discern does and does not do on your machine: no network, no telemetry, and your configured commands only."
order: 30
aliases:
  - trust
  - privacy
  - telemetry
  - network
  - security
---

# Trust & your data

_What discern does and does not do on your machine, on one page._

discern runs locally and keeps a small, visible footprint. Here's what that means in practice.

## No network, no telemetry

discern makes **zero network calls** and ships **no telemetry**. It uploads nothing about your code, usage, or project, and works offline. To update, re-run the installer.

The public site uses no client-side tracking or cookies.

One thing is measured, and it stays on your machine. The Logbook records discern's own use, has its own switch, and can be sealed or deleted through a terminal-confirmed owner command.

## The logbook: local history, one switch

With recording on and the project's `discern.toml` readable, discern records one line for each CLI verb run and each Model Context Protocol (MCP) invocation resolved to that project. A call outside every discern project records nothing. Each line holds names and numbers: the verb, branch, outcome, duration, change size, and each Standard's measured value. Validation runs add opaque keyed digests and counts for the repository state and job setup they saw. The key stays under `.git`; lines contain no manifests, content, commands, config or environment values, or reusable plain hashes. Possible coding-agent identity signals may also appear, including environment marker names with their values removed and the MCP client's declared name, title, and version. Those clues do not establish which agent drove a run. No code, prompts, command output, or file contents enter the Logbook. Read active history with `discern patterns`; seal it for later reports with `discern patterns archive`; remove it with `discern patterns reset`; or turn recording off with `logbook = false` under `[project]`. Archive and reset apply only after a terminal operator reviews the scope and answers Yes. Turning recording off also disables the features listed under [what it powers](../70-reference/the-logbook.md#what-it-powers).

The Logbook never leaves the machine. An architectural test keeps network interfaces out of its code path, so adding one would fail discern's own Gate. [The Logbook](../70-reference/the-logbook.md) reference lists every recorded field.

## Proof notes: local record, optional transport

A green landing records a DSSE-compatible Proof note under `refs/notes/discern`. Its Base64 payload separates structured result facts from human presentation and excludes runtime telemetry ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)). `signatures: []` records no signature. discern performs no signing or identity verification today. A future policy will decide which signing keys to trust.

Older bare and pre-correction notes still read. The note is authored by `discern <done@discern.sh>` unless `DISCERN_NO_ATTRIBUTION` asks Git to use the repository identity instead. Delete one with `git notes --ref=discern remove <commit>`, or delete the local channel with `git update-ref -d refs/notes/discern`.

This local record is on by default. It changes no remote setting and sends nothing anywhere. `[repository].proof_notes = "fetch"` separately opts into transport: refresh adds a fetch mapping into `refs/discern/remotes/<remote>/notes`. The mapping remains valid when a remote has no Proof note, including before its first publication and after deletion. Your ordinary `git fetch` can carry the remote Proof history. discern still makes no network request.

There is no push mapping. Configuring one would change plain `git push`, so publishing stays explicit. GitHub stores the ref but does not show it on commit pages. Branch and tag CI triggers ignore a notes-only push; raw push webhooks may still observe it. [Proof notes](../20-quality-gate/proof-notes.md) has the commands and recovery.

## Gate verbs run your configured commands

Like a `Makefile` or an npm `scripts` block, discern runs the commands you wrote in `discern.toml`. The Gate runs your `format`, `lint`, and `test` commands. A scope gate or Standard runs the command you supplied. discern adds no project command beyond its built-in Git and file operations.

The read-only verbs (`discern status`, `discern doctor`, `discern improvement`, the docs browser, and CLI help) run none of your commands and change none of your files. Unless recording is off, each run appends a line to the local Logbook. Commands from your config run when you invoke a Gate verb: `discern done`, `prepare`, `test`, or `standards`. Reading project status executes none of those commands. `discern.toml` lists everything the Gate will run.

## A small, checkable footprint

An architectural test enforces the list of paths discern writes. [Files & ownership](../70-reference/artifact-ownership.md) is the complete inventory. In brief, the footprint includes a committed `discern.toml`, a visible `discern/` folder of project-owned content, marked blocks in agent config files and `.gitignore`, and generated files. Agent files are committed so every agent can read them; materialized Skills are ignored. Git administration state holds validation caches and the local records described earlier. `discern uninstall` removes the wiring and keeps project-owned content.

## The binary is one self-contained file

discern is a single file on your `PATH`. It is larger than 100 MB because it carries its own JavaScript runtime. An installed project therefore needs no Node or Deno to run the Gate. What lands in the project is configuration and text.

## Release downloads are verifiable

The installer downloads the binary and its published SHA-256 checksum, then refuses to replace an existing installation unless they match. Public GitHub releases also carry build-provenance attestations for each binary and checksum.

macOS binaries are signed with Developer ID and accepted by Apple's notary service before publication. Gatekeeper can verify a copy downloaded through a browser. Apple's notarization ticket cannot be stapled to a standalone executable, so that first Gatekeeper assessment needs network access. The command-line installer does not add the quarantine attribute.

## What discern does not do: restrict your agent

discern does not limit what your coding agent can read, run, or change. The agent's permission system controls that boundary. Configure permissions there; discern supplies the Gate and its surrounding workflow.

## See also

- [Files & ownership](../70-reference/artifact-ownership.md): the enforced footprint, who owns each file, and how to remove it.
- [Design principles](design-principles.md): declared write paths (7) and the provable footprint (13).
