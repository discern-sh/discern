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

Land validated, authorized work on the [trunk](#trunk), the project's shared branch. From an effort's worktree, `discern accept` records the effort's [submission](#submission), the exact proven commit, and lands it when conversation consent or a recorded grant authorizes it: it fast-forwards the trunk, records the Proof note, converges the main checkout, and removes the worktree, its resources, and its branch when the branch holds nothing beyond the landed submission. When the trunk moved after the Proof, the landing composes and checks the combined code in an [integration worktree](#integration-worktree) and lands that exact proven commit; a second accept waits its turn and resumes on its own. Without authority it refuses, and the submission waits for the owner. See [worktrees](../20-understand/worktrees-and-trunk.md) and [landing authority](../20-understand/proof.md).

### Advisory

A finding that suggests attention without blocking work. [Coupling](../20-understand/evidence-and-improvement.md), [patterns](../20-understand/evidence-and-improvement.md), [impact](https://discern.sh/docs/reference/cli-reference#discern-impact), and [improvement](../10-guides/improve-the-practice.md) provide advice. The finding can prompt investigation; it is not itself a failed [gate](#gate) check.

### Agent file

An instruction file a coding agent reads when it works on the project. `discern refresh` generates `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` from the built-in instructions and your [instruction source](#instruction-source). These files are committed so a clone carries the instructions; `AGENTS.md` is the canonical copy the others import. Edit the authored source, then refresh the generated files. See [agent instructions](../10-guides/write-project-instructions.md).

### Checkpoint

A review question presented when a relevant kind of change occurs. A rule under `[checkpoints]` pairs a mechanical trigger with a question for the agent. In `stop` mode, the [gate](#gate) waits for a [declared met](#declared-met) or [declared unmet](#declared-unmet) conclusion; `advise` mode does not block it. An unmet conclusion needs an owner-authorized [variance](#variance) before landing. Committed policy preceding the change governs the question, including the recorded predecessor during candidate completion. `discern checkpoints` reports the applicable policy and question states. See [checkpoints](../20-understand/checkpoints.md).

### Coupling

Files that have often changed together in the project's history. `discern coupling` uses that history to suggest related files the current change may have missed. The finding is [advisory](#advisory): past co-change is a reason to investigate, not proof that another file must change. See [coupling](../20-understand/evidence-and-improvement.md).

### Declaration

The agent's recorded answer to a checkpoint [question](#question). The agent uses `discern done --met <id>` for a satisfied question, or `--unmet <id> --why "…"` for an unmet question with a reason. The answer applies to the resolved question and matched content; a relevant change reopens it. [Proof](#proof) labels the answer [declared met](#declared-met) or [declared unmet](#declared-unmet). The gate verifies that a required answer exists, not that the judgment is correct.

### Declared met

The agent has judged that the checkpoint question is satisfied for this change. This [declaration](#declaration) applies to the question and content the agent examined. A relevant change reopens it. The conclusion is recorded judgment, not independent machine verification.

### Declared unmet

The agent has judged that a checkpoint question is not satisfied and has recorded why. The [gate](#gate) can still run. [Proof](#proof) carries the reason for the owner to review, while landing waits for an authorized [variance](#variance). The rationale is kept out of the [logbook](#logbook).

### Desk

An interactive view of the project's tasks and the actions available for them. Open it from the main checkout with bare `discern` or `discern desk`. It surveys the [fleet](#fleet), starts tasks, opens configured coding-agent CLIs found on `PATH`, and offers valid actions for the selected worktree. See [the desk](../10-guides/delegate-work.md).

### discern

A tool that installs and runs an agent development practice in a project. One self-contained program handles setup and maintenance, isolated task [worktrees](#worktree), configured [gate](#gate) checks, project knowledge, and the completion and landing workflow.

### discern version

The version of discern you are running, shown by `discern --version`. Use `discern releases` to see what's new and check for updates. The installer updates the program; `discern upgrade` updates the project's setup to match.

### Effort

One task carried through implementation and review: the work a [worktree](#worktree), its branch, and its [submission](#submission) all belong to. Results name an effort by its branch. An effort keeps one worktree across feedback and resumed sessions; the landing queue lists efforts by their submissions, and `discern accept` lands the selected effort's submitted commit on the [trunk](#trunk).

### Engine

The part of discern that runs its workflow commands. Commands such as `done`, `prepare`, `status`, `update`, and `accept` use this TypeScript implementation, compiled into the program. It runs the jobs, scopes, standards, and worktree settings the project declares without prescribing a language or framework. The embedded [tidy](#tidy) formatter operates on discern-owned surfaces. See [engine internals](https://github.com/jackwh/discern/tree/main/project/map/50-engine-internals/).

### File ownership

The rules for which parts of a file discern may maintain. The categories are [project-owned](#project-owned-file), [shared](#shared-file), and [generated](#generated-file), and they determine what `discern upgrade` may change. See [files and ownership](files-and-ownership.md); the [install surface](https://github.com/jackwh/discern/blob/main/project/map/80-development/install-surface.md) lists the complete inventory.

### Fleet

The project's collection of task [worktrees](#worktree). The [desk](#desk) and `discern status` show it from the main checkout; `discern status --all` includes it from a task worktree. A listed worktree still belongs to its effort even when it is idle or clean. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Gate

The configured checks a change must satisfy for ordinary completion. `discern done` runs this workflow: preconditions, declared [jobs](#gate-job), applicable [scope](#scope) gates, required [standards](#standard), and required checkpoint declarations. Failures identify the check and the next action. Passing establishes the stated checks for the validated change, not permission to land it. See [the quality gate](../20-understand/proof.md).

### Gate job

A named check or operation scheduled by the [gate](#gate). A project declares its jobs under `[jobs]`: the six known names `format`, `build`, `lint`, `typecheck`, `test`, and `smoke` derive their [stage](#stage), while a custom name declares one. The run also schedules fired [scope](#scope) gates and [standard](#standard) measurements as labeled jobs. Covered in [the quality gate](../20-understand/proof.md).

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

A disposable [worktree](#worktree) a landing creates for itself when the [trunk](#trunk) moved after a [submission](#submission)'s Proof. discern creates it from the exact submitted commit through the same setup a task worktree gets, brings the trunk in, proves the combined committed tree with the full gate, lands that exact proven commit, and removes the copy, its resources, and its `integration/` branch. It is discern-owned — never an effort an agent may adopt — with its ownership and exact input recorded, not inferred from its name. A conflict or red combined check removes the copy and returns to the author with nothing landed; a copy whose owning process died is reclaimed by `discern worktree prune`, which never touches a live one. See [worktrees](../20-understand/worktrees-and-trunk.md).

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

The record created when a stop checkpoint asks for judgment on an effort. It keeps the question and its current answer or unanswered state. `discern done` creates the record when a `stop` [checkpoint](#checkpoint) fires. The record lives in the worktree's Git administrative area, survives session restarts, and tracks any later [declaration](#declaration) or reopening. `discern checkpoints` reports its current state without changing it. See [checkpoint state and declarations](proof-and-checkpoint-formats.md).

### Patterns

Findings about recurring behavior in the project's recorded use of discern. `discern patterns` reads the [logbook](#logbook) for such patterns as repeated gate failures, avoidable workflow steps, and changes in [standard](#standard) measurements. Each finding states its supporting counts and a next step. It is [advisory](#advisory); when evidence is insufficient, it says so. See [practice patterns](../20-understand/evidence-and-improvement.md).

### Placement is consent

Choosing a managed source location authorizes discern to maintain that content. The default source locations carry that permission; pointing a configuration key at another location gives it explicitly. This governs discern's managed content, not every command an agent or project job may run. See [design principles](https://github.com/jackwh/discern/blob/main/project/map/00-orientation/design-principles.md) and [files and ownership](files-and-ownership.md).

### Practice

The connected way of working discern installs and the project carries between sessions. Tasks use separate [worktrees](#worktree), configured [gate](#gate) checks, held [standards](#standard), exact completion [Proof](#proof), and owner-controlled [landing authority](#landing-authority). Bundled [skills](#skill) guide delegation, lasting project knowledge, and improvements that address a problem's cause. You direct the work and make the consequential decisions; your agents operate the workflow. See [the practice](../20-understand/practice-and-roles.md).

### Progress handle

The short `R1-XXXX-XXXX-XX` code recorded for a long operation and announced to MCP callers. `discern progress <handle>`, or the `discern_progress` tool, reads that operation back after a lost call: its phase, the counts and failures known so far, and the retained result. Human command output omits the startup announcement; `discern progress` without a handle finds the latest operation. It only reads; the `C1` continuation that `discern await` returns is what resumes a wait. See [progress and reconnect](https://github.com/jackwh/discern/blob/main/project/map/70-reference/progress-and-reconnect.md).

### Project script

A runnable procedure the project supplies for its agents and maintainers. It lives under `[scripts].dir` (default `discern/scripts`), run as `discern scripts <name>` with `DISCERN_*` exported. Scripts occupy their own namespace, so built-in verb names stay legal ([ADR 0137](https://discern.sh/docs/decisions/0137-project-scripts-live-under-the-script-command)).

### Project-owned file

A file whose ongoing contents belong to the project. discern may create an initial copy, but `discern upgrade` does not overwrite it. Examples include authored [map](#map) pages, instructions, the deferred-work ledger, and skills in the [namespace](#namespace).

### Proof

discern's completion evidence for the exact committed change it validated. `discern done` records machine results, held [standards](#standard), and declared checkpoint judgments for the committed tip of the invoking worktree. The Proof line summarizes that evidence; `discern status --verbose` retrieves the full page. Evidence whose inputs are unchanged can be reused, but a later commit needs current validation. Proof does not grant [landing authority](#landing-authority). See [the Proof](../20-understand/proof.md).

### Proof note

A durable copy of landed [Proof](#proof), attached to the commit in Git. The JSON record lives under `refs/notes/discern`. Its Dead Simple Signing Envelope (DSSE) binds the full commit and preserves the payload bytes for future signatures; current notes use an unsigned extension with an empty signatures array. Recording is local by default, fetching is opt-in, and publishing requires an explicit Git push. See [Proof notes](proof-and-checkpoint-formats.md).

### Question

Something the agent is asked to judge about the project or a change. [Checkpoints](#checkpoint) present questions when changes match their triggers; the [improvement review](../10-guides/improve-the-practice.md) asks them about existing work. A question can have a stable id and a `teach` note explaining why it matters. A checkpoint answer is [declared met](#declared-met) or [declared unmet](#declared-unmet), kept separate from machine-verified results. See [checkpoints](../20-understand/checkpoints.md).

### Schema version

The version number of the project's discern configuration format. `[meta].schema_version` identifies the current step in the [migration](#migration) sequence. It changes when an installation needs a format migration; a new discern release does not necessarily change it.

### Scope

A named set of project paths used to select work or policy. A `[scopes.<name>]` entry declares path patterns and can provide a `gate` command for changes in that area. Unclassified paths still count as code changes, so missing classification does not skip them. `discern map --export <name>` can also use a scope as an ordered reading list. See [the quality gate](../20-understand/proof.md).

### Shared file

A file with parts maintained by discern and parts maintained by the project. The ownership registry classifies as shared any registered path where discern manages a delimited region or fixed scaffold while preserving project content around it. The [registered project paths](https://discern.sh/docs/reference/files-and-ownership#registered-project-paths) table contains the complete inventory.

### Skill

A reusable playbook that tells an agent how to handle a particular kind of task. Skills use `SKILL.md` files. discern ships bundled skills prefixed `discern-`; you can add your own under `[skills].dir` or override a bundled skill with the same name. `discern refresh` makes the selected set available to configured agents, `discern skills list` shows it, and `[skills].exclude` omits named skills. See [skills](../10-guides/create-and-manage-skills.md).

### Stage

A group in the order the [gate](#gate) runs work. The stages are `fix`, `build`, `check`, or `test`. A known [job](#gate-job)'s name determines its stage; a custom job declares one explicitly.

### Standard

A held limit for a repeatable project measurement. A `[standards]` entry sets a floor that may rise or a ceiling that may fall. The gate checks the limit and protected measurement definition against the preceding committed policy; an ordinary branch cannot weaken or delete them. Completion requires every standard, using applicable evidence or a new measurement. `discern standards --pin` captures a gain; `discern prepare` requests no measurements. A weaker limit needs the separate owner-approved proposal process. See [standards](../20-understand/standards.md).

### Stop / advise

How a [checkpoint](#checkpoint) presents its question. `stop` waits for a recorded conclusion before the [gate](#gate) runs; `advise` presents the question without blocking. Stop is the default mode. Heuristic built-in triggers use advise. A [declared unmet](#declared-unmet) answer allows checks to run, but still needs the owner's [variance](#variance) before landing.

### Submission

An effort's recorded request to land one exact commit. `discern accept queue` records it without starting a landing; `discern accept` records it and starts landing. Both select the effort from its worktree or with `--target`, naming its branch, the committed revision, and the [Proof](#proof) that covers it, and store the submission beside the effort grant under the worktree's Git administration so no branch can forge it. A later explicit submission from the same effort replaces it; a later commit or Proof alone does not. A landing consumes it, and dropping the worktree removes it. The landing queue lists submissions with honored [Proof](#proof) that have not landed, pre-authorized ones first; a green run its agent never submitted is absent and lands only by the owner's explicit act. See [landing authority](../20-understand/proof.md).

### Tidy

discern's formatter for its configured Markdown and TOML surfaces. `discern tidy` formats the [map](#map), deferred-work ledger, and [instruction sources](#instruction-source) as Markdown, and `discern.toml` as TOML. Fresh installations run it through the format [job](#gate-job); removing that command opts out. See [format discern-owned surfaces](../10-guides/maintain-or-remove-discern.md).

### Tip

A short practical suggestion shown below the [desk](#desk) status. The desk chooses a tip once per session and records its id in the [logbook](#logbook). The yellow `Tip` label distinguishes it from task status; its advice does not change what the selected task may do. Advice delivered to agents remains in command results. See [desk tips](../10-guides/delegate-work.md).

### Trunk

The shared branch that accepted work joins, usually `main`. `[repository].trunk` selects it. Tasks bring its changes into their own worktrees with `discern update`; `discern accept` fast-forwards it to a submitted, proven, authorized commit.

### Update

Bring newer work into the current task's [worktree](#worktree). `discern update` merges the latest [trunk](#trunk) into the task branch and refreshes generated files. With `--from <ref>`, it can bring in another explicit source, including unlanded work. The result names overlapping files for the agent to re-read, because a successful merge does not prove the combined behavior is right. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Variance

The owner's permission to land a change despite a stated unmet checkpoint. It covers the exact current [declaration](#declaration) and landed commit, without changing the policy for future work. The agent records the owner's explicit current-conversation approval with `discern accept --confirmed --variance <id>`. Standing and effort grants do not cover variances. See [checkpoints](../20-understand/checkpoints.md).

### Worktree

A separate working copy and branch for one effort. `discern start` creates it so task edits stay apart from the main checkout and other efforts. Review and resumed sessions continue the same effort; a worktree changes only through the operation run in it, and no operation installs another revision into it. A landing removes the worktree, its resources, and its branch when the branch holds nothing beyond the landed [submission](#submission). Each worktree has a derived port and declared [resources](#worktree-resource); `discern enter` opens a child shell in a selected checkout. See [worktrees](../20-understand/worktrees-and-trunk.md).

### Worktree resource

A supporting service or other resource prepared separately for one worktree. Examples include a test database, emulator, or container. `[worktree.resources.<name>]` declares its `create` and `destroy` commands. Worktree setup ensures the declared resource exists, and lifecycle cleanup removes it when appropriate. `discern worktree prune` can reclaim positively identified orphaned resources. See [worktree resources](worktrees-and-status.md).
