---
name: discern-voice-and-tone
description:
  House voice for everything a user or visitor might read in discern — README, the documentation map (the public docs on the site, in `discern help`, and over MCP), guides, error messages, CLI help and output, UI microcopy, empty states, landing and feature pages, taglines, launch posts, and user-facing release notes. Use whenever writing, editing, or reviewing user-facing prose of any length, even a single error string, button label, or example value, and even if the task doesn't mention voice, tone, or style. Out of scope: code comments, commit messages, ADRs (dated records), and `_private/` notes. For map pages, the documenter brief owns structure, facts, and lengths; this skill owns register. Canonical technical terms are never renamed for style. This is an internal skill for the discern repo itself.
---

# discern: voice and tone

Everything public-facing in discern should sound like one person: a sharp engineer who is glad you showed up. They tell you the exact truth. They've formed opinions and will share them. They talk like a human being. And about once per page, they say something that makes you smile.

That's four distinct qualities, layered in priority order:

1. **Precision** — the substance. Say the true, specific, _sourced_ thing.
2. **Conviction** — the structure. Take a stance and stand on it.
3. **Warmth** — the register. A friend, not a vendor.
4. **Delight** — the garnish. One well-placed surprise, then stop.

When two collide, the earlier one wins. Never bend a fact to land a joke. Never soften a recommendation to seem agreeable. Delight goes on last and must cost nothing: if a playful line would displace information, cut the playful line.

Two failure modes flank this voice, and both are fatal. Run too hot and you get hype: adjectives, exclamation points, manufactured excitement. Run too cold and you get a spec sheet: technically true and completely unread. The layers exist to keep you off both rocks. Precision guards against hype. Warmth and delight guard against the spec sheet. Cutting the life out of a page is not a safe default; it's the second failure mode.

When editing copy that predates this guide, bring it up to this standard rather than matching the old tone around it.

## Scope and governance

**The map is in scope.** The documentation tree at `project/map/` is the public docs — the same pages render on the site, in `discern help`, and over MCP — so every published page holds this voice. Not in scope: `_adr/` (dated decision records — fix a dead link, never re-tone), `_private/` (unshipped), code comments, and commit messages. `_internal/` methodology docs follow the docs register too; they just ship to no reader, so judge them loosely.

**One hierarchy governs map pages.** The [documenter brief](../../map/_internal/documenter-agent-brief.md) owns _structure_: which pages exist, each page's one job, its section shapes, its facts, and its length budget. This skill owns _register_: how the prose sounds inside those structures. A question about shape or size is answered by the brief; a question about word choice, stance, or temperature is answered here.

That resolves the section-README collision the two documents used to have: a section `README.md` takes the brief's structure (the word budget, the closing leaf table) and this skill's overview register — precision high, conviction present, warmth present, delight at most one, and zero is fine.

## 1. Precision — say the true, specific thing

The reader is smart. They're missing context, not capability. Writing that pads, hedges, or gushes wastes their time and insults them; writing that hands them exact, verifiable facts respects them. Precision is also the trust engine for the other three layers. Opinions and jokes only land because the reader has learned that every plain statement here is true.

Do this:

- Prefer the number, the name, the limit, the default. "One file: `discern.toml`" beats "a minimal footprint." "624 tests passed in 8.9s" beats "blazing fast."
- Make every adjective survive the question _compared to what?_ If it can't answer, replace it with the fact that earned it, or cut it.
- Choose exact verbs. The parser _rejects_ the config; it doesn't "have trouble with" it.
- State limits and failure modes as plainly as features. "Not supported on Windows" belongs on the first screen, not in a footnote.
- Define a term once, then use it identically everywhere. Rotating synonyms for variety reads as four different concepts.
- No poetic near-misses. Never use jargon for flavor, and never use a metaphor that collapses under two seconds of scrutiny.

**Claims come from source material.** Every specific fact traces to the docs, the code, command output, tests, release notes, or something the user explicitly told you. Never invent numbers, benchmarks, integrations, guarantees, defaults, security properties, or supported agents to satisfy the "prefer the number" rule. Fake specificity is worse than honest vagueness. When the exact fact isn't available: get it, weaken the claim until it's literally true, or mark it `[claim — verify]`. Finished copy must survive a hostile literal reading; a skeptical reader should never be able to say "that's not what those words mean" or "that's not always true."

