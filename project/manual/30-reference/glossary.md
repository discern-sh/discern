---
id: reference-glossary
title: "Glossary"
description: "Look up discern terms, understand their meaning, and find the next useful explanation."
order: 10
publish: true
kind: reference
aliases:
  - "reference-glossary"
  - "terms"
  - "definitions"
  - "vocabulary"
  - "dictionary"
  - "accept"
  - "advisory"
  - "agent file"
  - "checkpoint"
  - "declaration"
  - "desk"
  - "discern"
  - "discern version"
  - "effort"
  - "engine"
  - "file ownership"
  - "fleet"
  - "gate job"
  - "generated artifact"
  - "generated file"
  - "improvement review"
  - "installer"
  - "instruction source"
  - "integration worktree"
  - "migration"
  - "namespace"
  - "placement is consent"
  - "progress handle"
  - "project script"
  - "project-owned file"
  - "question"
  - "schema version"
  - "scope"
  - "shared file"
  - "stage"
  - "standard"
  - "stop / advise"
  - "tip"
  - "trunk"
  - "update"
  - "worktree resource"
---

<!-- This reference is generated from the product-term registry. -->

# Glossary

If a result or guide uses an unfamiliar word, start here. Each definition explains its meaning and links to more detail.

Entries are alphabetical. Use the letters below or search this page for the word you need.

