# Set up the harness

> You are reading this because **`discern setup` printed it**. These are instructions for *you, the coding agent in this session* — **work to do now, not a summary to hand back**. Work through them top to bottom, then run `discern setup done` to finish. **Do not report these steps as done until you have actually done them and `discern setup done` passes** — paraphrasing this brief's checklist back to the user as completed work is the one failure this setup must avoid. (There is no skill file and no second program — discern just hands you this brief over stdout.)

`discern setup` has just laid down the harness machinery — a `discern.toml` whose capabilities are all unset, the compiled agent files, the merged settings, the MCP wiring — plus empty doc skeletons (only where the project had none). **Nothing about *this project* is filled in yet, and that is your job:** author the docs, the guidance, and the design principles from the project's own context, and propose the `[capabilities]` that turn the gate from a no-op into a real definition-of-done. There is no API key and no external service — the whole point is that the agent already in the loop sets the project up.

## Operating principles — read these first

- **Use the most capable model available** (Step 0). This is a one-time setup whose output every future session inherits — it is worth your best model.
- **Ask, don't guess.** There is no brief file. Derive intent from the repository, and ask the user for what the code can't tell you — **once, early, in a single batch**, not peppered across every step.
- **Propose, don't overwrite.** Treat everything you write as a first draft for the user to refine. For anything they'll want to confirm — above all the `discern.toml` capability fills — show it and let them confirm rather than silently committing.
- **Stay this-project-specific.** Principles, concepts, and conventions describe *this* project, not the harness and not any example. The stack-detection table in Step 7 is the one place where naming many ecosystems is correct — that step's whole job is to recognise them.
- **It is safe to re-run.** `discern` (and `discern setup`) is idempotent and non-destructive: it never overwrites your work or an existing `docs/` tree. If this session is interrupted, the user just runs `discern` again and you pick up where you left off.

---

## Step 0 — Make sure you're the right tool for this job

This setup is a one-time event, and it determines how well the project is harnessed for *every* future agent session. The principles, docs, and capability fills you produce here are the foundation everything else is judged against — so do it with the strongest model you can.

1. **Confirm you are running the user's most capable model.** If you are on a fast, small, or cheap model, **stop and tell the user** to switch you to their most capable frontier model — the top-tier Claude, GPT, or Gemini model they have access to — *before* you continue, then resume from here. Don't quietly press on: a weaker model produces weaker principles and shakier capability guesses, and every later session inherits them. Say so plainly and let the user decide.
2. **Confirm the harness is healthy.** Run **`discern status`** to orient (it also smoke-tests that the `discern` binary is on your PATH — you will lean on it constantly), and **`discern doctor`** if anything looks off. Fix what `doctor` flags before authoring; it returns the exact remedy.

---

## Step 1 — Learn the project, then ask

1. **Read the repository — it is your primary source.** The top-level layout, the README, the manifests/lockfiles, and the actual code (models, config, tests) are where the principles, concepts, and conventions you'll write are *evidenced*. Start forming the real mental model now; you inventory the stack properly in Step 7.
2. **Ask the user a short, sharp batch of questions** — only what the code can't tell you: what the project is *for* and who it serves, its non-negotiable rules, anything in flight or deliberately unusual. Keep it to a handful of high-signal questions asked together, then proceed. (If a `brief.md` exists at the root — a user or CI may have supplied one via `--brief`/`--config` — read it first and let it narrow what you ask.)

**A thin answer is not a licence for a shallow result.** Whether the user gives you a single sentence or a deliberate "figure it out", the job is identical: mine the repository for what the system actually *is* and document *that* — don't paraphrase the answer and stop. The depth comes from the repo, not the length of the answer. Never invent a domain — derive it from what you find.

---

## Step 2 — Check the doc skeletons

`discern setup` has already laid the skeletons for you — **but only when the project had none**, so existing docs are never disturbed:

- if there was no `docs/` tree, it scaffolded one (the orientation docs plus the `80-development/` leaves) for you to fill;
- if `TODO.md` was absent, it created that too;
- if you **already had** a `docs/` tree (or a `TODO.md`), discern left it untouched — work with what is there, adapting these steps to your existing structure rather than imposing the skeleton shape below.

The command's output told you which of these happened. The scaffolded files already carry the project name; the remaining placeholders are the `<!-- setup fills this -->` markers and the EXAMPLE principle, which you replace as you go.

---

## Step 3 — Draft the design principles

Open **`docs/00-orientation/design-principles.md`** and follow the template already in it (the commented shape plus the EXAMPLE principle).

