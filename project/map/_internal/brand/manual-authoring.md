# Manual authoring

**Status:** Binding procedure for the public manual\
**Applies to:** `project/manual/` tutorials, guides, explanations, reference, and troubleshooting\
**Reference pages:** `project/manual/20-understand/proof.md` (explanation), `project/manual/10-guides/finish-and-land-a-change.md` (guide), and `project/manual/20-understand/practice-and-roles.md` (overview)\
**Change control:** An edit to this procedure or to the reference pages binds only after the owner has approved the exact new text.

The manual is where people learn what discern does for them, decide to adopt it, and learn to direct their agents. It is one of discern's main marketing surfaces, and coding agents read the same pages through `discern docs` and `discern_docs`. Write for the person first: plain, warm, and exact. An agent gets the same facts from plain prose.

Write in the [product voice](../../../skills/discern-product-voice/SKILL.md). Use the [register bridge](register-bridge.md) to turn a product fact into a reason to care. The manual never switches to `discern-brand-voice`.

## The voice in brief

Lead with what the reader gets. Use plain words and short sentences. Name who does what: you, your agent, or discern. Carry one example through the page. Define each term in the sentence where it first appears. State each limit once, where it matters, without hedging. Show the real artifact, then say what it means. Check every claim against the live product.

The reference pages show all of this at work. Read them before drafting.

## Lead with what the reader gets

The first paragraph renders as the page's large introduction, above the first `##` heading. It tells the reader what they get, in their own terms:

> When your agent says a change is finished, Proof shows you what that means: which of your project's checks passed, on exactly which version of the code.

A second short paragraph can add the payoff or the page's scope. Don't open with a mechanism, a command, an internal object, or a scene that takes several sentences to reach its point.

Make the strongest claim the product supports, then give it a concrete meaning in the next sentence or two, so no reader mistakes it for a bigger promise. Proof means the project's checks passed on one exact commit. It never stands in for defect discovery, security review, or the decision to release.

## Write plainly

### Use plain words and short sentences

- Aim for 10 to 14 words per sentence on average, and split any sentence longer than 25 words.
- Give each sentence one idea, and each paragraph one topic.
- Prefer verbs to abstract nouns: "you said yes" instead of "consent was attested", and "finish" instead of "completion".
- Prefer common words: use, check, show, keep, stop, land.
- Use contractions: don't, can't, it's, you're.
- Cut filler: intensifiers, throat-clearing openers, and phrases that take four words to say what one word says. Keep "exactly" only where precision is the point.

Short doesn't mean choppy. Join two short sentences when the second only finishes the first.

