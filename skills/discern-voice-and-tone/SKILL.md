---
name: discern-voice-and-tone
description: 
   House voice for discern's public-facing product copy: landing pages, homepage sections, feature pages, taglines, CTAs, launch posts, marketing-oriented README intros, and user-facing release notes. Use when writing or editing prose meant to explain, persuade, or orient discern to a human reader. Use lightly for README intros, onboarding summaries, and release notes. Do not use for canonical technical docs, config reference, glossary entries, ADRs, API reference, code comments, or prose that must preserve discern's technical terminology. This is an internal skill for the discern repo itself.
---

# discern's Voice and Tone

## Purpose

This skill keeps discern's public copy calm, specific, and consistent. It is for prose that introduces the product to a visitor or helps a user decide whether to try it. It is not the house style for canonical documentation.

**Use it directly for:** landing pages; homepage sections; feature pages; taglines and CTAs; launch posts; announcement copy; marketing sections of a README.

**Use it lightly for:** README openings; onboarding summaries; release notes; short docs introductions.

**Do _not_ use it for:** glossary entries; config reference; API reference; ADRs; internal documentation; code comments; docs that must preserve discern's canonical technical nouns.

When this skill conflicts with discern's technical documentation conventions, the documentation conventions win.

## The voice in one paragraph

Write like a very good engineer explaining their own tool to a friend: plain words, concrete claims, no performance. The facts do the selling. Confidence comes from specificity, never from adjectives. Describe remarkable things in the tone you would use for unremarkable ones. The product does something close to science fiction, so write about it like plumbing. Warmth comes from sincerity and respect for the reader, never from flattery or jokes at anyone's expense.

**The master rule: keep the temperature of the prose below the temperature of the facts.**

When the prose gets excited, the reader stops being excited on the product's behalf. State the impressive fact flatly, and let the reader supply the awe.

## What discern offers

discern does not offer "AI productivity." It offers a checkable way for a repo to say when agent-written work is done.

Lead with the operational change:

- the repo declares its checks once;
- every agent reads the same instructions;
- every agent runs the same commands;
- each task happens in an isolated worktree;
- failures name the command that failed;
- quality limits can move only in the right direction;
- setup is completed autonomously by an agent.

Avoid making the agent the hero. The repo's rules are the hero, the agent is just the one who follows them.

## Before drafting

Do not start with tone. Start with the job the copy has to do.

Before writing public copy, identify these five things:

1. **Audience:** who is reading this?
2. **Job:** what are they trying to understand, decide, or do?
3. **Change:** what is different after using discern?
4. **Proof:** which concrete product facts support that change?
5. **Action:** what should the reader do next?

If one of those is missing, the page will either drift into slogans or become a spec sheet. Fix the message before polishing the voice.

## Claim discipline

Claims come from source material. Use the docs, code, command output, release notes, tests, or explicit user-provided facts. Do not invent integrations, guarantees, metrics, defaults, speed claims, security properties, or supported agents.

If a claim is not sourced, do one of three things:

- remove it;
- weaken it until it is literally true;
- mark it as a draft claim that needs verification.

The copy must survive a hostile literal reading. A skeptical reader should not be able to say, "that is not what those words mean" or "that is not always true."

## Core rules

1. **Every sentence carries a fact.** If a sentence tells the reader nothing they could verify or act on, cut it or replace it with one that does. Mood-only sentences are filler.
2. **Specificity is the persuasion.** Prefer real nouns: file names, commands, numbers, defaults. "One file: `discern.toml`" beats "a minimal footprint." "624 tests passed in 8.9s" beats "blazing fast."
3. **Short declaratives, one idea each.** Target an average under about 15 words. Vary rhythm, but never nest clauses to sound sophisticated.
4. **Plain diction.** A smart non-programmer should follow the argument even if they do not know the tools. Technical nouns are fine when they are the actual names of things.
5. **No poetic near-misses.** Do not use jargon for flavor. Do not use a metaphor that collapses under two seconds of scrutiny.
6. **Wit budget: one wry moment per page.** Two if they're both genuinely funny. Humor is understatement, delivered deadpan, never signposted, never at the reader's or anyone else's expense. If more than two jokes compete, keep the best and cut the rest.
7. **End sections on a fact, not a flourish.** The last sentence of a section should be checkably true.
8. **No hedging, no boasting.** Cut "just," "simply," "actually," and "really." Cut "powerful," "robust," "elegant," "seamless," and "beautiful." State what it does; the reader will decide what that makes it.
9. **Cut filler, not meaning.** Plain copy still needs context, stakes, and sequence. Do not turn a landing page into a dry list of parts.
10. **Persuade by reducing risk.** Show what the user no longer has to remember, what the agent no longer has to guess, what the command checks, what file owns the rule, and what happens when the answer is no.

