# ADR 0109: `discern start` accepts an optional name, normalised to a branch-safe slug

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use the retired product-category wording → `discern`, the gate, or
> the bar; the decision and reasoning are unchanged.

**Status**: accepted; extends
[ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md) (the `start` verb and
its `generateWorktreeId`), reuses the identity sanitiser from
[identity.ts](../../src/engine/worktree/identity.ts), serializes the
transparency note through the one result envelope
([ADR 0028](0028-result-envelope-and-diagnostics.md)), and is guarded class-wide
per [ADR 0051](0051-canonical-set-parity.md).

## Context

[ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md) gave `discern start`
its own id generator, minting a readable but random `<adjective>-<noun>-<hex>`
codename (`gentle-falcon-f1cfce`). That was the whole naming story: every
agent-created worktree got a Docker/Heroku-style placeholder that says
**nothing** about the work inside it. A fleet of eight worktrees reads as eight
animals.

The codename convention was itself borrowed from Claude Code, which named a
session's worktree the same way. Claude Code has since moved on: a session
launched into a worktree now runs a small summariser model to give it an
identifiable name from the task. That is a clear UX win, and discern should
match it — a named worktree is legible in `discern status`, in the fleet survey,
and in the directory listing.

discern, though, uses **no AI of its own** — it is a deterministic system. It
cannot summarise a task into a name. Only the caller (an agent) knows the task
and can name it. So the feature is really: let the caller optionally supply a
name, and have discern do the deterministic part well.

The design tension is the caller population. `discern start` is invoked by
agents ranging from frontier models down to small, cheap ones. A naming input
has to be robust to whatever they pass: spaces, mixed case, slashes, `..`, a
leading dash, a trailing `.lock`, emoji, non-Latin script, a 200-character
sentence — every one of which is a git-ref or filesystem hazard. The question
was not _whether_ to accept a name but _how_ to accept it without turning the
entry point to all work into a place a weaker agent can get stuck.

## Decision

**Accept an optional free-text `name`; reduce it deterministically to a
branch-safe slug; never fail on it.**

### 1. The name must never be able to fail the call

`discern start` is the gateway to _all_ work, and the name is **cosmetic**. The
moment a cosmetic field can block getting a worktree, every task inherits a
fallible tollbooth. So the transform is total: an empty or fully-stripped name
(all punctuation, emoji, non-Latin script) falls back to the original random
codename. `start` always produces a working worktree; the name only makes it
more legible when it can.

This principle is what rejects the obvious alternative of **validate-and-retry**
(refuse a malformed name, make the caller try again). That optimises for input
_purity_ we do not need, at the exact cost of the caller population we most
worry about: a weaker agent loops, repeats the same invalid string, or gives up
and loses the name — burning round-trips in front of the real work.
Reject-and-retry earns its place when bad input is _dangerous_; a slightly-off
worktree name is not.

### 2. Ask for intent, mechanise it in the tool

The agent is good at describing intent in natural language; the tool is good at
producing a correct, collision-free git ref. Asking the agent to hand back a
_valid slug_ makes it do the tool's job — precisely where small models fail. So
the `name` parameter is framed as **intent, not grammar**: "a few words
describing the task." Whatever arrives is reduced by the same
[`sanitizeSlug`](../../src/engine/worktree/identity.ts) every other identity
token already obeys (lowercase, collapse each non-`[a-z0-9]` run to a single
dash, trim the ends), then clamped to a length cap (`NAME_SLUG_MAX = 40`) on a
word boundary. Because `sanitizeSlug` collapses and trims, the git-ref and path
hazards a raw name might carry cannot survive it — a slash, a `..`, a leading
dash, a trailing `.lock`, a control byte all dissolve into a plain `[a-z0-9-]`
slug. Reusing the existing sanitiser keeps this single-source: there is no
second normaliser to drift.

The minted id is `<slug>-<hex>` when a usable name is given, and the unchanged
`<adjective>-<noun>-<hex>` codename when it is not. The random hex tail still
carries uniqueness, so two worktrees named the same never collide — they differ
in the tail, and `start`'s free-branch/free-directory check (ADR 0058) re-rolls
the tail on the astronomically-unlikely clash. The no-name path is byte-for-byte
what it was.

### 3. Correct silently, but report it

Between silent coercion and a hard refusal sits the choice taken here: **always
correct, and surface what happened.** When a supplied name is normalised or
falls back to a codename, `start` returns a one-line `name_note` in `StartData`
and leads its hints with it (on the CLI, and on MCP where the re-aim hint
otherwise replaces the engine's). A capable agent can read the note and retry
with a cleaner name; a weaker one simply proceeds. This is the robustness
principle — be liberal in what you accept — plus transparency, so "silent
correction" is a documented contract rather than a surprise. It also rejects a
strict **"give me exactly a five-word summary"** framing: rigid ceremony a weak
model miscounts, when bounding length is the tool's job, not the caller's.

### 4. Make the ask visible where the decision is made

A silently-optional parameter gets ignored, which would ship the mechanism and
none of the UX — worktrees would stay `gentle-falcon` in practice. So the name
is invited on every surface a caller reads at the moment it starts: the
`discern_start` MCP tool description and its `name` parameter description
(framed as intent), the `discern start --name` CLI option, and the on-the-trunk
`status` guardrail (`START_HERE_HINT` and its off-trunk sibling), which now
nudges the agent to name the worktree as it creates it.

### 5. Guard the hazard as a class

The load-bearing invariant — _no caller string can break `start`_ — is asserted
off **one predicate over a table** of hostile names (slashes, `..`, leading
dash, `.lock`, emoji, non-Latin, over-length, empty). Each must reduce, without
throwing, to a branch-safe slug (or a codename) that round-trips through the
override validator. A newly-discovered hazard is added to the table and is then
held to the whole contract, not spot-checked — the
[ADR 0051](0051-canonical-set-parity.md) discipline applied to an open input
space.

## Consequences

- Agent-created worktrees can be legible at a glance — `fix-upload-retry-a1b2c3`
  instead of `gentle-falcon-f1cfce` — matching the Claude Code UX, without
  discern taking on any AI of its own. The naming stays the caller's job; the
  safe mechanics stay discern's.
- The feature is purely additive and opt-in. Omitting the name reproduces the
  prior behaviour exactly, so nothing regresses for callers that don't adopt it.
- `start` cannot be blocked on the name. The worst case for a hostile or empty
  name is a codename plus a note — never a failed call or a retry loop.
- `generateWorktreeId` now returns `{ id, source, note }` rather than a bare
  string; the deterministic name→slug decision (`chooseWorktreeName`) is
  separated from the random tail so the class-guard test drives the pure part
  directly.
- The frozen identity derivation is untouched: a named id is still an ordinary
  sanitised slug, so `site` / `port` / `db` / `branch` derive from it exactly as
  before (ADR 0058's guarantee stands).

## See also

- [ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md) — the `start` verb,
  its id generator, and the status guardrail this extends.
- [ADR 0028](0028-result-envelope-and-diagnostics.md) — the result envelope the
  `name_note` rides in.
- [ADR 0051](0051-canonical-set-parity.md) — the class-guard discipline the
  hostile-name table follows.