Tutorials, guides, explanations, and troubleshooting pages should score at or below grade 7.5 under the `manual_reading_grade` projection. The reference pages score between 7.1 and 7.2. [Check the page](#check-the-page) explains how to measure.

### Name the actor

Every sentence needs a subject that does something. The manual's actors are:

- **you**, the reader, who sets the direction, reviews the work, and decides what lands;
- **your agent**, which operates discern, changes the project, answers checkpoints, and follows recovery instructions;
- **discern**, which runs the checks, records the evidence, and lands a change only with permission.

The project keeps things: rules, checks, and records. Don't make "the project", "the practice", "evidence", or "the gate" the subject of a sentence when a person or discern does the work. Write "discern runs your checks" rather than "the gate establishes completion".

Address the human reader as "you" on every page. Call a single agent "it" or "your agent", and keep "they" for people and for several agents, so every pronoun has one possible meaning.

When a step belongs to the agent, say so. Tell the reader when they don't need to act: "You don't need to run any of these commands yourself."

### Carry one example through the page

Pick one small, familiar scenario, such as recipe search, saved lists, or a phone layout. Introduce it in the opening and use it to the end. A reader who meets a new scenario halfway through has to start orienting again.

### Define terms where they first appear

Give the plain meaning in the same sentence, then use the canonical term from then on:

- "the **desk**: the interactive view that opens when you run `discern` in your main checkout";
- "a **worktree**, a separate copy of the project on its own branch";
- "a **variance**: permission to land despite an unmet checkpoint."

Never use a term the page hasn't defined or linked. Don't replace `gate`, `Proof`, `checkpoint`, `grant`, `variance`, `trunk`, or `worktree` with friendlier synonyms. Don't surround them with abstractions such as "candidate", "subject", "surface", or "observed work" when "change", "branch", "page", or "files" says the same thing. Plain words leave the reader attention for the terms that matter.

### Say it once, without hedging

State each limit where it changes what the reader does, in plain words: "A pass means those checks passed, and nothing more." Don't repeat it as reassurance.

- Describe the ordinary path first. Add an exception only where leaving it out would change a decision or an action.
- Say what discern does. Drop hedges such as "can help", "may be able to", and "is designed to" around behavior that is certain.
- When behavior depends on setup, name the condition: "If your project defines scopes, the gate runs only the checks for the areas the change touches."
- Give the reason for a rule when it changes what the reader does, usually in one sentence: "The gate only runs on committed work, so the Proof always describes a version that can land."
- Don't deny capabilities nobody asked about, and don't invent a mistaken belief to correct.

Repeating a distinction teaches when the reader meets it in a new situation. Green versus landed appears in Proof's explanation, its stage table, and the landing guide's closing section. Repeating a caveat for safety doesn't teach anything.

### Show the real thing, then say what it means

A Proof line, a command, the first sentence of a result, or a short config fragment makes a promise concrete. Show it, then explain it. A table that breaks an artifact into parts works well, as in Proof's "Read a Proof line".

Put commands in code formatting and match the live product. Say in plain words what each command does. Keep exhaustive flags, fields, and transport detail in Reference, and link to it.

Include requests the reader can give their agent. They show how to direct the work. Keep them short and realistic, with at most one per step.

### Leave runtime detail to runtime

discern's results tell the agent its next step at the moment it applies, and the bundled skills carry operating procedures. A page explains what the reader needs to understand and trust the flow. That means the situation, how it starts, how it succeeds or stops, and what the reader decides. If only an agent already inside the flow needs a detail, leave it to the result or to Reference. The landing guide says an agent answers a checkpoint about combined code "and the same landing continues". It doesn't explain composition receipts.

### Make every benefit explicit

Each tutorial, guide, and explanation page is the registered home of specific benefits in `MANUAL_BENEFIT_OBLIGATIONS` (`scripts/manual_benefits.ts`). The [Human Benefit Canon](../feature-canon-human-benefits.md) gives their meaning. Name each benefit at the point where it happens, in the reader's terms: "That doesn't send your change back to the start." A benefit the reader has to work out for themselves hasn't been delivered.

Describe a benefit by what happens. "discern checks the combined code and lands exactly what passed" persuades in a way no adjective can.

## Get the facts right

Plain prose only helps if it's still true.

1. Check every claim about behavior against the live product. Start with the current map page for that subsystem, and read the code and tests where the map is unclear. When sources disagree, the code and tests win. Report the disagreement to the page that owns it instead of smoothing it over.
2. Never copy a claim from another manual page without checking it. Pages drift: the Proof page and the landing guide once disagreed about what happens when the trunk moves.
3. Read the page's benefit obligations and the Human Benefit Canon entries they name.
4. Run every literal example, including commands, output, and config, against the live product. Examples must work in an external project, so don't use repository-only fixtures.

The plain feature canon (`project/map/_internal/feature-canon-plain.md`), the [Demand Canon](demand-canon.md), and the [Consequence Canon](consequence-canon.md) are good sources for the human situation and for wording ideas. Never copy them as final text.

## Structure the page

### Page kinds

Every page has one job, set by its `kind`. The kind decides what the reader can do afterwards and which checkpoint question judges the page.

| Kind                | Its job                                                       | Afterwards, the reader can…                                    |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| **Tutorial**        | Teach one first success from start to finish.                 | reach and recognize the result, then choose a next step.       |
| **Guide**           | Help someone reach one outcome from a known starting point.   | take the steps, handle a refusal, and recognize success.       |
| **Explanation**     | Build a working mental model of a concept.                    | restate it, tell it apart from nearby states, and predict why. |
| **Reference**       | Give the complete, current contract for exact lookup.         | find the field, default, limit, or supported value they need.  |
| **Troubleshooting** | Recover safely from something the reader can see going wrong. | find the likely cause, recover, and know when to stop.         |

### Spines

Headings can vary with the subject. The order holds.

- **Tutorial:** the first success and why it's worth the effort; prerequisites and a realistic time or effort estimate; ordered steps that say who acts at each handoff; the visible result after each phase, with recovery links where failure can happen; the finished result and one next step.
- **Guide:** the situation, the outcome, and the benefit; the starting point and any decision needed first; the shortest complete procedure with one example; what refusal or an unfinished state looks like, and who decides; how the reader knows it's done, and what comes next.
- **Explanation:** the reader's review or decision moment and why the concept matters; the concept in plain words, with the real artifact; how it works, what changes it, and why its boundaries exist; the nearby states, and who decides what; the usual next steps.
- **Reference:** what the lookup answers and why it matters; its scope; exact fields, types, defaults, limits, and states under stable headings; exceptions and unsupported cases; links to the guide or explanation for tasks and mental models.
- **Troubleshooting:** the symptom the reader sees and the recovery promise; the exact text or state they observe; the likely cause and how to tell it from nearby causes; the safe recovery first, with alternatives last; what success looks like, and when to stop and ask.

Reference stays exact and complete. Write it in the same plain voice, but never drop a default, limit, or exception to shorten it.

### Headings

Write headings that say what the section answers or does: "Without permission, nothing lands" and "What a pass does and doesn't tell you". Use sentence case.

Before renaming a heading, search for links to its anchor across `project/`, `templates/`, `src/`, and `site/`, then keep the heading or update every link.

### Tables

Use tables for comparisons, part-by-part breakdowns, sources of permission, and sequences of states. Keep each cell to a phrase or one short sentence.

### One home per concept

Explain each concept fully in one page, and link to that page elsewhere. The landing guide links to Proof's "From green to live" table instead of repeating it. Reference owns exact flags, fields, defaults, and limits.

### Link without a context cliff

A link adds depth. It must not hold the premise the current page needs. Before linking away, give the reader the key fact, why it matters, and what to do next. Then link, with text that says what the destination adds.

Link to published manual pages. Don't send a manual reader to a map page because it holds the implementation detail. When no public destination exists, keep the minimum true fact on the page and record the gap for its owner.

### Frontmatter

- Keep `id`, `kind`, `order`, `publish`, and `aliases` stable. When you retitle a page, add the old title as an alias.
- Write `description` as one plain sentence about what the reader gets. Search results and link previews show it.
- Keep a page's file name, and so its web address, unless the owner approves a change. When the address changes, list the old route in `redirect_from`.

## Before and after

These pairs come from the reference pages. Reuse the move, in your own words.

| Before                                                                                                                                                                          | After                                                                                                                                                  | The move                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| "What helps that exchange keep working as the project grows is a shared account of how the project works, what it values, and what needs checking before a change is complete." | "It works by giving each part of the job a clear owner. You decide what to build and what ships. Your agent does the work."                            | Make a person or discern the subject. Say the real thing. |
| "Evidence needs to describe the version that will become part of the project."                                                                                                  | "Proof belongs to one commit. discern records it only when every change in the worktree is committed, so the checks describe exactly what would land." | Replace the abstraction with the actor and the reason.    |
| "A green gate by itself cannot establish that no defects remain or that an application is ready for release."                                                                   | "A pass means those checks passed, and nothing more."                                                                                                  | State the limit once, plainly.                            |
| "Landing permission can come from your approval in the current conversation, a standing grant for named areas of the project, or a grant you record for one task at the desk."  | "a grant for one task, which you record from the desk: the interactive view that opens when you run `discern` in your main checkout."                  | Define the term where it first appears.                   |
| A 188-word paragraph on integration worktrees, served composition receipts, and continuation commands.                                                                          | "Another task may land on `main` while yours waits for review. That doesn't send your change back to the start."                                       | Lead with the situation and the benefit, then the facts.  |
| "Proof keeps automated checks, review judgments, and permission distinct."                                                                                                      | "A Proof keeps three things separate, so you can see who vouched for what."                                                                            | Say why the reader should care.                           |

## Shapes to reject

Reject a draft that turns into any of these:

- **feature catalogue:** a list of mechanisms instead of one promise to the reader;
- **mechanism-first opening:** a command, subsystem, schema, or internal object before the reader has a reason to care;
- **abstract actor:** "the project carries", "evidence establishes", or "the practice consists of" where a person or discern does the work;
- **hedge stack:** "can help", "may be able to", or "is designed to" around behavior that is certain;
- **defensive repetition:** the same caveat stated again for safety;
- **roaming example:** a scenario that changes partway through the page;
- **undefined term:** a product noun used before the page explains it;
- **runtime transcript:** every flag, receipt, and continuation of an agent-only path copied into a guide;
- **repository shorthand:** local paths, test fixtures, ADR numbers, or team vocabulary the reader needs to understand the page;
- **duplicate reference:** a guide or explanation that repeats the flags, fields, defaults, or limits Reference owns;
- **marketing flourish:** emotional language that hides the state, scope, or next step;
- **agent blame:** prose that mocks or judges the coding agent instead of describing the product boundary;
- **false certainty:** green becomes "correct", Proof becomes defect detection, landed becomes live, or an old conversation becomes permission;
- **surface-specific copy:** a different authored body for the website, terminal, MCP, or raw Markdown.

Also cut these machine-written habits:

- a dramatic reversal between doubt and a confident claim;
- paired slogan fragments that make evidence sound like certainty;
- a trailing fragment such as ", every time" or ", by design";
- a count that introduces a list ("does two things:"), which the lint blocks;
- moral or dramatic adverbs on ordinary claims;
- noun-phrase negation. Write "a guessed branch name won't resolve" instead of "a guessed name resolves to no branch".

Comparisons that carry product meaning stay: green versus landed, unfinished versus refused, and checked versus declared.

## Answer the checkpoint

Each page kind has a checkpoint question about comprehension. Before declaring it met, check the actual page:

- what can its reader now understand or do;
- where does it start and how does the reader recognize the end, where the kind needs them;
- which nearby states, responsibilities, and permission boundaries does it separate;
- which facts does it leave to a link, and why is the page still usable without following it;
- what does it say, where relevant, about green versus landed, who can approve an unmet checkpoint, and why a later edit makes Proof stale.

The Proof page's answer: a reader can say what a pass means. The project's checks passed on one exact commit, and nothing more. They can follow a change through green, ready for review, submitted, authorized, landed, and live. They can tell check results from the agent's checkpoint answers and from permission to land, and they know only the owner can approve a variance. They can predict what makes Proof stale: a new commit, an uncommitted file, a changed checkpoint answer, or a changed limit proposal. A newer trunk doesn't.

The landing guide's answer: a reader can ask for a reviewable result and follow what the agent does before the handoff. They can review the change, ask for fixes, and land it or learn why it didn't land. They know that other work landing first doesn't send the change back. They know where permission to land can come from, and that no grant covers a variance, a limit change, or an emergency landing. They recognize a finished landing, and the reasons a worktree can remain afterwards.

If a question could be declared met without this work, strengthen the question, its matcher, or its tests instead of recording a ceremonial answer.

## Check the page

Run these before you commit:

```sh
deno run --allow-read --allow-write --allow-env --allow-run scripts/manual_prose_check.ts <page…>
deno run --allow-read --allow-write --allow-env --allow-run scripts/manual_prose_check.ts --review <page…>
deno run --allow-read scripts/manual_reading_grade.ts
```

The first must report no findings; the lint blocks counted introductions and scope intensifiers. The second shows editorial advice. Take the suggestions that make a sentence clearer and ignore the rest. The third prints the corpus grade that the `manual_reading_grade` standard holds.

Then confirm that:

- the opening tells the reader what they get, above the first `##` heading;
- every sentence has a clear actor, and the pronouns are unambiguous;
- one example runs through the page;
- every term is defined where it first appears;
- each limit appears once, where it matters;
- every claim and example matches the live product;
- every benefit the page owns is stated in the reader's terms;
- headings that other pages link to still resolve;
- website, terminal, MCP, and raw Markdown show the same authored text.
