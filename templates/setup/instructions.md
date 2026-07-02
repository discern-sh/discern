# Set up the harness

> **`discern setup begin` printed this** — the third step of the staged handshake (`verify` previewed the plan and you confirmed the essentials with your human; `begin` scaffolded and printed this brief). These are instructions for *you, the coding agent in this session* — **work to do now, not a summary to hand back**: paraphrasing this checklist back as completed work, without doing it, is the one failure this setup exists to avoid. Work top to bottom, then run `discern setup done` to finish. **These are your setup instructions** — you are reading them right now — discern intentionally hands you this brief over stdout.

`discern setup begin` has just laid down the harness machinery — a `discern.toml` whose capabilities are all unset, the compiled agent files, the merged settings, the MCP wiring — plus empty doc skeletons (only where the project had none). **Nothing about *this project* is filled in yet, and that is your job:** author the docs, the guidance, and the design principles from the project's own context, and propose the `[capabilities]` that turn the gate from a no-op into a real definition-of-done. There is no API key and no external service — the whole point is that the agent already in the loop sets the project up.

## Operating principles — read these first

- **You are the configuration engine.** discern's pitch is zero configuration: the human points you at the repo and *you* — the capable agent already in the loop — set it up. They watch and trust; they don't field a stream of questions. Earn that trust by narrating what you do and why, and asking only the genuine decisions. The next section, *How to work with the user*, is the heart of how this should feel — read it.
- **What you author is the product.** The docs, guidance, and principles you write here are the **single source of truth** every future agent session — and discern itself — reads to work in this project. They are load-bearing infrastructure, not prose for human readers; that is why authoring them is the bulk of the job.
- **Checkpoint the model first (Step 0).** `verify` already served the model question for you to relay; Step 0 is the checkpoint that it actually reached your human before you configure anything. This one-time setup is inherited by every future session, so it is worth the user's strongest model — a question you put to *them*, not a box you tick for yourself.
- **Learn the project, then ask once (Step 1).** Derive intent from the repository; ask the user — in a single early batch — only what the code can't tell you. Pausing later for a genuine fork is different; that's not peppering.
- **Stay this-project-specific.** Principles, concepts, and conventions describe *this* project, not the harness and not any example. The Step 7 stack-detection table is the one place where naming many ecosystems is correct.
- **Read discern with `--json`.** Every discern verb that reports or checks — `status`, `doctor`, `finish`, `prepare`, `test`, `ratchets`, `setup verify`, `setup done` — accepts `--json` and returns a structured envelope. Parse that, not the human-formatted text (which is for the user).
- **It is safe to re-run.** `discern setup begin` is idempotent and non-destructive — it never overwrites your work or the configured `{{docs_dir}}` tree. Interrupted? Re-run `begin` to reprint this brief, `discern status` for a derived progress summary, or `discern setup step <n>` for one step's text.

---

## How to work with the user — you are the engine; transparency, not interrogation

You are configuring a project for someone who may be newer to shipping reliable software: building through coding agents, but without the background that keeps a codebase holding together. They can be unsettled by an agent that changes things silently. The instinct that follows — ask permission at every step — is the wrong fix: a novice asked to approve a dozen changes they don't yet understand has no basis to decide, so a wall of "may I?" prompts is its own kind of black box. **Zero configuration means *you* do the work; their job is to watch and trust.** So the contract is **transparency, not interrogation**: do the reversible work, narrate it clearly — above all *why* — and commit it in small revertible steps. The user stays informed and in control without answering for each one.

**Ask a real question only at a genuine decision** — one that is yours to escalate, not yours to make:

- the model check (Step 0) and the discovery batch (Step 1) — two expected, collaborative touchpoints, not gates;
- a change that is hard or costly to reverse;
- a real fork between legitimate alternatives only the user can choose;
- anything with cost, security, privacy, or data implications, or that depends on intent you can't infer from the repository.

Everything else you do, narrating as you go — the reversible, low-stakes, single-obvious-answer changes are yours to make. The Step 1 discovery questions are not a gate; that is you learning the project.

