# Engine internals

_The `agent` dispatcher and the dependency-free POSIX-shell library every Recipe
stands on._

This subtree covers the shared substrate under the gate, the Worktree workflow,
and guidance. [`agent`](../../templates/agent) is the **dispatcher**: it finds
the project root (the nearest ancestor with a `.icculus/config.toml`), routes
`agent <verb>` to the matching Recipe, lets the Engine win on a name collision
with a project recipe, and suggests a near-match on a typo. It is intentionally
tiny — the Recipes hold the logic.

Every Recipe sources `lib/bootstrap.sh`, which wires up the rest of
[`.icculus/engine/lib/`](../../templates/.icculus/engine/lib/): config access
(`config.sh` + the `toml.awk` parser), the parallel job runner (`jobs.sh`),
colour-aware output (`output.sh`), the Ratchet engine (`ratchets.sh`), the
failure-pointer wording (`gotchas.sh`), value validators (`validate.sh`), and
the shared Worktree helpers (`worktree.sh`). It is dependency-free POSIX shell —
no Deno, no Node — which is what lets the Harness drop into any project.

Engine Recipes run under `noglob` (`set -f`) by policy, so an unquoted glob in a
config value never expands unexpectedly; project recipes keep normal globbing
(ADR 0012). This is internal plumbing: Recipes source it, you rarely read it
directly.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.icculus/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_ | What it will cover                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `the-dispatcher.md`    | Root-finding, dispatch, engine-wins-on-collision, the typo suggester, `--help`.       |
| `the-shell-library.md` | `bootstrap.sh` and what each `lib/*.sh` provides to a Recipe.                         |
| `config-access.md`     | Reading `.icculus/config.toml` from shell via `config.sh` and `toml.awk`.             |
| `the-job-runner.md`    | `run_serial` / `run_parallel`, labelling, fail-fast, and the structured side channel. |
| `noglob-policy.md`     | Why Engine Recipes run under `set -f`, and the marker that scopes it (ADR 0012).      |

## See also

- [system-map.md](../00-orientation/system-map.md) — the run-time dispatch axis.
- [ADR 0012](../_adr/0012-engine-noglob-default.md) — the engine-noglob
  decision.
