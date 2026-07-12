# Open work — discern

The single source of truth for **outstanding work**: verified defects, deferred
fixes, known dead code, and at-risk or unmerged work. The
[`map/`](map/README.md) tree describes what _currently exists_; this file tracks
what's _still owed_.

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
  fine here, unlike in `map/`. Don't write that something was "finished this
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

- [ ] **Version the public JSON result contract before launch.** The generated
      result schema currently uses a mutable `main`-branch `$id`, which is fine
      while the contract is pre-launch but too slippery for consumers pinning a
      public validation target. Before calling the result contract stable, move
      it to an immutable/versioned identity (for example a `schema/v1/...` path
      with a documented compatibility policy, or a release-tag/domain URL), and
      consider adding a top-level `schema_version: 1` field to every
      `DiscernResult` envelope so raw `--json` output identifies its contract
      without out-of-band knowledge. Decide whether the version tracks only
      breaking schema changes or the discern release line, then document that in
      the result-envelope docs. Evidence: `src/shared/result_codegen.ts`
      (`RESULT_SCHEMA_ID`); `schema/discern-results.schema.json`;
      `map/20-quality-gate/the-result-envelope.md`.

- [ ] **Revisit when agents should run standards in the lifecycle.** The current
      guidance intentionally says to run standards "as needed" and keeps them
      slow/on-demand, with non-dry-run checks requiring a clean tree. Revisit
      after observing real agent sessions: we may want sharper timing language
      than "as needed" without reintroducing remote-push assumptions or causing
      repeated slow runs during iteration. Evidence:
      `templates/guidance/standards.md`; `src/engine/mcp/server.ts`;
      `src/engine/gate/standards.ts`.

- [ ] **Revisit generated-artifact user-content preservation only with a
      non-inference design.** A previous attempt rescued edits from ignored
      generated agent files and materialized skill dirs by diffing on-disk
      content against local ignored baselines. That was reverted: ignored files
      have no reliable authorship signal, and the first refresh after discern's
      own shipped guidance changed could rescue stale generated prose as if it
      were user-authored content. Revisit only if the design avoids inferring
      meaningful user edits from ignored generated artifacts, or if real user
      incidents make the trade-off worth re-opening. Evidence:
      `map/_adr/_superseded/0091-rescue-generated-content-before-overwrite.md`;
      `src/engine/guidelines.ts`; `src/lib/skills.ts`.

- [ ] **`setup`/`upgrade` `--json` report `ok:true` when agent-guidance
      compilation failed.** The primary operation (scaffold / migrate + stamp)
      did succeed and the failure IS surfaced in a sub-field (`compiled:[]` /
      `guidelines_compiled:false`), and guidance is regenerable via
      `discern refresh` — so this is defensible, not a clear bug. But a consumer
      keying on top-level `ok` won't learn the agent files didn't compile.
      Decide whether `ok` should reflect a secondary-artifact failure, and apply
      it consistently across all verbs, not just the installer.

- [ ] **Tier-1 diagnostics: declared text formats (the `[diagnostics.<name>]`
      regex slice).** `done` normalizes a failed tool's output into structured
      `{file,line,rule}` diagnostics only when the tool emits **SARIF**
      (auto-detected —
      [ADR 0028](map/_adr/0028-result-envelope-and-diagnostics.md)). Tools that
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

- [ ] **Per-capability `[gate].timeout` overrides.** `[gate].timeout` is one
      GLOBAL budget applied to every job the gate runs
      ([ADR 0108](map/_adr/0108-gate-job-timeout.md)). A slow suite raises the
      single number; there is no per-capability / per-check / per-scope
      override. Deferred as the same config-value-shape decision the Tier-1
      diagnostics entry above defers: a capability value is a bare
      command-or-list today, and per-job budgets would need a table form
      (`{ run = "…", timeout = N }`) plus schema/codegen/template work — heavier
      than the global bound, which already closes the hang. Add only if real
      projects hit a case one generous budget can't serve. Evidence:
      `src/shared/config_schema.ts` (`gateSection.timeout`);
      `src/engine/gate/execute.ts` (`gateRunContext` sets one `timeoutS` for the
      whole run).

## 🟢 Test & tooling hygiene

- [ ] **Scaffold the CI gate workflow once releases are public.** The docs now
      give a pasteable GitHub Actions recipe, but launch still needs the public
      repo/version values re-checked and a later `setup`/binary affordance that
      writes the workflow for users. Evidence: `map/20-quality-gate/ci.md`.
      (`timed out waiting for MCP response after
      5000ms`).

## 🔵 Unmerged / at-risk work — decide: land or drop

_Work built but not merged, or otherwise at risk of being lost. Nothing
outstanding._

## ⚪ Explorations / ideas (unscheduled)

