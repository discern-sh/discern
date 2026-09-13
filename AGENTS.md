# Working in discern

discern's built-in instructions appear first. discern's own instructions follow the divider and take precedence where they conflict.

## Operating discern

discern gives each development task an isolated workspace, runs the project's configured checks, records completion evidence, and controls how changes land on the shared branch. Its configuration lives in **`discern.toml`**. Use its **MCP tools** as the primary interface.

- **Orient first.** Call **`discern_status`** at the start of every session, including investigation-only and resumed sessions. It reports current state and the next action without running checks or changing the project.
- **Use the effort's worktree before editing.** An effort is one task carried through implementation and review. Continue in its existing worktree across feedback and resumed sessions. For a new effort requiring edits, call **`discern_start`** from the main checkout and move your file operations to the returned path. Read-only investigation does not require creating a worktree.
- **Finish through `discern_done`.** It verifies the configured gate: the checks required to call the change complete. Use **`discern_prepare`** or a diagnostic's reproduce command while iterating. A long call announces a `discern progress` handle; after a lost call, read the run back with it instead of rerunning. Follow the finishing sequence below before reporting completion.
- **Follow the reported next action.** Use the result's diagnostics and recovery instructions instead of bypassing them with raw Git or shell operations. If the remedy cannot be followed, use **`discern_docs`** for the relevant procedure or report the unresolved condition to the owner.
- **Find the right reference.** **`discern_docs`** explains discern; **`discern_map`** reads the current project's documentation; **`discern_doctor`** diagnoses installation problems.

**When MCP is unavailable:** tell the owner and use the **`discern` CLI**, with `--markdown` for readable results or `--json` for structured fields. Read the reported state, diagnostics, recovery instructions, and any owner relay or Proof. If output is truncated, retrieve its structured or stored view; never repeat an effectful command just to recover omitted output. If the CLI is also unavailable, stop and let the owner choose between installing discern (`curl discern.sh` explains how) and continuing without its protections.

## Communicating with the owner

Explain discern's findings through their consequences for the requested work: what happened, what remains unverified, and what you will do next. Match the owner's technical familiarity; explain unfamiliar terms when needed. Distinguish observed facts from suspected causes. Continue authorized investigation and repair before asking the owner to resolve routine implementation choices. When a decision is needed, present the supported tradeoff, your recommendation, and what approval would authorize. Keep completion claims within the available evidence.

## Generated files — don't hand-edit

discern compiles the project's instruction sources (`project/instructions.md`) into the agent files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) and materializes skills into their directories (`.claude/skills`, `.agents/skills`). To change what you read, edit the source and run **`discern refresh`** — edits to a generated file are overwritten on the next compile.

## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.

Keep one worktree for the whole effort, through review feedback and resumed sessions.

- **Resume the assigned worktree.** If this effort already has a worktree, continue at its recorded path and pass `path` to discern tools that accept it. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again.
- **Never adopt another effort's worktree**, even when it is idle or clean. Fleet rows in `discern_status` do not say which effort is yours.
- **Move your own file operations.** `discern_start` creates a worktree from `main` with branch prefix `agent/` and re-aims discern's tools. Your shell and editor must also use the returned path. If you can't change your working root, prefix shell commands with `cd <path> &&` and target file operations explicitly.
- **Update through `discern_update`.** Call it when behind `main`; it checks its own preconditions, so no Git pre-check or hand-merge is needed. Re-read affected files named in its overlap report before continuing.
- **Wait through `discern_await`.** Use one longest-safe call when work depends on a sibling effort or the trunk, and follow its continuation or recovery instructions.
- **Use the test queue.** Limit: 2 concurrent test runs across checkouts (`[gate].concurrent_test_runs`). Run direct tests through `discern queue -- <command>`.

### Finishing an effort

1. Run **`discern_prepare`**, review its changes, and commit the intended work belonging to this effort. `prepare` may rewrite files; staging and committing remain your responsibility. Commit each logical change separately.
2. Run **`discern_done`** on the clean, committed final tree; it refuses uncommitted work, includes the complete test stage, and reuses passing evidence whose inputs are unchanged, so a final gate needs no standalone test preflight; `discern_test` runs the complete test stage on demand when that stage is itself the requested task. Before any expensive repeat, name what changed or what new evidence the run will obtain. Diagnose a timeout at the layer whose named budget fired; never raise a limit to pass.
3. Read the completion evidence and landing-authority result. **Proof** records what the configured gate established for the exact validated commit. Later edits require renewed verification.
4. Report what changed, what was verified, and anything still unresolved. End with the returned Proof line verbatim.

