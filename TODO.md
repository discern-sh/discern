# Open work — discern

The single source of truth for **outstanding work**: verified defects, deferred
fixes, known dead code, and at-risk or unmerged work. The
[`docs/`](docs/README.md) tree describes what _currently exists_; this file
tracks what's _still owed_.

## For agents (any agent — and the maintainer)

- **When you defer something, descope, or find a real issue you won't fix this
  round, record it here.** Don't bury it in a private memory, a one-off chat
  reply, or a lone code comment — those are invisible to the next agent and to
  the maintainer. This file is the shared backlog.
- **Format:** one checkbox per item — a bold title, a one-line description, and
  `Evidence:` with `file:line` where it applies. Add an area tag if it helps.
  Keep entries terse and factual; link code with relative paths.
- **When you finish an item, delete its line** — the commit that resolves it is
  the record. Don't leave ticked boxes lying around.
- **Scope:** this file is for work that _outlives a single session_. For
  tracking the steps of the task you're doing right now, use your own in-session
  task tooling, not this file.
- This is a backlog, not documentation — modal verbs ("should", "could") are
  fine here, unlike in `docs/`. Don't write that something was "finished this
  round" — that's meaningless to a future reader ("which round?"). Every item
  must be pickup-able at any later time with no session-specific context
  required.

---

<!--
  The severity buckets below are empty by design — a fresh project owes nothing
  yet. Add items under the heading that fits; create a new bucket only if none
  do. Suggested order is most-urgent first.
-->

## 🔴 Performance & correctness

_Verified defects and correctness risks. Nothing outstanding._

## 🟠 Cleanup — known dead or slow code

_Nothing outstanding._

## 🟡 Smaller fixes & polish

- [ ] **The v3→v4 config migration leaves stale comment blocks behind.** It is
      comment-preserving, so it rewrites the tables (`[slots]`→`[capabilities]`/
      `[checks]`, `[scopes]` arrays→tables, drops `[evidence]`) but leaves the
      explanatory comment blocks that describe the _retired_ structure — the big
      `[slots]`/`phase` header, the `[ratchets]` "slot" references, the
      `[evidence]` header — and appends the new tables orphaned at the end of
      the file, detached from their comments. The output is valid TOML but messy
      enough that a migrated install needs a hand-tidy to match the v4
      template's layout. Consider also dropping a deleted section's leading
      comment block, or re-emitting the template comments for the sections the
      step rewrites. Observed needing a hand-tidy on several v3→v4 installs. The
      `5 → 6` step (ADR 0020) has the mirror issue: it appends the new
      `[features]`/`[guidance]`/`[skills]` sections comment-less at EOF (and in
      reverse key order). Net effect: a migrating user lands on a barer,
      comment- stripped config than a fresh `init` produces — the two onboarding
      paths diverge. The clean fix is to re-render `discern.toml` from the
      commented template, preserving the user's values, rather than line-editing
      in place. Consider also dropping a deleted section's leading comment
      block. Evidence: `src/lib/migrations.ts` (the `from: 3` and `from: 5`
      steps); target layout is `templates/discern.toml.tmpl`.

- [ ] **The 5→6 migration doesn't relocate a `.discern/`-pointed
      `gotchas_doc`.** If `[project].gotchas_doc` pointed inside
      `.discern/guidelines/`, that file is concatenated into `guidance.md` and
      `.discern/` is deleted, leaving `gotchas_doc` dangling (and merging a
      distinct doc into general guidance). `doctor` now _flags_ a dangling
      `gotchas_doc`, but the migration should relocate it (or keep it
      standalone) rather than rely on the user noticing. The common case
      (`gotchas_doc` under `docs/`, or empty) is unaffected. Evidence:
      `src/lib/migrations.ts` (`from: 5`); `src/commands/doctor.ts` (the new
      "gotchas doc" check surfaces it).

