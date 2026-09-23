---
title: Glossary
description: Look up discern terms, understand their meaning, and find the next useful explanation.
order: 70
aliases:
  - terms
  - definitions
  - vocabulary
  - dictionary
  - accept
  - advisory
  - agent file
  - checkpoint
  - coupling
  - declaration
  - declared met
  - declared unmet
  - desk
  - discern
  - discern version
  - effort
  - engine
  - file ownership
  - fleet
  - gate
  - gate job
  - generated artifact
  - generated file
  - improvement review
  - installer
  - instruction source
  - integration worktree
  - landing authority
  - logbook
  - map
  - migration
  - namespace
  - open question
  - patterns
  - placement is consent
  - practice
  - progress handle
  - project script
  - project-owned file
  - proof
  - proof note
  - question
  - schema version
  - scope
  - shared file
  - skill
  - stage
  - standard
  - stop / advise
  - submission
  - tidy
  - tip
  - trunk
  - update
  - variance
  - worktree
  - worktree resource
---

<!-- This reference is generated from the product-term registry. -->

# Glossary

Look up a term used in the project or its documentation. Each definition links to the explanation or reference behind it.

These names are canonical — every page uses them identically, no synonyms ([ADR 0169](../_adr/0169-the-launch-glossary-canon.md)); running prose capitalizes Proof and its family only ([ADR 0373](../_adr/0373-proof-alone-carries-product-concept-capitals.md)). For how they relate, read [concepts](concepts.md).

