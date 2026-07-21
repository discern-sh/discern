# ADR 0020: Dissolve `.discern/` — one root config file, config-driven point-and-override, feature toggles

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged. **Project Script amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** The config-pointing and ownership rule now applies to `[scripts].dir`; Project Scripts live under `discern script`, not the root command namespace.

**Status**: accepted; **supersedes [ADR 0016](_superseded/0016-consolidate-install-surface.md)**; the single-root-file **config** footprint is narrowed for _runtime_ per-worktree state by [ADR 0025](0025-worktree-resources.md) (the resource ledger under `.git/`); the `[features]` set introduced here is later revised by [ADR 0045](0045-mcp-is-core-infrastructure.md) (which drops `mcp` — the MCP server became core infrastructure, not a toggle); the root-scatter defaults introduced here are consolidated under a visible `discern/` namespace by [ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md), and the `[features]` set is retired outright by [ADR 0101](0101-retire-the-features-toggles.md) — this ADR's config-pointing and ownership rules stand

## Context

[ADR 0016](_superseded/0016-consolidate-install-surface.md) consolidated everything the kit owned under a hidden `.discern/` namespace: `config.toml`, `guidelines/`, `brief.md`, `recipes/`, and `skills/`. That answered "discern is all over the place" — but the single-binary cutover ([ADR 0019](0019-single-binary-ts-engine.md)) changed the calculus, and three DX problems remained, all about the _install footprint_ rather than the tool:

1. **It hid content you author.** Guidance, recipes, and skills are things you write and want to _see_ — burying them in a dotfolder is poor discoverability.
2. **It forced the binary's artifacts to cohabit with your files.** `.discern/skills/` held **bundled** skills (the binary's, gitignored, re-published) _and_ **authored** skills (yours, tracked) in one directory — a part-tracked/part-ignored mess that silently de-tracked authored skills on upgrade. (The concrete trigger: a repo with hand-authored skills under `.discern/skills/` would lose them by following the upgrade guide literally.)
3. **There was no provider-agnostic, config-driven way to point discern at your _own_ conventions.**

This is still pre-adoption beyond the maintainer, so the layout can change freely.

## Decision

**Dissolve `.discern/`.** The entire discern footprint in a project becomes **one root file: `discern.toml`.** Everything else is one of three things:

1. **Bundled in the binary** — the engine (already), the built-in discern guidance (`templates/guidance/*`), and the built-in skills (`templates/skills/`).
2. **A config-pointed location you choose**, with a sensible discoverable default, read only when present: `[guidance].sources` (→ `guidance.md`), `[skills].dir` (→ `./skills`), `[recipes].dir` (→ `./recipes`).
3. **An output discern writes** (never yours): the compiled agent files (`AGENTS.md` tracked; `CLAUDE.md`/`GEMINI.md` gitignored) and the materialized `.claude/skills/`.

Concretely:

- **Root discovery keys on `discern.toml`.** The pre-6 `.discern/config.toml` is demoted to a legacy/migration-source marker (recognised so a not-yet-upgraded install still works and is carried forward).
- **Skills, guidance, recipes are bundled built-ins ⊕ your config-pointed additions, yours overriding/extending** — one consistent rule for all three.
- **Skills materialize into the provider dir `.claude/skills/`** (gitignored): bundled skills as **copies** (their source is in the binary, out of the tree), authored skills as **symlinks** into `[skills].dir` (so edits are live). No directory is ever part-tracked/part-ignored — `[skills].dir` is 100% yours, `.claude/skills/` is 100% generated. `discern skills list|eject` manage the set.
- **Built-in discern guidance is bundled, always-on, and feature-aware.** The compiler assembles `[built-in base] + [built-in section per enabled feature] +
  [your [guidance].sources]` into each provider file in `[guidance].agents`. A generated banner heads every output; only `AGENTS.md` is tracked.
- **`[features]` toggles whole subsystems** (worktrees, standards, guidance, skills, docs); each defaults on. A disabled feature vanishes coherently: its verbs hide from `--help` (and error "feature disabled" if invoked), its hooks aren't written, its guidance section is omitted, and its doctor checks skip. This is **distinct from `[capabilities]`** (the gate's command table) — they are different sections with different jobs.
- **`.claude/` is the provider's, not discern's.** discern writes hooks and materializes skills there because that is where Claude Code looks; it is a write-_target_, never part of "where discern keeps its stuff."

This is a schema **5 → 6** migration (the first under the ADR 0014 chain to move the config back to the root — where the pre-0016 layout already had it).

## Consequences

- **An empty install is one file: `discern.toml`** (plus the generated `AGENTS.md`/ `CLAUDE.md` and the two integration files `.claude/settings.json` + `.gitignore`). As you opt in, _your_ files appear in the open at paths you control.
- **The part-tracked/part-ignored skills bug is gone by construction** (R1): the 5→6 migration splits `.discern/skills/` by name — authored dirs move to `./skills/`, pristine bundled copies are pruned, and a _customized_ bundled-named dir is preserved (moved to `./skills/` as an override) rather than lost. A fixture-backed test asserts the split.
- **`AGENTS.md` is tracked but generated.** A loud banner and the docs say so; a stale `AGENTS.md` fails CI's `git diff --exit-code`. Every other provider mirror is gitignored.
- **Downstream installs with custom recipes that sourced the old shell library still need a manual rewrite** (the R3 contract from ADR 0019); `doctor` flags them, and the upgrade guide calls it out.
- This **supersedes [ADR 0016]**: the `.discern/` namespace it introduced is gone. It also retires 0016's managed-skills relocation question — skills are now bundled-plus-authored with a clear override rule.

## Alternatives considered

- **Keep `.discern/` but un-hide the authored parts.** Rejected: the real problem was the mixed-ownership directory and the lack of config-driven pointing, not merely the dot-prefix. A half-measure would keep the de-tracking trap.
- **Put authored skills/guidance under `.claude/`.** Rejected: `.claude/` is the provider's directory (gitignored, regenerated). Authored content must be the user's, tracked, and provider-agnostic.
- **Keep `AGENTS.md` gitignored like the other mirrors.** Rejected: a tracked agent file makes guidance changes reviewable and gives CI a drift check; one tracked mirror is enough, and `AGENTS.md` is the committed cross-tool standard.
- **A blanket prune of `.discern/skills/` on migration.** Rejected: it would lose hand-authored skills (the exact bug that triggered this). The by-name split with a content guard preserves authored work.
