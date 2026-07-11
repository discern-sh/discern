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
  *integrating* means merging work into the mainline — this product's landing
  act. The `integrate` verb pulls the other way, trunk → branch. Its strongest
  prior points at the wrong verb.
- **A name its own config disclaims.** The `[docs]` config comment must open by
  explaining that the tree is "conceptually distinct from human-curated project
  docs," and [ADR 0100](0100-doctree-is-the-agents-map.md) already teaches the
  correct word: the tree is *the map*. A first-week user typing `discern docs`
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
reads as a sentence — *discern the status*, *discern the impact*. **Effectful
commands are imperatives** — *start*, *update*, *accept*. One deliberate
exception: **`done` is a claim, not a question** — the agent asserts "done,"
and discern verifies the claim and issues the receipt.

### The canon

| Verb | Reads as | Replaces |
| ------------- | ------------------------------------------------ | ---------- |
| `status` | what is true right now | — |
| `impact` | which parts of the gate this change wakes | `scopes` |
| `standards` | are the standards holding | `ratchets` |
| `improvement` | the single highest-value next improvement | `improve` |
| `map` | what the project knows about itself | `docs` |
| `coupling` | what historically changes together | — (kept) |
| `doctor` | is the install itself sound | — (kept) |
| `done` | claim the change clears the bar — verify it | `finish` |
| `update` | bring the trunk's latest beneath this branch | `integrate`|
| `accept` | the owner accepted — land it on the trunk | `graduate` |

`start`, `prepare`, `test`, `refresh`, `setup`, `upgrade`, `identity`,
`preset`, and `help` are unchanged. Why each contested word won:

- **`standards`** — a config entry *is* a standard: a level the codebase must
  meet, with a direction. The never-loosen rule becomes self-teaching ("never
  lower a standard"), both directions read plainly (floors rise, ceilings
  tighten), and the universal gloss stays: *numbers that can never get worse*.
  Output reports outcomes — improved, held, regressed — so the aspiration word
  lands in results, not in the name of the thing.
- **`impact`** — the user's question, not the machinery's name. Its help line
  disambiguates from `coupling`: impact is config-driven (which gate scopes
  fire), coupling is history-driven (what tends to change together).
- **`improvement`** — the noun form of the advisory verb, per the rule.
  Singular, because it returns exactly one suggestion. The word's natural
  reading ("fetch the suggested improvement") is exactly what the tool does.