Jump to: [A](#accept) · [C](#checkpoint) · [D](#declaration) · [E](#effort) · [F](#file-ownership) · [G](#gate) · [I](#improvement-review) · [L](#landing-authority) · [M](#map) · [N](#namespace) · [O](#open-question) · [P](#patterns) · [Q](#question) · [S](#schema-version) · [T](#tidy) · [U](#update) · [V](#variance) · [W](#worktree)

### Accept

`discern accept` lands a finished change on your project's shared branch once the change has permission to land. Your agent runs it from the task's worktree, where it first records the task's [submission](#submission): the exact commit that passed the gate. From your main checkout, your agent names the task with `--target`, and discern lands its recorded submission. The change lands on the [trunk](#trunk) if you approved it in the conversation or a grant covers it. Without permission, nothing lands, and the submission waits for you. If other work landed after the change's Proof and the submitted commit doesn't include it, discern combines the two in an [integration worktree](#integration-worktree). It checks the combined code and lands exactly what passed. If another landing is already running, this one waits its turn and then carries on by itself. With `--target`, discern then keeps landing queued tasks that a grant covers, in order, until one needs you. After landing, discern records the Proof note, updates your main checkout, and removes the task's worktree, resources, and branch. The worktree stays if it holds uncommitted files or its branch has newer commits. See [worktrees](../30-worktrees/) and [landing authority](../30-worktrees/landing-authority.md).

### Advisory

Advice from discern about where to look, which never blocks your work. [Coupling](../20-quality-gate/coupling.md), [patterns](../20-quality-gate/patterns.md), [impact](https://discern.sh/docs/reference/cli-reference#discern-impact), and [improvement](../20-quality-gate/improvement.md) all give advice, and so do `advise` checkpoints. A finding can prompt your agent to investigate, and it never fails a [gate](#gate) check. In discern's results, advice arrives in `hints`. The separate `advisories` field lists problems a command worked around while still succeeding.

### Agent file

An instruction file your coding agent reads when it works on your project. `discern refresh` writes one for each coding agent listed in `[project].agents`. Claude Code reads `CLAUDE.md`, Gemini reads `GEMINI.md`, and Codex, Cursor, and GitHub Copilot share `AGENTS.md`. Without that key, discern writes the files for Claude Code and Codex. Each file holds discern's built-in instructions, followed by your [instruction source](#instruction-source). When discern writes `AGENTS.md`, the other files import it instead of repeating it. Git tracks the files by default, so anyone who clones the project gets the same instructions. To change them, edit your instruction source and run `discern refresh`. The gate fails if an agent file no longer matches its source. See [agent instructions](../40-agent-instructions/).

### Checkpoint

A review question your project asks your agent whenever a certain kind of change happens. Each `[checkpoints.<id>]` table pairs a trigger, which picks out the changes it applies to, with a [question](#question) for your agent to judge. A `stop` checkpoint makes `discern done` refuse to run the [gate](#gate) until your agent records its answer: [declared met](#declared-met) or [declared unmet](#declared-unmet). An `advise` checkpoint offers its question as advice and blocks nothing. After an unmet answer the checks still run, but the change can't land until you approve a [variance](#variance). discern reads the checkpoints from the trunk as it was when the task started, or when the task last ran `discern update`. So a task can't rewrite the questions it has to answer. `discern checkpoints` shows which checkpoints apply and where each question stands, and changes nothing. See [checkpoints](../20-quality-gate/checkpoints.md).

### Coupling

Files that have often changed together in your project's Git history. If a change edits one file but not its usual partner, discern names the partner. Your agent then checks whether the partner needs a change too. discern does this after a passing `discern prepare` or `discern done`, unless you set `[coupling].report_in_gate = false`. `discern coupling` runs the same check on demand, and given a file name, it lists that file's usual partners. The finding is [advisory](#advisory) and never blocks, so your agent decides whether it matters. See [coupling](../20-quality-gate/coupling.md).

### Declaration

Your agent's recorded answer to a checkpoint [question](#question). For a question it judges satisfied, your agent runs `discern done --met <id>` with the checkpoint's id. For one that isn't, it runs `discern done --unmet <id> --why "…"` with a one-paragraph reason. discern accepts an answer only for a `stop` checkpoint whose question is open. The answer covers the checkpoint's question and the files it matched. If the question or those files change, discern asks again, and unrelated edits leave the answer standing. Changing an answer makes the [Proof](#proof) stale, even on the same commit. Proof shows each answer as [declared met](#declared-met) or [declared unmet](#declared-unmet). The gate checks that every required answer exists. It doesn't check whether the judgment is right.

### Declared met

Your agent's recorded answer that this change satisfies a checkpoint question. This [declaration](#declaration) covers the question and the matched files as they stood when your agent answered, and a change to either reopens it. The answer is your agent's judgment. discern records it but doesn't check whether it's right. A met answer needs no decision from you before the change lands.

### Declared unmet

Your agent's recorded answer that this change doesn't satisfy a checkpoint question, with its reason. The [gate](#gate) still runs. [Proof](#proof) carries the reason for you to review, and the change can't land until you approve a [variance](#variance). The reason stays in the Proof and, after landing, in the [Proof note](#proof-note), so it must hold no secrets. discern keeps the reason out of the [logbook](#logbook). If your agent fixes the problem, it can replace the answer with met.

### Desk

The interactive view that opens when you run `discern` in your main checkout. It shows every task in progress and what you can do with each. `discern desk` opens it too, and both need an interactive terminal. Run from a task's worktree, either command points you back to the main checkout instead. From the desk you can see the [fleet](#fleet), start a task, and act on the selected worktree. You can also open any configured coding agent installed on your `PATH`. Actions that can't run yet appear as unavailable, with the reason. The desk is the only place you can pre-authorize a task to land once green, or revoke that grant. See [the desk](../30-worktrees/the-desk.md).

### discern

A tool that lets you hand real work to coding agents and still decide what joins your project. It gives each task its own [worktree](#worktree) and runs your project's [gate](#gate) before a change counts as finished. It holds your quality limits, keeps what the project learns for later sessions, and lands a change only with permission. It's one self-contained program that needs only Git, and it has no AI model of its own. Your coding agent does the thinking and runs discern's commands.

### discern version

The version of discern you're running, shown by `discern --version`. `discern releases` opens discern's release notes in your browser, or prints their address, so you can see what's new and whether an upgrade is available. discern never checks the network for updates, and never updates itself. To upgrade, run the [installer](#installer) again, then restart your coding agent's sessions so they use the new program. `discern upgrade` then updates your project's setup to match.

### Effort

One task, carried from its first edit through review until it lands. A [worktree](#worktree), its branch, and its [submission](#submission) all belong to one effort. discern's results give each effort's id and branch, and its messages name the branch. An effort keeps the same worktree through review fixes and later sessions. The landing queue lists efforts by their submissions, and `discern accept` lands the selected effort's submission on the [trunk](#trunk). An effort can land more than once. If its branch has newer commits when a landing finishes, the worktree stays, and a later submission lands them.

### Engine

The part of discern that runs the everyday workflow inside a project. Its commands include `discern done`, `discern prepare`, `discern status`, `discern update`, and `discern accept`. The [installer](#installer) commands set a project up, and the engine's commands work inside it. Both parts are TypeScript, compiled into one program. The engine runs the jobs, scopes, standards, and worktree settings your project declares, so it works with any language or framework. It includes discern's formatter, [tidy](#tidy). See [engine internals](../50-engine-internals/).

### File ownership

The rules that decide which files, and which parts of files, discern may change in your project. Each file discern writes is [project-owned](#project-owned-file), [shared](#shared-file), or [generated](#generated-file). The category decides what setup, `discern refresh`, `discern upgrade`, and uninstalling may do to that file. A file a coding agent creates for itself, such as its local settings, sits outside these categories. discern never writes it, and only keeps it out of Git. See [files and ownership](../70-reference/artifact-ownership.md). The [install surface](../80-development/install-surface.md) lists every file.

### Fleet

All the task [worktrees](#worktree) in your project. The [desk](#desk) and `discern status` show the fleet from your main checkout, and `discern status --all` shows it from inside a task's worktree. The list also includes the main checkout and any integration worktree discern is using for a landing, each labeled. Each task worktree still belongs to its own effort when it's idle or has no changes. See [worktrees](../30-worktrees/).

### Gate

The full set of checks your project requires before a change counts as finished. `discern done` runs it on the task's committed work. It refuses to start while the worktree has uncommitted changes. It also stops if the branch is behind the trunk, or if a stop checkpoint is waiting for an answer. Then it runs discern's own checks, such as whether the agent files still match their source, and every one of your project's [jobs](#gate-job). It also runs the `gate` command of each [scope](#scope) the change touches, and measures every [standard](#standard). When something fails, the result names the check and gives a command that reproduces it. A pass means those checks passed on that commit, and nothing more. It doesn't give the change permission to land. See [the quality gate](../20-quality-gate/).

### Gate job

One named step the [gate](#gate) runs, such as your tests or your linter. Your project lists its jobs under `[jobs]` in `discern.toml`. Every job runs as part of every `discern done`, whatever the change touches. A job that declares its inputs can reuse an earlier result when none of them changed. A job named `format`, `build`, `lint`, `typecheck`, `test`, or `smoke` gets its [stage](#stage) from its name. Any other name makes a custom job, which declares its own stage. The gate also adds labeled jobs of its own: each `[generated.<name>]` command, the `gate` command of each [scope](#scope) the change touches, and each [standard](#standard)'s measurement. See [the quality gate](../20-quality-gate/).

### Generated artifact

A committed file that your project rebuilds from its own sources with a command. You declare its `paths` and its `run` command under `[generated.<name>]` in `discern.toml`. The command must produce the same bytes from the same sources. `discern prepare` runs it, so the files are current before the commit. `discern done` runs it too, and fails if that changes any committed file. When `discern update` hits a merge conflict only in declared generated paths, it resolves the conflict by running the command again. [Coupling](#coupling) leaves these paths out of its history. discern handles its own [generated files](#generated-file) the same way, so you don't declare them. See [the quality gate](../20-quality-gate/).

### Generated file

A file discern builds for your coding agents: an agent file or a skill folder. discern builds them from your own sources, such as your instruction source and skills, and from the instructions and skills it ships with. `discern refresh`, `discern upgrade`, and `discern prepare` rebuild them, so a direct edit gets replaced. The [gate](#gate) fails if a generated file no longer matches its source. To change one, edit its source instead. By default, Git tracks agent files and ignores the skill folders. See [agent files](#agent-file) and [skills](#skill).

### Improvement review

A review of your project as it stands, which finds the most useful next improvement. `discern improvement` scores the project's setup on a set of health checks and names one next action. It also lists [questions](#question) about existing work for you and your agent to judge, outside the score. They can find weaknesses a [checkpoint](#checkpoint) never sees, because checkpoints look only at new changes. The review is [advisory](#advisory) and never blocks `discern done` or `discern accept`. Its `--min-score` option makes the command fail when the score falls below a floor you choose. See [improvement](../20-quality-gate/improvement.md).

### Installer

The script that downloads the discern program, checks it, and installs it on your machine. Run it again to update the program. The same word also covers the commands that set discern up in a project and look after it. They include `discern setup`, `discern upgrade`, `discern config`, and [doctor](https://discern.sh/docs/reference/cli-reference#discern-doctor), which checks an installation without changing it. Each one runs and exits, and the software you build never needs discern to run. See [getting started](../10-getting-started/).

### Instruction source

The file where your project writes its own instructions for coding agents. `[instructions].sources` lists it, and the default is `discern/instructions.md`. The list can name several files or glob patterns, and discern skips any file that's missing. When discern builds the [agent files](#agent-file), it puts its built-in instructions first and yours after them, and yours win where the two conflict. See [agent instructions](../40-agent-instructions/).

### Integration worktree

A temporary copy of the project where discern checks a change combined with newer work before landing it. discern creates this [worktree](#worktree) during a landing when other work has reached the [trunk](#trunk) since the [submission](#submission)'s Proof, and the submitted commit doesn't include it. The copy starts from the submitted commit, with the same setup and resources a task worktree gets, and merges in the current trunk. discern runs the full gate on the combined code and lands exactly what passed. If the combined code fires a checkpoint, your agent answers it with `discern accept`, and the same landing carries on. If the changes conflict or a combined check fails, nothing lands. discern removes the copy and hands the problem back to the task's agent. After a landing, discern removes the copy, its resources, and its `integration/` branch. discern records that it owns each copy, so an agent must never adopt one as its own task. If the process that owns a copy dies, `discern worktree prune` cleans it up, and it leaves copies still in use alone. See [worktrees](../30-worktrees/).

### Landing authority

Permission for a change to land on the [trunk](#trunk), your project's shared branch. You can give it in the current conversation, and your agent records your yes with `discern accept --confirmed`. A standing grant gives it in advance: the trunk's `[acceptance].pre_authorized` names scopes, such as documentation, whose changes may land without asking. A standing grant covers a change only when every file the change touches falls inside a granted scope. A grant for one task, which you record from the [desk](#desk), covers every file in that task. It still covers the task after review fixes, once its agent submits the new version, and landing uses it up. Until then you can revoke it from the desk, and it disappears with the worktree. No grant covers a [variance](#variance), a change to a [standard](#standard)'s limit, or an emergency landing. A passing [Proof](#proof) shows which checks passed, and never gives permission to land. See [landing authority](../30-worktrees/landing-authority.md).

### Logbook

discern's local record of what each command did and how long it took. Recording is on by default. While it's on, and discern can read `discern.toml`, each discern command adds an entry. So does each tool call through the Model Context Protocol (MCP). An entry holds details such as timing and outcome, and names such as the branch and file paths. It never holds your code or command output. All worktrees share one logbook inside `.git`, and discern has no way to send it anywhere else. Set `[project].record_logbook = false` to stop recording. See [the logbook](../70-reference/the-logbook.md).

### Map

Your project's own guide to how its software works and why, which your agents write and keep current. It lives in `[map].dir`, which defaults to `discern/map`, and `discern map` browses, reads, and searches it. Read it to understand the project, and correct anything the agents got wrong. The gate checks the map's mechanics, such as its links, headings, and command examples. What the pages say is up to the people and agents who write them. A page with `publish: false` in its frontmatter stays out of every published copy ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). `discern map` and your agents can still read it. Pointing `[map].dir` at docs you already have gives discern permission to manage them ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).

### Migration

A numbered step that updates your project's discern setup to a newer format. A step can change `discern.toml`, rename or remove files, or merge a coding agent's settings files. `discern upgrade` runs any pending migrations in order, one [schema version](#schema-version) at a time. Running a migration again doesn't repeat its effect. discern checks that the updated configuration is valid before it records the new version. `discern upgrade` refuses to run with uncommitted changes unless you pass `--allow-dirty`, so Git can undo an upgrade. See [upgrading discern](../10-getting-started/upgrade-discern.md).

### Namespace

The folder that holds your project's own discern content, `discern/` by default. It holds the [map](#map), your [instruction source](#instruction-source), your own [skills](#skill) and [project scripts](#project-script), the project brief from setup, and the `TODO.md` list of deferred work. Everything in it belongs to your project. Configuration can move each of these except the brief, which stays at `discern/brief.md` ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). `discern.toml` stays at the project root.

### Open question

discern's record that a stop checkpoint has asked your agent a question about a task. `discern done` opens one when a `stop` [checkpoint](#checkpoint) fires, and so does `discern accept` when the combined code fires one during a landing. The record names the checkpoint and the files it matched, and tracks each later [declaration](#declaration) or reopening. Its state is waiting for an answer, declared met, declared unmet, or reopened. Once it's open, the question still needs an answer even if the trigger stops matching. discern keeps the record in the worktree's Git administration folder, so it survives a session restart and goes away with the worktree. `discern checkpoints` shows its state without changing it. See [checkpoint state and declarations](../70-reference/checkpoint-state.md).

### Patterns

discern's report on what keeps happening in your project's work, read from its local history. `discern patterns` reads the [logbook](#logbook) for patterns such as repeated gate failures, avoidable steps, slow checks, and changes in [standard](#standard) measurements. Each finding gives its counts, with the total they came from, and a next step. When the logbook doesn't hold enough evidence, the report says so. `discern patterns --stats` shows what went well instead. The report is [advisory](#advisory), and it has nothing to report when the project doesn't record a logbook. See [practice patterns](../20-quality-gate/patterns.md).

### Placement is consent

The rule that putting content where discern manages it gives discern and your agents permission to maintain it. The default locations carry that permission, and your agents treat anything stale there as a problem to fix. Pointing a configuration key at another location grants it explicitly, because you chose the path. The rule covers only the content discern manages. Your agent's other work and your project's jobs run under their own permissions. See [design principles](design-principles.md) and [files and ownership](../70-reference/artifact-ownership.md).

### Practice

The way of working discern sets up in your project, which carries over from one session to the next. Each session starts with the project's instructions. Each task gets its own [worktree](#worktree), passes your project's [gate](#gate), meets your [standards](#standard), and finishes with [Proof](#proof) of which checks passed. Nothing lands without [landing authority](#landing-authority) that you control. Bundled [skills](#skill) guide your agents as they delegate work, keep what the project learns, and fix problems at their cause. You set the direction and make the decisions that matter, and your agents run the workflow. See [the practice](the-practice.md).

### Progress handle

A short code, such as `R1-XXXX-XXXX-XX`, that lets your agent read back a long-running command after losing track of it. discern records one for each long operation, such as `discern done` or `discern accept`. `discern progress <handle>`, or the `discern_progress` tool, shows that operation's phase, the counts and failures known so far, and its result once it finishes. An MCP client that asks for progress updates gets the handle first. Terminal output, `--json`, and `--markdown` don't show it. Without a handle, `discern progress` reads the latest operation in the current checkout. Reading progress starts, repeats, and cancels nothing. To resume a wait, your agent uses the `C1` continuation that `discern await` returns. See [progress and reconnect](../70-reference/progress-and-reconnect.md).

### Project script

A procedure your project provides for its agents and maintainers to run. Each script is an executable file in any language, placed directly in `[scripts].dir`, which defaults to `discern/scripts`. `discern scripts` lists them, and `discern scripts <name>` runs one from the project root. discern gives each script its own `DISCERN_*` values, such as `DISCERN_ROOT` and `DISCERN_TRUNK`, and removes any it inherited. Scripts have a command of their own, so a script can share its name with a built-in discern command ([ADR 0137](../_adr/0137-project-scripts-live-under-the-script-command.md)).

### Project-owned file

A file that belongs to your project, even when discern created its first copy. `discern upgrade` never overwrites it. Examples include your [map](#map) pages, instruction source, skills, project scripts, and list of deferred work, in the [namespace](#namespace) or wherever your configuration puts them. `discern.toml` isn't one: it's a [shared file](#shared-file).

### Proof

discern's record of which of your project's checks passed, on exactly which commit. `discern done` records it when every check passes on the latest commit in the task's worktree, with nothing left uncommitted. It holds the check results, the [standards](#standard) that held, and your agent's checkpoint answers. The Proof line sums it up, and `discern status --verbose` shows the full record. Any later edit makes the Proof stale, and so does a changed checkpoint answer or limit proposal. The new version then needs its own `discern done`. A newer trunk doesn't make Proof stale. A check whose inputs haven't changed can reuse its earlier result. Proof shows what passed, and it never gives a change [landing authority](#landing-authority). See [how to read a Proof](../20-quality-gate/the-proof.md).

### Proof note

A copy of a landed change's [Proof](#proof), stored with its commit in Git. When a change lands, discern writes its Proof as a Git note on the landed commit, under `refs/notes/discern`. The note also records who allowed the landing, including any [variance](#variance) and its reason. Anyone with the repository can later look up which checks passed for that commit. The note is a JSON record in a Dead Simple Signing Envelope (DSSE). Its payload names the full commit, and the envelope keeps the exact payload bytes so a future version can add signatures. discern doesn't sign notes yet, so their list of signatures is empty. Notes stay in your local repository. Setting `[repository].proof_notes_mode = "fetch"` also fetches them from your remotes, and only an explicit `git push` shares them. An emergency landing writes an exception record there instead of Proof. See [Proof notes](../20-quality-gate/proof-notes.md).

### Question

Something discern asks your agent to judge, about a change or about the project as a whole. [Checkpoints](#checkpoint) ask questions when a change matches their triggers, and your agent records each answer as [declared met](#declared-met) or [declared unmet](#declared-unmet). The [improvement review](../20-quality-gate/improvement.md) asks questions about work that already exists, and leaves them open for you and your agent to weigh. A question can carry a `teach` note that says why it matters. Proof keeps checkpoint answers apart from the results of the checks discern runs. See [checkpoints](../20-quality-gate/checkpoints.md).

### Schema version

The version number of your project's discern setup format. discern stores it as `[meta].schema_version` in `discern.toml` and changes it itself, so don't edit it by hand. Each [migration](#migration) moves it up by one, and `discern upgrade` runs any that are pending. Many discern releases leave it unchanged. If the number is newer than your copy of discern understands, discern refuses to work on the project until you install a newer version.

### Scope

A named area of your project, such as its documentation, defined by path patterns. Each `[scopes.<name>]` entry lists its patterns and can give a `gate` command, which runs only when a change touches that area. Standing grants and checkpoint triggers can name scopes too. Every job in `[jobs]` still runs on every change. A path outside every scope fires no scope's `gate` command, and no standing grant covers it. If discern can't tell what changed, it runs every scope's `gate` command. `discern map --export <name>` can also use a scope as an ordered reading list. See [the quality gate](../20-quality-gate/).

### Shared file

A file where discern maintains some parts and your project owns the rest. discern's ownership registry classifies as shared any registered path where discern maintains a marked region, named entries, or a fixed outline. discern leaves your content around them alone. Examples include discern's block in `.gitignore`, its entries in a coding agent's settings, and `discern.toml`, where `discern upgrade` adds any missing sections and keys. The [registered project paths](https://discern.sh/docs/reference/files-and-ownership#registered-project-paths) table lists every one.

### Skill

A ready-made playbook that tells your agent how to handle a particular kind of task. Each skill is a folder with a `SKILL.md` file. discern comes with bundled skills whose names start with `discern-`. You can add your own in `[skills].dir`, which defaults to `discern/skills`, and one of yours with a bundled skill's name replaces it. `discern skills eject <name>` copies a bundled skill there for you to change, and that copy stops getting discern's updates. `discern refresh` makes the selected skills available to each configured coding agent. `discern skills list` shows every skill, including the ones `[skills].exclude` leaves out. See [skills](../45-skills/).

### Stage

A group in the order the [gate](#gate) runs its work. The stages are `fix`, `build`, `check`, and `test`. A known [job](#gate-job) gets its stage from its name, and a custom job declares its own. `fix` jobs run first, one at a time, and may change files. `build` jobs run next, and `check` and `test` jobs then run side by side. A failed result can also name a check outside these stages, such as `merge` or `standards`.

### Standard

A measured limit your project holds, such as a maximum download size or a minimum test coverage. Each `[standards.<name>]` entry sets a `direction`: `up` for a floor, which can only rise, or `down` for a ceiling, which can only fall. The gate measures every standard and compares it with its limit, reusing an earlier measurement when none of its inputs changed. It also compares the limit and what gets measured with the trunk's current configuration. So a branch can't weaken, delete, or redefine a standard to make its own work pass. `discern prepare` doesn't measure standards. When a measure improves, `discern standards --pin` tightens the limit to lock in the gain. Only you can approve a looser limit. Your agent proposes it with `discern standards propose`, and you approve that exact proposal before the change lands. No grant covers it. See [standards](../20-quality-gate/standards.md).

### Stop / advise

The setting that decides whether a [checkpoint](#checkpoint) waits for an answer or only gives advice. With `stop`, `discern done` refuses to run the [gate](#gate) until your agent records its answer. With `advise`, the question appears as a notice in `discern prepare`, `discern done`, and `discern status`, blocks nothing, and takes no answer. A checkpoint you write stops unless it says otherwise. A built-in checkpoint keeps the mode discern gives it. The built-ins that watch code changes advise, and the ones that watch project knowledge, such as the map, instructions, and skills, stop. After a [declared unmet](#declared-unmet) answer the checks still run, but the change needs your [variance](#variance) before it lands.

### Submission

Your agent's recorded request to land one exact commit. `discern accept` records the submission and starts landing it. `discern accept queue` only records it, and refuses if the Proof holds an unmet checkpoint answer or a proposed limit change. Your agent runs either one from the task's worktree, or names the task with `--target`. The submission names the task's branch, the commit, and the [Proof](#proof) that covers it. discern stores it beside any one-task grant, in the worktree's Git administration folder, where nothing committed on a branch can change it. A later explicit submission from the same task replaces it. A new commit or new Proof on its own doesn't. Landing uses the submission up, and removing the worktree deletes it. The landing queue lists every submission that hasn't landed, pre-authorized ones first, and says why any of them is waiting. A change that passed its checks but was never submitted isn't in the queue. It lands only when you act on it yourself. See [landing authority](../30-worktrees/landing-authority.md).

### Tidy

discern's formatter for the Markdown files it manages and for `discern.toml`. `discern tidy` formats every Markdown page in the [map](#map), the list of deferred work, and your [instruction sources](#instruction-source). It also checks that box-drawing diagrams stay aligned, and it refuses a file whose tables or frontmatter it can't format safely. It doesn't format your source code. New installations run it in the `format` [job](#gate-job), and removing it from that job opts out. See [formatting with tidy](../20-quality-gate/tidy.md).

### Tip

A short, practical suggestion that the [desk](#desk) shows on one line below its main view. The line starts with `Tip:`. The desk picks one tip when it opens and keeps it until you leave. Press `t` to read the full tip. Each tip only teaches, and every action works without it. When recording is on, the desk notes which tip it showed in the [logbook](#logbook). Advice for agents comes in their command results instead. See [desk tips](../30-worktrees/desk-tips.md).

### Trunk

Your project's shared branch, usually `main`, where finished changes land. `[repository].trunk` names it, and `DISCERN_TRUNK` overrides it for one command. By default, each new task branches from the trunk, and a task brings in the trunk's newer changes with `discern update`. `discern accept` moves the trunk forward, and only by fast-forward. If the submitted commit already includes the trunk's latest commit, the trunk moves to the submitted commit. Otherwise discern combines the submission with the current trunk in an [integration worktree](#integration-worktree), checks the result, and moves the trunk to that proven combination.

### Update

`discern update` brings the latest work from your project's shared branch into a task's [worktree](#worktree). It merges the latest [trunk](#trunk) into the task's branch, then rebuilds generated files and refreshes the agent files and skills. It runs only in a task's worktree, and only when the worktree has no uncommitted changes. If the merge conflicts, it stops and changes nothing, unless the conflicts are only in generated files, which it rebuilds. With `--from <ref>`, it brings in another source instead, such as another task's unlanded work. The result lists files that both sides changed, so your agent can re-read them. Changes can merge cleanly and still clash. See [worktrees](../30-worktrees/).

### Variance

Your permission to land a change even though your agent answered a checkpoint question unmet. Only you can approve one, in the current conversation. General permission to land doesn't cover it, and neither does any grant. Your agent records your approval with `discern accept --confirmed --variance <id>`, naming every unmet checkpoint. The variance covers that exact [declaration](#declaration), its reason, and the commit that lands. The checkpoint keeps asking its question of later work. See [checkpoints](../20-quality-gate/checkpoints.md).

### Worktree

A separate copy of your project, on its own branch, where one task's work happens. Your agent creates one from your main checkout with `discern start`, and its branch starts from the trunk by default. Work in it stays apart from your main checkout and from other tasks. The task keeps the same worktree through review fixes and later sessions. discern never slips other work into a worktree, and never hands one to another task, even when it's idle. Each worktree gets its own port and any [resources](#worktree-resource) your project declares. `discern enter` opens a shell in the worktree you choose. When the change lands, discern removes the worktree, its resources, and its branch. The worktree stays if it holds uncommitted files, or if its branch has commits beyond the landed [submission](#submission). See [worktrees](../30-worktrees/).

### Worktree resource

Something one worktree needs of its own, such as a test database, an emulator, or a container. You declare each one under `[worktree.resources.<name>]`, with `create` and `destroy` commands and an optional `ensure` command. discern runs `create` when it first sets up a worktree, and `ensure` on later setups instead of creating the resource again. It runs `destroy` when the worktree goes away, such as after landing. If a worktree leaves a resource behind, `discern worktree prune` removes it, but only when discern can prove no live worktree owns it. See [worktree resources](../30-worktrees/the-resources.md).
