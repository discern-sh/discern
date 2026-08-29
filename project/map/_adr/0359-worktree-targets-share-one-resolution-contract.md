# ADR 0359: Worktree targets share one resolution contract

**Status**: accepted. Extends the landing model from [ADR 0110](0110-the-landing-model.md), deterministic worktree identity from [ADR 0025](0025-worktree-resources.md), and plan/apply lifecycle selection from [ADR 0027](0027-plan-apply-engine-execution.md).

## Context

A discern worktree is one line of work with several stable names: its discern id, registered path, local branch, and full local branch ref. Public commands had grown separate resolvers around those names. Await required a short branch, Start and Update accepted Git refs, Identity accepted a path, and Park and Drop accepted an id or path. An agent reading the fleet therefore had to translate a known worktree into the undocumented spelling each command expected. A new command could repeat another partial matcher and widen the inconsistency.

Git refs add a second ambiguity boundary. `from` must retain tags, commits, revision expressions, and full refs. One short token can also name both a Git ref and a worktree id, or several registered paths can share a basename or recorded id. Fleet order and Git's short-ref precedence are not authority to choose one.

## Decision

One shared resolver maps an exact worktree id, registered path, local branch, or full local branch ref to canonical worktree facts. Every public argument whose meaning is “this line of work” consumes that resolver:

- The `green` and `landed` Await conditions resolve a branch;
- Start and Update's `from` resolve a commit source while retaining Git's broader commit-ish vocabulary;
- Park, Drop, and Identity resolve a registered checkout.

Parked task metadata keeps id-to-branch resolution available after Park removes a checkout. A conventionally prefixed local branch also remains reachable by its valid worktree id when no checkout is registered. Await continuations store the canonical branch so later evaluations do not repeat the caller's spelling.

Resolution collects every applicable candidate before acting. Several registered worktrees, a worktree alias colliding with a different Git ref, or conflicting live and parked evidence is an ambiguity. The command refuses and asks for an absolute path or full ref. A full ref distinguishes Git namespaces; an absolute path distinguishes registrations. Equivalent evidence for the same branch is one candidate.

The resolver does not treat a mutable task display title as identity. Model Context Protocol (MCP) tools' generic `path` field remains repository routing: it selects which discern project or checkout receives the call before an argument is resolved, rather than naming a sibling line of work.

## Consequences

- A fleet row can be passed directly to Await, Start, Update, Park, Drop, or Identity using any exact stable form the command's mode can use.
- Help, MCP schemas, bundled Skills, and the Map can describe one vocabulary instead of teaching verb-specific translation.
- `from` continues to accept branches, tags, commits, and revision expressions; worktree aliases add candidates without weakening Git ambiguity checks.
- Destructive verbs still require a registered non-main checkout and keep their cleanliness, merge, lock, ownership, and force boundaries. More spellings identify the same reviewed target; none broaden what the operation may do.
- New line-of-work consumers inherit the whole vocabulary by calling the shared resolver. The parameterized resolver test and cross-command adapter test guard both directions and ambiguous collisions.

## Alternatives considered

- **Document each command's preferred spelling.** Rejected because it preserves translation work for every caller and lets future commands drift again.
- **Normalize every token to a prefixed branch string.** Rejected because paths and overridden ids are positive identity evidence, while arbitrary Git refs used by `from` do not follow the worktree branch convention.
- **Let Git precedence choose when a ref and worktree id collide.** Rejected because precedence answers a Git parsing question, not which line of work the caller intended.
- **Accept task display titles.** Rejected because titles are mutable, non-unique human metadata and cannot safely identify a destructive target.