- Write **3–7** principles — the smallest set that actually governs decisions here, not a wish list.
- Each gets an imperative one-line name, 1–3 sentences stating the rule, a **Why it matters** (the failure it prevents), and a **How it shows up** (where it's visible in the code — concrete and present-tense).
- Replace the EXAMPLE principle entirely; delete the guidance comments as you go.
- Fill the **"What these add up to"** section: a few sentences on how the principles reinforce each other.
- Keep the override mechanism line intact — overriding a principle means writing an ADR (`docs/_adr/`).

Good principles are specific to this project and falsifiable: you can point at a change that would violate one.

---

## Step 4 — Fill the project guidance

Open **`guidance.md`** (at the repo root — the default `[guidance].sources`). This file holds **only this project's own conventions**: discern's built-in harness guidance (docs, TODO, worktree, finish gate) is bundled and auto-prepended at compile time, so you don't repeat the standing disciplines here. Flesh out the stub:

- The one-line pitch at the top — what the project is and who it's for.
- The **Conventions** section — language idioms, style, structure, naming, error handling, anything the tooling enforces. Keep it aligned with the capabilities you'll propose in Step 7, so the written rule and the enforced rule agree.

**Do not touch the generated copies** (`CLAUDE.md`, `AGENTS.md`, …). This source file is authoritative; those are compiled from the built-in guidance plus `guidance.md` in Step 8.

---

## Step 5 — Seed the orientation docs

Fill the three orientation skeletons from what you learned in Step 1, removing the `<!-- setup fills this -->` markers as you complete each section:

- **`docs/00-orientation/concepts.md`** — the narrative tour: the core building blocks and how material flows through them, in plain language. Introduce the canonical nouns here.
- **`docs/00-orientation/glossary.md`** — define each canonical noun once, precisely. Core nouns first, then a section per area.
- **`docs/00-orientation/system-map.md`** — an **ASCII** diagram of the real components and the flow between them, plus the "where each piece runs" notes.

Use the same capitalised canonical nouns across all three (and everywhere else). Don't introduce synonyms.

Then clear the stale "starts as a skeleton" notes so the filled tree doesn't still announce itself as empty: the blockquote at the top of **`docs/00-orientation/README.md`** and the one-line skeleton blockquote atop each doc you just filled. Once a doc is real, a note telling the reader it is empty is worse than no note.

---

## Step 6 — Propose the subsystem subtrees

Decide the numbered subsystem subtrees this project needs (`10-…`, `20-…`, … `80-development/` already exists). Then:

- Update the **Subsystems** table in **`docs/README.md`** with the proposed names and a one-liner each, removing the placeholder rows. Also clear the "this tree starts as a skeleton" blockquote above the table: once the subtrees are real, that note is stale.
- Reflect the same names in the "what to read next" / "how the map relates" tables in the orientation docs.
- **Create the directories with a stub `README.md` each** (a title and a one-line "what this subtree covers"), so the tree is navigable — but don't write the leaves now. Filling a subtree's leaves is the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill's job, run per subsystem when you're ready.

**Exception — fill the `80-development/` leaves now.** Those leaves (`getting-started.md`, `testing.md`, `code-conventions.md`) ship with `<!-- setup fills this -->` markers and are *stack-level*, not subsystem-deep: everything they need — the setup steps, the test runner, the formatter and build — you already have from Step 1 and the Step 7 stack sniff. Fill them now, clearing their markers, and keep them aligned with the guidance (Step 4) and the capabilities you propose (Step 7). Only the *numbered* subtree leaves are deferred to `document-subsystem`.

Propose the subtree set to the user before committing to it — the numbering is a reading order, easy to change, but worth a sanity check.

---

## Step 7 — Sniff the stack and propose the capabilities

This is the one step where naming concrete ecosystems is right: you're detecting which one this is.

Inventory the repo for stack signals, then propose the `[capabilities]` in **`discern.toml`** — the standard format / lint / typecheck / test / build command for each detected stack. A capability maps to its command by name; the engine derives the gate stage from the name, so you never write a stage for one.

**Use `discern config` to make the edits — it is comment-preserving and validated:**

```sh
discern config set-capability test "<the project's test command>"
discern config set-capability lint "<the project's linter>"
discern config set-check licenses --stage check --run "./scripts/check-licenses.sh"
discern config set-scope native 'native/**' --gate "make -C native check"
discern config set-ratchet coverage --direction up --limit 80 --run "<coverage tool>"
```

Prefer these over hand-editing TOML. **Propose, don't overwrite:** show the user the commands (or the diff) and let them confirm before you activate a capability — an unconfirmed guess can wait as a comment beside the unset key. An omitted capability is "knowably absent", so a wrong guess never breaks the gate.

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
- **A known tool maps to a capability by name.** Formatter → `format`, linter → `lint`, type-checker → `typecheck`, the test suite → `test`, a build/bundle step → `build`. Anything outside those five (a coverage threshold, a schema validator, a license check) is a `[checks.<name>]` with an explicit `stage` (`fix` | `build` | `check` | `test`).
- **Monorepo / polyglot:** several stacks can coexist. Chain tools in one capability with `&&`, or add a `[scopes.<name>]` for a sub-app with its own `gate`.
- **Wire the obvious scopes and worktree resources too** while you're here: point `[scopes]` globs at where this project's code actually lives, and if the project needs a per-worktree external resource (a database, an emulator, a container), note a `[worktree.resources.<name>]` table with `create`/`destroy` for the user to fill — again as proposals, not silent edits.
- **Point the gate at its gotchas doc.** Step 2 created `docs/80-development/finish-gate-gotchas.md`; set `[project].gotchas_doc = "docs/80-development/finish-gate-gotchas.md"` so a non-obvious gate failure points agents at it.
- **Leave a capability unset** if the stack has no standard tool for it. A green gate you grow into beats a red gate on day one.

---

## Step 8 — Compile, record, and confirm it's green

1. Run **`discern refresh`** to compile the built-in harness guidance + `guidance.md` into the per-provider agent files (`AGENTS.md`, `CLAUDE.md`, … — all gitignored build artifacts except `AGENTS.md`) and materialize the skills into `.claude/skills/`.
2. Run **`discern doctor`** to verify the install — dispatcher executable, hooks present, every configured capability command resolvable on PATH, git worktree support. Fix anything it flags (it returns the exact remedy).
3. **Prove the gate is real.** Once the user has confirmed the capability fills and you've activated them, run **`discern finish`** and confirm it goes **green** — every wired command actually runs and passes. If a command fails, fix the command (or the wiring), or back that capability out to a comment; **don't leave a red gate or a wrong command behind**. A green `finish` with real capabilities is the proof setup worked — not just that the config parses.
4. **Record the deferred wiring in `TODO.md`.** Everything you *proposed but did not activate* is outstanding work, and a comment in `discern.toml` or a line in chat is not where the next agent will look. Add a terse item (bold title + one line, in the right bucket) for each open decision: capabilities still awaiting confirmation, any `[worktree.resources.<name>]` / `[worktree]` inherit_env / setup steps left to wire, any tool worth adding, any test database or service the suite needs.
5. **Summarise for the user:** the principles you drafted, the subtrees you proposed, the capability fills awaiting their confirmation, the `TODO.md` items you recorded, and the result of `discern finish`. Point them at the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill as the next step for filling in each subtree's leaves.
6. **Run `discern setup done`** to lock it in. It validates the result — no `<!-- setup fills this -->` markers and no EXAMPLE principle left behind — then records `[meta].bootstrapped`, which retires the one-time setup redirect and hides `discern setup` from the command list. If it reports leftover markers, finish those and re-run it (or pass `--force` if a flagged file is a deliberate exception).

---

## You are not done until all of these are true

These are stop-conditions to **verify for yourself before you finish** — not a summary to read back. **Do not paraphrase this list to the user as completed work; actually do each one, then prove it by running `discern setup done`** (it fails while any skeleton marker remains, so it is the check, not your word for it).

- You're on a capable model and `discern doctor` is green.
- `design-principles.md` holds real, project-specific principles (no EXAMPLE block, no `<!-- setup fills this -->` markers left).
- `guidance.md` has a real pitch and Conventions section.
- The orientation docs (concepts, glossary, system-map) are seeded, the `80-development/` leaves are filled, and the numbered subsystem subtrees are named with stub READMEs.
- No stale "starts as a skeleton / run `discern setup`" notes remain — the `docs/README.md` and `docs/00-orientation/README.md` intros describe the filled tree, not an empty one.
- `discern.toml` capability fills are **proposed** for every detected stack (committed only if the user confirms), and `discern finish` is **green** with whatever was activated.
- `TODO.md` records the deferred wiring so no open decision lives only in a comment or the chat.
- `discern refresh` and `discern doctor` pass, and `discern setup done` reports success (it records `[meta].bootstrapped`).

If any line above is not yet true, you are still mid-setup: keep going, don't report back as if finished. Lost the top of this brief? Re-run `discern setup` to reprint it in full.
