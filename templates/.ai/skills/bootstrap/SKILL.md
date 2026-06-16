---
name: bootstrap
description: Seed a freshly-installed Icculus harness from the project brief. Use right after `icculus init`, or when the user runs /bootstrap, or asks to "set up the docs", "fill in the principles/guidelines", "bootstrap the harness", or "propose the slot fills". The agent already in the loop does all the authoring — no API key, no provider lock-in.
---

# Bootstrap the harness

`icculus init` lays down a skeleton: blank docs, a guidelines stub, a `TODO.md`, and an `icculus.toml` whose tool slots are all no-ops. Your job is to fill that skeleton in **from the project's own context** — the brief the user wrote at install time, plus what the repository reveals about itself.

You — the coding agent already in this session — do the authoring. There is no API key and no external service: the whole point is that the agent in the loop seeds the project. Work through the steps below in order. Treat everything you write as a first draft for the user to refine, and **propose rather than silently overwrite** anything the user will want to confirm (especially the `icculus.toml` slot fills).

> Stay domain-agnostic in the docs and guidelines you write: principles, concepts, and conventions describe *this* project, not the harness and not any example. The stack-detection table in Step 5 is the one place where naming many ecosystems is correct — that step's whole job is to recognise them.

---

## Step 0 — Read the brief and look around

