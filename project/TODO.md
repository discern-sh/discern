# Open work — discern

The single source of truth for **outstanding work**: verified defects, deferred fixes, known dead code, and at-risk or unmerged work. The [`project/map/`](map/README.md) describes what _currently exists_; this file tracks what's _still owed_.

## For agents (any agent — and the maintainer)

- **When you defer something, descope, or find a real issue you won't fix this round, record it here.** Don't bury it in a private memory, a one-off chat reply, or a lone code comment — those are invisible to the next agent and to the maintainer. This file is the shared backlog.
- **Format:** one checkbox per item — a bold title, a one-line description, and `Evidence:` with `file:line` where it applies. Add an area tag if it helps. Keep entries terse and factual; link code with relative paths.
- **When you finish an item, delete its line** — the commit that resolves it is the record. Don't leave ticked boxes lying around.
- **Scope:** this file is for work that _outlives a single session_. For tracking the steps of the task you're doing right now, use your own in-session task tooling, not this file.
- This is a backlog, not documentation — modal verbs ("should", "could") are fine here, unlike in `project/map/`. Don't write that something was "finished this round" — that's meaningless to a future reader ("which round?"). Every item must be pickup-able at any later time with no session-specific context required.

---

<!--
  The severity buckets below are empty by design — a fresh project owes nothing
  yet. Add items under the heading that fits; create a new bucket only if none
  do. Suggested order is most-urgent first.
-->

## 🔴 Performance & correctness

_Verified defects and correctness risks. Nothing outstanding._

## 🟠 Cleanup — known dead or slow code

- [ ] **Eliminate Deno lint suppression directives.** Replace each remaining `deno-lint-ignore` or `deno-lint-ignore-file` with code that satisfies the named rule. `[standards.lint_suppressions]` prevents the census from rising; pin every reduction. At zero, move the detector into an always-on test and retire the standard. Evidence: `scripts/lint_suppressions.ts`; `project/map/80-development/code-conventions.md`.

## 🟡 Smaller fixes & polish

- [ ] **Keep the live `done` progress table visible with `[gate].stream = true`.** Coordinate streamed job output with terminal redraws: clear the table, emit each complete output line, then redraw the current job states. Account for partial lines, subprocess ANSI cursor controls, terminal resizing, interrupts, and parallel output without changing the non-TTY, CI, `--plain`, or JSON contracts. Evidence: `src/engine/gate/done_tty.ts`; `src/engine/gate/finish.ts`; `src/engine/jobs/runner.ts`.

- [ ] **Give a fired standard a completion-shaped exit: `discern standards override`.** When a breach comes from the work itself (the deliverable grew what the metric measures), the only green path today is engineering the number back down — which is how unrelated micro-optimizations creep into feature branches. Add an override verb (owner-agreed name: `discern standards override <name> --reason "…"`) that records the breach — standard, measured value, delta, reason — into the branch's gate receipt so `discern done` can pass green-with-override, and `discern accept` surfaces the recorded override to the owner at the landing moment: accepting re-pins the limit to the new value with the owner's recorded approval; declining sends the branch back. Guards to design: an override never edits the trunk limit itself (that stays an owner move on trunk), overrides are consumed at accept so none becomes a standing bypass, and the receipt names which files moved the breached metric so an offsetting edit outside the task's scope stays visible. Design follows the breach-diagnostic doctrine (report intrinsic growth; never offset it). Evidence: `src/engine/gate/standards.ts` (`compareValueToLimit` — the diagnostic that now routes agents here); `src/engine/gate/receipt.ts` (the receipt the override would join); `project/map/20-quality-gate/standards.md` (§Choose a number that survives growth).

- [ ] **Complete the manual accessibility journeys before making the site public.** Automated checks pass. Test the live site with VoiceOver; keyboard-only navigation; 200% zoom; a narrow viewport; reduced motion; print preview; and JavaScript disabled. Define and exercise the supported-browser matrix, then verify computed color contrast in both themes.

- [ ] **Revisit generated-artifact user-content preservation only with a non-inference design.** A previous attempt rescued edits from ignored generated agent files and materialized skill dirs by diffing on-disk content against local ignored baselines. That was reverted: ignored files have no reliable authorship signal, and the first refresh after discern's own shipped guidance changed could rescue stale generated prose as if it were user-authored content. Revisit only if the design avoids inferring meaningful user edits from ignored generated artifacts, or if real user incidents make the trade-off worth re-opening. Evidence: `project/map/_adr/_superseded/0091-rescue-generated-content-before-overwrite.md`; `src/engine/guidelines.ts`; `src/lib/skills.ts`.

- [ ] **`setup`/`upgrade` `--json` report `ok:true` when agent-guidance compilation failed.** The primary operation (scaffold / migrate + stamp) did succeed and the failure IS surfaced in a sub-field (`compiled:[]` / `guidelines_compiled:false`), and guidance is regenerable via `discern refresh` — so this is defensible, not a clear bug. But a consumer keying on top-level `ok` won't learn the agent files didn't compile. Decide whether `ok` should reflect a secondary-artifact failure, and apply it consistently across all verbs, not just the installer.

- [ ] **Keep HTML comments out of map search excerpts and terminal doc rendering.** Map pages carry structural HTML comments — the generated-section banners, and now the `<!-- discern-workflow:… -->` directives — and they leak into surfaces meant for reading: `discern_map` search excerpts hand them to agents as context, and `discern docs`' terminal rendering shows them to end users. Strip comments in the excerpt builder and the human Markdown renderer as a display concern only — the raw `.md`, MCP, and negotiated-text routes serve pristine bytes by contract (see the browser-workflow projection decision in `project/map/_adr/0205-browser-workflow-semantics-are-explicit-markdown-projections.md`) and must stay byte-identical. Evidence: `src/lib/docs_search.ts:359` (excerpt builder); `src/commands/docs.ts` + `src/lib/markdown.ts` (terminal rendering).