**Commit atomically, stage by stage.** Each coherent stage — the principles, the guidance, the orientation docs, each capability — lands as its own focused, atomic commit with a plain-language message, and you say so ("I'm committing this on its own, so you can undo just this piece"). Reassure the user **up front**: `discern setup` already put you on a dedicated **`discern-setup`** branch off their clean tree, so the whole burst of commits is isolated — none of it touches their main branch until they merge it, and it all rolls back by deleting the branch. The per-stage commit is what makes "you can revert this" literally true: the commit **is** the undo, so never batch unrelated changes into one.

**Narrate generously, but at the level of stages and decisions** — warm and clear, never a wall of text. When you introduce something the project is *missing*, or hit a genuine fork, walk the user through it in **five beats**:

1. **Recommend it as a shared step** — "I'm recommending we add ‹the missing capability›…".
2. **Say why it helps** — tie it to what they care about: the code keeps holding up as it grows, mistakes get caught before they ship.
3. **Name `discern` as the source** — "…so `discern` can hold the line on it for you," so they learn the tool is watching their back.
4. **Preserve their authority and name the risk of skipping** — "we can revert this commit later — but skipping it risks quality slipping, or subtle bugs that are hard to track down."
5. **Proceed and say what you did** — then commit it on its own.

Reserve the full five beats for genuine additions and forks. The obvious capabilities a stack plainly already has — formatter, linter, type-checker, tests — you batch into **one** concise recommendation, not five beats apiece (Step 7).

You can use your own words when narrating progress, just make sure your narration covers: what you're adding, why it matters, how discern will enforce it, how it can be reverted, and what you did.

**Narration is not completion.** Proceeding and committing as you go is transparency *during* setup — never licence to tell the user setup is done. Completion is only the stop-conditions at the foot of this brief plus a green `discern setup done`. (The `discern setup` *command* never prompts you for anything — but a non-interactive command and a silent agent are different things: converse, narrate, and ask the genuine questions anyway.)

---

## Step 0 — Checkpoint: the model question, then orient

```toml
intent = "Checkpoint before you configure anything: make sure the model question `verify` served actually reached your human, then orient with status and doctor."
files_to_read = []
must_do = [
  "Confirm you actually put verify's model question to your human; if you skipped it, ask it now — before you read the repo or touch a file.",
  "If a stronger model is available, ask the user to restart setup in a fresh session running it.",
  "Run `discern status --json` to orient, and `discern doctor --json` if anything looks off.",
]
what_not_to_do = [
  "Do not assume you are the best model and press on — you cannot reliably self-certify.",
  "Do not treat a skipped consent conversation as done; if it did not happen, hold it now.",
]
completion_check = "You have put the model question to your human, and `discern doctor` is green."
next_action = "Once the model is confirmed and the harness is healthy, pull the next page: `discern setup step 1`."
```

`verify` served the model question inside the consent message you relayed. This step is the **checkpoint**: if you haven't actually put that question to your human, do it now — before anything else, before you read the repo or touch a file. It is the single highest-leverage moment in the project's life with discern, because **you are the engine of this setup, and its quality is bounded by the model that does it** — everything you configure here is inherited by every future session.

If the consent conversation didn't happen (you reprinted this brief, or landed here without running `verify`), ask it plainly now and wait:

> **"Before I configure anything: am I your most capable model? Everything I set up here — the principles, the docs, the capabilities — is inherited by every future session, so it's worth your strongest model."**

You can't see the other models the user has access to, or ones released after your training cutoff, so you cannot self-certify — this is the one decision only they can make.

- If a stronger model is available, **ask the user to restart setup in a fresh session running that model** — don't carry on in this one. A clean session is the only reliable switch: providers differ (some can't change model mid-session at all), discern's tools and session hooks load only at session start, and even where a mid-session switch is allowed, the weaker model's reasoning already in this context window would bias the stronger one.
- If they confirm, proceed — you'll already have passed `--model` to `begin`, so discern recorded which model configured the project.

Then **confirm the harness is healthy**: run **`discern status --json`** to orient (it also smoke-tests that `discern` is on your PATH — you lean on it constantly), and **`discern doctor --json`** if anything looks off. Fix what `doctor` flags before authoring; it returns the exact remedy.

---

## Step 1 — Learn the project, then ask

