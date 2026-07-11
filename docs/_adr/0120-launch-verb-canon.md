# ADR 0120: The launch verb canon — questions are nouns, actions are imperatives

**Status**: accepted

## Context

[ADR 0095](0095-prelaunch-cli-vocabulary.md) gave the prelaunch CLI one
canonical spelling per job, but it standardized the names the surface already
had. Since then, a July vocabulary workshop (recorded in the product-strategy
document's vocabulary canon and in `TODO.md`) settled further renames one word
at a time — `finish` → `done`, `graduate` → `accept`, a replacement for
"ratchet" — each argued on its own merits, with no governing rule. Word-by-word
taste calls kept reopening: every new candidate re-litigated the last one.

A final review of the whole verb surface, held before the wave-3 vocabulary
sweep dispatches, found the remaining names failing in reproducible ways:

- **Implementation-shaped names.** `scopes` names the engine's classification
  machinery, not the user's question ("what does this change wake up?").
  `ratchets` names a mechanism, needs a gloss at every first use, and carries
  associations the strategy document records as fatal for a quality tool.
- **A directionally misleading name.** In continuous-integration vocabulary,
  _integrating_ means merging work into the mainline — this product's landing
  act. The `integrate` verb pulls the other way, trunk → branch. Its strongest
  prior points at the wrong verb.
- **A name its own config disclaims.** The `[docs]` config comment must open by
  explaining that the tree is "conceptually distinct from human-curated project
  docs," and [ADR 0100](0100-doctree-is-the-agents-map.md) already teaches the
  correct word: the tree is _the map_. A first-week user typing `discern docs`
  plausibly wants discern's own manual, which is `help`'s job.
- **Guidance that translates a verb into the word it should have been.** The
  bundled guidance must say "`discern_finish` is the bar for done" — the
  teaching sentence contains the better name.

This is the last cheap moment. As [ADR 0022](0022-rename-to-discern.md) and
[ADR 0009](0009-one-point-zero-drop-backward-compat.md) argued for earlier
breaking changes, pre-1.0 with no installed base is when a rename costs least —
and every one of these names becomes a public contract at launch.

## Decision

**Adopt one naming rule, derive the verb canon from it, and land the renames
with no legacy aliases.**

### The rule

`discern` is itself a verb. **Read-only commands are nouns**, so every question
reads as a sentence — _discern the status_, _discern the impact_. **Effectful
commands are imperatives** — _start_, _update_, _accept_. One deliberate
exception: **`done` is a claim, not a question** — the agent asserts "done," and
discern verifies the claim and issues the receipt.

### The canon

| Verb          | Reads as                                     | Replaces    |
| ------------- | -------------------------------------------- | ----------- |
| `status`      | what is true right now                       | —           |
| `impact`      | which parts of the gate this change wakes    | `scopes`    |
| `standards`   | are the standards holding                    | `ratchets`  |
| `improvement` | the single highest-value next improvement    | `improve`   |
| `map`         | what the project knows about itself          | `docs`      |
| `coupling`    | what historically changes together           | — (kept)    |
| `doctor`      | is the install itself sound                  | — (kept)    |
| `done`        | claim the change clears the bar — verify it  | `finish`    |
| `update`      | bring the trunk's latest beneath this branch | `integrate` |
| `accept`      | the owner accepted — land it on the trunk    | `graduate`  |

`start`, `prepare`, `test`, `refresh`, `setup`, `upgrade`, `identity`, `preset`,
and `help` are unchanged. Why each contested word won:

- **`standards`** — a config entry _is_ a standard: a level the codebase must
  meet, with a direction. The never-loosen rule becomes self-teaching ("never
  lower a standard"), both directions read plainly (floors rise, ceilings
  tighten), and the universal gloss stays: _numbers that can never get worse_.
  Output reports outcomes — improved, held, regressed — so the aspiration word
  lands in results, not in the name of the thing.
- **`impact`** — the user's question, not the machinery's name. Its help line
  separates it from `coupling`: impact is config-driven (which gate scopes
  fire), coupling is history-driven (what tends to change together).
- **`improvement`** — the noun form of the advisory verb, per the rule (the
  retired imperative also lied about effects: `improve` sounds like it mutates,
  but the surface only advises). The full surface is an audit — a health score,
  per-category rules, open judgement reviews — yet the name stays singular
  because it states the headline contract, not the report's size: everything in
  the audit funds one deliverable, the single highest-value next action, and the
  loop is find it, land it, lock it in. The breadth belongs in the help line;
  `improvements` and `improve` both forward via forgiveness.
- **`map`** — [ADR 0100](0100-doctree-is-the-agents-map.md)'s own language,
  promoted to the verb. A map carries the authority contract ("a stale map is a
  defect") and cannot be misread as discern's own manual. The tree moves to
  `map/` on disk too: keeping the retired name as the address would recreate the
  defect this rename fixes — a name every gloss must disclaim ("the map — it
  lives at `docs/`") — and a dedicated default directory ends the collision with
  the human-curated `docs/` most host projects already have. The directory stays
  configurable for projects that want another address.
- **`done` / `accept`** — a handshake: the agent claims done, the owner accepts.
  `accept` names the _authorization_, not the mechanism — an agent has no reason
  to call it when nothing has been accepted — and "lands on the trunk" stays as
  the plain-prose description of the effect. The setup flow's landing step
  aligns: `setup land` → `setup accept`.
- **`update`** — the operation is strictly inbound (trunk → branch), and "Update
  branch" is the exact prior most users already hold. The `upgrade` adjacency is
  accepted: the two act on different domains (your branch vs the tool), both
  fail safe, `upgrade` is not on the MCP surface at all, and `update` refuses on
  the trunk — exactly where someone who meant `upgrade` would be standing. The
  freshening trio (`update` / `upgrade` / `refresh`) stays unambiguous through
  object-first help lines — "Update _this branch_…", "Upgrade _discern
  itself_…", "Refresh _the generated agent files_…" — each cross-linking the
  other two.
- **`doctor` (kept)** — already a noun, and the strongest convention in the
  diagnostic genre. Familiarity matters most at the moment of breakage.
- **`coupling` (kept)** — the literal term of art for what the tool measures,
  used with its industry meaning and glossed at first use. Unlike "ratchet," it
  is not a borrowed metaphor that needs an invented product meaning.

### Descriptions carry the priors

The renames make agents' trained tool-selection vocabulary stale, so the MCP
tool descriptions and help lines deliberately anchor each verb to the words
agents already hold, woven in naturally: `impact` speaks of the gate **scopes**
it wakes ("scope" stays product vocabulary for a gate section — only the verb
spelling retires), `update` says "merge the trunk's latest (`main`) into this
branch", `done` names its stages — format, lint, type-check, tests — and
`improvement` advertises its full surface (the ranked next action plus the
health audit and open reviews behind it). Two bounds hold: never present a
retired spelling as a callable name, and `standards` stays free of "ratchet" —
the associations that retired the word apply to descriptions too, and "limits
that may only improve" routes well enough. Descriptions, unlike names, are not
contracts: if post-launch use shows agents picking the wrong tool, tune them in
a patch.

### Alias and retirement policy

- **No legacy aliases.** The retired spellings — `finish`, `graduate`,
  `integrate`, `ratchets`, `scopes`, `docs` — hard-error with a one-line
  redirect naming the successor. [ADR 0022](0022-rename-to-discern.md)'s no-shim
  reasoning applies verbatim: pre-1.0 there is no population to protect, and a
  permanent alias gives every job two names forever. ADR 0095 adds the sharper
  reason: in an agent-read tree, a working old spelling is a live suggestion.
  The redirect table and the ADRs are the only places retired spellings live;
  the development vocabulary guard grows to enforce it. A retired _spelling_
  means a verb position — a CLI invocation, an MCP tool name, a config key —
  never an English prose word: the sweep itself must write "finishing steps" in
  `done`'s help, and prose about documentation may still say "docs", so the
  guard matches invocations, not words.
- **Forgiveness for the current canon.** Grammatical variants forward silently
  when they resolve unambiguously: trailing-s folding (`impacts` → `impact`,
  `standard` → `standards`) plus a small verb-form synonym table (`improve` →
  `improvement` — the same job under the same stem, so silence is safe). The
  folding is a class-level rule, so new verbs enrol automatically. Help output
  teaches canonical spellings only.

### Scope and sequencing

The config tables rename with their verbs — `[ratchets]` → `[standards]`,
`[docs]` → `[map]` (with `${map.dir}` interpolation) — via schema migration and
codegen. The tree's default directory becomes `map/` for fresh setups; migrating
an existing config pins its effective directory explicitly, so no installed tree
moves out from under its project; and this repo adopts the new default — its
tree moves wholesale (`git mv docs/ map/`), historical ADR content untouched.
MCP tools rename in lockstep, and the existing parity guards force the
satellites. The receipt naming is unchanged (the July 10, 2026 decision stands),
and the "harness" retirement proceeds per-context as already planned.

Implementation lands via the wave-3 vocabulary sweep; until it lands, the tree
still speaks the old names and this ADR is the authority the sweep executes.
Historical ADRs get a reviewed vocabulary refresh, not a blind rewrite. Where a
decision still governs a living feature, its incidental references update to the
canon under a one-line amendment note naming this ADR and the spellings that
changed — the note keeps the old name searchable while the body speaks the
present. Where an ADR's subject was the retired word itself, or a later decision
replaced it, its content stays intact — moved to `_superseded/` per that
folder's convention if it no longer applies, inbound links fixed. Decisions and
their reasoning are never rewritten: names are pointers, and after a global
rename the pointers dangle; refreshing a pointer is not revising history. This
revises the first draft's "historical ADRs keep the old vocabulary" stance,
which would have left dozens of live decisions describing current features under
dead names — invisible to a search for the new name, and teaching retired
spellings to every agent that reads them (this ADR's own live-suggestion
argument). ADR 0095's full history-rewrite stays narrowed all the same: the
guard, not rewriting, is what keeps retired names out of shipped surfaces.

## Consequences

- Naming questions stop being taste calls. The rule decides first — question or
  action, noun or imperative — and only then is there a word to choose. Future
  verbs get named by the same two checks: does the name state the user's
  question or act, and does it lie about effects?
- The rename is breaking for any prelaunch checkout or script using the old
  spellings. Intentional, per ADR 0022's costing: this only gets more expensive.
- The two config-table renames are the deepest changes — `${docs.dir}` is
  interpolated through checks, scopes, and ratchet definitions in the template
  and in real configs — so both ride the migration system with tests. The
  `[map]` rename also moves this repo's own tree on disk, so every recorded path
  — root README, `TODO.md`, tests, prose-check targets — moves with it, and the
  map's ownership becomes physical: discern's output lives at `map/`; the host
  project's own documentation stays wherever it always was.
- Agents' cached knowledge of the MCP tool names goes stale when the sweep
  lands. Acceptable pre-launch; the self-describing MCP surface re-teaches on
  connection.
- The lifecycle now reads as the product thesis: `start` → `prepare` → `done` →
  `accept`. The advisory loop reads as the other headline: `improvement` finds
  the change, the owner lands it, `standards` lock it in.

## Alternatives considered

- **`baselines` for `ratchets`** (the July 3, 2026 call, superseded here) — a
  baseline is a reference you compare against, not a requirement you must meet;
  "standards" carries the obligation, and "never lower your standards" is the
  contract in tagline form. The move _away from_ "ratchet" stands unchanged;
  only the destination moved.
- **`progress` for `ratchets`** — broke noun-unity with the config table (the
  entries would still need their own noun) and sat confusingly close to `status`
  in the help screen.
- **`improvement` for `ratchets`** — legitimate as a question-name, but the
  feature's config artifact must share the verb's noun, and a declared entry is
  not "an improvement." Failure surfaces decided it: a red run means a
  regression, and "standard not met" describes that; "no improvement" does not.
  The word's true home is the advisory verb.
- **`improvements` (plural) for the advisory verb** — honest about the size of
  the report behind the answer, wrong about its contract: the open items are
  reviews (questions pending judgement), not improvements, and a plural name
  presents the tool as a backlog generator — the overwhelm the one-ranked-action
  design exists to prevent. Trailing-s folding accepts the plural spelling
  anyway; the canon teaches the cadence.
- **`health` for `doctor`** — rule-satisfying ("discern the health" reads better
  than "discern the doctor"), but `doctor` is already a noun, the strongest
  convention in the genre, and unambiguous: agents' trained prior for "health"
  is service liveness, which routes project-health questions here instead of to
  `status` or `standards`, while `doctor` uniquely means "diagnose the tool's
  own install". A `doctor` alias under a `health` canon was also rejected — it
  would be the canon's first true synonym alias, two names forever on the
  least-typed verb, in the document that bans them.
- **`sync` for `integrate`** — implies reconciliation in both directions; this
  operation is strictly inbound.
- **`notes` / `memos` for `docs`** — notes undersell the authority contract
  (nobody audits notes, and stale notes are nobody's defect); memos are
  point-in-time messages, and the memo-shaped artifact already exists: ADRs.
- **Keeping the tree at `docs/` while the verb renames** (this ADR's first
  draft) — "the map is the concept, `docs/` is its address" defended an
  inconsistency: every gloss would carry the disclaimer forever, and the retired
  word would survive as a path on every surface, needing a permanent carve-out
  from the guard that retires it. The address follows the concept.
- **Freezing historical ADRs in the old vocabulary** (this ADR's first draft) —
  treated immutability of _decisions_ as immutability of _words_. Live features
  described under dead names fail retrieval in both directions and keep the
  decision record teaching retired spellings to every agent that reads it; the
  reviewed amendment — notes on record, git preserving the originals — keeps
  history honest while making it findable.
- **`land` as the landing verb** — names the mechanism. `accept` names the
  authorization, which is the safety property an agent-run CLI wants in its most
  consequential verb.
- **Permanent aliases for every old spelling** — rejected as dual-spelling debt
  guarding a population that does not exist yet; see the retirement policy
  above.