`discern_done` proves the committed tip of this worktree and records Proof for that exact commit. It lands nothing, and the worktree stays yours afterwards.

**`discern_accept` submits and lands.** It records the submission — the exact proven commit — and lands it on `main`. A passing gate is evidence; landing requires explicit owner consent or machine-verified authority (`--confirmed` attests the conversation; recorded grants are checked automatically), and a task brief or handoff is never consent. Follow `done`'s authority-aware next action: report and wait when consent is needed, or proceed under the verified authority. Without authority it refuses read-only and the submission waits; relay the Proof line and stop. Landing removes the worktree, resources, and branch once nothing beyond the landed submission remains. If `main` moved after your Proof, `accept` proves the combination in a disposable integration worktree and lands that exact result, waiting behind another landing. A conflict or failed combined check names the cause, lands nothing: run `discern_update`, resolve, commit, `discern_done`, `discern_accept` again. Never adopt an `integration/` worktree — discern's disposable copy.

## Quality standards

Standards protect measured limits: minimums may rise and maximums may fall. **`discern_done`** checks the required standards; **`discern_standards`** measures them separately.

**Never loosen or delete a limit to make a change pass.** Investigate the measured regression and try reasonable remedies within the authorized task. If satisfying the requested outcome requires changing a limit, explain the evidence, alternatives, and recommendation to the owner.

After owner agreement, use **`discern_standards_propose`** and follow its procedure for measuring and recording the proposed limit. A general permission to land does not approve a standard-limit change.

When a measure improves, offer to preserve the gain by tightening its limit through **`discern_standards`** with `pin`.

## Checkpoints

A checkpoint asks you to judge a specific question about the change. `discern_status` and `discern_prepare` identify relevant checkpoints; `discern_done` supplies any question that needs a recorded answer.

Judge the question against the actual change and record your conclusion using the supplied instructions. If it does not hold, explain the tradeoff for the owner without including secrets. The gate can still run, but landing requires the owner to approve an exception for the exact unmet questions. Recorded landing grants do not authorize that exception.

## Skills

discern makes **skills** — focused, reusable task playbooks — discoverable to **you**; reach for one when a task matches. **`discern skills list`** shows the set.

When a session yields a durable lesson — a correction, a hard-won procedure, an unrecorded decision — **offer to capture it** with the `discern-teach-the-project` skill at a natural pause, so future sessions inherit it.

## The Map & decisions

`project/map/` is the agent-maintained **map**, browsable with **`discern_map`**. Agents use the map to learn and navigate the project; humans use the map to audit agent understanding. Update the map when the reader's mental model, a durable boundary, a supported workflow, or a product behavior changes.

Staleness is a defect, so keep the map current — a page is current when nothing in it is false. A map page must **reduce** the total amount of repository reading required to make a correct decision, so it should never restate what code, tests, or config already express — link the authority instead. Do not use the map to maintain independently mechanically derivable facts.

The map records what the code cannot say (boundaries, invariants, intent, where to start). The map should read in the present, not as change history. Significant, hard-to-reverse decisions belong as ADRs instead — save **Architecture Decision Records** under `project/map/_adr/`.

- `00-orientation` — Orientation
- `10-getting-started` — Getting started
- `20-quality-gate` — The quality gate
- `30-worktrees` — Worktrees
- `40-agent-instructions` — Agent instructions
- `45-skills` — Skills
- `50-engine-internals` — Engine internals
- `60-agent-integrations` — Agent integrations
- `70-reference` — Reference
- `80-development` — Working on this project
- `90-site` — The public site — discern.sh

Stuck or missing context? Call `discern_map` with `search` in task language, then retrieve the best result using its returned `target`.

---

# Working in the discern repo

discern is a portable, stack-neutral **agentic-development system**: one command scaffolds a quality gate, an isolated git-worktree workflow, an author-once→compile-everywhere agent-instruction pipeline, and a map/ADR discipline into any project.