```toml
intent = "Build your mental model from the repository, then ask the user one sharp batch of only what the code can't tell you."
files_to_read = [
  "the top-level layout, the README, and the manifests/lockfiles",
  "the actual code — models, config, tests",
  "brief.md at the root, if a user or CI supplied one",
]
must_do = [
  "Read the repository first — it is your primary source for the principles, concepts, and conventions you will write.",
  "Ask a short, high-signal batch of questions together, then proceed.",
  "Mine the repo for what the system actually is — a thin answer is no licence for a shallow result.",
]
what_not_to_do = [
  "Do not pepper the user with questions one at a time.",
  "Do not invent a domain — derive it from what you find.",
]
completion_check = "You have read the repository and asked your one discovery batch."
next_action = "When you have your bearings, pull the next page: `discern setup step 2`."
```

1. **Read the repository — it is your primary source.** The top-level layout, the README, the manifests/lockfiles, and the actual code (models, config, tests) are where the principles, concepts, and conventions you'll write are *evidenced*. Start forming the real mental model now; you inventory the stack properly in Step 7.
2. **Ask the user a short, sharp batch of questions** — only what the code can't tell you: what the project is *for* and who it serves, its non-negotiable rules, anything in flight or deliberately unusual. Keep it to a handful of high-signal questions asked together, then proceed. (If a `brief.md` exists at the root — a user or CI may have supplied one via `--brief`/`--config` — read it first and let it narrow what you ask.)

**A thin answer is not a licence for a shallow result.** Whether the user gives you a single sentence or a deliberate "figure it out", the job is identical: mine the repository for what the system actually *is* and document *that* — don't paraphrase the answer and stop. The depth comes from the repo, not the length of the answer. Never invent a domain — derive it from what you find.

---

## Step 2 — Check the doc skeletons

```toml
intent = "Take stock of what `setup begin` scaffolded versus left untouched — and, if you will wire a formatter, do it now so its sweep lands before you author."
files_to_read = [
  "the `setup begin` output (what it laid versus left untouched)",
  "the scaffolded {{docs_dir}} tree, if one was laid",
]
must_do = [
  "Note whether the configured {{docs_dir}} tree and TODO.md were scaffolded or already existed, and adapt to what is there.",
  "If a formatter applies, wire it now, run `discern prepare`, and commit its whole-tree reflow on its own.",
]
what_not_to_do = [
  "Do not impose the skeleton shape on an existing configured documentation tree.",
]
completion_check = "You know what was scaffolded, and any formatter sweep is committed on its own."
next_action = "With the lay of the land clear, pull the next page: `discern setup step 3`."
```

`discern setup` has already laid the skeletons for you — **but only when their configured destinations were absent**, so existing content is never disturbed:

- if there was no `{{docs_dir}}` tree, it scaffolded one (the orientation docs plus the `80-development/` leaves) for you to fill;
- if `TODO.md` was absent, it created that too;
- if you **already had** the configured tree (or a `TODO.md`), discern left it untouched — work with what is there, adapting these steps to your existing structure rather than imposing the skeleton shape below.

The command's output told you which of these happened. The scaffolded files already carry the project name; the remaining placeholders are the `<!-- setup fills this -->` markers and the EXAMPLE principle, which you replace as you go.

**One ordering tip before you author (Steps 3–6).** If this project has a code formatter — or you intend to add one (a missing formatter is exactly the kind of well-established tool worth proposing; see Step 7) — wire that single capability now and commit its first whole-tree sweep on its own — `discern config set-capability format "<the formatter>"`, then `discern prepare` to run it, then commit just the reflow (Step 7 has the detail). Doing it first lands the mechanical reformat on the empty scaffold, so every docs and guidance commit you make afterwards stays a clean content diff instead of being tangled with formatting noise.

---

## Step 3 — Draft the design principles

```toml
intent = "Write the 3–7 principles that actually govern decisions here — the load-bearing foundation every future session reads."
files_to_read = [
  "{{docs_dir}}00-orientation/design-principles.md (the template shape plus the EXAMPLE principle)",
]
must_do = [
  "Write 3–7 project-specific, falsifiable principles, each with a name, the rule, a Why it matters, and a How it shows up.",
  "Replace the EXAMPLE principle entirely and delete the guidance comments as you go.",
  "Fill the \"What these add up to\" section.",
]
what_not_to_do = [
  "Do not write a wish list — keep the smallest set that actually governs decisions.",
  "Do not leave the EXAMPLE block or any generic, unfalsifiable principle.",
]
completion_check = "design-principles.md holds at least 3 real principles (the EXAMPLE block replaced)."
next_action = "Once the principles are real, pull the next page: `discern setup step 4`."
```

