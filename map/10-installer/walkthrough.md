# A walkthrough — one session, start to finish

_What actually happens when you install discern, set it up through your coding
agent, and ship a first change. Written for the human watching._

discern is driven by your coding agent, not by you typing commands. So this
walkthrough follows what you _see_: you ask your agent to do things, the agent
runs discern, and discern hands messages back through the agent to you. Nothing
below is scripted — it is the real staged flow, with the moments you act called
out.

## 1. Install (about a minute)

You install the binary once, the way the install page tells you (a
`brew
install`, a download, whatever your platform uses). The install message
ends with one instruction — not "read the docs", but:

> Tell your coding agent to run `discern`.

That is the whole handoff. You don't configure anything by hand.

## 2. Setup is a conversation

In your project, you tell your agent something like _"set this project up with
discern."_ The agent runs `discern`, and because the project isn't set up yet,
discern prints a **welcome** the agent relays to you: what discern is, and that
it is about to ask for consent before writing anything.

Then the agent runs `discern setup verify`, and this is the moment that matters.
discern serves a first-person **consent message** the agent relays verbatim (or
in its own words) — it tells you, plainly:

- what discern will write (one `discern.toml`, a visible `discern/` namespace
  for your guidance and docs, the agent files each coding agent needs, a
  delimited `.gitignore` block);
- that there is **no lock-in** — the namespace is plain Markdown you own, the
  generated files are gitignored, and `discern uninstall` takes the wiring back
  out;
- one real question: should discern manage a **fresh docs tree** at `map/`, or
  adopt your project's **existing docs** directory?

You answer in plain language — _"yes, go ahead; use a fresh docs tree; set up
Claude Code and Codex."_ The agent doesn't proceed until you've said yes; a
fresh setup requires the agent to attest that this conversation happened.

## 3. The agent scaffolds

With your consent, the agent runs `discern setup begin`. discern works on an
isolated `discern-setup` branch so your `main` is never touched mid-setup — and
it starts that branch **from** your integration branch, refusing to begin from
an unlanded feature branch (whose own commits would otherwise ride along when
the setup accepts). It lays down the scaffold — `discern.toml`, the `discern/`
namespace, the docs skeleton — records a short brief of what you're building,
and prints a **setup brief** the agent then works through: filling in your
guidance, sketching the first docs, wiring the gate commands for your stack.

You watch this happen. It's ordinary file edits on a branch you can read.

## 4. Setup proves itself, then hands back

When the scaffold is ready, the agent runs `discern setup done`. This is not a
rubber stamp: discern first refuses if any of the authored setup is still
uncommitted (the proof runs on committed history, and "the branch keeps every
commit" has to be true), then **proves the gate** — it refreshes the generated
files, runs `discern doctor`, runs `discern done`, and then runs the whole gate
again in a **throwaway worktree copy**, so a project that passes on your machine
but would break in an isolated worktree can't complete setup silently.

If that all passes, discern records that setup is complete and serves a
**reactivation** note: the MCP tools, session hooks, and project rules it wired
load at session start, so the session that ran setup can't see them yet — start
a fresh agent session to pick them up. You then review the `discern-setup`
branch like any other and land it.

That's setup. A few minutes, one consent conversation, one review.

## 5. Shipping a change

Now the daily loop. In a fresh session, you ask your agent for a small change —
_"add a `--quiet` flag to the export command."_ Here is what the agent does, and
what you see:

1. **It gets its own workspace.** On the trunk, the agent runs `discern start`,
   which creates an isolated git worktree on an `agent/…` branch and moves into
   it. Your `main` checkout is left alone; the agent works in a copy.
2. **It writes the change.** Ordinary editing and testing, in the worktree.
3. **It runs the gate.** `discern done` formats, builds, lints, type-checks, and
   tests — and won't call the work done until the whole tree passes. If a step
   fails, discern hands the agent the exact failing command and its output, so
   the agent fixes and re-runs rather than guessing.
4. **It reports ready.** The agent tells you the change is green and waits — it
   does not land anything on its own.

You review the branch. When you're happy, you tell the agent to land it, and it
runs `discern accept`, which fast-forwards your trunk to the reviewed branch and
removes the worktree. The change is on `main`; the workspace is gone.

## 6. If you ever want it gone

`discern uninstall --dry-run` shows you exactly what removal would touch;
`discern uninstall` does it — removing the generated files and the wiring,
keeping your `discern.toml` and everything in `discern/`. See
[what discern writes](what-discern-writes.md) for the full footprint.

## See also

- [What discern writes to your repo](what-discern-writes.md) — the footprint in
  full.
- [FAQ & troubleshooting](faq.md) — when a step doesn't go as above.
- [The quality gate](../20-quality-gate/README.md) — what `discern done`
  actually runs.