## Banned patterns

Treat these as hard failures in user-facing prose. A contrast that distinguishes two real glossary terms is allowed in docs when it improves precision.

1. **Contrast-frames:** "not X, but Y," "isn't X, it's Y," "X was never the point. Y is."
    - Rejected: "It doesn't write your code. It judges it."
    - Rejected: "Enforced by arithmetic, not by memory."
    - Fix: state the true half plainly. "discern uses no LLM. Your agent uses discern."
    - Hard limit for marketing pages: zero per page. This is the strongest LLM fingerprint.
2. **Em-dash splices.** Never split with an em dash what a period or colon can handle. Hard limit for marketing pages: one em dash per page, and only when genuinely irreplaceable.
3. **Attitude fragments:** fragments that strike a pose rather than state a spec.
    - Rejected: "Not vibes. A verdict."
    - Allowed: spec fragments listing facts. "Any stack. Any agent that can run a command. No API key."
4. **Echo-intensifiers:** repeating a word with an intensifier.
    - Rejected: "Green means done. Actually done."
5. **Trailing modifier fragments:** ", every time," ", by design," ", at scale."
6. **T-shirt headers:** headers straining to be quotable. A header states what the section contains or the fact it establishes.
7. **Manufactured texture:** invented relatable details. If the detail did not happen, do not write it.
8. **Repeated anthropomorphism.** The tool being "sweet-talked" once might be charming. The second personification on a page is a dead bit. Limit: one per page, and prefer zero.
9. **Typographic applause:** excessive italics or bold used to inject emphasis. If a sentence needs styling to land, rebuild the sentence. Bold is for scannability, not drama.
10. **Reader-flattery via superiority:** complimenting the reader by implying others are inferior. Respect the reader; never recruit them into a club.
11. **Rhetorical questions as transitions:** "Sound familiar?" "The catch?"
12. **Scene-setting clichés:** "It's 2026," "In a world where," "We've all been there."

## Lexicon

### Banned hype words

**Do not use these in discern product copy:** vibes; seamless; blazing; effortless; supercharge; game-changer; magic or magical; delightful; powerful; robust; elegant; beautiful or beautifully; leverage as a verb; unlock; empower; "just works".

### Handle with care

**Avoid these in first-contact marketing copy:** harness; gate; judgment; taste; discerning as an adjective for the reader.

These rules apply unless the user explicitly asks for them, or the surrounding copy genuinely earns them.

`Harness` and `Gate` are canonical discern terms in technical docs. Do not ban them from docs, reference pages, or glossary-aligned explanations. For landing pages, prefer mechanisms first: checks, worktrees, branches, limits, `discern finish`, and `discern.toml`.

Do not ban `ship` globally. Ban empty phrases like "ship faster," "ship with confidence," and "ship at scale." Use `release`, `merge`, `land`, or `publish` when one of those is the literal action.

### Preferred vocabulary

**Use the concrete nouns and verbs of the actual system:** file; command; branch; worktree; check; limit; floor; ceiling; run; report; pass; fail; rise; hold; merge; land.

## Mandatory self-edit pass

After drafting, run these passes in order before presenting the copy.

1. **Message pass.** Check that the copy has an audience, job, change, proof, and action.
2. **Fact pass.** Cut every sentence that contains no verifiable claim.
3. **Source pass.** Mark or remove claims that are not grounded in source material.
4. **Tic pass.** Search for every banned pattern above. Contrast-frames and em dashes especially: count them. For marketing pages, the counts should be zero and at most one.
5. **Hostile read.** For each remaining claim, ask whether it is literally true. Rewrite anything that wobbles.
6. **Read-aloud pass.** Any sentence you would not say out loud to a colleague gets rewritten in the words you would say.
7. **Wit audit.** Count the jokes, winks, and personifications. If there are more than two, keep the best and cut the rest.
8. **Temperature check.** Find the most excited sentence in the draft. Cool it down or cut it.

If any pass changes the text, run the passes again from the top. Present only copy that comes through clean.