Steps 3–6 are the authoring core, and before you write a word, say *why* it matters to the user: the principles, docs, and guidance you're about to write are the **single source of truth** every future agent session — and discern itself — reads to work in this project. This is the load-bearing part of setup, the foundation the project's reliability is built on, not prose for human readers. So author it with that weight, and don't let the user mistake the lengthy step for busywork.

Open **`{{docs_dir}}00-orientation/design-principles.md`** and follow the template already in it (the commented shape plus the EXAMPLE principle).

- Write **3–7** principles — the smallest set that actually governs decisions here, not a wish list.
- Each gets an imperative one-line name, 1–3 sentences stating the rule, a **Why it matters** (the failure it prevents), and a **How it shows up** (where it's visible in the code — concrete and present-tense).
- Replace the EXAMPLE principle entirely; delete the guidance comments as you go.
- Fill the **"What these add up to"** section: a few sentences on how the principles reinforce each other.
- Keep the override mechanism line intact — overriding a principle means writing an ADR (`{{docs_dir}}_adr/`).

Good principles are specific to this project and falsifiable: you can point at a change that would violate one.

---

## Step 4 — Fill the project guidance

```toml
intent = "Fill guidance.md with this project's own conventions — the source every compiled agent file (and discern) is built from."
files_to_read = [
  "guidance.md at the repo root (the default [guidance].sources)",
]
must_do = [
  "Write the one-line pitch at the top and the Conventions section, aligned with the capabilities you will wire.",
  "If `begin` imported an existing CLAUDE.md/AGENTS.md, fold it in and note any conflict with discern's disciplines for Step 8.",
]
what_not_to_do = [
  "Do not repeat discern's built-in harness disciplines — they are bundled and auto-prepended.",
  "Do not edit the generated CLAUDE.md/AGENTS.md; guidance.md is the authoritative source.",
]
completion_check = "guidance.md has a real one-line pitch and a filled-in Conventions section."
next_action = "With the guidance written, pull the next page: `discern setup step 5`."
```

Open **`guidance.md`** (at the repo root — the default `[guidance].sources`). This file holds **only this project's own conventions**: discern's built-in harness guidance (docs, TODO, worktree, finish gate) is bundled and auto-prepended at compile time, so you don't repeat the standing disciplines here. Flesh out the stub:

- The one-line pitch at the top — what the project is and who it's for.
- The **Conventions** section — language idioms, style, structure, naming, error handling, anything the tooling enforces. Keep it aligned with the capabilities you'll propose in Step 7, so the written rule and the enforced rule agree.
- **If `discern setup begin` imported your existing instructions:** when the project already had a hand-written `CLAUDE.md`/`AGENTS.md`, `begin` migrated its content into `guidance.md` under an _"Imported from …"_ heading so nothing was lost (the `verify` preflight flagged this). Fold it into the pitch and Conventions above, then delete that heading and its import note. **Watch for instructions that contradict discern's standing disciplines** — a pre-existing rule like "never use worktrees" fights discern's worktree workflow, and silently appending it would leave the compiled guidance self-contradictory. Note any such conflict now; you resolve it in discern's favour at the end (Step 8), once the whole guidance is in view.

**Do not touch the generated copies** (`CLAUDE.md`, `AGENTS.md`, …). This source file is authoritative; those are compiled from the built-in guidance plus `guidance.md` in Step 8.

---

## Step 5 — Seed the orientation docs

```toml
intent = "Seed the three orientation docs from what you learned, using one consistent set of canonical nouns."
files_to_read = [
  "{{docs_dir}}00-orientation/concepts.md",
  "{{docs_dir}}00-orientation/glossary.md",
  "{{docs_dir}}00-orientation/system-map.md",
]
must_do = [
  "Fill concepts (the narrative tour), glossary (each canonical noun defined once), and system-map (an ASCII diagram).",
  "Clear the stale \"starts as a skeleton\" notes once each doc is real.",
]
what_not_to_do = [
  "Do not introduce synonyms for the canonical nouns — use the same capitalised terms everywhere.",
]
completion_check = "concepts, glossary, and system-map are seeded, and their skeleton notes are cleared."
next_action = "Once the orientation docs read true, pull the next page: `discern setup step 6`."
```

Fill the three orientation skeletons from what you learned in Step 1, removing the `<!-- setup fills this -->` markers as you complete each section:

- **`{{docs_dir}}00-orientation/concepts.md`** — the narrative tour: the core building blocks and how material flows through them, in plain language. Introduce the canonical nouns here.
- **`{{docs_dir}}00-orientation/glossary.md`** — define each canonical noun once, precisely. Core nouns first, then a section per area.
- **`{{docs_dir}}00-orientation/system-map.md`** — an **ASCII** diagram of the real components and the flow between them, plus the "where each piece runs" notes.

Use the same capitalised canonical nouns across all three (and everywhere else). Don't introduce synonyms.

Then clear the stale "starts as a skeleton" notes so the filled tree doesn't still announce itself as empty: the blockquote at the top of **`{{docs_dir}}00-orientation/README.md`** and the one-line skeleton blockquote atop each doc you just filled. Once a doc is real, a note telling the reader it is empty is worse than no note.

---

## Step 6 — Propose the subsystem subtrees

```toml
intent = "Decide the numbered subsystem subtrees, stub their READMEs, and fill the stack-level 80-development leaves now."
files_to_read = [
  "{{docs_dir}}README.md (the Subsystems table)",
  "{{docs_dir}}80-development/ (getting-started, testing, code-conventions)",
]
must_do = [
  "Update the Subsystems table and the orientation cross-references with the proposed subtrees, clearing the placeholder rows.",
  "Create each numbered subtree directory with a stub README, and fill the 80-development/ leaves now.",
]
what_not_to_do = [
  "Do not write the numbered subtree leaves now — that is the document-subsystem skill's job, run per subsystem later.",
]
completion_check = "The subsystem subtrees are named with stub READMEs, and the 80-development leaves are filled."
next_action = "With the tree mapped out, pull the next page: `discern setup step 7`."
```

Decide the numbered subsystem subtrees this project needs (`10-…`, `20-…`, … `80-development/` already exists). Then:

- Update the **Subsystems** table in **`{{docs_dir}}README.md`** with the proposed names and a one-liner each, removing the placeholder rows. Also clear the "this tree starts as a skeleton" blockquote above the table: once the subtrees are real, that note is stale.
- Reflect the same names in the "what to read next" / "how the map relates" tables in the orientation docs.
- **Create the directories with a stub `README.md` each** (a title and a one-line "what this subtree covers"), so the tree is navigable — but don't write the leaves now. Filling a subtree's leaves is the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill's job, run per subsystem when you're ready.

**Exception — fill the `80-development/` leaves now.** Those leaves (`getting-started.md`, `testing.md`, `code-conventions.md`) ship with `<!-- setup fills this -->` markers and are *stack-level*, not subsystem-deep: everything they need — the setup steps, the test runner, the formatter and build — you already have from Step 1 and the Step 7 stack sniff. Fill them now, clearing their markers, and keep them aligned with the guidance (Step 4) and the capabilities you propose (Step 7). Only the *numbered* subtree leaves are deferred to `document-subsystem`.

Run the subtree set past the user as a quick sanity check — the numbering is a reading order, easy to change and easy to revert — then create the stub directories and commit them. This is a narrate-and-proceed step, not a decision to gate on.

---

## Step 7 — Sniff the stack and recommend the capabilities

```toml
intent = "Detect the stack and wire the [capabilities] that turn the gate from a no-op into a real definition-of-done — raising the floor where a standard tool is missing."
files_to_read = [
  "the manifests/lockfiles and the scripts they actually declare",
  "discern.toml ([capabilities])",
]
must_do = [
  "Inventory the stack signals and wire format/lint/typecheck/test/build via `discern config set-capability`, committing each (the formatter first, its sweep on its own).",
  "Run `discern refresh`, then `discern finish` (or `discern prepare`), and watch the gate go green as you wire each capability.",
  "Where the stack is missing a standard tool, propose adding it through the five beats.",
]
what_not_to_do = [
  "Do not wire a command you can't pin down — leave it as a comment beside the unset key.",
  "Do not leave a capability unset merely because the project hadn't adopted the obvious tool yet.",
]
completion_check = "at least one capability is wired in discern.toml."
next_action = "Once the gate is green with what you wired, pull the final page: `discern setup step 8`."
```

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

Prefer these over hand-editing TOML. The format/lint/typecheck/test/build a stack plainly already has are not a fork to deliberate — so **batch them into one concise recommendation**, not a five-beat pitch apiece: tell the user which tools you found, that wiring them lets `discern` check those parts of the project for them, and that each lands as its own revertible commit. Then activate the ones you're confident in and commit them (the formatter on its own — see below). Reserve a genuine, individual pause for a **real decision**: two legitimate commands where the choice matters, or a command that would do more than check — touch real data, hit a paid or networked service, or run long.

**Setup is a chance to raise the project's floor, not just record it.** Where a stack is *missing* a standard tool — no formatter, no linter, no type-checker, or even no test suite — proposing a well-established one (the conventional, well-regarded choice for the ecosystem, like those in the table below) is a real improvement, not overreach. Walk the user through *adding* it in the five beats — recommend, say why, name `discern`, preserve their authority and the revert, then proceed — because installing a standard dev tool and committing it on its own is low-stakes and reversible, a narrate-and-proceed rather than a gate. Keep the genuine pause for the real decisions above (a paid, networked, or long-running command, or a true fork between legitimate alternatives).

Before you run the gate here for the first time, **run `discern refresh`**: you edited `guidance.md` in Step 4, which leaves the generated agent files stale, and `discern finish`'s currency check fails on stale files until `refresh` recompiles them. Then **`discern finish`** (or the faster **`discern prepare`**) confirms each fill passes — both run during setup, and `discern setup done` proves the whole gate green before completion — so a confident fill is exactly the low-stakes, reversible change to proceed on. A capability you can't pin down waits as a comment beside the unset key: an omitted capability is "knowably absent", so a wrong guess never breaks the gate.

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
- **Point the gate at its gotchas doc.** Step 2 created `{{docs_dir}}80-development/finish-gate-gotchas.md`; set `[project].gotchas_doc = "{{docs_dir}}80-development/finish-gate-gotchas.md"` so a non-obvious gate failure points agents at it.
- **Wire `format` first, and commit its sweep on its own.** A `format` capability reformats the whole tree the first time it runs — so ideally you wired it before authoring the docs (Step 2's ordering tip), landing the reflow on the empty scaffold. Either way: run `discern prepare` right after wiring it and commit that normalization as its own step, so the mechanical reflow never muddies a content commit.
- **Leave a capability unset** only when the ecosystem genuinely has no standard tool for that slot — not merely because the project hadn't adopted the obvious one yet (recommend adding that; see above). A green gate you grow into beats a red gate on day one.

---

## Step 8 — Record, summarise, and prove it with `discern setup done`

```toml
intent = "Reconcile imported instructions, record deferred wiring in TODO.md, summarise for the user, and prove completion with `discern setup done`."
files_to_read = [
  "guidance.md (the reconciled result, if begin imported instructions)",
  "TODO.md",
]
must_do = [
  "Reconcile any imported instructions in discern's favour, telling the user what you changed and why.",
  "Record every proposed-but-not-activated item (a deferred capability, a worktree resource, a tool worth adding) in TODO.md.",
  "Summarise the principles, subtrees, capabilities, and TODOs — and say what the docs are for.",
]
what_not_to_do = [
  "Do not reach for --force to paper over a real gate failure.",
  "Do not tell the user setup is complete until `discern setup done` passes.",
]
completion_check = "`discern setup done` passes — it re-runs refresh → doctor → finish and checks every step."
next_action = "When every page above is done, run `discern setup done` — the one command that proves and finishes setup."
```

You wired and verified the capabilities in Step 7 — **`discern finish`** (the full gate) and **`discern prepare`** (the fast fix-then-check loop) both run *during* setup, so you have already watched the gate go green as you wired each one. This step records the outcome and locks it in.

1. **Reconcile any imported instructions against discern's guidelines.** If `begin` folded a pre-existing `CLAUDE.md`/`AGENTS.md` into `guidance.md` (Step 4), review it now — with the full guidance and discern's built-in disciplines both in view — for anything that **contradicts how discern works**: a "never use worktrees", a "don't run a quality gate", a commit convention that clashes with the atomic-commit workflow. Resolve each conflict **in discern's favour** — edit or drop the offending line, and tell the user plainly why ("your earlier note said to avoid worktrees, but discern's workflow depends on them, so I've removed it; here's what that changes for you"). An unreconciled contradiction compiles into every agent file and quietly works against the harness. (No imported instructions? Skip this.)
2. **Record the deferred wiring in `TODO.md`.** Everything you *proposed but did not activate* is outstanding work, and a comment in `discern.toml` or a line in chat is not where the next agent will look. Add a terse item (bold title + one line, in the right bucket) for each open decision: any capability you deliberately left for the user to decide (a genuine fork you paused on), any `[worktree.resources.<name>]` / `[worktree]` inherit_env / setup steps left to wire, any tool worth adding, any test database or service the suite needs.
3. **Summarise for the user — and say what the docs are *for*.** Recap the principles you drafted, the subtrees you proposed, the capabilities you wired and committed (plus any genuine fork you left for them to decide), and the `TODO.md` items you recorded. Then remind them why it mattered: the docs and guidance you wrote are the single source of truth every future agent session — and discern — reads to work in this project, the foundation its reliability is built on, not documentation for its own sake. Point them at the [`document-subsystem`](/.claude/skills/document-subsystem/SKILL.md) skill as the next step for filling in each subtree's leaves.
4. **Run `discern setup done` — it proves completion for you.** This is the one command that finishes setup, and it does the proving: it re-runs **`discern refresh` → `discern doctor` → `discern finish`** and records `[meta].bootstrapped` **only when the install is healthy and the gate is green**. Then the one-time setup redirect retires and `discern setup` hides from the command list. (`discern refresh` compiles the built-in harness guidance + `guidance.md` into the per-provider agent files — `AGENTS.md`, `CLAUDE.md`, … — all gitignored build artifacts, with `guidance.md` as the tracked, reviewable source — and materializes the skills into `.claude/skills/`.) If it reports:
   - **leftover markers** — a `<!-- setup fills this -->` sentinel or the EXAMPLE principle is still in a file: fill it and re-run (or pass `--force` if a flagged file is a deliberate exception);
   - **a red `doctor` or `finish`** — fix what it names (run `discern doctor` / `discern finish` to see the detail), then re-run. **Don't leave a red gate or a wrong command behind**, and don't reach for `--force` to paper over a real failure — a green `setup done` with real capabilities is the proof setup worked, not just that the config parses.

---

## You are not done until all of these are true

These are stop-conditions to **verify for yourself before you finish** — not a summary to read back. **Do not paraphrase this list to the user as completed work; actually do each one, then prove it by running `discern setup done`** (it fails while any skeleton marker remains, so it is the check, not your word for it).

- You relayed Step 0's model question to your human — proceeding on the model they confirmed, or resuming on the stronger one they chose — and `discern doctor` is green.
- `design-principles.md` holds real, project-specific principles (no EXAMPLE block, no `<!-- setup fills this -->` markers left).
- `guidance.md` has a real pitch and Conventions section.
- If `begin` imported existing instructions, they are folded into `guidance.md` and **reconciled** — no leftover rule contradicts discern's standing disciplines (e.g. no surviving "don't use worktrees").
- The orientation docs (concepts, glossary, system-map) are seeded, the `80-development/` leaves are filled, and the numbered subsystem subtrees are named with stub READMEs.
- No stale "starts as a skeleton / run `discern setup`" notes remain — the `{{docs_dir}}README.md` and `{{docs_dir}}00-orientation/README.md` intros describe the filled tree, not an empty one.
- `discern.toml` capability fills are **recommended, narrated, and committed** for every detected stack you were confident in — each its own revertible commit — with any genuine fork left for the user to decide and recorded in `TODO.md`; and `discern finish` is **green** with whatever was activated.
- `TODO.md` records the deferred wiring so no open decision lives only in a comment or the chat.
- `discern setup done` reports success — it re-runs `discern refresh` → `discern doctor` → `discern finish` and records `[meta].bootstrapped` only when all three pass, so a green `setup done` *is* the proof the gate is real (not merely that the config parses).

If any line above is not yet true, you are still mid-setup: keep going, don't report back as if finished. Lost the top of this brief? Re-run `discern setup begin` to reprint it in full (or `discern setup step <n>` for just one step).