**This repo is both the tool and a user of it — it runs on its own gate.**

All the instructions you've already seen (the ones _above_ "Working in the discern repo") are _the same instructions_ discern bundles and ships to other coding agents, working in _their_ user's projects, to help them navigate their own way around discern. All the instructions from _here onwards_ are for **you**: an agent working on discern _itself_.

## What's in the repo

discern is **one self-contained Deno binary** — the installer verbs and the engine are the same program, with no second copy committed alongside it to keep in sync.

- **`src/`** — the whole binary. Installer verbs (`setup`, `doctor`, `upgrade`, `config`) **and** the TypeScript engine: `src/engine/**` (the gate, the parallel/serial job runner, scope classification, standards, the worktree lifecycle + identity, the instruction compiler, the dispatcher), sharing `src/shared/**` (config reader, known-job constants, feature toggles, POSIX `cksum`, root discovery). Compiled to a single binary via `deno task build`.
- **`templates/`** — the **distribution surface** the binary lays down or materializes into a project: the config template (`discern.toml.tmpl`), the settings template, the gitignore fragment, the **bundled built-in instructions** (`templates/instructions/*.md`), and the **bundled skills** (`templates/skills/**`).

## The footprint: one root `discern.toml`

A project's entire discern footprint is a single root file, **`discern.toml`**. Everything else is bundled in the binary, a **config-pointed** location the user chooses (with discoverable defaults under `discern/` — `instructions.md`, `skills/`, `scripts/`), or a generated **output** (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md` are compiled, committed outputs; vendor-specific files and paths are materialized). Every subsystem is core (ADR 0101) — `[jobs]` is the gate's command table, and the one per-skill knob is `[skills].exclude`.

This repository points every ongoing authored source at `project/` to dogfood the independent path overrides: `project/instructions.md`, `project/map/`, `project/scripts/`, `project/skills/`, and `project/TODO.md`. Those are this checkout's live sources; the shipped defaults above remain the contract for fresh installations.

## ⚠️ Edit in place — there is no managed copy to sync

The rules:

- **The engine and installer are TypeScript under `src/**` — edit them in place.** There is no second copy, no hash tracking, no drift to detect. The gate (`discern done`) type-checks and tests them.
- **`templates/**` is the distribution surface** — edit the seed/skill/instructions _source_ here (keep it generic; see below). To reflect a bundled-skill or built-in-instructions edit in this repo's own skills and instructions, run `discern refresh` (or `upgrade`).
- **`CLAUDE.md` / `AGENTS.md` are generated** from discern's built-in instructions (`templates/instructions/*`) plus this repo's `project/instructions.md` — never hand-edit them. Edit `project/instructions.md` and recompile.
- **`.claude/skills/` is a materialized artifact (gitignored)** — the binary republishes it from `templates/skills/**`. Don't hand-edit; edit the source under `templates/skills/`.

**The project instruction source is yours.** Customise it by editing `project/instructions.md` (this file) — never `templates/`, which only holds the generic built-in instructions _other_ projects receive. Then run `discern refresh` to recompile the agent files (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/etc.) — committed generated files you never hand-edit (ADR 0128); `discern done` fails if one drifts from its source, so commit the refreshed copies with the source change. Keep the prose provider-agnostic: one source compiles to every agent. Nothing overwrites `project/instructions.md`.

| To change…                                      | Edit…                                                                                            | Then run                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| the gate / the engine / the dispatcher / a verb | `src/engine/**`, `src/main.ts` (in place)                                                        | `discern done`                     |
| an installer command                            | `src/commands/**` (in place)                                                                     | `discern done`                     |
| a bundled skill                                 | `templates/skills/…`                                                                             | `discern refresh` (re-materialize) |
| the built-in discern instructions               | `templates/instructions/*.md`                                                                    | `discern refresh`                  |
| the config template's prose or layout           | `src/shared/config_prose.ts`, the schema's `describe()`, `src/shared/config_template_codegen.ts` | `deno task codegen`                |
| a seed file users receive                       | `templates/…`                                                                                    | —                                  |
| this instructions (yours)                       | `project/instructions.md`                                                                        | `discern refresh`                  |
| an authored project skill                       | `project/skills/…`                                                                               | `discern refresh`                  |
| project config (yours)                          | `discern.toml`, `deno.json`                                                                      | —                                  |

