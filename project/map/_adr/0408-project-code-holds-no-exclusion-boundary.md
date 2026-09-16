# ADR 0408: Project code holds no exclusion boundary

**Status**: accepted on 2026-09-17; amends [ADR 0330](0330-every-command-path-declares-its-operation-effects.md) and extends [ADR 0151](0151-the-desk-starts-tasks-and-opens-agents.md) and [ADR 0157](0157-the-desk-owns-launched-child-sessions.md)

## Context

ADR 0330 classified every command path and gave project-authored command execution the checkout boundary, with one consequence stated rather than argued: Project Script execution holds its checkout boundary while `queue` keeps its own concurrency authority. The desk's shell, editor, and coding-agent launches reused the same policy.

Those children are open-ended and human-paced. A shell opened from the desk to look around a worktree held that checkout's boundary until the operator typed `exit`, so an agent's `discern done` on the same worktree was refused for as long as the operator was reading code. A file-watching dev server started as a Project Script held the boundary for its whole lifetime, so agents stopped it to run the gate and often did not restart it. The mirror held too: while a gate ran, the desk refused the operator a shell on that worktree.

The checkout boundary serializes discern's own effectful verbs, whose interleaving corrupts claims, Proofs, and generated files. Project code cannot reach that state except by invoking `discern`, and the invocation acquires its own boundary. The gate does not depend on the boundary to protect its committed tip: it re-reads HEAD and cleanliness before every producer, extraction, and publication, which is the only defense that also covers an editor or shell discern never launched. Refusing a shell early therefore protected nothing the gate did not already protect.

## Decision

**A policy whose effects are only project code, reading, or an interactive session holds no exclusion boundary.** `queue`, `scripts`, and the desk's shell, editor, and agent launches declare `lock: "none"`. The desk launches carry a new `interactive-session` effect class naming an open-ended child that owns the terminal until the human ends it. `test` keeps its checkout boundary and declares the discern-owned checkout state it binds its captures to, so the rule has no exception list.

These operations keep their journal, ownership, desk-session marker, and interrupt contract. `status` and `progress` still show a running script or shell; contention messages still name a real holder when there is one.

The rule is enforced at the registry, which rejects a project-only policy that declares a lock across both the command-path and interactive registries, and at the launch boundary, where a terminal-owning child refuses an action not registered as a session before it spawns.

## Consequences

- An agent's gate runs while the operator reads code in a desk shell, and the operator can open a shell while a gate runs. A watching dev server stays up across gate runs.
- A Project Script that mutates the tree while a gate runs fails that gate at the next re-verification instead of being refused at its start. That is the same outcome an editor produces, reached a little later.
- A `discern` command invoked from a shell or script acquires its own boundary and contends like any other invocation.
- A future desk launcher must register as an interactive session; a future runner of project code must declare no lock, or declare the discern-owned state that justifies one.

## Alternatives considered

**Keep the boundary and make the gate wait for it.** Rejected because an idle shell holds the boundary indefinitely; waiting converts a refusal into a hang.

**A per-script annotation choosing whether to hold the boundary.** Rejected for now because the honest default is "not held", the gate already protects itself against the minority of mutating scripts, and the annotation would become part of the shipped extensibility contract for a marginal early refusal. A declaration block beside `# desc:` remains the place for it if a real case appears.

**Drop the boundary from `test` as well.** Rejected because a standalone validation run binds its captures and artifact scopes to the completion lease the engine requires; it is discern-owned work around project commands, not plain project execution.
