# Open work — icculus

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

_Dead code, N+1s, and known-slow paths worth removing or fixing. Nothing
outstanding._

## 🟡 Smaller fixes & polish

- [ ] **`init` undersells `/bootstrap` — make the handoff feel required, not
      optional.** A fresh install is non-functional until `/bootstrap` fills the
      slots and docs, but the `init` outro lists `/bootstrap` as merely "step 1
      of next steps" — easy to skip, and no developer will fill the many blanks
      by hand. Make it close to mandatory: a single loud "do this next"
      call-to-action in the outro, and/or a nudge from `doctor`/the first
      `finish` while every slot is still a no-op. Evidence:
      `src/commands/init.ts:243` (`printOutro`); the all-no-op gate nudge
      already exists at `src/engine/gate/finish.ts:243`.

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
      step rewrites. Observed needing a hand-tidy on several v3→v4 installs.
      Evidence: `src/lib/migrations.ts:281-284` (the `from: 3` step deletes the
      tables via comment-preserving `deleteSection`, leaving their comment
      blocks); target layout is `templates/.icculus/config.toml.tmpl`.

## 🟢 Test & tooling hygiene

- [ ] **Ratchet the coverage floor back up toward its pre-cutover level.** The
      single-binary cutover moved the engine into `src/` (now instrumented by
      `deno task coverage`), so the same suite covers a larger tree and src/
      line coverage fell from ~94% to ~84%. The floor was re-baselined down to
      83 to land the cutover (ADR 0019); raise it as engine coverage improves.
      Weakest spots in the post-cutover run were `src/lib/skills.ts` (~62%) and
      `src/shared/capabilities.ts` (~50%). Evidence: `.icculus/config.toml`
      `[ratchets.coverage].limit`.

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
      `Filament.md`, and `docs/AI/*`), and `/bootstrap` built a _parallel_
      numbered tree beside them — declaring `docs/README.md` the "canonical
      source of truth" while never acknowledging or folding in the existing
      docs. Several overlap directly with the new subtrees it created
      (`Stripe.md` ↔ `60-billing`, `docs/AI/` ↔ `40-ai`,
      `Mathematics.md`/`Annuities.md` ↔ `30-questions`, `Deployment.md` ↔
      `80-development`, `Filament.md` ↔ `70-admin`), leaving the developer with
      two doc systems and no guidance on reconciling them. Tackle as part of a
      broader opt-in model where a developer chooses which harness pieces to
      install rather than getting everything — and where `init`/`/bootstrap`
      detect pre-existing docs and either fold them into the tree or record them
      for folding. (Observed in the `passapp` control case; that staging area
      will be discarded and re-run, so re-confirm against a fresh run. Worth an
      ADR when designed.)