## Keep the shipped surface generic

`templates/` (the seed files, the bundled skills, **and** the built-in instructions) is the **distribution surface**: every project receives it verbatim, in every language and domain. Its content — and any user-facing engine output (help text, messages) — must therefore stay domain-neutral: examples, placeholders, and prose use generic stand-ins ("the project", "a tool that does X"), never the vocabulary of one domain. The trap is subtle: you're usually reasoning about a _specific_ repo at the same time (the one discern is installed into, or one you're testing against), and its domain bleeds into a generic skill or doc. Before editing under `templates/`, check that every example reads correctly for any project in any field — if a word only fits one domain, it doesn't belong there. And don't "fix" a leak by banning domain words in the gate: a denylist just relocates the same vocabulary into tracked test history — this rule, applied while editing, is the safeguard.

One vocabulary **is** gated, because it's structural rather than open-ended: **internal ADR citations never ship**. An "(ADR 0034)" in an error message, upgrade note, or template is repo-internal shorthand no other project's users or agents can follow. Cite ADRs in code comments, `project/map/`, and commit messages; keep shipped strings self-contained (`tests/adr_vocab_guard_test.ts` enforces this — string literals under `src/`, all text under `templates/`). The concept word "ADR" stays legal everywhere: discern ships an ADR discipline.

## The gate

- `discern prepare` — fast inner loop: fix + regenerate + refresh + check, no tests. Run it after your last edit, before the final commit, so `done` has nothing left to rewrite.
- `discern done` — full gate (run from the repo root): `deno fmt` (fix) → `deno lint` + `deno check` (check) ∥ `deno task coverage` (instrumented tests), with every required measurement including the local binary-size recipe. This is the repo running its **own** TS engine, so a regression in the engine surfaces here.

## Running discern from source

Use **`discern <cmd> --markdown`** for a result you will read directly, or **`discern <cmd> --json`** when you need to inspect structured fields. Here, `discern` points to a local-dev wrapper, not a binary, and runs the nearest discern engine it finds. From a worktree it therefore runs _that worktree's_ in-progress engine. It is the closest thing to what an end user runs, so the generic `discern` instructions above applies verbatim. (One exception: `discern mcp` always runs from the **main** checkout only.)

`deno task dev <cmd> --json` is a fallback — reach for it only if you specifically need to. (If you do: don't put `--` before the subcommand — `deno task dev -- upgrade` makes the CLI parser print help, a `deno task` quirk the wrapper doesn't share.)

**Never** use the `dist/` binaries while developing — they bundle a frozen snapshot of `templates/` and the engine compiled at build time.

The MCP `discern_*` tools are a separately-spawned, long-lived server running the **main** checkout's engine, not your worktree's — so for branch-only changes (a bundled skill, instructions, or engine edit not yet on `main`) they can report stale results against main, not your branch. Trust the engine run from source — `discern done` — over the MCP `discern_*` tools whenever they disagree.

Every result command supports discern's own **`--markdown`** and **`--json`** flags. Pass one so human terminal decoration stays out of agent context. Both reach the underlying `discern <cmd>` exactly as an end user would, so discern's full range is open to you too.

## Testing

`deno task test` is the authority on correctness, engine included: the `tests/engine_*` suite scaffolds the seed surface into temp dirs and drives the TS engine via `deno task dev <verb>` (with a `discern` PATH shim so Project Scripts and hooks resolve the binary like a real install). It is the behavioral parity oracle for the engine. If a bad engine change ever breaks `discern done` itself, run `deno task test` directly. Add engine coverage to `tests/engine_*_test.ts`; installer coverage to the other `tests/*_test.ts`. Iterate on one suite with `deno task test tests/<name>_test.ts` (or `--filter <name>`) instead of running the whole suite each loop.

## Conventions & gotchas