- [ ] **Tier-1 diagnostics: declared text formats (the `[diagnostics.<name>]` regex slice).** `done` normalizes a failed tool's output into structured `{file,line,rule}` diagnostics only when the tool emits **SARIF** (auto-detected — [ADR 0028](map/_adr/0028-result-envelope-and-diagnostics.md)). Tools that emit only human text (the common case for many linters/compilers without a SARIF flag) still carry their raw output (Tier 0). The planned next slice: a `[diagnostics.<name>]` config table letting a job declare a `format = "regex"` + `pattern` (named groups `file`/`line`/`col`/`rule`/`message`) so discern parses text output too. Deferred because it needs a config-surface decision (a new section + schema + codegen + the `[jobs]` value shapes) that SARIF needed none of; worth its own small ADR. Wire it into `normalizeDiagnostics`. Evidence: `src/engine/gate/diagnostics.ts` (`normalizeDiagnostics` — SARIF only); `src/engine/gate/plan.ts` (`buildGateResult` calls it).

## 🟢 Test & tooling hygiene

- [ ] **Scaffold the CI gate workflow once releases are public.** The docs now give a pasteable GitHub Actions recipe, but launch still needs the public repo/version values re-checked and a later `setup`/binary affordance that writes the workflow for users. Evidence: `project/map/20-quality-gate/ci.md`.

## 🔵 Unmerged / at-risk work — decide: land or drop

_Work built but not merged, or otherwise at risk of being lost. Nothing outstanding._

## ⚪ Explorations / ideas (unscheduled)

_Nothing queued._

## 📣 Marketing & positioning

_Product positioning, messaging, and launch/content tasks._

- [ ] **Site launch blocker: make `brew install discern` real.** The plaintext edition leads with it. Stand up the tap or switch the copy to the install path that will exist at launch. Evidence: `site/text/discern.txt`.
- [ ] **Site launch: create the Deno Deploy org + app and point DNS.** One-time account/DNS work only the maintainer can do, on the new `console.deno.com` (Deploy Classic shuts down 2026-07-20); the steps are written up in `project/map/90-site/publishing.md`.
- [ ] **Make "author once → compile everywhere" + per-agent wiring a first-class message.** discern compiles one `project/guidance.md` into every vendor's agent files and wires each agent's exact guidance file, skills dir, MCP, and hooks — most tools just say "supports Claude, Codex, Gemini". Elevate this from a buried detail to a headline principle in external docs and landing copy.
- [ ] **Use self-hosting as launch credibility.** "discern is developed under its own gate" proves the flow is real, the docs discipline is tolerable, and the gate isn't theoretical — the best possible demo. Put it in launch material.
- [ ] **Coin: "the project gets smarter over time".** A candidate tagline for the website/copy, capturing how the `discern-teach-the-project` skill routes each session's lessons back into discern (guidance, skills, Project Scripts, docs, ADRs) so every future agent — of any vendor — inherits them. Drop it in when the messaging is ready.
- [ ] **Coin: "taste is the human's contribution."** Candidate positioning for the whole product: discern's story is a human/agent collaboration in which agents write the implementation and the human supplies the technical and creative direction — the taste — with discern as the instrument that makes that direction durable and enforceable (guidance compiled to every agent, standards that only tighten, the gate, the map). The aspirational note to strike: an owner should feel responsible for the bar their project holds even when they write almost none of its code. Siblings: "the project gets smarter over time" (the project learns) and "grows your discernment" (the user learns); this one says why the human stays in the loop at all. Mind the voice skill's handle-with-care list ("taste" in first-contact copy) when this lands — this concept is the case that earns it. First articulated while reshaping the eighth bundled skill, whose preamble frames discern's own codebase this way. When that skill gets its public mention, "steal our playbook" is the candidate CTA — the idiom sells it in copy while the sober name (`discern-write-it-once`) stays on the artifact. Evidence: `templates/skills/discern-write-it-once/SKILL.md` (preamble).
- [ ] **Explore: "grows your discernment" as a marketing angle.** Some bundled skills don't just guard quality, they teach it: `discern-shape-the-work` interrogates a vague ask with consequence-level questions (empty input? repeated action? two actors at once?), and each well-put question hands the user a category of concern they keep for their next ask. For the wave-2 audience with enthusiasm but not yet judgment, this reframes discern from a gate that says no into a mentor that compounds — and it puns on the product name. Sibling of "the project gets smarter over time" (that one is the _project_ learning; this one is the _user_ learning). Candidate for landing copy. Evidence: `templates/skills/discern-shape-the-work/SKILL.md` (§4).

## 👨‍💻 Jack's Odds and Ends

_Small things Jack finds whilst reviewing code and documentation; cleaned up periodically in maintenance batches._

- [ ] Discern should make clear to end-users that the `map` feature, and the documentation subtree procedures, are _conceptually distinct_ from any existing documentation the user has already set up in their project. The reason for this is that the map represents _what can be inferred from the user's codebase_ - which is what matters to their coding agents - and likely diverges from what they would consciously choose to document already. This is a teaching opportunity as it can be hard to understand for new users, so should be folded in to `discern improvement` and throughout our own docs, guidance, and reference materials.
- [ ] Fan-out agentic review/rewrite for public-facing audiences of all documentation (Vale prose lint is now wired — see `[standards.prose]`); plus all ADRs. Once complete, ensure agents know future documentation changes will be publicly visible to end-users, including future ADRs.
- [ ] Conduct a general-purpose thorough "consistency review" - establish all aspects of the platform use the same conventions consistently everywhere.