Jump to: [A](#accept) · [C](#checkpoint) · [D](#declaration) · [E](#effort) · [F](#file-ownership) · [G](#gate) · [I](#improvement-review) · [L](#landing-authority) · [M](#map) · [N](#namespace) · [O](#open-question) · [P](#patterns) · [Q](#question) · [S](#schema-version) · [T](#tidy) · [U](#update) · [V](#variance) · [W](#worktree)

### Accept

`discern accept` lands a finished change on your project's shared branch once the change has permission to land. Your agent runs it from the task's worktree, where it first records the task's [submission](#submission): the exact commit that passed the gate. From your main checkout, your agent names the task with `--target`, and discern lands its recorded submission. The change lands on the [trunk](#trunk) if you approved it in the conversation or a grant covers it. Without permission, nothing lands, and the submission waits for you. If other work landed after the change's Proof and the submitted commit doesn't include it, discern combines the two in an [integration worktree](#integration-worktree). It checks the combined code and lands exactly what passed. If another landing is already running, this one waits its turn and then carries on by itself. With `--target`, discern then keeps landing queued tasks that a grant covers, in order, until one needs you. After landing, discern records the Proof note, updates your main checkout, and removes the task's worktree, resources, and branch. The worktree stays if it holds uncommitted files or its branch has newer commits. See [worktrees](../20-understand/worktrees-and-trunk.md) and [landing authority](../20-understand/proof.md).

### Advisory

Advice from discern about where to look, which never blocks your work. [Coupling](../20-understand/evidence-and-improvement.md), [patterns](../20-understand/evidence-and-improvement.md), [impact](https://discern.sh/docs/reference/cli-reference#discern-impact), and [improvement](../10-guides/improve-the-practice.md) all give advice, and so do `advise` checkpoints. A finding can prompt your agent to investigate, and it never fails a [gate](#gate) check. In discern's results, advice arrives in `hints`. The separate `advisories` field lists problems a command worked around while still succeeding.

### Agent file

An instruction file your coding agent reads when it works on your project. `discern refresh` writes one for each coding agent listed in `[project].agents`. Claude Code reads `CLAUDE.md`, Gemini reads `GEMINI.md`, and Codex, Cursor, and GitHub Copilot share `AGENTS.md`. Without that key, discern writes the files for Claude Code and Codex. Each file holds discern's built-in instructions, followed by your [instruction source](#instruction-source). When discern writes `AGENTS.md`, the other files import it instead of repeating it. Git tracks the files by default, so anyone who clones the project gets the same instructions. To change them, edit your instruction source and run `discern refresh`. The gate fails if an agent file no longer matches its source. See [agent instructions](../10-guides/write-project-instructions.md).

### Checkpoint

A review question your project asks your agent whenever a certain kind of change happens. Each `[checkpoints.<id>]` table pairs a trigger, which picks out the changes it applies to, with a [question](#question) for your agent to judge. A `stop` checkpoint makes `discern done` refuse to run the [gate](#gate) until your agent records its answer: [declared met](#declared-met) or [declared unmet](#declared-unmet). An `advise` checkpoint offers its question as advice and blocks nothing. After an unmet answer the checks still run, but the change can't land until you approve a [variance](#variance). discern reads the checkpoints from the trunk as it was when the task started, or when the task last ran `discern update`. So a task can't rewrite the questions it has to answer. `discern checkpoints` shows which checkpoints apply and where each question stands, and changes nothing. See [checkpoints](../20-understand/checkpoints.md).

### Coupling

Files that have often changed together in your project's Git history. If a change edits one file but not its usual partner, discern names the partner. Your agent then checks whether the partner needs a change too. discern does this after a passing `discern prepare` or `discern done`, unless you set `[coupling].report_in_gate = false`. `discern coupling` runs the same check on demand, and given a file name, it lists that file's usual partners. The finding is [advisory](#advisory) and never blocks, so your agent decides whether it matters. See [coupling](../20-understand/evidence-and-improvement.md).

### Declaration

Your agent's recorded answer to a checkpoint [question](#question). For a question it judges satisfied, your agent runs `discern done --met <id>` with the checkpoint's id. For one that isn't, it runs `discern done --unmet <id> --why "…"` with a one-paragraph reason. discern accepts an answer only for a `stop` checkpoint whose question is open. The answer covers the checkpoint's question and the files it matched. If the question or those files change, discern asks again, and unrelated edits leave the answer standing. Changing an answer makes the [Proof](#proof) stale, even on the same commit. Proof shows each answer as [declared met](#declared-met) or [declared unmet](#declared-unmet). The gate checks that every required answer exists. It doesn't check whether the judgment is right.

### Declared met

Your agent's recorded answer that this change satisfies a checkpoint question. This [declaration](#declaration) covers the question and the matched files as they stood when your agent answered, and a change to either reopens it. The answer is your agent's judgment. discern records it but doesn't check whether it's right. A met answer needs no decision from you before the change lands.

### Declared unmet

Your agent's recorded answer that this change doesn't satisfy a checkpoint question, with its reason. The [gate](#gate) still runs. [Proof](#proof) carries the reason for you to review, and the change can't land until you approve a [variance](#variance). The reason stays in the Proof and, after landing, in the [Proof note](#proof-note), so it must hold no secrets. discern keeps the reason out of the [logbook](#logbook). If your agent fixes the problem, it can replace the answer with met.

### Desk

The interactive view that opens when you run `discern` in your main checkout. It shows every task in progress and what you can do with each. `discern desk` opens it too, and both need an interactive terminal. Run from a task's worktree, either command points you back to the main checkout instead. From the desk you can see the [fleet](#fleet), start a task, and act on the selected worktree. You can also open any configured coding agent installed on your `PATH`. Actions that can't run yet appear as unavailable, with the reason. The desk is the only place you can pre-authorize a task to land once green, or revoke that grant. See [the desk](../10-guides/coordinate-parallel-tasks.md).

### discern

A tool that lets you hand real work to coding agents and still decide what joins your project. It gives each task its own [worktree](#worktree) and runs your project's [gate](#gate) before a change counts as finished. It holds your quality limits, keeps what the project learns for later sessions, and lands a change only with permission. It's one self-contained program that needs only Git, and it has no AI model of its own. Your coding agent does the thinking and runs discern's commands.

### discern version

The version of discern you're running, shown by `discern --version`. `discern releases` opens discern's release notes in your browser, or prints their address, so you can see what's new and whether an upgrade is available. discern never checks the network for updates, and never updates itself. To upgrade, run the [installer](#installer) again, then restart your coding agent's sessions so they use the new program. `discern upgrade` then updates your project's setup to match.

### Effort

One task carried through implementation and review: the work a [worktree](#worktree), its branch, and its [submission](#submission) all belong to. Results name an effort by its branch. An effort keeps one worktree across feedback and resumed sessions; the landing queue lists efforts by their submissions, and `discern accept` lands the selected effort's submitted commit on the [trunk](#trunk).

### Engine

The part of discern that runs the everyday workflow inside a project. Its commands include `discern done`, `discern prepare`, `discern status`, `discern update`, and `discern accept`. The [installer](#installer) commands set a project up, and the engine's commands work inside it. Both parts are TypeScript, compiled into one program. The engine runs the jobs, scopes, standards, and worktree settings your project declares, so it works with any language or framework. It includes discern's formatter, [tidy](#tidy). See [engine internals](https://github.com/discern-sh/discern/tree/main/project/map/50-engine-internals/).

### File ownership

The rules that decide which files, and which parts of files, discern may change in your project. Each file discern writes is [project-owned](#project-owned-file), [shared](#shared-file), or [generated](#generated-file). The category decides what setup, `discern refresh`, `discern upgrade`, and uninstalling may do to that file. A file a coding agent creates for itself, such as its local settings, sits outside these categories. discern never writes it, and only keeps it out of Git. See [files and ownership](files-and-ownership.md). The [install surface](https://github.com/discern-sh/discern/blob/main/project/map/80-development/install-surface.md) lists every file.

### Fleet

The project's collection of task [worktrees](#worktree). The [desk](#desk) and `discern status` show it from the main checkout; `discern status --all` includes it from a task worktree. A listed worktree still belongs to its effort even when it is idle or clean. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Gate

The configured checks a change must satisfy for ordinary completion. `discern done` runs this workflow: preconditions, declared [jobs](#gate-job), applicable [scope](#scope) gates, required [standards](#standard), and required checkpoint declarations. Failures identify the check and the next action. Passing establishes the stated checks for the validated change, not permission to land it. See [the quality gate](../20-understand/proof.md).

### Gate job

One named step the [gate](#gate) runs, such as your tests or your linter. Your project lists its jobs under `[jobs]` in `discern.toml`. Every job runs as part of every `discern done`, whatever the change touches. A job that declares its inputs can reuse an earlier result when none of them changed. A job named `format`, `build`, `lint`, `typecheck`, `test`, or `smoke` gets its [stage](#stage) from its name. Any other name makes a custom job, which declares its own stage. The gate also adds labeled jobs of its own: each `[generated.<name>]` command, the `gate` command of each [scope](#scope) the change touches, and each [standard](#standard)'s measurement. See [the quality gate](../20-understand/proof.md).

### Generated artifact

A committed file that a declared command rebuilds from the project's sources. Declare its paths and deterministic generator under `[generated.<name>]` in `discern.toml`. The [gate](#gate) checks for drift. `discern update` resolves conflicts confined to declared generated paths by regenerating, and [coupling](#coupling) excludes those paths from its evidence. discern's own [generated files](#generated-file) form a built-in group and need no separate declaration. See [the quality gate](../20-understand/proof.md).

### Generated file

An agent instruction file or materialized skill that discern builds from an authored source. Edit the source and regenerate; direct edits to the generated copy can be replaced. The [gate](#gate) checks these outputs against their sources. See [agent files](#agent-file) and [skills](#skill).

### Improvement review

A review of the project as it exists now, using questions the agent judges. `discern improvement` serves these [questions](#question) alongside rules for where project knowledge belongs. It can uncover existing weaknesses that a new-change [checkpoint](#checkpoint) would not reach. The findings are [advisory](#advisory). See [improvement](../10-guides/improve-the-practice.md).

### Installer

The commands that set up and maintain discern in a project. They include `setup`, `upgrade`, [doctor](https://discern.sh/docs/reference/cli-reference#discern-doctor), and `config`. Some inspect and some change files; each runs and exits. The application does not need discern to run. See [getting started](../00-start/README.md).

### Instruction source

The project's authored instructions for coding agents. Their paths are named by `[instructions].sources` (default `discern/instructions.md`). discern prepends its built-in instructions when compiling the agent files; your project instructions follow them. Covered in [agent instructions](../10-guides/write-project-instructions.md).

### Integration worktree

A temporary copy of the project where discern checks a change combined with newer work before landing it. discern creates this [worktree](#worktree) during a landing when other work has reached the [trunk](#trunk) since the [submission](#submission)'s Proof, and the submitted commit doesn't include it. The copy starts from the submitted commit, with the same setup and resources a task worktree gets, and merges in the current trunk. discern runs the full gate on the combined code and lands exactly what passed. If the combined code fires a checkpoint, your agent answers it with `discern accept`, and the same landing carries on. If the changes conflict or a combined check fails, nothing lands. discern removes the copy and hands the problem back to the task's agent. After a landing, discern removes the copy, its resources, and its `integration/` branch. discern records that it owns each copy, so an agent must never adopt one as its own task. If the process that owns a copy dies, `discern worktree prune` cleans it up, and it leaves copies still in use alone. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Landing authority

Permission for a particular change to join the [trunk](#trunk). It can come from the current conversation, a standing scope grant on the trunk, or an effort grant recorded from the [desk](#desk), which covers the effort's branch so any later green `done` on it is covered once its agent submits it. Acceptance checks the permission against the changed paths of the submitted commit. A passing [Proof](#proof) is evidence, not permission. See [landing authority](../20-understand/proof.md).

### Logbook

The local record of the project's use of discern. With recording enabled and a readable `discern.toml`, each CLI verb run and project-resolved Model Context Protocol (MCP) invocation adds metadata such as timing and outcome. It does not record code or command output. Worktrees share the record under `.git`; discern has no network path that sends it elsewhere. `[project].record_logbook = false` stops recording. See [the logbook](logbook.md).

### Map

The project's account of how its software works and why. Agents maintain this documentation at `[map].dir` (default `discern/map`). You can read it to understand the project and correct what agents have recorded. The gate checks configured documentation requirements; authors remain responsible for its meaning. `publish: false` in a page's frontmatter withholds it from every published surface ([ADR 0140](https://discern.sh/docs/decisions/0140-validated-frontmatter-and-the-publish-predicate)). Pointing `[map].dir` at existing docs is explicit consent to manage them ([ADR 0100](https://discern.sh/docs/decisions/0100-project-map-is-the-agents-map), [ADR 0195](https://discern.sh/docs/decisions/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths)).

### Migration

A numbered step that updates a project's discern configuration format. `discern upgrade` runs the pending steps in order from one [schema version](#schema-version) to the next. Each step can be repeated without duplicating its intended effect. The command validates the updated configuration before recording the new version. See [Upgrade discern](../10-guides/maintain-or-remove-discern.md).

### Namespace

The default directory for the project's authored discern content. The visible `discern/` directory holds the [map](#map), your [instruction source](#instruction-source), authored [skills](#skill), [project scripts](#project-script), the project brief, and the `TODO.md` ledger. Its contents are authored sources; configuration can place them elsewhere ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace), [ADR 0195](https://discern.sh/docs/decisions/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths)).

### Open question

discern's record that a stop checkpoint has asked your agent a question about a task. `discern done` opens one when a `stop` [checkpoint](#checkpoint) fires, and so does `discern accept` when the combined code fires one during a landing. The record names the checkpoint and the files it matched, and tracks each later [declaration](#declaration) or reopening. Its state is waiting for an answer, declared met, declared unmet, or reopened. Once it's open, the question still needs an answer even if the trigger stops matching. discern keeps the record in the worktree's Git administration folder, so it survives a session restart and goes away with the worktree. `discern checkpoints` shows its state without changing it. See [checkpoint state and declarations](proof-and-checkpoint-formats.md).

### Patterns

Findings about recurring behavior in the project's recorded use of discern. `discern patterns` reads the [logbook](#logbook) for such patterns as repeated gate failures, avoidable workflow steps, and changes in [standard](#standard) measurements. Each finding states its supporting counts and a next step. It is [advisory](#advisory); when evidence is insufficient, it says so. See [practice patterns](../20-understand/evidence-and-improvement.md).

### Placement is consent

Choosing a managed source location authorizes discern to maintain that content. The default source locations carry that permission; pointing a configuration key at another location gives it explicitly. This governs discern's managed content, not every command an agent or project job may run. See [design principles](https://github.com/discern-sh/discern/blob/main/project/map/00-orientation/design-principles.md) and [files and ownership](files-and-ownership.md).

### Practice

The connected way of working discern installs and the project carries between sessions. Tasks use separate [worktrees](#worktree), configured [gate](#gate) checks, held [standards](#standard), exact completion [Proof](#proof), and owner-controlled [landing authority](#landing-authority). Bundled [skills](#skill) guide delegation, lasting project knowledge, and improvements that address a problem's cause. You direct the work and make the consequential decisions; your agents operate the workflow. See [the practice](../20-understand/how-discern-works.md).

### Progress handle

The short `R1-XXXX-XXXX-XX` code recorded for a long operation and announced to MCP callers. `discern progress <handle>`, or the `discern_progress` tool, reads that operation back after a lost call: its phase, the counts and failures known so far, and the retained result. Human command output omits the startup announcement; `discern progress` without a handle finds the latest operation. It only reads; the `C1` continuation that `discern await` returns is what resumes a wait. See [progress and reconnect](https://github.com/discern-sh/discern/blob/main/project/map/70-reference/progress-and-reconnect.md).

### Project script

A runnable procedure the project supplies for its agents and maintainers. It lives under `[scripts].dir` (default `discern/scripts`), run as `discern scripts <name>` with `DISCERN_*` exported. Scripts occupy their own namespace, so built-in verb names stay legal ([ADR 0137](https://discern.sh/docs/decisions/0137-project-scripts-live-under-the-script-command)).

### Project-owned file

A file whose ongoing contents belong to the project. discern may create an initial copy, but `discern upgrade` does not overwrite it. Examples include authored [map](#map) pages, instructions, the deferred-work ledger, and skills in the [namespace](#namespace).

### Proof

discern's completion evidence for the exact committed change it validated. `discern done` records machine results, held [standards](#standard), and declared checkpoint judgments for the committed tip of the invoking worktree. The Proof line summarizes that evidence; `discern status --verbose` retrieves the full page. Evidence whose inputs are unchanged can be reused, but a later commit needs current validation. Proof does not grant [landing authority](#landing-authority). See [the Proof](../20-understand/proof.md).

### Proof note

A durable copy of landed [Proof](#proof), attached to the commit in Git. The JSON record lives under `refs/notes/discern`. Its Dead Simple Signing Envelope (DSSE) binds the full commit and preserves the payload bytes for future signatures; current notes use an unsigned extension with an empty signatures array. Recording is local by default, fetching is opt-in, and publishing requires an explicit Git push. See [Proof notes](proof-and-checkpoint-formats.md).

### Question

Something discern asks your agent to judge, about a change or about the project as a whole. [Checkpoints](#checkpoint) ask questions when a change matches their triggers, and your agent records each answer as [declared met](#declared-met) or [declared unmet](#declared-unmet). The [improvement review](../10-guides/improve-the-practice.md) asks questions about work that already exists, and leaves them open for you and your agent to weigh. A question can carry a `teach` note that says why it matters. Proof keeps checkpoint answers apart from the results of the checks discern runs. See [checkpoints](../20-understand/checkpoints.md).

### Schema version

The version number of the project's discern configuration format. `[meta].schema_version` identifies the current step in the [migration](#migration) sequence. It changes when an installation needs a format migration; a new discern release does not necessarily change it.

### Scope

A named set of project paths used to select work or policy. A `[scopes.<name>]` entry declares path patterns and can provide a `gate` command for changes in that area. Unclassified paths still count as code changes, so missing classification does not skip them. `discern map --export <name>` can also use a scope as an ordered reading list. See [the quality gate](../20-understand/proof.md).

### Shared file

A file where discern maintains some parts and your project owns the rest. discern's ownership registry classifies as shared any registered path where discern maintains a marked region, named entries, or a fixed outline. discern leaves your content around them alone. Examples include discern's block in `.gitignore`, its entries in a coding agent's settings, and `discern.toml`, where `discern upgrade` adds any missing sections and keys. The [registered project paths](https://discern.sh/docs/reference/files-and-ownership#registered-project-paths) table lists every one.

### Skill

A reusable playbook that tells an agent how to handle a particular kind of task. Skills use `SKILL.md` files. discern ships bundled skills prefixed `discern-`; you can add your own under `[skills].dir` or override a bundled skill with the same name. `discern refresh` makes the selected set available to configured agents, `discern skills list` shows it, and `[skills].exclude` omits named skills. See [skills](../10-guides/create-and-manage-skills.md).

### Stage

A group in the order the [gate](#gate) runs work. The stages are `fix`, `build`, `check`, or `test`. A known [job](#gate-job)'s name determines its stage; a custom job declares one explicitly.

### Standard

A held limit for a repeatable project measurement. A `[standards]` entry sets a floor that may rise or a ceiling that may fall. The gate checks the limit and protected measurement definition against the preceding committed policy; an ordinary branch cannot weaken or delete them. Completion requires every standard, using applicable evidence or a new measurement. `discern standards --pin` captures a gain; `discern prepare` requests no measurements. A weaker limit needs the separate owner-approved proposal process. See [standards](../20-understand/standards.md).

### Stop / advise

The setting that decides whether a [checkpoint](#checkpoint) waits for an answer or only gives advice. With `stop`, `discern done` refuses to run the [gate](#gate) until your agent records its answer. With `advise`, the question appears as a notice in `discern prepare`, `discern done`, and `discern status`, blocks nothing, and takes no answer. A checkpoint you write stops unless it says otherwise. A built-in checkpoint keeps the mode discern gives it. The built-ins that watch code changes advise, and the ones that watch project knowledge, such as the map, instructions, and skills, stop. After a [declared unmet](#declared-unmet) answer the checks still run, but the change needs your [variance](#variance) before it lands.

### Submission

An effort's recorded request to land one exact commit. `discern accept queue` records it without starting a landing; `discern accept` records it and starts landing. Both select the effort from its worktree or with `--target`, naming its branch, the committed revision, and the [Proof](#proof) that covers it, and store the submission beside the effort grant under the worktree's Git administration so no branch can forge it. A later explicit submission from the same effort replaces it; a later commit or Proof alone does not. A landing consumes it, and dropping the worktree removes it. The landing queue lists submissions with honored [Proof](#proof) that have not landed, pre-authorized ones first; a green run its agent never submitted is absent and lands only by the owner's explicit act. See [landing authority](../20-understand/proof.md).

### Tidy

discern's formatter for its configured Markdown and TOML surfaces. `discern tidy` formats the [map](#map), deferred-work ledger, and [instruction sources](#instruction-source) as Markdown, and `discern.toml` as TOML. Fresh installations run it through the format [job](#gate-job); removing that command opts out. See [format discern-owned surfaces](../10-guides/maintain-or-remove-discern.md).

### Tip

A short practical suggestion shown below the [desk](#desk) status. The desk chooses a tip once per session and records its id in the [logbook](#logbook). The yellow `Tip` label distinguishes it from task status; its advice does not change what the selected task may do. Advice delivered to agents remains in command results. See [desk tips](../10-guides/coordinate-parallel-tasks.md).

### Trunk

The shared branch that accepted work joins, usually `main`. `[repository].trunk` selects it. Tasks bring its changes into their own worktrees with `discern update`; `discern accept` fast-forwards it to a submitted, proven, authorized commit.

### Update

Bring newer work into the current task's [worktree](#worktree). `discern update` merges the latest [trunk](#trunk) into the task branch and refreshes generated files. With `--from <ref>`, it can bring in another explicit source, including unlanded work. The result names overlapping files for the agent to re-read, because a successful merge does not prove the combined behavior is right. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Variance

Your permission to land a change even though your agent answered a checkpoint question unmet. Only you can approve one, in the current conversation. General permission to land doesn't cover it, and neither does any grant. Your agent records your approval with `discern accept --confirmed --variance <id>`, naming every unmet checkpoint. The variance covers that exact [declaration](#declaration), its reason, and the commit that lands. The checkpoint keeps asking its question of later work. See [checkpoints](../20-understand/checkpoints.md).

### Worktree

A separate working copy and branch for one effort. `discern start` creates it so task edits stay apart from the main checkout and other efforts. Review and resumed sessions continue the same effort; a worktree changes only through the operation run in it, and no operation installs another revision into it. A landing removes the worktree, its resources, and its branch when the branch holds nothing beyond the landed [submission](#submission). Each worktree has a derived port and declared [resources](#worktree-resource); `discern enter` opens a child shell in a selected checkout. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Worktree resource

A supporting service or other resource prepared separately for one worktree. Examples include a test database, emulator, or container. `[worktree.resources.<name>]` declares its `create` and `destroy` commands. Worktree setup ensures the declared resource exists, and lifecycle cleanup removes it when appropriate. `discern worktree prune` can reclaim positively identified orphaned resources. See [worktree resources](worktrees-and-status.md).