**Keep the temperature of the prose below the temperature of the facts.** discern does something close to science fiction, so write about it like plumbing. When the prose gets excited, the reader stops being excited on the product's behalf. State the impressive fact flatly and let the reader supply the awe. Note what this rule bans: excitement. Not personality. Cool is not the same as flat, and the warmth and delight layers still apply at full strength.

**Before:** "A powerful, seamless quality gate for the modern agentic workflow."

**After:** "Your repo declares its checks once, in `discern.toml`. Every agent reads the same instructions and runs the same commands."

The test: could the sentence appear in a competitor's docs unchanged? Then it says nothing about discern. Make it specific until it couldn't.

## 2. Conviction — take a stance and stand on it

discern exists because of a belief about how something should work. State that belief in short, declarative sentences and let it stand. A menu of equally weighted options outsources the decision to the reader, the only person in the room who hasn't spent months inside this problem. You have. Decide.

Do this:

- Recommend one way. When alternatives exist, name a default and give the reason: "Use X. It's the default because Y. If you need Z, here's the escape hatch."
- Kill reflexive hedging. "You may want to consider enabling" → "Enable." Keep a hedge only for genuine uncertainty, and then be precise about what's uncertain.
- Say what discern is _not_ for, early and cheerfully. Sending the wrong user to the right tool earns more trust than any feature list.
- Write short sentences, one idea each. Full stops over semicolons. Vary the rhythm, but never nest clauses to sound sophisticated.
- Aim conviction at ideas and industry defaults, never at named competitors and never at readers who chose differently.

**Before:** "There are several approaches to enforcing quality, and the best choice depends on your team's workflow and preferences."

**After:** "Declare the checks in the repo. Agents come and go; the repo is the thing that persists, so the repo holds the rules."

The test: does the page contain at least one statement a reasonable person could disagree with? If not, it has no point of view. It's a spec, not a voice.

## 3. Warmth — a friend, not a vendor

Write like a competent friend explaining something across the table: plain words, contractions, direct address, honesty about what we got wrong. Warmth is not perkiness. No exclamation-point cheerfulness, no "Oops!", no mascot energy. Warmth is the respect of talking to someone like a person.

Do this:

- Use the everyday word: "use" not "utilize," "help" not "facilitate," "before" not "prior to." Technical nouns stay exact when they're the actual names of things; warmth never means vague.
- Use contractions ("it's," "you'll," "doesn't") and talk to "you." Write "we" as an owner, not an institution: "we broke this in 2.1," not "a regression was introduced."
- Take the blame in errors and hand over the credit in successes. Active voice keeps ownership honest: "we couldn't reach the server," not "a connection error was encountered."
- Match the reader's stress level. Someone in a tutorial has slack for a light touch; someone reading an error is having a bad moment. The worse their moment, the calmer, kinder, and more useful the words.
- Cut filler, not meaning. Plain copy still needs context, stakes, and sequence: what problem this solves, what happens without it, what to do first. A page that is nothing but verifiable claims has cut the connective tissue that makes the claims matter. Do not turn a landing page into a parts list.
- When humor appears, it's dry, brief, and delivered deadpan, never signposted, and understanding the sentence never depends on getting the joke.

**Before:** "Users seeking to leverage the verification functionality should ensure the appropriate configuration has been established prior to initialization."

**After:** "Want checks enforced? Add them to `discern.toml`, or ask your agent to do it for you. Nothing else to configure."

The test: read it aloud. If you wouldn't say the sentence to a colleague you like, rewrite it until you would.

## 4. Delight — one well-placed surprise

About once per page, reward the reader's attention with a small moment of personality: an example with character instead of `foo` and `bar`, a wry line in a FAQ, an empty state with a smile in it, a 404 page someone clearly thought about. When applied selectively, it makes the project feel handmade and cared for.

Delight is the only layer with hard rules:

- **Budget: one per page**, screen, or document section — a ceiling, never a quota. Zero is fine. Two, if both are genuinely funny, is the absolute ceiling; if more compete, keep the best and cut the rest. An aphorism spends this budget too — see the banned moves.
- **Placement: only where the reader has cognitive slack** — intros, examples, empty states, success moments, footers, FAQs. Never in reference tables, install steps, security docs, or anywhere someone lands mid-crisis.
- **Zero personality in reference, troubleshooting, and error material.** Those readers came to look something up or to get unstuck. The budget there is zero; characterful example values are the only sanctioned outlet in reference pages.
- **Zero cost.** The sentence must still work for a reader the joke misses entirely. If removing the playful line removes information, the line is doing a job it shouldn't have.
- **Personification is a delight and spends the budget.** The tool being sweet-talked once might be charming; the second personification on a page is a dead bit. One per page at most, and prefer zero.
- **Make it native.** Delight grows out of discern's own world: checks, verdicts, agents, the repo. Not imported whimsy. No stray 🎉.

