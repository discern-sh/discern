# Bootstrap the harness

> You are reading this because **`discern bootstrap` printed it**. These are instructions for *you, the coding agent in this session*: work through them in order, then run `discern bootstrap done` to finish. (There is no skill file and no second program — discern just hands you the brief.)

`discern init` lays down only the harness machinery and a `discern.toml` whose capabilities are all unset — it deliberately scaffolds **no docs tree and no `TODO.md`** (those appear once there is real content to put in them). Your job is to **create and fill** the docs and guidance **from the project's own context** — the brief the user wrote at install time, plus what the repository reveals about itself. discern lays the doc skeletons for you when the project has none (see Step 0.5); you fill them.

You — the coding agent already in this session — do the authoring. There is no API key and no external service: the whole point is that the agent in the loop seeds the project. Work through the steps below in order. Treat everything you write as a first draft for the user to refine, and **propose rather than silently overwrite** anything the user will want to confirm (especially the `discern.toml` capability fills).

> Stay domain-agnostic in the docs and guidance you write: principles, concepts, and conventions describe *this* project, not the harness and not any example. The stack-detection table in Step 5 is the one place where naming many ecosystems is correct — that step's whole job is to recognise them.

---

## Step 0 — Read the brief and look around

1. Read **`brief.md`** (at the repo root) — the free-text description the user gave at install. Treat it as a statement of *intent and direction* (what the project is for, who it serves, what matters), **not** as the ceiling on how much you write. The depth of what you produce comes from the repository, not the length of the brief.
2. Read the repo itself — this is your primary source. The top-level layout, the README, the manifest/lockfiles, and the actual code (models, config, tests) are where the principles, concepts, and conventions you'll write are *evidenced*. You inventory the stack properly in Step 5, but start forming the real mental model here.

**A short brief is not a licence for a shallow result.** Whether the brief is a single declarative sentence or a deliberate "figure it out", the job is identical: mine the repository for what the system actually is and document *that* — don't paraphrase the brief and stop. A declarative one-liner is the real trap, because it tempts you to treat it as a sufficient summary; go deeper than it regardless.

Ask the user a couple of sharp questions **only when the repo itself is uninformative** (a near-empty or greenfield project) *and* the brief is also thin — what it will do, its core building blocks, its non-negotiable rules. When the code is there to read, read it rather than asking. Either way, never invent a domain — derive it from what you find.

---

## Step 0.5 — Check the doc skeletons

`discern bootstrap` has already laid the skeletons for you — **but only when the project had none**, so existing docs are never disturbed:

- if there was no `docs/` tree, it scaffolded one (the orientation docs plus the `80-development/` leaves) for you to fill;
- if `TODO.md` was absent, it created that too;
- if you **already had** a `docs/` tree (or a `TODO.md`), discern left it untouched — work with what is there, adapting these steps to your existing structure rather than imposing the skeleton shape below.

The command's output told you which of these happened. The scaffolded files already carry the project name; the remaining placeholders are the `<!-- bootstrap fills this -->` markers and the EXAMPLE principle, which you replace as you go.

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

## Step 2 — Fill the project guidance

Open **`guidance.md`** (at the repo root — the default `[guidance].sources`). This file holds **only this project's own conventions**: discern's built-in harness guidance (docs, TODO, worktree, finish gate) is bundled and auto-prepended at compile time, so you don't repeat the standing disciplines here. Flesh out the stub:

- The one-line pitch at the top — what the project is and who it's for.
- The **Conventions** section — language idioms, style, structure, naming, error handling, anything the tooling enforces. Keep it aligned with the capabilities you'll propose in Step 5, so the written rule and the enforced rule agree.

**Do not touch the generated copies** (`CLAUDE.md`, `AGENTS.md`, …). This source file is authoritative; those are compiled from the built-in guidance plus `guidance.md` in Step 6.

---

## Step 3 — Seed the orientation docs

Fill the three orientation skeletons from the brief, removing the `<!-- bootstrap fills this -->` markers as you complete each section:

- **`docs/00-orientation/concepts.md`** — the narrative tour: the core building blocks and how material flows through them, in plain language. Introduce the canonical nouns here.
- **`docs/00-orientation/glossary.md`** — define each canonical noun once, precisely. Core nouns first, then a section per area.
- **`docs/00-orientation/system-map.md`** — an **ASCII** diagram of the real components and the flow between them, plus the "where each piece runs" notes.

Use the same capitalised canonical nouns across all three (and everywhere else). Don't introduce synonyms.

Then clear the stale "starts as a skeleton" notes so the filled tree doesn't still announce itself as empty: the blockquote at the top of **`docs/00-orientation/README.md`** (it points readers at `discern bootstrap` and the `<!-- bootstrap fills this -->` markers) and the one-line skeleton blockquote atop each doc you just filled. Once a doc is real, a note telling the reader it is empty is worse than no note.

---

## Step 4 — Propose the subsystem subtrees

Decide the numbered subsystem subtrees this project needs (`10-…`, `20-…`, … `80-development/` already exists). Then:

- Update the **Subsystems** table in **`docs/README.md`** with the proposed names and a one-liner each, removing the placeholder rows. Also clear the "this tree starts as a skeleton — run `discern bootstrap`" blockquote above the table: once the subtrees are real, that note is stale.
- Reflect the same names in the "what to read next" / "how the map relates" tables in the orientation docs.
- **Create the directories with a stub `README.md` each** (a title and a one-line "what this subtree covers"), so the tree is navigable — but don't write the leaves now. Filling a subtree's leaves is the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill's job, run per subsystem when you're ready.

