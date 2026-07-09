# ADR 0062: The MCP server tracks its own working root, and retires location-based tool visibility

**Status**: accepted. Revises the location-aware tool _visibility_ of
[ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md) §2 (the
`requiresLocation` hiding) while keeping its defensive refusals; builds on the
MCP surface of [ADR 0045](0045-mcp-is-core-infrastructure.md) and
[ADR 0041](0041-self-describing-mcp-surface.md).

## Context

The discern MCP server (`discern mcp`) resolves its project root **once, from
its process cwd, at spawn** (`findRoot()` in `runMcpServer`), and every verb
then operates on that single root (`runTool(tool, root, args)`). The root is
frozen for the life of the subprocess.

That assumption breaks the moment an agent's working location diverges from the
server's spawn directory — which is exactly what the worktree workflow asks for.
An agent on the main checkout calls `discern_start`
([ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md)), gets a fresh
worktree, and continues working in it. But the agent moves by `cd`-ing in its
_own_ shell (the Bash tool's process); the MCP subprocess never sees it. So the
server stays rooted in the main checkout, and from that stale connection:

- `discern_graduate` / `discern_integrate` are **hidden** (the
  `requiresLocation: "worktree"` gate, ADR 0058 §2), so the agent that just
  built a feature in the worktree cannot finish it; and
- worse, _every_ verb — `discern_finish`, `discern_status` — operates on the
  **main checkout**, not the worktree. A gate run from the stale connection
  gates a clean, unchanged trunk: a false green.

This is **not a client bug to wait out, and not a Claude Code quirk.** The
cross-agent research
([cross-agent-behaviour-reference.md §7](../_private/research/cross-agent-behaviour-reference.md))
establishes that a project-scoped MCP server's root is pinned at launch on
_every_ agent that can move its cwd, and that **nothing the client does moves
it** — not a `cd`, not even Claude Code's native `EnterWorktree` re-root. It is
empirically confirmed against discern's own server: `discern_status` reports
`location: "worktree"` only when the session was _opened in_ the worktree; a
session opened on the trunk reports `location: "main"` for its whole life.

Retiring the visibility gate alone — the instinctive "just un-hide graduate" —
does not help and makes the DX worse: on a main-rooted server, a revealed
`discern_graduate` runs against the trunk and refuses ("nothing to graduate"). A
visible-but-refusing tool is more confusing than a hidden one. **The frozen root
is the disease; visibility is a symptom.** And telling the agent to go open a
fresh session turns `discern_start` into a verb that starts nothing and asks the
agent to apologise for it.

## Decision

### 1. The MCP server tracks its own working root

The server keeps a single mutable value — its **working root**, the directory
its verbs operate on. It is the process's logical cwd made explicit, because the
OS cwd is frozen at spawn and unusable for this. It is initialized to the spawn
root (`findRoot()`), and re-pointed on exactly two lifecycle transitions:

- **`discern_start`** sets it to the worktree it just created
  (`result.data.path`). `start` stops being a no-op at the MCP layer: it cannot
  relocate the client's session, but it _can_ re-aim the live server, so
  subsequent `finish` / `integrate` / `graduate` calls operate on the new
  worktree with nothing for the agent to thread.
- **`discern_graduate`** re-aims it to the **main checkout the branch landed
  in** — carried in the result's `data.root`
  ([ADR 0072](0072-typed-mcp-status-forcing-function.md)-style typed data) —
  since the worktree it operated on is removed.

  > **Refined (Phase B).** This originally reset to the **spawn root**, on the
  > assumption — made throughout this record — that the server is launched from
  > the trunk (true for Claude Code). Phase B's Codex `environment.toml` wiring
  > ([ADR 0073](0073-codex-worktree-lifecycle-comanagement.md)) made the Codex
  > _app_ spawn the server **inside its worktree** for the first time, so the
  > spawn root IS the worktree being graduated — re-aiming there would strand
  > the server in the grave of the directory it just removed. Re-aiming to the
  > landing main checkout is correct for a server launched anywhere; it equals
  > the spawn root in the trunk-launched case, so nothing changed for Claude
  > Code.

Resolution per call is `args.path ?? workingRoot`. The verb **cores stay pure**
— they remain functions of an explicit `root`; the working root is a thin,
server-layer default resolved in `runTool`, never state pushed down into the
engine. That explicit root is also the **working directory of every configured
project command** the core launches. Resolving configuration, scopes, and git
state against one root while allowing `format`/`test`/scope-gate commands to
inherit the MCP process cwd would certify a different checkout from the one the
commands actually checked. The gate runner therefore requires `cwd = root`;
ratchet measurements and command-resolution probes use the same rule. This also
applies to a short-lived CLI invoked below the project root: root discovery, not
the caller's subdirectory, defines project-command execution.

### 2. An explicit `path` override — escape hatch and the safety default's partner

Every root-operating tool gains an optional `path` argument, resolved through
`findRoot(path)` (so any directory inside a worktree resolves to its root, and a
non-project path falls through the existing `not_initialized` envelope). `path`
wins over the working root for that one call.

> **Refined (Phase B).** "For that one call" has one exception: a
> `path`-override `discern_graduate` that **removes the directory the held root
> points at**. A launch-pinned agent (Codex) spawns the server inside its
> worktree and graduates it _by `path`_, then issues a follow-up call with no
> `path` — which would resolve the now-deleted worktree. So the re-aim runs even
> on a `path` override, but **only when the held root no longer exists**
> (`heldRootMissing` in `runTool`): graduate that removed _your_ root re-roots
> you to where it landed; graduating some _other_ worktree by path leaves your
> live held root untouched, preserving the one-call rule for every
> non-destructive case.

> **Refined ([ADR 0111](0111-cross-project-path-and-strict-tool-schemas.md)).**
> Two of this section's edges moved. `discern_start`, originally the one
> root-operating tool *without* `path`, now declares it with creation-target
> semantics — the worktree is created for the project containing that path, and
> the re-aim follows it, a second deliberate exception to the one-call-steer
> rule. And `findRoot`'s unfenced resolution is now the documented contract:
> `path` may name **any** discern project on disk, which is what makes
> multi-repo setups workable from one session. Undeclared arguments — including
> `path` on a tool that doesn't take it — refuse loudly instead of being
> silently stripped by the SDK's open-object validation.

The held working root is not mere convenience over a bare `path` parameter — it
is a **safety default**. Path-only and stateless has a sharp edge: an agent that
forgets `path` on `discern_finish` silently gates the _spawn_ root, the
false-green this whole record exists to prevent. Defaulting to the last-started
worktree turns "forgot the parameter" into the right thing.

### 3. Retire location-based tool _visibility_; keep the refusals

The `requiresLocation`-driven hiding from `tools/list` (ADR 0058 §2) is removed;
all worktree-lifecycle tools are always listed. This is what makes a re-aimed
server usable: once `discern_start` re-points the working root to a worktree,
`discern_graduate` must be _callable_, so it can no longer be hidden by the
server's spawn location. The **defensive refusals stay** — `start` still refuses
from inside a worktree, `graduate` / `integrate` still refuse on the trunk — so
correctness is unchanged; only the UX-level hiding goes. Visibility is no longer
the safety boundary; the cores are.

We explicitly do **not** rebuild visibility dynamically via MCP
`tools/list_changed`: there is no trigger (the server cannot observe the agent's
`cd`), client support is inconsistent, and a freshly-revealed tool would still
operate on the wrong root — three independent reasons it cannot carry the job.

### 4. The agent-agnostic blind spot, stated as a constraint

`discern mcp` is one agent-agnostic binary; **it cannot know whether its client
can follow it into a worktree.** Claude Code (`EnterWorktree`) and Copilot
(`/worktree`) can move the session's own cwd to match a re-aimed server; Codex,
Cursor, and Gemini are launch-pinned and cannot (their worktree flow is a fresh
session). So re-aim-on-start is a _bet that the client follows_. Because the
server cannot detect this, two things are load-bearing, not optional:

- `discern_start`'s result **spells out** that the agent must move its own
  working context to the returned path too (via `EnterWorktree` / `/worktree` /
  a fresh session), or its edits and the gate will diverge.
- `discern_status` surfaces the active working root (it already renders
  `location` / `root` from the root it is handed), so any divergence is one call
  away from visible.

## Consequences

- The motivating failure is fixed at the root: a single session can
  `discern_start` then `discern_graduate` the same worktree without re-rooting
  the MCP connection. The headline regression test — start→graduate over one
  main-rooted connection — guards it.
- The MCP server gains **one piece of mutable process state.** This is a genuine
  step away from the "resolved once, immutable" model the server held before
  (root, features, instructions were all frozen at startup). The cost is
  bounded: exactly one value, changed on only two verbs, and inspectable via
  `discern_status`.
- **Re-aim-on-start bets the client can follow.** On a launch-pinned agent, an
  agent that misuses `start`-then-continues-in-session would point the gate at
  the new worktree while its edits stay on the trunk — a split. It is mitigated
  by §4's guidance and observability, but **cannot be enforced
  agent-agnostically**; that is the price of one binary serving every client.
- **Two working directories to keep aligned** — the server's working root
  (discern verbs) and the agent's own file cwd (edits). They point at the same
  path the agent already holds from `start`, but they are two things; this is
  inherent to the agent/server split, not removable. Discern's configured
  project commands follow the former explicitly; they never inherit the MCP
  process cwd. The alignment requirement remains because the agent's own edits
  still follow the latter.
- The `tools/list` is slightly noisier — an agent on the trunk now sees
  `graduate` / `integrate` (which refuse cleanly). Traded for never-stuck.
- Adjacent and out of scope: a sandboxed agent (Codex defaults its sandbox on)
  may force the resolved git common-dir read-only and break worktree commits
  regardless of the working root
  ([behaviour reference §3](../_private/research/cross-agent-behaviour-reference.md));
  that is a per-agent MCP-wiring concern, not this decision's.

## Alternatives considered

- **Per-call `path` only, no held default.** The stateless version, and the
  original instinct. Rejected as the _sole_ mechanism because a forgotten `path`
  silently gates the wrong tree — the held default exists precisely to make the
  dangerous omission safe. We keep `path` as the override, not the only lever.
- **Dynamic visibility via `tools/list_changed`.** Reveal `graduate` once a
  worktree is active. Rejected: no trigger, inconsistent client support, and the
  revealed tool would still hit the wrong root.
- **Keep the gate; require a fresh worktree-rooted session.** The "correct"
  client-side cure, but it makes `discern_start` start nothing and forces a
  session restart for the common Claude / Copilot single-session flow. Rejected
  as DX; kept only as the honest fallback for launch-pinned agents, where it is
  unavoidable anyway.

## See also

- [ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md) — `discern start` and
  the location-aware listing this revises (visibility retired; refusals kept).
- [ADR 0045](0045-mcp-is-core-infrastructure.md) and
  [ADR 0041](0041-self-describing-mcp-surface.md) — the MCP surface the working
  root lives on.
- [cross-agent-behaviour-reference.md §7](../_private/research/cross-agent-behaviour-reference.md)
  — the cross-agent MCP-root-pinning evidence and the empirical confirmation.