- [ ] **`config set <key> <value>` strips the edited line's inline comment.**
      The comment-preserving `TomlEditor.setLiteral` rewrites the whole
      `key = …` line, dropping any trailing `# …` annotation, so editing the
      self-documenting `discern.toml` via the CLI quietly degrades it one line
      at a time (e.g. `config set features.worktrees false` drops that line's
      trailing `# …` annotation). Preserve a trailing inline comment when
      rewriting a value. Evidence: `src/lib/toml_edit.ts` (`setLiteral`).

- [ ] **`worktree:prune` apply re-scans instead of consuming its plan (footgun,
      gate-guarded).** `pruneGitWorktrees`/`sweepOrphanWorktrees` still take a
      `dryRun` flag whose two return paths must stay in lock-step (the original
      catastrophe was the dry path returning empty lists). Both now return their
      candidates in dry mode, and `tests/engine_plan_parity_test.ts` fails the
      gate if a dry/wet divergence ever returns — so the footgun is neutralised,
      not removed. The clean structural fix: split each into a pure `scan*()`
      (no `dryRun`, always returns candidates) + a thin `apply*(scan)`, have
      `buildPrunePlan` carry the scan, and have `worktreePrune` apply _consume_
      that scan (as teardown now consumes its plan) — so the apply path can't
      re-scan and diverge. Deferred as the rm-rf core: marginal safety over the
      existing gate test, real refactor risk. Evidence:
      `src/engine/worktree/git.ts` (`pruneGitWorktrees` ~677,
      `sweepOrphanWorktrees` ~920); `src/engine/worktree/lifecycle.ts`
      (`worktreePrune`, `buildPrunePlan`).

