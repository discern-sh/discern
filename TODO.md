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

- [ ] **The gate's `fix` stage rewrites uncommitted work with no snapshot.**
      Pre-existing dirty files are excluded from ADR 0047's strand detection by
      design (D1∖D0), so a misconfigured or buggy `[capabilities].format`
      command run by `discern prepare`/`finish` can rewrite a user's uncommitted
      changes with no backup and no warning. Benign for the common formatters;
      the risk is the open-ended command table. Design question —
      stash-before-fix, a dirty-tree warning, or a diff preview — deferred from
      the launch-readiness review (finding C15) pending a decision. Evidence:
      `src/engine/gate/fix_drift.ts` (the deliberate D0 exclusion);
      [ADR 0047](docs/_adr/0047-fix-stage-strand-detection.md).

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

- [ ] **Scaffold the CI gate workflow once releases are public.** The docs now
      give a pasteable GitHub Actions recipe, but launch still needs the public
      repo/version values re-checked and a later `setup`/binary affordance that
      writes the workflow for users. Evidence: `docs/20-quality-gate/ci.md`.

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

- [ ] **Review the coupling advisory's judgment constants across diverse repos,
      then consider on-by-default.** `coupling` is zero-config, but its three
      fixed constants — `LLR_CUTOFF` (6.63, p<0.01 significance),
      `MIN_CONFIDENCE` (0.2, the relevance floor), and `MIN_COCHANGES` (2, the
      fluke floor) — carry the product claim that the calibration generalizes
      across repo cultures. They are principled and were validated against
      _this_ repo's history, but deleting every knob also deleted any recourse
      if a very different repo (a huge monorepo, or one with very different
      commit habits) reads too noisy or too quiet. Experiment with these across
      several repos of different size/age/commit-style; confirm the
      genuine-vs-incidental boundary holds (or learn where it doesn't). Once
      they are trusted, consider flipping `[coupling].in_gate` to default **on**
      so the diff-aware nudge rides with `finish` out of the box. Also worth
      weighing then: localising the mined window to the change-set files for
      huge monorepos, and a formal multiple-testing correction (today bounded
      only by the top-k output cap). Evidence: `src/engine/coupling/coupling.ts`
      (the constants), `[coupling]` in `discern.toml`
      ([ADR 0084](docs/_adr/0084-co-change-coupling-advisory.md)).

- [ ] **`discern improve` candidates + a `// discern-coupled-to:` declaration
      marker — the discovery→enforcement bridge as a deliberate review, with
      state.** `coupling` (ADR 0084) _discovers_ co-change pairs and nudges
      per-change; ADR 0051's forcing functions _enforce_ the ones that are
      essential invariants. Nothing today bridges the two as a periodic,
      considered review — and nothing remembers which couplings a human has
      already judged, so any standing surface re-serves the same advice forever.
      This item is the design for both halves. **Deferred — design only here; do
      not implement without confirmation.**

  - **`improve` candidates.** Extend `discern improve` (the subjective-review
    surface — formerly `audit`,
    [ADR 0079](docs/_adr/0079-improve-is-a-coach-not-an-audit.md)) with the
    top-N strongest co-change pairs that are _not yet protected_ by a forcing
    function — "candidates to lock with a parity test, or to deliberately
    decouple." It is the discovery→enforcement bridge made a deliberate,
    on-demand review item rather than a per-change nudge: the agent/human looks
    at the strongest couplings periodically and _decides_, instead of being
    prompted mid-change. Lands as a `review` (not a deterministic `rule`) —
    discern surfaces the pair and its evidence and leaves the judgement to the
    consumer (ADR 0063).

  - **The re-advice problem, and the fix.** A standing candidate list with no
    state re-serves the same pairs every run, including the ones already judged
    — noise that trains the reader to ignore it. The fix is an inline,
    stack-agnostic **declaration marker**, `// discern-coupled-to: <path>`,
    which gives a coupling three states:
    - **Discovered** — present only in the heuristic co-change graph. Always
      advisory; what `coupling` surfaces today.
    - **Declared** — a `// discern-coupled-to: B` comment on a line in file `A`:
      the user/agent has _asserted_ the coupling is real. This (a) drops the
      pair out of the discovered-candidate list, so the audit **self-cleans**
      and only genuinely-new pairs surface on later runs; and (b) becomes its
      own _precise_ check — "you changed `A`, which declares it's coupled to
      `B`, but `B` isn't in your change" — decidable **from the diff alone, in
      any language, with no static analysis**. This is the key insight: a
      declared coupling is the stack-agnostic forcing function discern otherwise
      can't offer a non-TS repo (ADR 0051's parity tests need a test runner and
      a canonical set; this needs only a grep over the diff).
    - **Enforced** — a real ADR-0051 parity/architectural test, for the stacks
      that can write one. The strongest, but TS/test-runner-bound.

  - **Design notes (record so an implementer needs no further context):**
    - **Directional, not symmetric.** `discern-coupled-to: B` on `A` asserts A→B
      only; to bind both ways, add the reverse marker on `B`. (Mirrors the
      directional co-change edges — `coupling` already reports A→B and B→A
      separately.)
    - **Needs a currency check.** A marker pointing at a path that no longer
      exists is a silent decay, exactly the failure ADR 0053 guards. Reuse the
      ADR-0053 comment-scanning machinery (`tests/comment_currency_test.ts`'s
      extractor, which already skips string/template bodies and resolves path
      references against the live tree) to fail the gate when a
      `discern-coupled-to:` target is missing.
    - **A separate ignore marker is YAGNI for now.** The "this strong co-change
      is genuinely incidental — stop suggesting it" case would want its own
      `// discern-coupling-ignore: <path>` marker (suppress the candidate
      without asserting a checkable coupling). Don't build it until the audit
      candidate list actually annoys — declaring the coupling already removes it
      from the list, which covers the common case.
    - **Inline comment, not config — deliberate.** Keeping the declaration in a
      code comment (not a `discern.toml` key) preserves zero-_config_: it is
      declarative _intent that travels with the code_, not a tuning knob, and it
      sits beside the coupled line where a reader meets it. It matches discern's
      existing inline-marker vocabulary (`# desc:` on a recipe,
      `discern-allow-retrospective`), so it is not a new mechanism, just a new
      marker.
    - **A declared coupling _could_ justify optional gating** — it is asserted,
      not guessed, so failing on it is defensible in a way a discovered nudge
      never is — **but it must still default to advisory** to honour the
      never-block discipline (ADR 0084); any blocking is opt-in, like
      `[coupling].in_gate`.

    Evidence: `src/engine/coupling/coupling.ts` (the discovered graph);
    `src/engine/improve/rules.ts` (where a candidate `review` would land);
    `tests/comment_currency_test.ts` (the marker-currency machinery to reuse);
    [ADR 0084](docs/_adr/0084-co-change-coupling-advisory.md) (discovery) →
    [ADR 0051](docs/_adr/0051-canonical-set-parity.md) (enforcement).

