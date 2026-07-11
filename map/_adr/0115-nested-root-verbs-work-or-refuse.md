# ADR 0115: under a nested project root, every verb works correctly or refuses loudly

**Status**: accepted. Complements [ADR 0011](0011-adopt-worktree-workflow.md)
(the worktree workflow) and [ADR 0003](0003-named-metric-ratchets.md)
(named-metric ratchets).

## Context

`findRoot` roots discern at the nearest ancestor holding `discern.toml`, with no
requirement that this directory is also the git repository's top level. So a
project can legitimately sit _below_ its repo's root — a standalone discern
project folded into a monorepo is the natural way to get there — and every verb
will happily run in that shape. The shape had never been deliberately
considered, and the engine silently assumed the root IS the top level in the
places where git's path conventions make the two differ:

- git resolves a bare `rev:path` against the repository **top level**, so the
  ratchet baseline read (`git show <main>:discern.toml`) found nothing, returned
  "no baseline", and the never-loosen half of every ratchet — the guarantee the
  feature exists for — was silently disabled while the measurement half kept
  passing.
- `git diff --name-only`, `git status --porcelain`, and `git log --name-only`
  all emit **toplevel-relative** paths regardless of cwd, while scope globs,
  coupling queries, and the strand diagnostic all speak **root-relative** paths.
  Changed paths carried the subdir prefix, matched no scope glob, and scope
  gates silently skipped; the co-change miner's baskets could never match a
  query; sibling projects' changes leaked in as this project's evidence.

Each failure was silent — fewer gates, not more; a quietly missing advisory; a
loosened floor waved through. Meanwhile the worktree lifecycle already refused
the shape loudly (`start` names the layout and the fix), and `doctor`'s
"repository shape" check reports it — so the repo held both halves of a posture
without ever having chosen one.

## Decision

**Under a nested project root, every engine verb either works correctly or
refuses loudly. Silent misbehaviour is the defect; the class is guarded by
`tests/engine_nested_root_test.ts`.**

- **Git-facing readers normalize to root-relative.** `repoPathPrefix` /
  `stripRepoPathPrefix` (in `src/engine/scopes/scopes.ts`, beside
  `parsePorcelainPaths`) resolve the root's prefix inside the repo once and
  normalize every git-emitted path list: the scope classifier (`collectPaths`,
  feeding the gate, `status`, and `scopes`), the co-change miner, and the
  fix-stage strand snapshot. Paths outside the project subtree are dropped — a
  sibling project's changes in a shared repository are not this project's. The
  ratchet baseline is read with the cwd-relative `rev:./path` spelling.
- **The worktree lifecycle keeps its refusal.** A worktree is a whole-repository
  checkout; a nested root's copy would nest inside the repo with its
  `discern.toml` where nothing looks for it. `start` refuses with the move-it
  message, and `doctor`'s repository-shape check reports the same fact. This is
  a deliberate _no_: the lifecycle is not being taught the shape.
- **Repo-wide reads that only tighten stay repo-wide.** The clean-tree guards
  (`ratchets`, `--pin`, receipts) read `git status` across the whole repository:
  under a nested root, sibling dirt blocks with a loud message. Conservative and
  honest, so it stands.

## Consequences

- A monorepo-nested discern project gets a truthful gate: ratchets hold their
  never-loosen guarantee, scope gates fire, coupling answers — verified by the
  nested-root suite, which pins each key engine path (and the refusals) against
  one shared fixture. A future git-facing reader that skips the normalization
  seam fails there.
- The worktree workflow remains unavailable in the shape until someone designs
  it properly; `doctor` keeps saying so. Users who want it move `discern.toml`
  to the top level or split the repo, exactly as the refusal instructs.
- Receipt renderings may show repo-relative paths, and repo-wide clean-tree
  guards may block on sibling dirt — cosmetic and conservative respectively,
  accepted residuals of the split.

## Alternatives considered

- **Refuse the shape everywhere** (make every verb demand the root be the top
  level). Honest but heavy-handed: the measurement surface has no structural
  reason not to work, and hard-refusing would brick `finish`/`ratchets` for any
  monorepo fold-in that works today apart from the silent bugs.
- **Support the worktree lifecycle nested** (worktrees of the whole repo with
  re-rooting into the subdir). A real feature with real value, but a redesign of
  worktree placement, identity, and setup — not a bug fix, and not worth
  blocking the correctness fixes on.