- **Strict TS, strict lint.** `deno.json` turns on the strict compiler set (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`/`Parameters`, …) and a strict lint set: explicit return and module-boundary types, no non-null assertions (`!`), no `process`/node globals (import from `node:process`), no thrown literals, `eqeqeq`. Match the surrounding code and write to these the first time. Fix lint findings instead of adding `deno-lint-ignore` or `deno-lint-ignore-file`; `[standards.lint_suppressions]` prevents the existing count from rising while it moves to zero.
- **Several artifacts are generated.** `deno task codegen` rewrites generated map references and sections, schemas, result types, and third-party artifacts from their registries. It runs in discern's `[jobs.build]` step. The `discern.toml` template is one of its outputs, rendered from the config schema's `describe()` prose plus the config prose registry (`src/shared/config_prose.ts`, ADR 0363): edit those sources, never the template.
- **Keep `project/map/` current with the change.** The `project/map/` tree is the source of truth and must not drift from code — update the affected docs in the same commit. The configured map, instructions, skills, and ledger form neutral scopes — only the `map` scope (map + ledger) is pre-authorized to land; instructions and skills always get owner review. The map alone is held to the Vale `prose` check and the `[standards.prose]` density ceiling. The gate also validates the map's substance: fenced `discern …` examples against the live verb/flag registry, intra-map links and heading anchors against the shared renderer, and the published tiers against the `_internal`/`_private` audience boundary — so quote real commands and real paths, and expect a rename to fail the docs until they follow.
- **A new check documents itself at the point of failure.** Invest in its diagnostic (location, rule, escape hatch) plus on-demand reference — feature registry, verb `--help`, its map page, an ADR. Don't pre-explain it in this instructions, the gotchas page, or template comments: always-loaded prose charges every session for an event most sessions never hit. The gotchas page is for failures whose own output can't explain them.
- Keep commits **atomic**: one logical change per commit, step by step.
- **Commit messages** must start with a **subject** - one imperative line summarizing the change (e.g. "Add retry to upload path"), no trailing period; then follow with a **body** (when the change is non-trivial) explaining _why_ the change was made and any consequences or trade-offs, not a restatement of the diff. Wrap at ~72 cols. Use bullets for multiple distinct points.

## Adding or changing a verb

- **Plan/apply.** Every effectful verb computes a pure, read-only plan, then a thin executor applies it (ADR 0027) — that split is what gives `--dry-run` (render the plan, change nothing) and agent result projections for free.
- **One result envelope.** A verb returns a single `DiscernResult` ([`src/shared/result.ts`](src/shared/result.ts)); compact JSON, authored Markdown, MCP, and human output project from it (ADR 0028). Don't `console.log` ad-hoc output from a verb.
- **MCP is a first-class surface.** Each tool in [`src/engine/mcp/server.ts`](src/engine/mcp/server.ts) is backed by a `*Result(root, …)` core the CLI shares; the verb-parity guard (`tests/engine_verb_parity_test.ts`) ties the `TOOLS` table back to the CLI verb list. Exposing a read/run verb means extracting that core first (ADR 0045/0041).

## Fix the class, not the instance

A bug is rarely alone. Before fixing one, name the _class_ of defect as a checkable predicate, then write a check that fails on **every** member — a parameterized test, a lint or structural-search rule, an architectural test that iterates the canonical set — and leave it in the gate as a permanent guard so the class can't silently return. Drive the check off the single source of truth (a registry, enum, or type), never a hand-copied list, so a new member auto-enrols. The **`discern-cure-a-bug`** skill walks the full procedure. This is already wired for discern's closed sets — CLI verbs, known jobs, agent providers, MCP tools, the config schema — by forcing-function guards (`engine_verb_parity_test.ts`, `agent_parity_test.ts`, `engine_mcp_surface_test.ts`, `config_codegen_test.ts`): add a member to its single source and the satellites must match or the gate fails (ADR 0051). Maintain this practice with new development going forward. Every structural guard obtains its scan set through a call-site declaration in `tests/structural_guard_scope.ts`. A repo-wide TypeScript rule declares `authored-ts`; a rule spanning every source extension Deno lints declares `authored-deno`. Never hand-root a guard at `src/` or import the underlying canonical file arrays directly: authored code also lives in `scripts/`, `tests/`, `site/`, and `types/`, and the Git-derived universe widens when a new tree appears. Scope a guard narrower than its universe only with a one-line reason stating the invariant's semantic boundary.

## Decisions

Architecture decisions live in `project/map/_adr/` (0001+, several dozen and counting) — browse them with `discern docs --adr --json`. Add one for any notable or hard-to-reverse change. ADRs move fast, so skim the most recent few before a significant change — a current ADR usually explains why something is the way it is.