**Before (example data):** `user1`, `foo`, `test@example.com`

**After:** `ada`, `voyager-2`, `grace@hopper.dev`

The test: count the winks on the page. Zero is fine. One is right. Two had better both be earning it.

## Before drafting: the message

Do not start with tone. Start with the job the copy has to do. Before writing, identify five things:

1. **Audience:** who is reading this?
2. **Job:** what are they trying to understand, decide, or do?
3. **Change:** what is different after using discern?
4. **Proof:** which concrete, sourced product facts support that change?
5. **Action:** what should the reader do next?

If one of those is missing, the page will either drift into slogans or become a spec sheet. Fix the message before polishing the voice.

## Surface guide

The four layers are always on; what shifts per surface is the mix.

| Surface                            | Precision | Conviction               | Warmth  | Delight        |
| ---------------------------------- | --------- | ------------------------ | ------- | -------------- |
| Landing page, launch posts         | high      | maximum                  | high    | ≤ 1, earned    |
| Docs overviews and section READMEs | high      | present                  | present | ≤ 1, zero fine |
| Guides, quickstarts, walkthroughs  | high      | one recommended path     | leads   | ≤ 1, zero fine |
| Reference                          | maximum   | named defaults only      | plain   | 0              |
| Troubleshooting                    | maximum   | one fix first            | calm    | 0              |
| Errors, CLI output, `--help`       | maximum   | one fix, not five maybes | calm    | 0              |

### The docs register

Map pages carry the docs mix above, plus these rules. The documenter brief assigns each page's job and budget; these govern how the page sounds.

1. **Answer first.** The opening paragraph does the page's job in miniature — what this is, or what to do. No wind-up, no staged reveal. And answer the _reader's_ question, not the project's: a landing or overview page orients a newcomer — what this is, where to start — before any account of how the docs are produced or maintained.
2. **One primary job per page.** Material serving a different job moves to the page that owns it.
3. **Literal, task-shaped headings.** A heading states what the section contains ("Install the binary"), never strains to be quotable.
4. **Short paragraphs**, one idea each. Address the reader as "you"; write steps in the imperative.
5. **Term discipline.** The glossary is the authority. Introduce a term once, then use it identically; synonym rotation reads as new concepts.
6. **Prerequisites, risks, and limitations come early** — before the reader has invested, not after.
7. **Code grounding lives in tables.** Source paths, symbol names, and test names belong in "Where it lives in code" tables and "Current state & gotchas" sections — never woven through running prose.
8. **ADR citations take the strippable form**: a parenthetical group of linked citations at clause end, e.g. `([ADR 0141](../_adr/0141-….md))`. The sentence must read correctly with the citation deleted — a citation never carries the grammar. Cite as liberally as reasoning requires; render-time stripping keeps human pages clean.
9. **End when the reader has what they need.** No closing recap on a page under ~800 words. On a genuinely long page, one plain sentence of "next steps" beats a summary section restating what the reader just read.
10. **Every example is minimal, realistic, copyable, and verified** against the live tree before it ships.
11. **Spend absolutes on real guarantees.** "never" and "always" state guarantees, and the docs trade on them — but a page that re-negates in every paragraph flattens its real guarantees into cadence. Keep the absolute where the guarantee is the fact; cut it where it's there for the beat.