- **`map`** — [ADR 0100](0100-doctree-is-the-agents-map.md)'s own language,
  promoted to the verb. A map carries the authority contract ("a stale map is
  a defect") and cannot be misread as discern's own manual. The tree stays at
  `docs/` on disk: the map is the concept, `docs/` is its address.
- **`done` / `accept`** — a handshake: the agent claims done, the owner
  accepts. `accept` names the *authorization*, not the mechanism — an agent has
  no reason to call it when nothing has been accepted — and "lands on the
  trunk" stays as the plain-prose description of the effect. The setup flow's
  landing step aligns: `setup land` → `setup accept`.
- **`update`** — the operation is strictly inbound (trunk → branch), and
  "Update branch" is the exact prior most users already hold. The `upgrade`
  adjacency is accepted: the two act on different domains (your branch vs the
  tool), both fail safe, and `upgrade` is not on the MCP surface at all.
- **`doctor` (kept)** — already a noun, and the strongest convention in the
  diagnostic genre. Familiarity matters most at the moment of breakage.
- **`coupling` (kept)** — the literal term of art for what the tool measures,
  used with its industry meaning and glossed at first use. Unlike "ratchet,"
  it is not a borrowed metaphor that needs an invented product meaning.

### Alias and retirement policy

- **No legacy aliases.** The retired spellings — `finish`, `graduate`,
  `integrate`, `ratchets`, `scopes`, `docs` — hard-error with a one-line
  redirect naming the successor. [ADR 0022](0022-rename-to-discern.md)'s
  no-shim reasoning applies verbatim: pre-1.0 there is no population to
  protect, and a permanent alias gives every job two names forever. ADR 0095
  adds the sharper reason: in an agent-read tree, a working old spelling is a
  live suggestion. The redirect table and the ADRs are the only places retired
  spellings live; the development vocabulary guard grows to enforce it.
- **Forgiveness for the current canon.** Grammatical variants forward
  silently when they resolve unambiguously: trailing-s folding
  (`impacts` → `impact`, `standard` → `standards`) plus a small verb-form
  synonym table (`improve` → `improvement` — the same job under the same stem,
  so silence is safe). The folding is a class-level rule, so new verbs enrol
  automatically. Help output teaches canonical spellings only.

### Scope and sequencing

The config tables rename with their verbs — `[ratchets]` → `[standards]`,
`[docs]` → `[map]` (with `${map.dir}` interpolation; the default directory
stays `docs/`) — via schema migration and codegen. MCP tools rename in
lockstep, and the existing parity guards force the satellites. The receipt
naming is unchanged (the 10 July 2026 decision stands), and the "harness"
retirement proceeds per-context as already planned.

Implementation lands via the wave-3 vocabulary sweep; until it lands, the tree
still speaks the old names and this ADR is the authority the sweep executes.
Historical ADRs keep the old vocabulary — only this ADR records the change.
That deliberately narrows ADR 0095's history-rewrite: the guard, not
rewriting, is what keeps retired names from teaching.

## Consequences

- Naming questions stop being taste calls. The rule decides first —
  question or action, noun or imperative — and only then is there a word to
  choose. Future verbs get named by the same two checks: does the name state
  the user's question or act, and does it lie about effects?
- The rename is breaking for any prelaunch checkout or script using the old
  spellings. Intentional, per ADR 0022's costing: this only gets more
  expensive.
- The two config-table renames are the deepest changes — `${docs.dir}` is
  interpolated through checks, scopes, and ratchet definitions in the template
  and in real configs — so both ride the migration system with tests.
- Agents' cached knowledge of the MCP tool names goes stale when the sweep
  lands. Acceptable pre-launch; the self-describing MCP surface re-teaches on
  connection.
- The lifecycle now reads as the product thesis: `start` → `prepare` →
  `done` → `accept`. The advisory loop reads as the other headline:
  `improvement` finds the change, the owner lands it, `standards` lock it in.

## Alternatives considered

- **`baselines` for `ratchets`** (the 3 July 2026 call, superseded here) — a
  baseline is a reference you compare against, not a requirement you must
  meet; "standards" carries the obligation, and "never lower your standards"
  is the contract in tagline form. The move *away from* "ratchet" stands
  unchanged; only the destination moved.
- **`progress` for `ratchets`** — broke noun-unity with the config table
  (the entries would still need their own noun) and sat confusably beside
  `status` in the help screen.
- **`improvement` for `ratchets`** — legitimate as a question-name, but the
  feature's config artifact must share the verb's noun, and a declared entry
  is not "an improvement." Failure surfaces decided it: a red run means a
  regression, and "standard not met" describes that; "no improvement" does
  not. The word's true home is the advisory verb.
- **`health` for `doctor`** — rule-satisfying, but `doctor` is already a noun
  and the convention is worth more than the prettier sentence.
- **`sync` for `integrate`** — implies reconciliation in both directions;
  this operation is strictly inbound.
- **`notes` / `memos` for `docs`** — notes undersell the authority contract
  (nobody audits notes, and stale notes are nobody's defect); memos are
  point-in-time messages, and the memo-shaped artifact already exists: ADRs.
- **`land` as the landing verb** — names the mechanism. `accept` names the
  authorization, which is the safety property an agent-run CLI wants in its
  most consequential verb.
- **Permanent aliases for every old spelling** — rejected as dual-spelling
  debt guarding a population that does not exist yet; see the retirement
  policy above.
