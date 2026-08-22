# ADR 0099: Consolidate the authored surface under a visible `discern/` namespace

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0169](0169-the-launch-glossary-canon.md)):** ADR 0120 supersedes this record's map vocabulary — live config uses `[map]` — and the current spelling is Agent file (formerly `Compiled agent file`); the decision and reasoning are unchanged.
> - **[ADR 0137](0137-project-scripts-live-under-the-script-command.md) — Project Scripts:** the row originally named `[recipes].dir` is now `[scripts].dir`; its default moved from `discern/recipes` to `discern/scripts`. The placement rule stands.
> - **[ADR 0195](0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md) — placement:** the fresh map now defaults to `discern/map/`, restoring this record's namespace rule while keeping the map noun.
> - **Self-hosting (2026-07-13):** this repository now points every ongoing configurable authored source beneath `project/` — guidance, map, authored skills, project scripts, and ledger — to exercise every independent path override coherently.

**Status**: accepted; amends [ADR 0020](0020-dissolve-discern-dir.md) (its config-pointing and ownership rules stand; its root-scatter defaults are revised) and [ADR 0080](0080-configured-agent-map-root.md) (the docs default moves inside the namespace)

## Context

discern has always claimed a **one-file footprint**: the entire install is `discern.toml`. The claim is true of discern's _own_ namespace but false of the committed surface a fresh full install actually produces: `discern.toml`, `guidance.md`, `TODO.md`, an optional `brief.md`, and the docs skeleton — four potential root files plus a tree, before the integration shims. Each file is justified on its own; together they read as scatter, and root real estate is the most expensive place to scatter.

[ADR 0020](0020-dissolve-discern-dir.md) dissolved the hidden `.discern/` directory for three reasons: it hid content the user authors, it mixed tracked and generated files in one directory, and there was no config-driven way to point discern at existing conventions. All three were cured — but the cure (root scatter plus config pointing) traded containment away entirely. The objections were to a _hidden, mixed-ownership_ directory, not to a directory.

The ecosystem shows what a tolerable tool directory looks like: `prisma/`, `fastlane/`, `gradle/`, `cypress/` are visible, branded, and accepted — and every one of them contains only files whose shape the tool dictates. None contains content the user authors for audiences of their own. That is the implicit contract that makes a branded directory welcome.

This is the last cheap window: discern is pre-release with no external installs, so a layout migration costs one schema step.

## Decision

**A visible `discern/` directory becomes the default home for everything discern asks of the user and everything it maintains for them.** Concretely, the defaults become:

| Source               | Old default   | New default           |
| -------------------- | ------------- | --------------------- |
| `[guidance].sources` | `guidance.md` | `discern/guidance.md` |
| `[docs].dir`         | `docs/`       | `discern/docs/`       |
| deferred-work ledger | `TODO.md`     | `discern/TODO.md`     |
| `[skills].dir`       | `skills`      | `discern/skills`      |
| `[recipes].dir`      | `recipes`     | `discern/recipes`     |
| project brief        | `brief.md`    | `discern/brief.md`    |

- **`discern.toml` stays at the root.** It is the discovery marker — the root-config convention (`deno.json`, `Cargo.toml`, `fly.toml`) — and the one committed root file. The footprint sentence becomes "one root file, one visible folder".
- **The placement rule.** A path defaults into the namespace exactly when discern is the reason it looks the way it does: inputs discern consumes (guidance sources, authored skills, recipes, the brief) and knowledge its discipline maintains (the map — [ADR 0100](0100-project-map-is-the-agents-map.md) — and the ledger). Content the user authors for their own audiences never defaults there. Future files get placed by this rule, not by re-litigating the layout.
- **Placement is consent.** A file at its namespace default carries an implicit write-license: agents maintain it freely and staleness is a defect. A config key pointed outside the namespace is an explicit write-license: the user typed the path. A path that is neither is untouchable. Every source keeps its config key — prescriptive defaults, portable paths; pointing remains the brownfield escape hatch, exactly as ADR 0020 built it.
- **The namespace stays 100% the user's.** No generated or gitignored artifact is ever written inside `discern/` — Agent files, materialized skills, and provider files stay at their vendor-fixed paths. This preserves ADR 0020's mixed-ownership lesson: no directory is ever part-tracked, part-generated.
- **The write-surface contract.** discern writes to a user project only: the root `discern.toml`; the configured source paths (default `discern/**`); the Agent files and provider integration files at vendor-fixed paths; the delimited `.gitignore` block; and runtime worktree state (`.env` entries, the ready sentinel). The contract is enforced by an architectural test driven from the paths registry ([ADR 0102](0102-paths-registry-and-rendered-artifacts.md)), so the footprint claim is a checkable predicate rather than copy.
- **Migration.** A schema step moves each source file from its old default to its new one when the config did not override it, and leaves every user-pointed path alone.
- **This repo self-hosts on a non-default layout.** Every ongoing configurable authored source resolves beneath `project/` through its existing independent key. A registry-driven architectural guard requires each source to remain there and exist, excluding only the setup-time brief because it has no ongoing config key. This keeps hard-coded-default leaks loud without changing a fresh installation's layout.

## Consequences

- The footprint story becomes literally true, visually verifiable in a file listing, and gate-enforced — a stronger claim than the old one-file slogan, because it is testable.
- A brownfield adoption diff is `discern.toml` + `discern/` + two shims; the project's existing tree is untouched by construction.
- Setup's existing-docs conflict machinery (the `docs/discern/` suggestion) dissolves: the default no longer collides with anything.
- The shipped `.gitignore` fragment must stop hard-coding a docs path in its comment (it currently points at `docs/80-development/install-surface.md`, which is this repo's layout, not the installed project's).
- Uninstalling discern leaves `discern/` behind as readable markdown; the name then records provenance accurately. Assets a user wants unbranded are one `git mv` plus one config key away, before or after uninstall.
- ADR 0020's single-root-file consequence is revised to one-root-file-plus-one-namespace; everything else in it stands.

## Alternatives considered

- **Keep the root-scatter defaults (status quo).** Rejected: four root files from one tool has no containment story, and each seeded file must justify itself separately to every newcomer.
- **Re-hide under `.discern/`.** Rejected in ADR 0020 and the reasons hold: hidden folders bury content the user authors and edits.
- **Inline everything into `discern.toml`.** Rejected: markdown in TOML strings is unreadable, diffs badly, and agents consume standalone files far better.
- **Enforce the namespace (drop the config keys).** Rejected: pointing is the consent model and the brownfield path; enforcement would delete both.
- **A separate "namespace root" config knob.** Rejected: it would be a second way to state each location — the per-source keys already exist and remain the single way.
