# Engine internals

_The dispatcher and the TypeScript modules every built-in verb is built on._

This subtree covers the shared substrate under the gate, the Worktree workflow,
and guidance. [`dispatch.ts`](../../src/engine/dispatch.ts) is the
**dispatcher**: it finds the project root (the nearest ancestor with an
`discern.toml`), routes a known `discern <verb>` to its built-in in-binary
handler, execs an _unknown_ verb as a matching project Recipe (with the
`DISCERN_*` environment exported), lets the Engine win on a name collision with
a project recipe, and suggests a near-match on a typo. Every subsystem's verbs
are always registered — there is no toggle layer in the dispatch
([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). The router in
[`main.ts`](../../src/main.ts) resolves the verb as the first token that is not
a global flag, so `discern --json <verb>` routes exactly like
`discern <verb> --json` — the pre-setup redirect
([ADR 0036](../_adr/0036-unify-setup.md)), the welcome/help split, and recipe
dispatch included.

The Engine is **TypeScript compiled into the binary**, under
[`src/engine/`](../../src/engine/) and sharing
[`src/shared/`](../../src/shared/) with the Installer — no Deno or Node is
installed into a project, which is what lets the Harness drop into any project.
The built-in handlers are organised by area: the gate and its job runner
([`gate/`](../../src/engine/gate/), [`jobs/`](../../src/engine/jobs/)), scope
classification ([`scopes/`](../../src/engine/scopes/)), the worktree lifecycle
and identity ([`worktree/`](../../src/engine/worktree/)), and the guideline
compiler ([`guidelines.ts`](../../src/engine/guidelines.ts)) — which assembles
discern's built-in guidance plus the project's sources and materializes the
skills. Shared concerns — config reading, the
[paths registry](../../src/shared/paths_registry.ts), capability/stage
constants, the POSIX-`cksum` port, and root discovery with `DISCERN_*` — live
under [`src/shared/`](../../src/shared/).

Scope globs are matched in-memory by
[`scopes/glob.ts`](../../src/engine/scopes/glob.ts), so a glob in a config value
never expands against the filesystem the way an unquoted shell glob would; a
project Recipe is just an executable with normal shell globbing. This is
internal plumbing: the built-in verbs run it, you rarely read it directly.

Every **effectful** verb follows a **plan/apply** shape
([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)): it computes a pure
plan first (read-only — load config, classify changed scopes, read the resource
ledger), then a thin executor applies it. That split is what gives `finish`,
`graduate`, `worktree` setup/teardown/prune, and `ratchets` a `--dry-run`
(render the plan, touch nothing) and a `--json` that **serializes the
`DiscernResult`** — the one envelope every verb returns
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)) — rather than
re-deriving it. The plan vocabulary, the diagnostic, the envelope, and the one
shared plan→human/JSON renderer live in
[`shared/result.ts`](../../src/shared/result.ts) (the base layer both halves
import), with the `Out`/`Logger` sink adapters beside the writers they bridge —
the engine generalization of the installer's
[`fs_plan.ts`](../../src/lib/fs_plan.ts) /
[`plan_view.ts`](../../src/lib/plan_view.ts). The decision logic each verb plans
from (gate job derivation, scope-gate selection, the prune-GC reclaim decision)
is factored into pure functions, unit-tested with no subprocess.

This tree is contributor-facing — internals for people working ON discern — so
it is not bundled into `discern help`; read it here or on GitHub.

## In this section

- [config-access.md](config-access.md) — reading `discern.toml` via the typed
  schema, the paths registry and resolvers, and the `discern config` surface.

## See also

- [system-map.md](../00-orientation/system-map.md) — the run-time dispatch axis.
- [ADR 0019](../_adr/0019-single-binary-ts-engine.md) — collapsing into one
  binary with a TypeScript-native engine.
- [ADR 0027](../_adr/0027-plan-apply-engine-execution.md) — plan/apply as the
  engine's execution model (the `--dry-run` / serialized-`--json` seam).