**Exception — fill the `80-development/` leaves now.** Those leaves (`getting-started.md`, `testing.md`, `code-conventions.md`) ship with `<!-- bootstrap fills this -->` markers and are *stack-level*, not subsystem-deep: everything they need — the setup steps, the test runner, the formatter and build — you already have from the brief and the Step 5 stack sniff. Fill them now, clearing their markers, and keep them aligned with the guidelines (Step 2) and the capabilities you propose (Step 5). Only the *numbered* subtree leaves are deferred to `document-subsystem`.

Propose the subtree set to the user before committing to it — the numbering is a reading order, easy to change, but worth a sanity check.

---

## Step 5 — Sniff the stack and fill the capabilities

This is the one step where naming concrete ecosystems is right: you're detecting which one this is.

Inventory the repo for stack signals, then fill the `[capabilities]` in **`discern.toml`** — the standard format / lint / typecheck / test / build command for each detected stack. A capability maps to its command by name; the engine derives the gate stage from the name, so you never write a stage for one. While you're here, also wire `[scopes]` (where the code lives) and any `[ratchets]` (metrics worth tracking), and reach for `[checks.<name>]` for gate work that isn't one of the five known capabilities. **Propose, don't overwrite:** show the user a diff, or write the suggested command as a comment beside the unset capability, and let them confirm. An omitted capability is "knowably absent", so a wrong guess never breaks the gate.

Detection lookup (signal file → ecosystem → the usual tools to suggest):

| Signal file(s) | Ecosystem | Typical capability fills (format · lint · typecheck · test · build) |
|---|---|---|
| `deno.json(c)` | Deno | `deno fmt` · `deno lint` · `deno check <entry>` · `deno test` · _(none)_ |
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
- **A known tool maps to a capability by name.** Formatter → `format`, linter → `lint`, type-checker → `typecheck`, the test suite → `test`, a build/bundle step → `build`. The engine reads the stage from the capability name — you don't set one. Anything outside those five (a coverage threshold, a schema validator, a license check) is a `[checks.<name>]` with an explicit `stage` (`fix` | `build` | `check` | `test`).
- **Monorepo / polyglot:** several stacks can coexist. Chain tools in one capability with `&&`, or add a `[scopes.<name>]` for a sub-app with its own `gate` so changes there run that sub-app's checks.
- **Wire the obvious scopes and worktree settings too** while you're here: point `[scopes]` globs at where this project's code actually lives, and if the project has a database or a dev server, note the `[worktree.db]` / `[worktree.dev_server]` worktree settings for the user to fill — again as proposals, not silent edits.
- **Point the gate at its gotchas doc.** Step 0.5 created `docs/80-development/finish-gate-gotchas.md`; set `[project].gotchas_doc = "docs/80-development/finish-gate-gotchas.md"` in `discern.toml` so a non-obvious gate failure points agents at it (`init` leaves `gotchas_doc` empty).
- **Leave a capability unset** if the stack has no standard tool for it. A green gate you grow into beats a red gate on day one.

---

## Step 6 — Compile, capture, and verify

1. Run **`discern refresh`** to compile the built-in harness guidance + `guidance.md` into the per-provider agent files (`AGENTS.md` tracked, `CLAUDE.md` / `GEMINI.md` gitignored) and materialize the skills into `.claude/skills/`.
2. Run **`discern doctor`** to verify the install — dispatcher executable, hooks present, every configured capability command resolvable, git worktree support, required tools on PATH.
3. **Record the deferred wiring in `TODO.md`.** Everything you *proposed but did not activate* is outstanding work — and a comment in `discern.toml` or a line in your chat reply is not where the next agent (or the maintainer) will look. `TODO.md` is the shared backlog. Add a terse item (a bold title + one line, in the bucket that fits) for each open decision: the capabilities still awaiting confirmation, the `[worktree]` db / dev-server / `inherit_env` / setup settings left empty, any tool worth adding (a static analyser, a JS linter), and any test database or service the suite needs to run. This is what stops the bootstrap proposals from being silently lost when the session ends.
4. Fix anything `doctor` flags (it returns the exact remedy), then summarise for the user: the principles you drafted, the subtrees you proposed, the capability fills awaiting their confirmation, and the `TODO.md` items you recorded. Point them at the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill as the next step for filling in each subtree's leaves.
5. **Run `discern bootstrap done`** to lock it in. It validates the result — no `<!-- bootstrap fills this -->` markers and no EXAMPLE principle left behind — then records `[meta].bootstrapped` in `discern.toml`, which retires the one-time setup reminder and hides `discern bootstrap` from the command list. If it reports leftover markers, finish those and re-run it (or pass `--force` if a flagged file is a deliberate exception).

---

## Done when

- `design-principles.md` holds real, project-specific principles (no EXAMPLE block, no `<!-- bootstrap fills this -->` markers left).
- `guidance.md` has a real pitch and Conventions section.
- The orientation docs (concepts, glossary, system-map) are seeded, the `80-development/` leaves are filled, and the numbered subsystem subtrees are named with stub READMEs.
- No stale "starts as a skeleton / run `discern bootstrap`" notes remain — the `docs/README.md` and `docs/00-orientation/README.md` intros describe the filled tree, not an empty one.
- `discern.toml` capability fills are **proposed** for every detected stack (committed only if the user confirms).
- `TODO.md` records the deferred wiring (unactivated capabilities, empty worktree settings, tools or test databases to add) so no open decision lives only in a comment or the chat.
- `discern refresh` and `discern doctor` have been run and `doctor` is green.
- `discern bootstrap done` has been run and reports success (it records `[meta].bootstrapped`).
