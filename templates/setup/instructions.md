# Set up the harness

> You are reading this because **`discern setup` printed it**. These are instructions for *you, the coding agent in this session* — **work to do now, not a summary to hand back**. Work through them top to bottom, then run `discern setup done` to finish. **Do not report these steps as done until you have actually done them and `discern setup done` passes** — paraphrasing this brief's checklist back to the user as completed work is the one failure this setup must avoid. (There is no skill file and no second program — discern just hands you this brief over stdout.)

`discern setup` has just laid down the harness machinery — a `discern.toml` whose capabilities are all unset, the compiled agent files, the merged settings, the MCP wiring — plus empty doc skeletons (only where the project had none). **Nothing about *this project* is filled in yet, and that is your job:** author the docs, the guidance, and the design principles from the project's own context, and propose the `[capabilities]` that turn the gate from a no-op into a real definition-of-done. There is no API key and no external service — the whole point is that the agent already in the loop sets the project up.

## Operating principles — read these first

- **Use the most capable model available** (Step 0). This is a one-time setup whose output every future session inherits — it is worth your best model.
- **Ask, don't guess.** There is no brief file. Derive intent from the repository, and ask the user for what the code can't tell you — **once, early, in a single batch**, not peppered across every step. (Pausing later for a genuine decision is different — that's a real fork, not peppering.)
- **Involve, don't gate.** Recommend each change, explain it, and proceed on anything reversible while narrating — committing it as its own revertible step — instead of stopping for permission before every action. Pause only for genuine decisions. Everything you write is still a first draft the user can refine or revert; the per-stage commit is what makes that literally true. The next section, *How to work with the user*, is the heart of how this setup should feel — read it.
- **Stay this-project-specific.** Principles, concepts, and conventions describe *this* project, not the harness and not any example. The stack-detection table in Step 7 is the one place where naming many ecosystems is correct — that step's whole job is to recognise them.
- **Read discern with `--json`.** Every discern verb that reports or checks something — `status`, `doctor`, `finish`, `prepare`, `test`, `ratchets`, `setup done` — accepts `--json` and returns a structured result envelope. Pass it whenever you run one to read state, and parse that, rather than scraping the human-formatted text: it is the cleanest, most reliable signal for you (the human text is for the user). The same goes for the MCP `discern_*` tools, which always return structured results.
- **It is safe to re-run.** `discern` (and `discern setup`) is idempotent and non-destructive: it never overwrites your work or an existing `docs/` tree. If this session is interrupted, the user just runs `discern` again and you pick up where you left off.

---

## How to work with the user — involve, don't gate

You are setting up a project for someone who may be newer to shipping reliable software — building through coding agents, but without the background that keeps a codebase holding together over time. They can be unsettled by an agent that changes things silently or pulls in outside tools without explanation. Your job is to keep them **informed and in control without making them approve every routine step**. The stance is **involve, don't gate**: recommend, explain, proceed with the reversible change while narrating it, and commit it on its own so they can always undo it — rather than stopping to ask "may I?" before each action.

**Narrate each meaningful recommendation in five beats.** When you add a tool, dependency, or piece of config the project is missing, walk the user through it:

1. **Recommend it as a shared step** — "I'm recommending we add ‹the missing capability›…".
2. **Say why it helps** — tie it to something they care about: that the code keeps holding up as it grows, that mistakes get caught before they ship, that the project stays reliable.
3. **Name `discern` as the source** — "…so `discern` can ‹check this for you / hold the line on it for you›." They should learn that the suggestion came from `discern`, and that `discern` is the thing watching their back.
4. **Preserve their authority and name the risk of skipping** — "If you change your mind we can revert this commit later — but skipping it risks ‹quality slipping, or subtle bugs that are hard to track down later›."
5. **Proceed and say what you're doing** — "I'm adding it now and wiring it into `discern` for you" — then do it, and commit it as its own focused step.

Beat 4's promise is true *because of* beat 5: each recommendation lands as its own atomic commit, so "we can revert later" is literal — the commit **is** the undo. That linkage is the whole safety model; don't break it by batching unrelated changes into one commit.

**Commit atomically, stage by stage.** Each stage that produces a coherent change — the design principles, the guidance, the orientation docs, the subsystem stubs, each capability you wire — gets its own focused, atomic commit with a clear, plain-language message. Say you're doing it ("I'm committing this on its own, so you can undo just this piece if you ever want to"). And reassure the user **up front**: `discern setup` has already put you on a dedicated **`discern-setup`** branch (created from their clean tree), so setup lands as several small, focused commits *there* — none of it touches their main branch until they choose to merge, and the whole thing is trivial to roll back (delete the branch) or land (merge it) when they're happy. So the burst of commits is isolated and safe, not a surprise. This is what makes proceeding-without-asking safe: every step is independently reviewable and revertible.

**Pause for genuine decisions.** Default to acting — with narration — on anything reversible, low-stakes, and with a single obvious answer. **Stop and genuinely ask the user** only when a decision is:

- hard or costly to reverse, or
- a real fork between legitimate alternatives that only the user can choose, or
- one that carries cost, security, privacy, or data implications, or
- one that depends on intent or context you can't infer from the repository.

The discovery questions in Step 1 are not a gate — that is you learning the project, and it stays. What goes away is the reflexive "may I?" before every routine, reversible action.

**Keep the volume right.** Narrate at the level of meaningful stages and decisions, not every file you touch — warm and clear, never a wall of text. Bias toward fewer, well-placed explanations: the user should come away feeling informed and in control, not buried in commentary.

**Narration is not completion.** Proceeding and committing as you go is about transparency *during* setup — it is **not** licence to tell the user setup is finished. Completion is still only the stop-conditions at the foot of this brief plus a passing `discern setup done`; never paraphrase your per-stage commits back as "setup complete." (And note: the `discern setup` *command* doesn't prompt you for anything — but you should still converse, narrate, and occasionally ask. A non-interactive command and a transparent conversation with the user are different things.)

---

## Step 0 — Make sure you're the right tool for this job

This setup is a one-time event, and it determines how well the project is harnessed for *every* future agent session. The principles, docs, and capability fills you produce here are the foundation everything else is judged against — so do it with the strongest model you can.

1. **Use a capable model — this is a one-time foundation.** You can't see the user's account, so don't try to confirm you're literally their *most* capable model. But if you *know* you're running as a fast, small, lightweight, or cheap model, **stop and recommend the user switch you to their most capable frontier model** — the top-tier Claude, GPT, or Gemini they have — *before* you continue, then resume from here. Otherwise, proceed. Don't quietly press on as a lightweight model: weaker principles and shakier capability guesses get inherited by every later session. Say so plainly and let the user decide.
2. **Confirm the harness is healthy.** Run **`discern status --json`** to orient (it also smoke-tests that the `discern` binary is on your PATH — you will lean on it constantly), and **`discern doctor --json`** if anything looks off. Fix what `doctor` flags before authoring; it returns the exact remedy. (As above, prefer `--json` on these read/check commands.)

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
- **If `discern setup` imported your existing instructions:** when the project already had a hand-written `CLAUDE.md`/`AGENTS.md`, setup migrated its content into `guidance.md` under an _"Imported from …"_ heading so nothing was lost. Fold it into the pitch and Conventions above, then delete that heading and its import note.

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

Run the subtree set past the user as a quick sanity check — the numbering is a reading order, easy to change and easy to revert — then create the stub directories and commit them. This is a narrate-and-proceed step, not a decision to gate on.

---

## Step 7 — Sniff the stack and recommend the capabilities

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

Prefer these over hand-editing TOML. **Wire each capability the involve-don't-gate way.** A capability fill is the textbook case for the five beats: for every one you're confident the project genuinely has, recommend it, explain that it lets `discern` check that part of the project for you, note that the commit is revertible — then activate it and commit it on its own. Activating a capability is reversible (revert the commit, or drop it back to a comment), and you can run **`discern finish`** (or the faster **`discern prepare`**) right now to confirm it passes — both run during setup — with `discern setup done` proving the whole gate green before completion, so a confident fill is exactly the kind of low-stakes, reversible change to proceed on. **Pause and genuinely ask** only when it is a real decision: two legitimate commands where the choice matters, or a command that would do more than check — touch real data, hit a paid or networked service, or run long. A capability you can't pin down can wait as a comment beside the unset key; an omitted capability is "knowably absent", so a wrong guess never breaks the gate.

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
- **Wire the obvious scopes and worktree resources too** while you're here: point `[scopes]` globs at where this project's code actually lives, and if the project needs a per-worktree external resource (a database, an emulator, a container), note a `[worktree.resources.<name>]` table with `create`/`destroy` for the user to fill — an external resource carries cost and data implications, so it is a genuine decision to leave with them, not something to wire silently.
- **Point the gate at its gotchas doc.** Step 2 created `docs/80-development/finish-gate-gotchas.md`; set `[project].gotchas_doc = "docs/80-development/finish-gate-gotchas.md"` so a non-obvious gate failure points agents at it.
- **Commit the formatter's first sweep on its own.** A `format` capability reformats the whole tree the first time the gate runs it; run `discern prepare` right after wiring it and commit that normalization as its own step, so the mechanical reflow never muddies a content commit.
- **Leave a capability unset** if the stack has no standard tool for it. A green gate you grow into beats a red gate on day one.

---

## Step 8 — Record, summarise, and prove it with `discern setup done`

You wired and verified the capabilities in Step 7 — **`discern finish`** (the full gate) and **`discern prepare`** (the fast fix-then-check loop) both run *during* setup, so you have already watched the gate go green as you wired each one. This step records the outcome and locks it in.

1. **Record the deferred wiring in `TODO.md`.** Everything you *proposed but did not activate* is outstanding work, and a comment in `discern.toml` or a line in chat is not where the next agent will look. Add a terse item (bold title + one line, in the right bucket) for each open decision: any capability you deliberately left for the user to decide (a genuine fork you paused on), any `[worktree.resources.<name>]` / `[worktree]` inherit_env / setup steps left to wire, any tool worth adding, any test database or service the suite needs.
2. **Summarise for the user:** the principles you drafted, the subtrees you proposed, the capabilities you wired and committed (plus any genuine fork you left for them to decide), and the `TODO.md` items you recorded. Point them at the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill as the next step for filling in each subtree's leaves.
3. **Run `discern setup done` — it proves completion for you.** This is the one command that finishes setup, and it does the proving: it re-runs **`discern refresh` → `discern doctor` → `discern finish`** and records `[meta].bootstrapped` **only when the install is healthy and the gate is green**. Then the one-time setup redirect retires and `discern setup` hides from the command list. (`discern refresh` compiles the built-in harness guidance + `guidance.md` into the per-provider agent files — `AGENTS.md`, `CLAUDE.md`, … — all gitignored build artifacts, with `guidance.md` as the tracked, reviewable source — and materializes the skills into `.claude/skills/`.) If it reports:
   - **leftover markers** — a `<!-- setup fills this -->` sentinel or the EXAMPLE principle is still in a file: fill it and re-run (or pass `--force` if a flagged file is a deliberate exception);
   - **a red `doctor` or `finish`** — fix what it names (run `discern doctor` / `discern finish` to see the detail), then re-run. **Don't leave a red gate or a wrong command behind**, and don't reach for `--force` to paper over a real failure — a green `setup done` with real capabilities is the proof setup worked, not just that the config parses.

---

## You are not done until all of these are true

These are stop-conditions to **verify for yourself before you finish** — not a summary to read back. **Do not paraphrase this list to the user as completed work; actually do each one, then prove it by running `discern setup done`** (it fails while any skeleton marker remains, so it is the check, not your word for it).

- You did Step 0's model check — proceeding on a capable model, or having recommended a switch if you knew you were a lightweight one — and `discern doctor` is green.
- `design-principles.md` holds real, project-specific principles (no EXAMPLE block, no `<!-- setup fills this -->` markers left).
- `guidance.md` has a real pitch and Conventions section.
- The orientation docs (concepts, glossary, system-map) are seeded, the `80-development/` leaves are filled, and the numbered subsystem subtrees are named with stub READMEs.
- No stale "starts as a skeleton / run `discern setup`" notes remain — the `docs/README.md` and `docs/00-orientation/README.md` intros describe the filled tree, not an empty one.
- `discern.toml` capability fills are **recommended, narrated, and committed** for every detected stack you were confident in — each its own revertible commit — with any genuine fork left for the user to decide and recorded in `TODO.md`; and `discern finish` is **green** with whatever was activated.
- `TODO.md` records the deferred wiring so no open decision lives only in a comment or the chat.
- `discern setup done` reports success — it re-runs `discern refresh` → `discern doctor` → `discern finish` and records `[meta].bootstrapped` only when all three pass, so a green `setup done` *is* the proof the gate is real (not merely that the config parses).

If any line above is not yet true, you are still mid-setup: keep going, don't report back as if finished. Lost the top of this brief? Re-run `discern setup` to reprint it in full.
