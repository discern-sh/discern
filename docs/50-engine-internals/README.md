# Engine internals

_The dispatcher and the TypeScript modules every built-in verb is built on._

This subtree covers the shared substrate under the gate, the Worktree workflow,
and guidance. [`dispatch.ts`](../../src/engine/dispatch.ts) is the
**dispatcher**: it finds the project root (the nearest ancestor with a
`.icculus/config.toml`), routes a known `icculus <verb>` to its built-in
in-binary handler, execs an _unknown_ verb as a matching project Recipe (with
the `ICCULUS_*` environment exported), lets the Engine win on a name collision
with a project recipe, and suggests a near-match on a typo.

The Engine is **TypeScript compiled into the binary**, under
[`src/engine/`](../../src/engine/) and sharing
[`src/shared/`](../../src/shared/) with the Installer — no Deno or Node is
installed into a project, which is what lets the Harness drop into any project.
The built-in handlers are organised by area: the gate and its job runner
([`gate/`](../../src/engine/gate/), [`jobs/`](../../src/engine/jobs/)), scope
classification ([`scopes/`](../../src/engine/scopes/)), the worktree lifecycle
and identity ([`worktree/`](../../src/engine/worktree/)), and the guideline
compiler ([`guidelines.ts`](../../src/engine/guidelines.ts)). Shared concerns —
config reading, capability/stage constants, the POSIX-`cksum` port, and root
discovery with `ICCULUS_*` — live under [`src/shared/`](../../src/shared/).

Scope globs are matched in-memory by
[`scopes/glob.ts`](../../src/engine/scopes/glob.ts), so a glob in a config value
never expands against the filesystem the way an unquoted shell glob would; a
project Recipe is just an executable with normal shell globbing. This is
internal plumbing: the built-in verbs run it, you rarely read it directly.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.icculus/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_ | What it will cover                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `the-dispatcher.md`    | Root-finding, dispatch, engine-wins-on-collision, the typo suggester, `--help`.       |
| `config-access.md`     | Reading `.icculus/config.toml` via `config_read.ts` and the `icculus config` surface. |
| `the-job-runner.md`    | Serial/parallel staging, labelling, fail-fast tree-kill, and the structured channel.  |

## See also

- [system-map.md](../00-orientation/system-map.md) — the run-time dispatch axis.
- [ADR 0019](../_adr/0019-single-binary-ts-engine.md) — collapsing into one
  binary with a TypeScript-native engine.
