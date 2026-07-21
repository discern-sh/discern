# Install surface

_What `discern setup` lays down in a project, and which files are **yours** (written once, then kept), **co-managed** (discern owns a delimited part), or **the binary's** (re-published artifacts that may be overwritten)._

One `discern setup` scaffolds discern into a project. By default, `discern.toml` and the project `map/` stay at the root; the `discern/` namespace holds guidance, authored skills, project scripts, the ledger, and the setup brief ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md); see [the write-surface contract](#the-write-surface-contract)). The namespace belongs entirely to the project. The binary writes no generated artifacts inside it, leaving every directory either tracked or generated. Seed files originate in [`templates/`](../../../templates/), which is their source of truth. The binary renders, merges, or appends them into place. Built-in skills and guidance are bundled in the binary and appear on disk only as generated output.

This page groups the installed files by purpose. For an exhaustive file list, consult the self-describing sources that define the leaves:

> - `discern --help` lists every subcommand.
> - [`discern.toml`](../../../templates/discern.toml.tmpl) documents every config block in its own comments.

## The buckets

Each installed path belongs to a bucket that determines how the binary treats it on `upgrade` and where you change it.

| Bucket           | What it is                                                                                                                                                                                               | On `discern upgrade`                                                                                                                                                                                                                                                                  | Where you change it                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **yours**        | The root `map/`, the `discern/` namespace (guidance, authored skills, project scripts, the ledger, the brief), and project-owned portions of merged provider settings.                                   | Untouched.                                                                                                                                                                                                                                                                            | Edit the file in place.                                                                                                 |
| **co-managed**   | `discern.toml`'s fixed scaffold and ruled banners, plus the delimited discern block in `.gitignore`; project-owned values, record tables, key comments, and ignore rules outside the block remain yours. | Versioned migrations run; missing fixed sections/keys are restored (ADR 0092), every ruled config banner converges on the template (ADR 0138), and the `.gitignore` block converges on the current fragment (ADR 0093). Values, named tables, key comments, and outside rules remain. | Edit project values, named tables, comments outside ruled banners, and ignore rules outside the discern block in place. |
| **the binary's** | Re-published artifacts: gitignored materialized-skills dirs (`.claude/skills/`, `.agents/skills/`) and tracked compiled agent files. Produced from the bundled sources and safe to overwrite.            | Re-published — overwritten to match the binary.                                                                                                                                                                                                                                       | Edit the source (in this repo) and re-run the producing command.                                                        |

A limit case of the binary's bucket is **bundled**: the engine, the built-in skills ([`templates/skills/`](../../../templates/skills/)), and the built-in guidance ([`templates/guidance/`](../../../templates/guidance/)) ship _inside_ the binary and remain absent from project history ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The same buckets are defined in the [glossary](../00-orientation/glossary.md#file-dispositions).

`setup` preserves existing content in each configured agent's settings file through a structured merge. It also preserves the project rules around the delimited discern block in `.gitignore`.

## The write-surface contract

discern writes to a user project **only**:

- the root `discern.toml` (the config writer);
- the configured source paths, resolved through the [paths registry](../../../src/shared/paths_registry.ts): the root `map/` plus the guidance seed, authored-skills and project scripts dirs, ledger, and brief under `discern/` by default;
- the compiled agent files, materialized-skills dirs, and provider integration files, at the vendor-fixed paths the [provider registry](../../../src/lib/providers.ts) declares;
- the delimited block in `.gitignore`;
- an existing worktree `.env`, updated in place.

Everything else it records lives inside `.git` (the gate receipt, the worktree-ready sentinel, the resource ledger, the ignored-file baseline), at a path the user typed (`docs --output`), or in a temp file — outside the project tree. **[Placement is consent](../00-orientation/glossary.md#placement-is-consent)**: a file at its namespace default carries an implicit write-license; a config key pointed elsewhere is an explicit one; a path that is neither is untouchable ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).

The contract is enforced by [`tests/paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts), guard #4 of the leakage battery ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)): a static funnel confines every raw write primitive in `src/**` to a sanctioned write-site module, and a runtime pass scaffolds a project, runs `setup begin` + `refresh` + `upgrade`, and checks every file written against the contract derived from the two registries. A write outside the surface fails the gate — which is what makes the footprint sentence a checkable predicate rather than copy.

## Control surface & configuration

| Path                                                   | Bucket     | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`discern.toml`](../../../templates/discern.toml.tmpl) | co-managed | The hand-edited root file. It teaches the generic engine about your stack: jobs, scopes (with gates), worktree settings, standards, gate ergonomics, and the `[map]`/`[guidance]`/`[skills]`/`[scripts]`/`[project].todo` pointers. Its `[meta].schema_version` is the migration anchor ([ADR 0014](../_adr/0014-versioned-migration-system.md)); missing fixed structure is restored ([ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md)), and prose between ruled banner delimiters is replaced from the current template while key comments stay project-owned ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md)). |
| `discern/brief.md`                                     | yours      | An optional project brief — seeded only when one is supplied (`discern setup --brief`/`--config`). When present, the agent reads it to help fill the map and guidance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Every source path has a prescriptive default and a config key that points it anywhere ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)):

| Source               | Default               | Config key           |
| -------------------- | --------------------- | -------------------- |
| guidance source      | `discern/guidance.md` | `[guidance].sources` |
| the map              | `map/`                | `[map].dir`          |
| authored skills      | `discern/skills`      | `[skills].dir`       |
| project scripts      | `discern/scripts`     | `[scripts].dir`      |
| deferred-work ledger | `discern/TODO.md`     | `[project].todo`     |
| project brief        | `discern/brief.md`    | — (fixed)            |

This repo itself points every ongoing configurable authored source beneath `project/`: the map, guidance, authored skills, project scripts, and ledger. The registry-driven self-hosting guard makes a future configurable source auto-enrol, while the shipped defaults in the table above remain unchanged.

## The quality gate

The gate is part of the binary's TypeScript engine ([`src/engine/`](../../../src/engine/)). Its public verbs are first-class `discern` subcommands:

| Command             | What it does                                                                                                                                                                                          | Source                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `discern done`      | The full gate — (in a worktree) the trunk-merged precondition first, then built-in currency and write-access preconditions, `fix`+`build`, `check`+`test` in parallel, and scope-matched scope gates. | [`src/engine/gate/finish.ts`](../../../src/engine/gate/finish.ts)       |
| `discern prepare`   | The fast inner loop — fixers then read-only checks; no build or test.                                                                                                                                 | [`src/engine/gate/prepare.ts`](../../../src/engine/gate/prepare.ts)     |
| `discern test`      | The `test` job on its own.                                                                                                                                                                            | [`src/engine/gate/test.ts`](../../../src/engine/gate/test.ts)           |
| `discern standards` | Measures configured metric floors and ceilings when invoked; its built-in write preflight covers the measurement receipt, plus config and Git commit state when pinning.                              | [`src/engine/gate/standards.ts`](../../../src/engine/gate/standards.ts) |
| `discern impact`    | Classifies which scopes the branch touches; fails **open** (an unknown path runs additional gates).                                                                                                   | [`src/engine/scopes/scopes.ts`](../../../src/engine/scopes/scopes.ts)   |

Every subsystem is core. The config has no `[features]` table or existence toggle ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). A subsystem that costs nothing when unused needs no switch: worktrees exist only when started, and standards exist only when defined. `[skills].exclude` remains because materialized skills occupy agent context even when unused. `[jobs]` is the gate's command table.

Stage scheduling ([`src/engine/gate/stages.ts`](../../../src/engine/gate/stages.ts)), the failure-pointer wording ([`src/engine/gate/gotchas.ts`](../../../src/engine/gate/gotchas.ts)), and the parallel/serial job runner ([`src/engine/jobs/runner.ts`](../../../src/engine/jobs/runner.ts), with process-group tree-kill in [`src/engine/jobs/command.ts`](../../../src/engine/jobs/command.ts)) back these. `doctor` ([`src/commands/doctor.ts`](../../../src/commands/doctor.ts)) health-checks the install — config, git, job commands, paths, and a readiness report.

## The isolated-worktree workflow

The worktree workflow is discern's spine and has no feature toggle or attached configuration ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). Generic git mechanics live in the engine ([`src/engine/worktree/`](../../../src/engine/worktree/)), driven by the hooks in [Bookkeeping & integration](#bookkeeping--integration). The stack-specific part is the per-worktree **resources** (`[worktree.resources.<name>]`) a project declares in `discern.toml`; a fresh install declares none.

| Command                     | What it does                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `discern start`             | Creates + sets up an isolated worktree to begin a change in.                                                 |
| `discern worktree create`   | Creates + sets up a worktree from the `WorktreeCreate` hook's JSON payload (stdin).                          |
| `discern worktree setup`    | Sets up a freshly-created worktree (what `worktree create` runs inside it).                                  |
| `discern worktree ensure`   | Session-start idempotent setup (run by the `SessionStart` hook).                                             |
| `discern accept`            | Accepts the branch into the main repo, tears the worktree down, and refreshes the checkout it leaves behind. |
| `discern worktree remove`   | Tears a worktree down from the `WorktreeRemove` hook's payload (stdin; best-effort).                         |
| `discern worktree teardown` | Destroys a worktree's resources (what `worktree remove` runs).                                               |
| `discern worktree prune`    | Sweeps stale worktrees, fully-merged branches, orphan dirs, and orphan resources.                            |
| `discern identity`          | Resolves a worktree's stable identity (id / site / branch / port / db / resource).                           |

The lifecycle logic lives in [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts); the stable worktree identity (POSIX-`cksum`-faithful) in [`src/engine/worktree/identity.ts`](../../../src/engine/worktree/identity.ts). Run `discern --help` for the full verb list.

## Agent instructions (author-once → compile-everywhere)

| Path                                 | Bucket    | What it is                                                                                                                                                                                                                                                   |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `discern/guidance.md`                | yours     | Your hand-authored guidance source(s) — the default `[guidance].sources`, additive to the built-ins. Globs allowed. Seeded by `discern setup`.                                                                                                               |
| `AGENTS.md`                          | generated | The **canonical** agent file — holds the full compiled body the mirrors import; Codex, Cursor, and the Copilot CLI read it natively. Committed by default (ADR 0128) so a bare clone carries it; a stale one fails `discern done`'s guidance-currency check. |
| `CLAUDE.md`, `GEMINI.md`             | generated | The committed per-agent mirrors — each a one-line `@AGENTS.md` import (both vendors expand it in place), so neither can drift from the canonical file. No banner — drift is caught by the currency check.                                                    |
| `.claude/skills/`, `.agents/skills/` | generated | Materialized skills the configured agents discover — built-ins rendered, authored skills symlinked. Gitignored; stale rendered skills fail the skills currency check, and force-tracked materialized files fail the tracked-artifacts guard.                 |

`discern refresh` ([`src/engine/guidelines.ts`](../../../src/engine/guidelines.ts)) regenerates the agent files, skills, and integration artifacts. It compiles the canonical body from **discern's built-in guidance**, followed by **your `[guidance].sources`**. It then writes each provider's full body or canonical pointer and materializes the skills again. `[guidance].agents` selects the files through the provider registry ([`src/lib/providers.ts`](../../../src/lib/providers.ts)). The MCP, hooks, and skills wiring for each agent are mapped in [`../60-agent-integrations/`](../60-agent-integrations/).

## Bundled skills

The bundled skills a coding agent can invoke ship **in the binary**. Their source lives under [`templates/skills/`](../../../templates/skills/) and is included by `deno compile --include templates`; the table below is guard-checked against that set. A project can add its own skills under `[skills].dir` (default `discern/skills`), overriding a built-in by name.

`discern refresh`, `setup`, and `upgrade` materialize the effective set into each configured agent's generated, gitignored skills directory. The strict template engine renders built-ins, replacing path tokens such as `{{map_dir}}` with configured paths ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). Authored skills are symlinked so edits are live (see [`src/lib/skills.ts`](../../../src/lib/skills.ts)). `discern skills list` shows the effective set and its overrides. `discern skills eject <name>` copies a built-in into your skills directory for customization. `[skills].exclude` drops named skills from materialization. Each skill is a `SKILL.md` under its directory:

| Skill                                                                                             | What it does                                                                                                         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`discern-shape-the-work`](../../../templates/skills/discern-shape-the-work/SKILL.md)             | Turn a vague ask into a one-page brief: the goal, decisions answered or defaulted visibly, falsifiable criteria.     |
| [`discern-delegate-work`](../../../templates/skills/discern-delegate-work/SKILL.md)               | Shape work into self-contained briefs — one handoff, a fan-out, or stages — then review what lands.                  |
| [`discern-prove-it-works`](../../../templates/skills/discern-prove-it-works/SKILL.md)             | Earn the "done": exercise the real artifact and report an evidence dossier — verified, failed, unverifiable.         |
| [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md)     | Write or refresh a subtree of the map per the documenter brief.                                                      |
| [`discern-cure-a-bug`](../../../templates/skills/discern-cure-a-bug/SKILL.md)                     | Cure a whole class of defect — every instance, behind a permanent detector.                                          |
| [`discern-diagnose-a-bug`](../../../templates/skills/discern-diagnose-a-bug/SKILL.md)             | Prove a bug's cause — reproduce, falsify hypotheses — before any fix is written.                                     |
| [`discern-audit-the-suite`](../../../templates/skills/discern-audit-the-suite/SKILL.md)           | Find instance-pinned test clusters and under-scoped guards; close each with a guard off the source of truth.         |
| [`discern-prune-the-overgrowth`](../../../templates/skills/discern-prune-the-overgrowth/SKILL.md) | Sweep out agent-session overgrowth — proven-safe cuts, behavior-preserving commits, a standard capping the entropy.  |
| [`discern-outlaw-a-pattern`](../../../templates/skills/discern-outlaw-a-pattern/SKILL.md)         | Make a legacy pattern illegal: detector, falling standard, permanent gate rule at zero.                              |
| [`discern-standard-a-metric`](../../../templates/skills/discern-standard-a-metric/SKILL.md)       | Put a defendable quality metric behind a monotonic standard, limit set at today's value.                             |
| [`discern-survey-the-fleet`](../../../templates/skills/discern-survey-the-fleet/SKILL.md)         | Read-only reconnaissance across every worktree: intent, state, collisions, next steps.                               |
| [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md)       | Route a session's lesson into guidance, a skill, a project script, a doc, or an ADR — so future sessions inherit it. |
| [`discern-write-adr`](../../../templates/skills/discern-write-adr/SKILL.md)                       | Record a significant decision as an Architecture Decision Record.                                                    |

Fresh-install seeding belongs to the `discern setup` command rather than a skill; see [ADR 0024](../_adr/_superseded/0024-setup-command-not-skill.md), amended by [ADR 0036](../_adr/0036-unify-setup.md).

## The map & the ledger

`discern setup begin` lays the map's skeleton at `[map].dir` (default `map/`, including the ADR pack) and the deferred-work ledger at `[project].todo` (default `discern/TODO.md`). The setup brief's authoring pass fills them, and the map has its skeleton from the start ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md)). The documenter brief and scope-manifest template land lazily on the [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md) skill's first use. The skeleton sources ship with their producer: [`templates/setup/skeleton/`](../../../templates/setup/skeleton/) for setup and a `skeleton/` directory inside each carrying skill. They are copied to the **configured** destinations with path tokens rendered ([ADR 0080](../_adr/0080-configured-agent-map-root.md), [ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)).

## Bookkeeping & integration

| Path                                                                     | Bucket           | What it is                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern/TODO.md` (`[project].todo`)                                     | yours            | The deferred-work ledger — the running TODO list agents read and maintain in discern's workflow (not the team's backlog); documents its own format.                                                                                                                                                                                                                                                                             |
| `discern/scripts` (`[scripts].dir`)                                      | yours            | Your executable project scripts (read only if present), listed with `discern script` and run with `discern script <name>`. Built-in names are legal inside the namespace ([ADR 0137](../_adr/0137-project-scripts-live-under-the-script-command.md)). Scripts read config through `discern config get`; sourcing a shell library is unsupported.                                                                                |
| [`.claude/settings.json`](../../../templates/.claude/settings.json.tmpl) | co-managed merge | Adds a `Read(./.env)` deny and three hooks — `SessionStart` → `discern worktree ensure`, `WorktreeCreate` → `discern worktree create`, `WorktreeRemove` → `discern worktree remove` — preserving existing settings. Each other configured agent gets its own settings/hooks seed the same way, routed through the provider registry ([`../60-agent-integrations/`](../60-agent-integrations/)).                                 |
| [`.gitignore`](../../../templates/.gitignore.fragment)                   | co-managed       | The project owns its ignore rules outside `# --- discern ---` / `# --- /discern ---`. Inside that block, discern ignores only what it materializes or keeps machine-local — the skills dirs and `.claude/settings.local.json` (ADR 0128); the compiled agent files stay tracked. `upgrade` reconciles it to the current fragment (ADR 0093), while `status` warns and `done` blocks if a discern-owned ignored path is tracked. |

> In this repo, the same hooks call `discern worktree ensure`, `discern worktree create`, and `discern worktree remove`. The local-dev wrapper resolves the nearest checkout's source engine, while the distributed [`templates/.claude/settings.json.tmpl`](../../../templates/.claude/settings.json.tmpl) resolves the installed binary on `PATH`.

The linked worktree checkouts appear only at run time; `setup` does not create them. By default they live in a **sibling** directory (`<repo>.worktrees/`), outside the repo entirely, so nothing in the tree needs to ignore them. A project that points `[worktree].root` at a path _inside_ the repo (e.g. `.claude/worktrees`) keeps them out of git via the ignore block ([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).