- [ ] **`worktree:prune --dry-run` no longer mentions stale-metadata pruning.**
      The pre-plan dry-run narrated "Would also prune N stale metadata entries";
      the plan-based dry-run drops it (it isn't a candidate in `PruneResult`,
      and the apply's trailing `git worktree prune` cleans it regardless). Non-
      destructive git bookkeeping, absent from the `--json` contract, so the gap
      is cosmetic — but the preview is now slightly less informative than the
      act. Consider adding a `staleMetadata` count to `PruneResult` and a plan
      detail line. Evidence: `src/engine/worktree/git.ts` (`pruneGitWorktrees`,
      the `dryRun` return ~832); `src/engine/worktree/plan.ts`
      (`prunePlanToEngine`).

- [ ] **`init`/`upgrade` `--json` report `ok:true` when agent-guidance
      compilation failed.** The primary operation (scaffold / migrate + stamp)
      did succeed and the failure IS surfaced in a sub-field (`compiled:[]` /
      `guidelines_compiled:false`), and guidance is regenerable via
      `discern
      refresh` — so this is defensible, not a clear bug. But a
      consumer keying on top-level `ok` won't learn the agent files didn't
      compile. Decide whether `ok` should reflect a secondary-artifact failure,
      and apply it consistently across the installer verbs. Evidence:
      `src/commands/init.ts` (~306, ~319); `src/commands/upgrade.ts` (~209).

- [ ] **`skills` `targetExists` treats an unreadable symlink target as
      missing.** A bare `catch {}` conflates "absent" with "couldn't stat", so a
      symlink whose target is merely unreadable (e.g. EACCES) could be pruned
      during materialize. Self-healing (the symlink is recreated on the next
      `discern refresh`), hence low severity, but the stat error should be
      distinguished from a genuine absence. Evidence: `src/lib/skills.ts`
      (`targetExists` ~151).

- [ ] **Tier-1 diagnostics: declared text formats (the `[diagnostics.<name>]`
      regex slice).** `finish` normalizes a failed tool's output into structured
      `{file,line,rule}` diagnostics only when the tool emits **SARIF**
      (auto-detected —
      [ADR 0028](docs/_adr/0028-result-envelope-and-diagnostics.md)). Tools that
      emit only human text (the common case for many linters/compilers without a
      SARIF flag) still carry their raw output (Tier 0). The planned next slice:
      a `[diagnostics.<name>]` config table letting a Capability/Check declare a
      `format = "regex"` + `pattern` (named groups
      `file`/`line`/`col`/`rule`/`message`) so discern parses text output too.
      Deferred because it needs a config-surface decision (a new section +
      schema + codegen + the closed `[capabilities]` value shape) that SARIF
      needed none of; worth its own small ADR. Wire it into
      `normalizeDiagnostics`. Evidence: `src/engine/gate/diagnostics.ts`
      (`normalizeDiagnostics` — SARIF only); `src/engine/gate/plan.ts`
      (`buildGateResult` calls it).

- [ ] **`discern mcp` could expose more read/run verbs.** Wired so far:
      `finish`, `prepare`, `test`, `doctor`, `changed_scopes`, `audit`, `docs`,
      and `graduate` (the last two feature-gated) — each backed by a
      result-returning core
      (`finishResult`/`prepareResult`/`testResult`/`doctorResult`/`docsResult`/
      `graduateResult`/…). `ratchets` is the obvious next candidate (extract a
      `ratchetsResult` core first). The `worktree`/`worktree:*` lifecycle verbs
      are deliberately NOT exposed: they are driven by the
      worktree-create/session hooks, and an agent must not hop between or
      `prune` the worktree it is sitting in. Evidence:
      `src/engine/mcp/server.ts` (`TOOLS`).

- [ ] **A `discern start` verb to launch a worktree from the main checkout.** An
      agent invoked on `main` (not in a worktree) has no affordance to spin up
      its own isolated worktree, so it improvises badly: observed an agent call
      `discern status`, see an idle, up-to-date worktree belonging to _another_
      agent (which simply hadn't started working yet), and move in to work there
      — jumping into someone else's worktree was its only option. A
      `discern start` (a naming-convention sibling of `finish`/`graduate`) would
      create a fresh worktree on its own `agent/` branch and guide the agent to
      move inside it before continuing. MCP wrinkle: the server runs rooted in
      one worktree, so a `discern_start` tool would have to return the new
      worktree's path and tell the agent to re-root there, not silently
      relocate. Distinct from — and complementary to — the
      deliberately-unexposed `worktree:*` lifecycle verbs above: this _creates_
      a worktree to inhabit; it never hops into or prunes an existing one.
      Follow-up, after the MCP server expansion.

- [ ] **Tier-2 diagnostics: populate `fix_available`.** The `Diagnostic` field
      and the ADR-0028 Tier-2 tier exist, but nothing sets it. Derive it from
      whether a `fix`-stage command is wired for the failing capability (a
      formatter that may auto-resolve it). Evidence: `src/shared/result.ts`
      (`Diagnostic.fix_available`); `src/engine/gate/plan.ts`
      (`buildGateResult`).

- [ ] **`prepare`/`test` `--json` carry no `steps`/`diagnostics`.** They emit a
      valid `{ok, verb}` envelope, but run the joined stage command via
      `runShellInherit`, which under `--json` now DISCARDS the command's output
      (the quiet rule, ADR 0030) — so a failing `prepare --json` is opaque
      (`ok:false`, no diagnostic). Rework them to run through the job runner
      (the `runGate` machinery) so the failure is captured into `steps[]` +
      structured `diagnostics[]` like `finish`. Evidence:
      `src/engine/gate/prepare.ts`, `src/engine/gate/test.ts`,
      `src/engine/gate/run-shell.ts`.

- [ ] **The apply path's human output isn't rendered FROM the result.**
      `finish`, the worktree verbs, and `ratchets` narrate during execution, in
      parallel with the `steps[]` they serialize for `--json` — kept consistent
      by convention, not structure (ADR 0028 is now precise about this). A
      shared `StepResult[]` renderer (the mirror of `renderPlan`, which covers
      only plans) would make the apply path a true rendering of the one object
      too. Evidence: `src/engine/worktree/lifecycle.ts` (parallel
      `log.info`/`done()`); `src/shared/result.ts` (`renderPlan`).

- [ ] **`skills eject` is the lone CLI verb off the envelope.** A mutating verb
      that emits `console.log`/`console.error` with no `--json`. Low
      agent-consumption (interactive customization), but it should return a
      `DiscernResult` for completeness. Evidence: `src/engine/dispatch.ts`
      (`runSkillsEject`).

- [ ] **Human-output polish (cosmetic).** (a) A SARIF-emitting check dumps its
      raw JSON to the human stream before the parsed Failures block — humans pay
      for both the raw and located views. (b) No `FORCE_COLOR` override: colour
      is gated on `Deno.stdout.isTerminal()` only, so piped human output is
      always plain. (c) A single failure is reported three times (the stream
      banner, the Failures block, and the `✗ The <stage> stage failed.` die
      line). Evidence: `src/engine/jobs/runner.ts`; `src/engine/output.ts`
      (`colorEnabled`); `src/engine/gate/finish.ts` (`renderFailures` +
      `failMessage`).

## 🟢 Test & tooling hygiene

None at present.

## 🔵 Unmerged / at-risk work — decide: land or drop

_Work built but not merged, or otherwise at risk of being lost. Nothing
outstanding._

## ⚪ Explorations / ideas (unscheduled)

- [ ] **`init` is all-or-nothing; design a "feature opt-in" install (and handle
      pre-existing docs).** Today `init` scaffolds the whole harness — full docs
      tree, all slots, all adapters — regardless of what the target repo already
      has. The first real install (`passapp`, an established Laravel app)
      surfaced a concrete gap: the repo already had its own `docs/` (loose files
      `Stripe.md`, `Annuities.md`, `Mathematics.md`, `Deployment.md`,
      `Filament.md`, and `docs/AI/*`), and `discern bootstrap` built a
      _parallel_ numbered tree beside them — declaring `docs/README.md` the
      "canonical source of truth" while never acknowledging or folding in the
      existing docs. Several overlap directly with the new subtrees it created
      (`Stripe.md` ↔ `60-billing`, `docs/AI/` ↔ `40-ai`,
      `Mathematics.md`/`Annuities.md` ↔ `30-questions`, `Deployment.md` ↔
      `80-development`, `Filament.md` ↔ `70-admin`), leaving the developer with
      two doc systems and no guidance on reconciling them. Tackle as part of a
      broader opt-in model where a developer chooses which harness pieces to
      install rather than getting everything — and where
      `init`/`discern
      bootstrap` detect pre-existing docs and either fold
      them into the tree or record them for folding. **Partly addressed:**
      `discern bootstrap` no longer lays the skeleton tree when a `docs/`
      already exists ([ADR 0024](docs/_adr/0024-bootstrap-as-command.md)), so it
      no longer builds a _parallel_ tree — but acknowledging/folding
      pre-existing loose docs and the opt-in install model remain. (Observed in
      the `passapp` control case; that staging area will be discarded and
      re-run, so re-confirm against a fresh run. Worth an ADR when designed.)

## 👨‍💻 Jack's Odds and Ends

_Small things Jack finds whilst reviewing code and documentation; cleaned up
periodically in maintenance batches._

- [ ] `base.md` guidance needs polishing: do this once MCP and guideline work is
      concluded and wrapped up as a final pass.
- [ ] Discern should make clear to end-users that the `docs` feature, and the
      documentation subtree procedures, are _conceptually distinct_ from any
      existing documentation the user has already set up in their project. The
      reason for this is that the doctree represents _what can be inferred from
      the user's codebase_ - which is what matters to their coding agents - and
      likely diverges from what they would consciously choose to document
      already. This is a teaching opportunity as it can be hard to understand
      for new users, so should be folded in to `discern audit` and throughout
      our own docs, guidance, and reference materials.
- [ ] Fan-out agentic review/rewrite for public-facing audiences of all
      documentation (Vale prose lint is now wired — see `[ratchets.prose]`);
      plus all ADRs. Once complete, ensure agents know future documentation
      changes will be publicly visible to end-users, including future ADRs.
- [ ] Conduct a general-purpose thorough "consistency review" - establish all
      aspects of the platform use the same conventions consistently everywhere.
      Noteworthy inconsistencies currently (non-exhaustive list):
      `discern <verb>` where <verb> is a single word, but `worktree:prune` etc.
      is two words; etc...