1. Read **`.icculus/brief.md`** — the free-text description the user gave at install. This is your primary source for what the project is, who it's for, and what shape it has.
2. Skim the repo: the top-level layout, the README if one exists, and the manifest/lockfiles (you'll inventory these properly in Step 5). Form a quick mental model before you write anything.

If the brief is thin or empty, ask the user two or three sharp questions before drafting — what the project does, its core building blocks, and any non-negotiable rules it lives by. Do not invent a domain.

---

## Step 1 — Draft the design principles

Open **`docs/00-orientation/design-principles.md`** and follow the template already in it (the commented shape plus the EXAMPLE principle).

- Write **3–7** principles — the smallest set that actually governs decisions here, not a wish list.
- Each gets an imperative one-line name, 1–3 sentences stating the rule, a **Why it matters** (the failure it prevents), and a **How it shows up** (where it's visible in the code — concrete and present-tense).
- Replace the EXAMPLE principle entirely; delete the guidance comments as you go.
- Fill the **"What these add up to"** section: a few sentences on how the principles reinforce each other.
- Keep the override mechanism line intact — overriding a principle means writing an ADR (`docs/_adr/`).

Good principles are specific to this project and falsifiable: you can point at a change that would violate one.

---

## Step 2 — Fill the project guidelines

Open **`.ai/guidelines/<slug>.md`** (the `<slug>` is your project's slug). Flesh out the stub:

- The one-line pitch at the top — what the project is and who it's for.
- The **Conventions** section — language idioms, style, structure, naming, error handling, anything the tooling enforces. Keep it aligned with the slots you'll propose in Step 5, so the written rule and the enforced rule agree.
- Leave the standing disciplines (docs, TODO, worktree, finish gate) as they are — they're the same on every project.

**Do not touch the generated copies** (`CLAUDE.md`, `AGENTS.md`, …). This source file is authoritative; those are compiled from it in Step 6.

---

## Step 3 — Seed the orientation docs

Fill the three orientation skeletons from the brief, removing the `<!-- /bootstrap fills this -->` markers as you complete each section:

- **`docs/00-orientation/concepts.md`** — the narrative tour: the core building blocks and how material flows through them, in plain language. Introduce the canonical nouns here.
- **`docs/00-orientation/glossary.md`** — define each canonical noun once, precisely. Core nouns first, then a section per area.
- **`docs/00-orientation/system-map.md`** — an **ASCII** diagram of the real components and the flow between them, plus the "where each piece runs" notes.

Use the same capitalised canonical nouns across all three (and everywhere else). Don't introduce synonyms.

---

## Step 4 — Propose the subsystem subtrees

Decide the numbered subsystem subtrees this project needs (`10-…`, `20-…`, … `80-development/` already exists). Then:

- Update the **Subsystems** table in **`docs/README.md`** with the proposed names and a one-liner each, removing the placeholder rows.
- Reflect the same names in the "what to read next" / "how the map relates" tables in the orientation docs.
- **Create the directories with a stub `README.md` each** (a title and a one-line "what this subtree covers"), so the tree is navigable — but don't write the leaves now. Filling a subtree's leaves is the [`document-subsystem`](/.ai/skills/document-subsystem/SKILL.md) skill's job, run per subsystem when you're ready.

Propose the subtree set to the user before committing to it — the numbering is a reading order, easy to change, but worth a sanity check.

---

## Step 5 — Sniff the stack and propose slot fills

This is the one step where naming concrete ecosystems is right: you're detecting which one this is.

Inventory the repo for stack signals, then propose concrete `[slots]` fills in **`icculus.toml`** — the standard format / lint / typecheck / test / build command for each detected stack. **Propose, don't overwrite:** show the user a diff, or write the suggested command as a comment next to the existing `run = ":"` line, and let them confirm. The defaults are no-ops precisely so a wrong guess never breaks the gate.

Detection lookup (signal file → ecosystem → the usual tools to suggest):

| Signal file(s) | Ecosystem | Typical slot fills (format · lint · typecheck · test · build) |
|---|---|---|
| `package.json` (+ `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`) | Node / JS / TS | `prettier --write .` · `eslint .` · `tsc --noEmit` (if `tsconfig.json`) · the package's `test` script · the package's `build` script |
| `pyproject.toml` / `requirements.txt` / `setup.py` | Python | `ruff format .` (or `black .`) · `ruff check .` · `mypy .` (or `pyright`) · `pytest` · _(usually none)_ |
| `go.mod` | Go | `gofmt -w .` · `go vet ./...` · _(vet covers it)_ · `go test ./...` · `go build ./...` |
| `Cargo.toml` | Rust | `cargo fmt` · `cargo clippy` · _(clippy covers it)_ · `cargo test` · `cargo build` |
| `composer.json` | PHP | a formatter (e.g. `php-cs-fixer fix`) · a linter · a static analyser (e.g. `phpstan analyse`) · the test script · _(usually none)_ |
| `Gemfile` | Ruby | `rubocop -A` · `rubocop` · _(none standard)_ · `rspec` (or `rake test`) · _(usually none)_ |
| `pom.xml` / `build.gradle(.kts)` | Java / Kotlin (JVM) | a formatter plugin · a linter plugin · _(compiler)_ · `mvn test` / `gradle test` · `mvn package` / `gradle build` |
| `*.csproj` / `*.sln` | .NET | `dotnet format` · analyzers · _(compiler)_ · `dotnet test` · `dotnet build` |

Notes that keep the proposal honest:

- **Verify before suggesting.** Read the manifest's actual scripts/dependencies — propose the command the project really has, not the textbook one. If a stack declares a custom test script, suggest that.
- **Map to the right `phase`.** Mutating tools (formatters, codemods) → `phase = "fix"`. Artifact producers (compile, bundle) → `phase = "build"`. Read-only analysis (linters, type-checkers) → `phase = "check"`. The test suite → `phase = "test"`.
- **Monorepo / polyglot:** several stacks can coexist. Chain tools in one slot with `&&`, or add a custom scope per sub-app and a side gate under `[scopes.side_gates]`.
- **Wire the obvious scopes and adapters too** while you're here: point `[scopes]` globs at where this project's code actually lives, and if the project has a database or a dev server, note the `[worktree.db]` / `[worktree.dev_server]` adapter seams for the user to fill — again as proposals, not silent edits.
- **Leave a slot a no-op** if the stack has no standard tool for it. A green gate you grow into beats a red gate on day one.

---

## Step 6 — Compile and verify

1. Run **`agent guidelines`** to compile `.ai/guidelines/` + `.ai/skills/` into the per-agent files (`CLAUDE.md`, `AGENTS.md`, …) and link the skills.
2. Run **`agent doctor`** to verify the install — dispatcher executable, hooks present, every configured slot command resolvable, git worktree support, required tools on PATH.
3. Fix anything `doctor` flags (it returns the exact remedy), then summarise for the user: the principles you drafted, the subtrees you proposed, and the slot fills awaiting their confirmation. Point them at the [`document-subsystem`](/.ai/skills/document-subsystem/SKILL.md) skill as the next step for filling in each subtree's leaves.

---

## Done when

- `design-principles.md` holds real, project-specific principles (no EXAMPLE block, no `<!-- /bootstrap fills this -->` markers left).
- `.ai/guidelines/<slug>.md` has a real pitch and Conventions section.
- The orientation docs (concepts, glossary, system-map) are seeded and the subsystem subtrees are named with stub READMEs.
- `icculus.toml` slot fills are **proposed** for every detected stack (committed only if the user confirms).
- `agent guidelines` and `agent doctor` have been run and `doctor` is green.
