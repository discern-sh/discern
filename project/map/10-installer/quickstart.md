---
title: Quickstart
description: Install discern, hand setup to your coding agent, and land your first gated change.
order: 10
aliases:
  - quickstart
  - getting started
  - install
---

# Quickstart: from install to a green gate

_Install the binary, let your agent set the project up, and ship one change
through the gate. Install takes about a minute; setup a few more._

You need a git repository and a coding agent that works in it. Claude Code,
Codex, Gemini, Cursor, and GitHub Copilot are all supported. You don't need
Deno, Node, or any other runtime: discern is one self-contained binary, and it
makes zero network calls once installed.

## 1. Install the binary

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

The install message ends with the whole handoff: tell your coding agent to run
`discern`. There is nothing for you to configure by hand.

## 2. Ask your agent to set the project up

In your project, tell your agent:

> Set this project up with discern.

The agent runs `discern`, and discern walks it through a staged setup
([ADR 0075](../_adr/0075-setup-pages-and-per-step-proof.md)). The moment that
matters is consent: before writing anything, discern serves a message for the
agent to relay, naming exactly what it will write: one `discern.toml` at
the repo root, a visible `discern/` folder for content you own, the
documentation map, the agent files each coding agent reads, and a delimited
`.gitignore` block. Everything authored is plain Markdown, and
`discern uninstall` takes the wiring back out, so there's no lock-in to weigh.

Answer in plain language — "yes, go ahead; set up Claude Code and Codex." The
agent can't proceed until you've said yes
([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

Setup then happens as ordinary file edits on a separate `discern-setup` branch,
so your `main` is untouched until you land it. The agent wires your gate
commands first: format, lint, test, whatever your stack runs. Then it fills in
guidance and the first docs under that live gate.

## 3. Let setup prove itself

When the scaffold is ready, the agent runs `discern setup done`. This is a
proof, not a rubber stamp: discern refreshes the generated files, runs
`discern doctor`, runs the full gate, and then runs the gate _again_ in a
throwaway worktree copy — so a project that would break in an isolated
workspace can't complete setup silently
([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)).

Two things remain for you:

1. **Start a fresh agent session.** The MCP tools and session hooks setup wired
   load at session start, so the session that ran setup can't see them yet.
2. **Review and land the `discern-setup` branch** like any other branch. Setup
   is a diff you read, not a black box.

## 4. Ship a change through the gate

In the fresh session, ask for a small, real change. Watch for four moments:

1. The agent runs `discern start` and gets an isolated worktree on an
   `agent/…` branch — your checkout stays clean.
2. It makes the change there, like any other work.
3. It runs `discern done`. The gate formats, builds, lints, and tests the whole
   tree; a failure hands the agent the exact failing command and its output, so
   it fixes and re-runs instead of guessing.
4. On green, the agent reports ready with a receipt of what passed — and waits.
   It does not land anything on its own.

Review the branch. When you're happy, say so: the agent runs `discern accept`,
which fast-forwards your trunk to the reviewed branch and removes the worktree
([ADR 0110](../_adr/0110-the-landing-model.md)).

That's the loop you'll live in: your agent works in isolation, the gate says
when the work is done, and nothing lands without your word.

Next: the [walkthrough](walkthrough.md) narrates a full session in detail, and
the [FAQ](faq.md) covers the first things that go wrong.