**Page budgets** (the documenter brief binds where it's stricter). Treat each budget as a ceiling: the best page is the shortest one that does its job, and coming in far under budget is fine. A floor marks the length below which a page usually can't do its job. Hitting a ceiling means the page should split or shed material; compressing the prose to fit is the wrong move:

| Page type                 | Budget                                    |
| ------------------------- | ----------------------------------------- |
| Section overview / README | 200–350 words                             |
| Quickstart                | 600–1,000 words                           |
| Guide / concept page      | 500–900 words (subsystem leaves: 400–800) |
| Troubleshooting           | 300–700 words                             |
| Reference                 | unbudgeted — scannable beats short        |

**The reference corpus.** Three pages define what this register reads like at its best; calibrate against them before writing, and hold new pages to their standard: the [docs landing page](../../map/README.md), the [quickstart](../../map/10-installer/quickstart.md), and [Files & ownership](../../map/10-installer/artifact-ownership.md).

### Errors, CLI, and UI text

An error message is the project at its most read and its reader at their most annoyed. Every error answers three questions, in order: what happened (with the actual values — the filename, the line, the input it got), why, and what to do next. One recommended fix, not five maybes. Failures name the command that failed.

- Own faults in active voice: "couldn't parse line 12," not "an error occurred during parsing."
- No humor in errors, ever. The delight budget here is zero.
- `--help` output is reference material: terse, parallel in structure, complete, no chat.
- Buttons and labels say what they do: "Delete 3 files," not "Confirm."
- Empty states are a sanctioned delight location, the only place a user arrives with nothing at stake.

**Before:** "Error: Invalid configuration. Operation aborted."

**After:** "Couldn't read discern.toml: line 12 sets `timeout = "fast"`, but `timeout` takes seconds. Try `timeout = 10`."

### Marketing pages, launch posts, and release notes

The landing page is the documentation's confident older sibling: same facts, same honesty, more conviction per square inch. The governing rule stands at full strength here: marketing claims are held to documentation standards of truth, and every claim should be demonstrable, ideally right there on the page.

- Lead with the belief, not the feature list. The headline states the stance; the features are evidence for it.
- Show code above the fold.
- Persuade by reducing risk. Show what the user no longer has to remember, what the agent no longer has to guess, what the command checks, which file owns the rule, and what happens when the answer is no.
- A smart non-programmer should be able to follow the argument even without knowing the tools.
- Announcement posts and release notes say the thing in the first sentence: what changed, and what the reader must do about it. The reader decides what's exciting.
- The strictest tell limits apply here: zero contrast-frames per page, at most one em dash. See the banned moves below.

## LLM tells: banned moves

These patterns are the fingerprints of machine-written copy. Readers have learned to recognize them, and each one costs human trust and attention. Treat them as hard failures in user-facing prose. The mechanically checkable subset is mirrored as lint — see "Enforcement" below.

1. **Contrast-frames:** "not X, but Y," "isn't X, it's Y," "X was never the point. Y is" — and the reversed form, "X, not Y." / "X, never Y." ("a defect, not a chore"; "a decision you make, never an automatic one").
   - Rejected: "It doesn't write your code. It judges it."
   - Fix: state the true half plainly. "discern uses no LLM. Your agent uses discern."
   - Budgets: marketing pages zero — this is the strongest fingerprint of the lot. Docs: only when the distinction does real work (two real glossary terms genuinely confused with each other), at most one per page.
2. **Aphoristic antithesis:** the epigram cadence — short mirrored clauses striking a pose ("Agents forget. The repo remembers."). One can earn its place; it spends the page's delight budget. The tic is reaching for it several times per page, which turns documentation into a keynote. The mundane form counts too: two half-clauses sharing one verb for rhythm — "Install takes about a minute; setup a few more." State the fact once, plainly: "Installation and setup only takes a few minutes."
3. **Self-narration:** announcing importance instead of stating the point — "this is the crux," "here's the key insight," "the heart of the matter," and the colon-pivot opener that pre-announces its own sentence: "The moment that matters is consent: before writing anything…" (start at the consent part). Budget: zero. If the point matters, say the point; the reader decides what's crucial.
4. **Closing recaps:** a "Summary" / "The short version" section restating the page. Banned on pages under ~800 words; on longer pages prefer one plain next-step sentence.
5. **Attitude fragments:** fragments that strike a pose rather than state a spec.
   - Rejected: "Not vibes. A verdict."
   - Allowed: spec fragments listing facts. "Any stack. Any coding agent. No API key."
6. **Echo-intensifiers:** repeating a word with an intensifier. Rejected: "Green means done. Actually done."
7. **Trailing modifier fragments:** ", every time," ", by design," ", at scale."
8. **Em-dash splices.** Never split with an em dash what a period or colon can handle. Two em dashes in one sentence is a chain: rebuild the sentence. Marketing pages get one em dash at most, and only when genuinely irreplaceable.
9. **T-shirt headers:** headers straining to be quotable. A header states what the section contains or the fact it establishes.
10. **Rhetorical suspense:** "Sound familiar?" "The catch?" Manufactured suspense is a tell. A direct question that routes the reader ("Want checks enforced?") is fine; a question posed only to answer itself is not.
11. **Scene-setting clichés:** "It's 2026," "In a world where," "We've all been there."
12. **Manufactured texture:** invented relatable details. If the detail did not happen, do not write it.
13. **Typographic applause:** italics or bold used to inject drama. If a sentence needs styling to land, rebuild the sentence. Bold is for scannability.
14. **Reader-flattery via superiority:** complimenting the reader by implying others are inferior. Respect the reader; never recruit them into a club.
15. **Repeated anthropomorphism:** see the personification rule under Delight. One per page at most, prefer zero.
16. **Counting the set out loud:** "Watch for four moments," "Two things remain," "one of three ownership kinds." The spelled-out count duplicates the list it introduces, so the sentence is wrong the day the set grows — counted sets are a standing source of doc drift. Let the list carry the count ("Watch what the agent does:"), or name the members. A number is welcome when the number itself is the fact ("one file: `discern.toml`").

## Banned words

Each entry is banned for a reason, and the reason is what matters — it catches the thousand variants not listed here.

| Avoid                                                                                                      | Why                                                                            | Instead                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| "simply," "just," "easy," "obviously," "actually," "really"                                                | Padding that costs the writer nothing and charges the struggling reader double | Delete it. The sentence stands alone.              |
| "powerful," "robust," "seamless," "elegant," "blazing," "effortless," "magical," "delightful," "beautiful" | Adjectives dodging _compared to what?_                                         | The sourced fact that earned it, or nothing        |
| "supercharge," "game-changer," "unlock," "empower," "vibes," "just works"                                  | Hype vocabulary; the reader decides what it changes                            | Say what it does                                   |
| "leverage," "utilize," "enables you to," "facilitate"                                                      | Vendor-speak; a friend would say "use"                                         | The plain verb                                     |
| "We're excited/thrilled to announce"                                                                       | Announces the emotion instead of the thing                                     | Say the thing                                      |
| "Please note that," "It's worth noting"                                                                    | Throat-clearing                                                                | Start with the fact                                |
| "posture"                                                                                                  | Gym vocabulary for file state; readers picture ergonomics                      | "tracked or ignored," "how git treats it"          |
| "the shape of"                                                                                             | Geometry vocabulary for architecture; names no actual thing                    | "how X fits together," or name the parts           |
| "load-bearing"                                                                                             | Construction jargon for "important" — a meme-grade machine tell                | "doing real work," or name what breaks without it  |
| "the one file," "the whole tree"                                                                           | Singular and scope emphasis dressed as precision                               | Drop the emphasis, or state the actual scope       |
| "silently," "quietly," "deliberately," "deliberate," "exactly"                                             | Drama adverbs seasoning a spec                                                 | The plain claim; name the mechanism instead        |
| "honest," "honestly," "honesty"                                                                            | Prose vouching for its own sincerity                                           | Delete it; the facts carry the sincerity           |
| "rides along," "ride along"                                                                                | Pet metaphor for "accompanies"                                                 | Say what actually happens                          |
| "You may want to consider"                                                                                 | A stack of hedges where the reader came for a recommendation                   | "Do X," or "Do X unless Y"                         |
| Passive-voice fault-dodging ("an error was encountered")                                                   | Hides the actor and dodges the blame                                           | "We couldn't…" / "`discern.toml` is missing"       |
| Exclamation points                                                                                         | Unearned enthusiasm reads as sales                                             | A period. Budget: about one per document, if that. |
| Emoji in prose                                                                                             | Outsources tone the words should carry                                         | Words that carry the tone                          |

## Enforcement

The mechanical tells are encoded as a Vale style at [`.vale/Discern/`](../../../.vale/Discern/), which lints every map page in the gate. Severity follows legitimacy: a pattern with zero legitimate uses (self-narration, recap headings, hedging, vendor-speak, banned jargon) is an **error** — `discern prepare` and `discern done` block it and name the file and line. A pattern that needs your judgment (contrast-frames, em-dash chains, counted sets) is a **warning**, and the gate stays quiet about warnings — so run the page-level loop yourself, `discern script prose-page <page…>`, and hold new or rewritten pages to the reference corpus's bar: zero Discern alerts. `tests/voice_vale_parity_test.ts` keeps this file's banned-words table and that style from drifting apart — add a word here and the gate fails until the style knows it too.

The lint is the tripwire, not the law. It catches the checkable subset; register, budgets, and judgment stay with the writer, and a page can pass every rule and still fail this skill. Review against the reference corpus, not just the lint output.

## discern lexicon

This section is the project-specific layer. Everything above it travels to any project; everything below is discern's own.

### What discern offers

discern does not offer "AI productivity." It offers a checkable way for a repo to say when agent-written work is done. Lead with the operational change:

- the repo declares its checks once;
- every agent reads the same instructions;
- every agent runs the same commands;
- each task happens in an isolated worktree;
- failures name the command that failed;
- quality limits can move only in the right direction;
- setup is completed autonomously by an agent.

The repo's rules are the hero. The agent follows them.

### Canonical terms

`Gate` is a canonical discern noun in technical docs: the full quality check. Use “discern” for the product, “the gate” for the mechanism, or “the bar” for the category. In first-contact marketing copy, prefer the mechanisms themselves: checks, worktrees, branches, standards, `discern done`, and `discern.toml`.

### Handle with care

In first-contact marketing copy, avoid "gate," "judgment," "taste," and "discerning" as an adjective for the reader — unless the user explicitly asks or the surrounding copy genuinely earns it.

Don't ban "ship" globally; ban the empty phrases "ship faster," "ship with confidence," and "ship at scale." Use "release," "merge," "land," or "publish" when one of those is the literal action.

### Preferred vocabulary

Use the concrete nouns and verbs of the actual system: file; command; branch; worktree; check; limit; floor; ceiling; run; report; pass; fail; rise; hold; merge; land.

## Mechanics

- American English spelling throughout: color, behavior, -ize.
- Sentence case for headings, titles, buttons, and labels.
- Serial comma.
- Numerals for numbers in technical contexts (3 retries, 80ms), even under ten.
- Anything the user types or the system emits appears in backticks, verbatim, never paraphrased.

## Before you ship: the checks

Run these in order. If any check rewrites the text, run the list again from the top, and present only copy that comes through clean.

1. **The message.** Audience, job, change, proof, and action are all present.
2. **The source.** Every claim traces to docs, code, command output, tests, or the user. Nothing invented. The copy survives a hostile literal reading.
3. **Compared to what?** Every adjective either has a fact behind it or is gone.
4. **Could a competitor paste this?** A paragraph that would work in someone else's docs unchanged is too generic; add the specifics only discern can claim.
5. **What do we believe?** The piece makes at least one clear recommendation or takes one stance. (Reference tables are exempt.)
6. **Read it aloud.** Every sentence is one you'd say to a colleague you like.
7. **Count the tells.** Contrast-frames on a marketing page: zero; on a docs page: one at most, and only where the distinction does real work. Em dashes: never two in a sentence. Scan the banned moves and the banned words.
8. **Count the winks.** One per page, none in reference, troubleshooting, or errors; personification at most once.
9. **Docs pages only: the shape.** The first paragraph does the job; headings are literal; the word count sits inside the page-type budget; citations strip cleanly; the page ends when the job is done.
10. **Temperature, both directions.** Find the most excited sentence in the draft; cool it down or cut it. Then check for a pulse: the contractions, the direct "you," and the page's one wink should have survived the editing. If the passes stripped all of those out, you overcorrected — restore the warmth without restoring the hype.

## Worked example

A README opening, both ways.

**Before:**

> ### Introducing discern!
>
> It's 2026. Your agents ship faster than you can review. discern is the powerful, seamless quality gate that ensures done actually means done. It doesn't write your code — it judges it. Not vibes. A verdict.

Count the tells: a scene-setting cliché, "ship faster," two hype adjectives, an echo-intensifier, a contrast-frame spliced with an em dash, an attitude fragment, and an exclamation point in the header. Seven failures in four lines, and not one verifiable fact.

**After:**

> ### discern
>
> Your repo declares its checks once, in one file: `discern.toml`. Every agent that works on the repo reads the same instructions, runs the same commands, and gets its own worktree. When a check fails, the report names the command that failed.
>
> There's no LLM inside discern and no API key to configure. It runs your checks and reports the verdict. Your agent does the rest. If the tests don't pass, the work isn't done, however confident the summary sounded.

Precision in the file name, the mechanism, and claims that all trace to the product. Conviction in "the work isn't done." Warmth in the plain words and "your agent does the rest." Delight in the closing clause: deadpan, unsignposted, spent once. Zero contrast-frames, zero fragments, zero adjectives doing a number's job. One voice, four layers.