- [ ] **Surface the per-verb execution model beyond `doctor`.** The execution
      model (ADR 0063, `VerbPlan`) is only reachable by running `discern doctor`
      and scrolling past the health checks. Make it independently addressable
      (e.g. `doctor --section execution-model`, or expose via `help`/`status`)
      and front-load `doctor`'s envelope with a crisp
      `{ok, problems,
      next_action}` verdict so a consumer can early-out.
      Keep one envelope per verb (ADR 0028) — don't split `doctor` into several
      commands. Evidence: `src/engine/doctor/execution_model.ts`,
      `src/engine/doctor/doctor.ts`. (Deferred from onboarding triage — useful,
      not urgent.)

## 📣 Marketing & positioning

_Product positioning, messaging, and launch/content tasks._

- [ ] **Make "author once → compile everywhere" + per-agent wiring a first-class
      message.** discern compiles one `guidance.md` into every vendor's agent
      files and wires each agent's exact guidance file, skills dir, MCP, and
      hooks — most tools just say "supports Claude, Codex, Gemini". Elevate this
      from a buried detail to a headline principle in external docs and landing
      copy.
- [ ] **Use self-hosting as launch credibility.** "discern is developed under
      its own gate" proves the flow is real, the docs discipline is tolerable,
      and the gate isn't theoretical — the best possible demo. Put it in launch
      material.
- [ ] **Coin: "the project gets smarter over time".** A candidate tagline for
      the website/copy, capturing how the `discern-teach-the-project` skill
      routes each session's lessons back into the harness (guidance, skills,
      recipes, docs, ADRs) so every future agent — of any vendor — inherits
      them. Drop it in when the messaging is ready.
- [ ] **Rename `ratchets` → `baselines` throughout (decided).** Vocabulary
      decision recorded in the product-strategy doc: "ratchet" carries bad
      associations (Nurse Ratched, the US slang for "trashy") and doesn't read
      as an improvement mechanism; "baseline" parses instantly ("a baseline that
      may only improve") and reinforces the messy-repo message ("your baseline
      is wherever you are today — it only rises"). Rename the `[ratchets]`
      config table, the `ratchets` feature toggle, the `discern ratchets` verb +
      `discern_ratchets` MCP tool, docs, guidance, and tests; ship a schema
      migration and keep `ratchets` as a verb alias. Keep the one-way-mechanism
      explanation as the universal gloss ("numbers that can never get worse").
      Worth a short vocabulary ADR (precedent: ADR 0018, ADR 0022). Evidence:
      `templates/discern.toml.tmpl` (`[ratchets]`), `src/engine/mcp/server.ts`
      (`discern_ratchets`), `docs/_private/planning/discern-product-strategy.md`
      (vocabulary canon).
- [ ] **Rename the gate artifact `receipt` → `pass` (decided).** Standardize on
      "pass" for the artifact the gate issues: the finish envelope's
      `gate_receipt` field vs the `discern-gate-pass` file it points at — both
      words are already in the code; keep "pass". "Receipt" connotes spending
      money and paper clutter; a pass is what a gate issues, and "proof" is the
      marketing register ("Proof, not promises"). Pre-1.0 field rename is cheap.
      Evidence: the `finish` result envelope (`gate_receipt`), the
      `discern-gate-pass` marker file,
      `docs/_private/planning/discern-product-strategy.md` (vocabulary canon).
- [ ] **Proposed: rename `finish` → `done` (awaiting maintainer sign-off).**
      Recommendation is yes: `discern done` makes the verb the positioning
      ("done isn't something you say — it's something you run"), the lifecycle
      reads `start → prepare → done → graduate`, and `discern setup done`
      already established done-as-completion-verb in the product. Keep `finish`
      as a permanent alias. One honest caveat to weigh: `done` sounds read-only,
      while the gate's fix stage mutates (formats) — document "done runs your
      finishing steps, then verifies the rest". If confirmed, rename the verb,
      `discern_finish` MCP tool, docs, guidance, and templates, with the same
      alias + migration care as the baselines rename. Evidence:
      `docs/_private/planning/discern-product-strategy.md` (vocabulary canon,
      pending item).

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