- [ ] **Review the coupling advisory's judgment constants across diverse repos,
      then consider on-by-default.** `coupling` is zero-config, but its three
      fixed constants (`LLR_CUTOFF`, `MIN_CONFIDENCE`, and `MIN_COCHANGES`)
      carry the product claim that the calibration generalizes across repo
      cultures. They are principled and were validated against _this_ repo's
      history as well as several other repos available at the time, but deleting
      every knob also deleted any recourse if a very different repo (a huge
      monorepo, or one with very different commit habits) reads too noisy or too
      quiet. Experiment with these across several repos of different
      size/age/commit-style; confirm the genuine-vs-incidental boundary holds
      (or learn where it doesn't). Once they are trusted, consider flipping
      `[coupling].in_gate` to default **on** so the diff-aware nudge rides with
      `done` out of the box. Also worth weighing then: localising the mined
      window to the change-set files for huge monorepos, and a formal
      multiple-testing correction (today bounded only by the top-k output cap).
      Evidence: `src/engine/coupling/coupling.ts` (the constants), `[coupling]`
      in `discern.toml`
      ([ADR 0084](map/_adr/0084-co-change-coupling-advisory.md)).

- [ ] **`discern improvement` candidates + a `// discern-coupled-to:`
      declaration marker — the discovery→enforcement bridge as a deliberate
      review, with state.** `coupling` (ADR 0084) _discovers_ co-change pairs
      and nudges per-change; ADR 0051's forcing functions _enforce_ the ones
      that are essential invariants. Nothing today bridges the two as a
      periodic, considered review — and nothing remembers which couplings a
      human has already judged, so any standing surface re-serves the same
      advice forever.

## 📣 Marketing & positioning

_Product positioning, messaging, and launch/content tasks._

- [ ] **Site launch blocker: self-host fonts and precompile Tailwind.** Every
      page under `site/pages/` loads Tailwind from a CDN and fonts from Google
      Fonts while claiming "no analytics on this page" — third-party requests
      that log visitor IPs undercut the claim, and the runtime Tailwind compile
      costs a visible style flash. Before pointing discern.sh DNS at the site:
      download the woff2 files into `site/pages/assets/`, compile each page's
      `@theme` block to static CSS, and drop both third-party origins. Then say
      so on the page — "view source: no third-party requests" is on-brand.
      Evidence: `site/pages/*.html` (fonts.googleapis.com, cdn.jsdelivr.net).
- [ ] **Site launch blocker: make `brew install discern` real.** All four site
      pages and the plaintext edition lead with it. Stand up the tap (or switch
      the copy to the install path that will exist at launch) before the pages
      go public. Consider a `curl`-pipe installer as the secondary path for the
      `/start` audience, who often lack Homebrew. Evidence: `site/pages/*.html`,
      `site/text/discern.txt`.
- [ ] **Site launch: create the Deno Deploy project and point DNS.** One-time
      account/DNS work only the maintainer can do; the steps are written up in
      `map/90-site/publishing.md`.
- [ ] **Regenerate the homepage receipt at deploy time.** The `/` receipt
      section bakes numbers from a real `discern done` run recorded at build
      time. Automate refreshing it (a small script that runs the gate, reads the
      envelope, and rewrites the receipt values) as part of the deploy flow, so
      the artifact always cites a current run. Evidence: `site/pages/index.html`
      (#receipt).
- [ ] **Re-capture the /agents DIAGNOSTICS transcript for real before launch.**
      The man page states its example output is "genuine output, captured 3 July
      2026 … nothing shown is altered" — inherited from the mockup. Reproduce
      the one-character defect for real, capture the actual
      `discern test --json` envelope and the passing `discern done`, and swap
      the numbers in; the page's honesty framing depends on it. Evidence:
      `site/pages/agents.html` (§DIAGNOSTICS).

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
      routes each session's lessons back into discern (guidance, skills,
      recipes, docs, ADRs) so every future agent — of any vendor — inherits
      them. Drop it in when the messaging is ready.
- [ ] **Explore: "grows your discernment" as a marketing angle.** Some bundled
      skills don't just guard quality, they teach it: `discern-shape-the-work`
      interrogates a vague ask with consequence-level questions (empty input?
      repeated action? two actors at once?), and each well-put question hands
      the user a category of concern they keep for their next ask. For the
      wave-2 audience with enthusiasm but not yet judgment, this reframes
      discern from a gate that says no into a mentor that compounds — and it
      puns on the product name. Sibling of "the project gets smarter over time"
      (that one is the _project_ learning; this one is the _user_ learning).
      Candidate for landing copy. Evidence:
      `templates/skills/discern-shape-the-work/SKILL.md` (§4).

## 👨‍💻 Jack's Odds and Ends

_Small things Jack finds whilst reviewing code and documentation; cleaned up
periodically in maintenance batches._

- [ ] Discern should make clear to end-users that the `map` feature, and the
      documentation subtree procedures, are _conceptually distinct_ from any
      existing documentation the user has already set up in their project. The
      reason for this is that the map represents _what can be inferred from the
      user's codebase_ - which is what matters to their coding agents - and
      likely diverges from what they would consciously choose to document
      already. This is a teaching opportunity as it can be hard to understand
      for new users, so should be folded in to `discern improvement` and
      throughout our own docs, guidance, and reference materials.
- [ ] Fan-out agentic review/rewrite for public-facing audiences of all
      documentation (Vale prose lint is now wired — see `[standards.prose]`);
      plus all ADRs. Once complete, ensure agents know future documentation
      changes will be publicly visible to end-users, including future ADRs.
- [ ] Conduct a general-purpose thorough "consistency review" - establish all
      aspects of the platform use the same conventions consistently everywhere.
