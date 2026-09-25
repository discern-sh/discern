# Manual authoring

**Status:** Binding procedure for the public manual\
**Applies to:** `project/manual/` tutorials, guides, explanations, reference, and troubleshooting\
**Model pages:** `project/manual/00-start/first-real-change.md` (tutorial), `project/manual/20-guides/finish-and-land-a-change.md` (guide), `project/manual/10-understand/proof.md` (explanation), `project/manual/40-troubleshooting/gate-and-proof.md` (troubleshooting), and `project/manual/30-reference/proof-and-checkpoint-formats.md` (reference)\
**Change control:** An edit to this procedure or to the model pages binds only after the owner has approved the exact new text.

The manual is where people learn what discern does for them, decide to adopt it, and learn to direct their agents. It is one of discern's main marketing surfaces, and coding agents read the same pages through `discern docs` and `discern_docs`. Write for the person first: precise, warm, and connected. An agent gets the same facts, along with the reasons that tie them together.

The manual's reader builds software with coding agents. Some are experienced engineers; others are newer builders whose agent writes most of the code. Write for both at once: use the words an engineer uses for what their project runs, and give a newcomer the plain category the first time a page needs it. A page that trades a precise word for a vaguer one feels easier and reads harder.

Write in the [product voice](../../../skills/discern-product-voice/SKILL.md). Use the [register bridge](register-bridge.md) to turn a product fact into a reason to care. The manual never switches to `discern-brand-voice`.

## The voice in brief

Lead with what the reader gets. Use the most precise words the reader already knows, and connect the reasoning: say why each thing is so and what follows from it. Name the worry a feature answers, then show how discern answers it. Make clear who acts: you, your agent, or discern. Put the reader in one example and follow it to its outcome. Define each discern term where it first appears. Put each limit where it changes a decision, and make strong claims exact instead of hedging them. Write requests the way people talk to their agents. Show the real artifact, then say what it means. Check every claim against the live product.

The model pages show all of this at work. Read them before drafting.

## Lead with what the reader gets

The first paragraph renders as the page's large introduction, above the first `##` heading. It tells the reader what they get, in the terms of their own situation:

> A standard keeps a measured gain from slipping back. Once your project reaches a number worth keeping, such as a smaller download or higher test coverage, every later change has to meet it.

A second short paragraph can add the payoff, the worry the page answers, or its scope. Don't open with a mechanism, a command, an internal object, or a scene that takes several sentences to reach its point.

## Write for someone who builds software

### Use the reader's own words

The plainest word is the most precise one the reader already knows. Tests, linter, type checker, formatter, commit, branch, merge, and flaky test name real things in the reader's project. Words such as "checks", "the work", and "the process" hide which thing ran, so use them only after the page has said what they stand for. The first time it matters, name what the project runs: the gate runs your project's own commands, such as its linter and test suite.

Give a newer builder the plain category first when a page needs a tool's name: "code-quality tools, such as the linter and type checker". That's all the welcome the page needs. Don't swap a precise word for a vaguer one to make a page feel simpler: once someone knows what a test is, "check" is harder to understand.

The glossary's plain renderings and the plain feature canon (`project/map/_internal/feature-canon-plain.md`) translate discern's terms for readers who don't build software. The manual doesn't use their wording.

- Prefer verbs to abstract nouns: "you said yes" instead of "consent was attested".
- Use contractions: don't, can't, it's, you're.
- Cut filler: intensifiers, throat-clearing openers, and phrases that take four words to say what one word says. Keep "exactly" only where precision is the point.
- Write American English. The house Vale rule blocks British spellings.

### Connect the reasoning

Say why each thing is true and what follows from it, with the word that names the link: because, so, until, unless, instead of. A reader shouldn't have to supply the "so" between two sentences, and a run of short assertions leaves them to work out how the facts connect.

A sentence can run long when it carries one line of reasoning, or a list after a colon. Split it where it makes two separate claims, and never between a cause and its effect. Procedures are the exception: give each numbered step one action.

Explain a design choice by the real alternative it avoids: "When `main` has moved, discern checks the combined code in a temporary copy instead of landing your change on top of work its checks never saw." Name an alternative a simpler tool would take, or one the reader would otherwise face. Don't invent a belief the reader doesn't hold only to correct it.

### Name the worry, then show the mechanism

Readers arrive with specific worries about coding agents: work called finished that isn't, a test or limit weakened to get a change through, quality that erodes in small steps nobody notices, and a lesson learned in one session and lost by the next. Where a page answers one, name it as a plain fact about how agents work, then show what discern does about it. The standards page does this: "Without it, new features slowly eat the gain, and months later it's gone without anyone deciding to give it up." A precise problem and a precise mechanism persuade where adjectives can't.

Describe an agent's limits as facts about how agents work, without judging the agent. Naming the limit is how the reader sees why discern exists.

### Make clear who acts

Every step belongs to someone. The manual's actors are:

- **you**, the reader, who sets the direction, reviews the work, and decides what lands;
- **your agent**, which operates discern, changes the project, answers checkpoints, and follows recovery instructions;
- **discern**, which runs your project's commands, records what passed, and lands a change only with permission.

The project keeps things: rules, checks, and records. Don't let an abstraction do the work ("the practice establishes", "evidence shows"), and don't let an object act for a person: a worktree doesn't run tests, and a report doesn't make decisions. A sentence can open with its condition or with the thing the reader already has in mind, as long as the actor stays clear.

Address the human reader as "you" on every page. Call a single agent "it" or "your agent", and keep "they" for people and for several agents, so every pronoun has one possible meaning.

When a step belongs to the agent, say so. Tell the reader when they don't need to act: "You don't need to run any of these commands yourself."

### Set the scene, and finish the example

Pick one small, familiar scenario, such as recipe search, saved lists, or a phone layout, and put the reader in it: "Say your agent adds search to your recipe app." Don't announce it with a sentence such as "This guide follows one example". Carry it to the end of the page, and follow it to an outcome the reader can picture: the failure the agent finds, the test it writes, the question a checkpoint asks. When a later section needs an illustration, return to the same scenario instead of starting another. A reader who meets a new scenario halfway through has to start orienting again.

### Define terms where the reader needs them

Give a discern term its meaning in the sentence where it first appears, by what it's made of in the reader's project where you can, then use the canonical term from then on:

- "the **desk**: the interactive view that opens when you run `discern` in your main checkout";
- "a **worktree**, a separate copy of the project on its own branch";
- "a **variance**: permission to land despite an unmet checkpoint."

Once a page introduces `gate`, `Proof`, `checkpoint`, `grant`, `variance`, `trunk`, or `worktree`, use that term every time, without friendlier synonyms. Introduce a term only when the reader needs it to act or to recognize what they'll see: on a page about fixing a failing test, "your approval" says enough without defining grants. Don't surround terms with abstractions such as "candidate", "subject", "surface", or "observed work" when "change", "branch", "page", or "files" says the same thing.

Never use a term the page hasn't defined or linked. Glossary hover cards appear only on the website, and readers of raw Markdown or `discern docs` never see them, so each page defines what it needs.

### Put each limit where the reader would misjudge it

State each limit once, inside the step where leaving it out would mislead the reader, in plain words: "A pass means those checks passed, and nothing more." A caveat collected in a closing section arrives after the decision it should have shaped. At a choice, say what each option gives up: "Advise blocks nothing and needs no answer, so keep it for questions a missed answer won't hurt."

- Describe the ordinary path first. Add an exception only where leaving it out would change a decision or an action.
- Say what discern does. Drop hedges such as "can help", "may be able to", and "is designed to" around behavior that is certain.
- When behavior depends on setup, name the condition: "If your project defines scopes, the gate also runs the check of each scope the change touches."
- Give the reason for a rule when it changes what the reader does, usually in one sentence: "The gate only runs on committed work, so the Proof always describes a version that can land."
- Don't deny capabilities nobody asked about, and don't invent a mistaken belief to correct.

Repeating a distinction teaches when the reader meets it in a new situation. Green versus landed appears in Proof's explanation, its stage table, and the landing guide's closing section. Repeating a caveat for safety doesn't teach anything.

### Make strong claims exact

Make the strongest claim the product supports, in its exact words. When a confident sentence overstates what the product does, change the word, not the confidence: "Proof shows your change works" becomes "Proof shows which of your project's commands passed on this exact commit." Wrapping the first sentence in qualifications would keep it vague and add legalese. A caveat is the last resort, for a limit the reader would otherwise act on wrongly.

Check each "never", "only", "always", and "every" against the product, and against what the [register bridge](register-bridge.md) says each concept must not imply. Proof means the project's checks passed on one exact commit. It never stands in for defect discovery, security review, or the decision to release.

### Write requests the way people talk to their agents

Example requests show the reader how to direct their agent, and that they don't need discern's vocabulary to do it. Write each one as the reader's intent: what should happen, what should stay the same, and what they want back before they decide. Leave out commands, flags, skill names, and file names, then say in the next sentence what the agent does with the request. Search indexes a request like any other prose, so a request that names a file can outrank the page that explains it. Name a skill only as optional precision, for a reader who wants to be sure the agent uses it.

Put anything a person says to their agent in quotation marks, whether it stands alone as a block quote or sits inside a sentence, such as "land it". The website styles every blockquote alike, so the quotation marks are what tell a request apart from output the reader will see. Keep each request short enough to type, with at most one per step.

### Show the real thing, then say what it means

A Proof line, a command, the first sentence of a result, a finding, or a short config fragment makes a promise concrete. Where it reads naturally, give each tutorial, guide, and explanation page at least one artifact the reader will see, run against the live product; skip it where it would feel staged. Show it, then explain it. A table that breaks an artifact into parts works well, as in Proof's "Read a Proof line".

Put commands in code formatting and match the live product. Say in plain words what each command does. Keep exhaustive flags, fields, and transport detail in Reference, and link to it.

### Order each paragraph the way the reader reads it

- Put the condition first when it decides whether the paragraph applies: "If your project says each copy needs its own port or test database, discern sets them up in every worktree, so two agents can run their tests at once."
- Put an instruction before its reason: "You don't need to run these commands yourself. Each result tells the agent what to do next."
- Tell the reader what normal looks like before they mistake it for a problem: "An unmet answer is an ordinary result: the checks still run, and landing waits for your decision."

### Leave runtime detail to runtime

discern's results tell the agent its next step at the moment it applies, and the bundled skills carry operating procedures. A page explains what the reader needs to understand and trust the flow. That means the situation, how it starts, how it succeeds or stops, and what the reader decides. If only an agent already inside the flow needs a detail, leave it to the result or to Reference. The landing guide says an agent answers a checkpoint about combined code "and the same landing continues". It doesn't explain composition receipts.

### Make every benefit explicit

Each tutorial, guide, and explanation page is the registered home of specific benefits in `MANUAL_BENEFIT_OBLIGATIONS` (`scripts/manual_benefits.ts`). The [Human Benefit Canon](../feature-canon-human-benefits.md) gives their meaning. Name each benefit at the point where it happens, in the reader's terms: "That doesn't send your change back to the start." A benefit the reader has to work out for themselves hasn't been delivered.

Wherever a page touches them, give prominence to discern's product-wide goals:

- **The project gets better over time.** Gains are kept: a standard's limit only tightens, a fixed bug leaves a check behind, and a lesson reaches every later session. The Human Benefit Canon's "Keep the gains the project earns" describes this.
- **discern is built for the agent to operate.** Short results name the next step, and failures come with a way to reproduce them, so the agent's effort goes into the project. The [Agent Benefit Canon](../feature-canon-agent-benefits.md) describes what the agent gets. Tell the reader what that means for them: less time unblocking the agent, and more of its effort in the work they asked for.

Describe a benefit by what happens. "discern checks the combined code and lands exactly what passed" persuades in a way no adjective can.

## Get the facts right

Clear prose only helps if it's still true.

1. Check every claim about behavior against the live product. Start with the current map page for that subsystem, and read the code and tests where the map is unclear. When sources disagree, the code and tests win. Report the disagreement to the page that owns it instead of smoothing it over.
2. Never copy a claim from another manual page without checking it. A page can fall behind the product without anyone noticing.
3. Read the page's benefit obligations and the Human Benefit Canon entries they name. Where the agent does the work, also read the matching Agent Benefit Canon entries.
4. Run every literal example, including commands, output, and config, against the live product. Examples must work in an external project, so don't use repository-only fixtures.

The [Demand Canon](demand-canon.md) and the [Consequence Canon](consequence-canon.md) describe the situations readers are in. Use them to find the worry a page answers, and never copy them as final text.

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

Reference stays exact and complete. Write it in the same voice, but never drop a default, limit, or exception to shorten it.

### Headings

Write headings that say what the section answers or does: "Without permission, nothing lands" and "What a pass does and doesn't tell you". Use sentence case.

Keep the concept's term in the heading of the section that explains it. `discern docs` search weighs headings above body text and points each result at the matching heading, and a reader scanning the page's contents does the same. "Stop or advise" is found by a search for either mode; "How firmly to ask" is found by neither.

Before renaming a heading, search for links to its anchor across `project/`, `templates/`, `src/`, and `site/`, then keep the heading or update every link.

### Tables

Use tables for comparisons, part-by-part breakdowns, sources of permission, and sequences of states. Keep each cell to a phrase or one short sentence.

### One home per concept

Explain each concept fully in one page, and link to that page elsewhere. The landing guide links to Proof's "From green to live" table instead of repeating it. Reference owns exact flags, fields, defaults, and limits.

### Generated pages and sections

Some reference text is generated from the product's own source, so the page and the product can't disagree. Edit the source, run `deno task codegen`, and commit the source and its output together. Never edit generated text by hand: the gate fails when it drifts from its source.

| Page or section          | Edit this source                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Glossary                 | `GLOSSARY` in `scripts/glossary_registry.ts`, which also renders the map's glossary.                                                                                                   |
| CLI reference            | The command and option descriptions that `buildCli` in `src/main.ts` assembles. The same text is `discern --help`.                                                                     |
| Config reference         | Key descriptions in `src/shared/config_schema.ts` and section prose in `src/shared/config_prose.ts`. The same text becomes each project's `discern.toml` and `discern config explain`. |
| Environment variables    | The definitions in `src/shared/environment_variables.ts`.                                                                                                                              |
| `BEGIN GENERATED` blocks | Their registries. Write the prose around them and leave the block itself to codegen.                                                                                                   |

CLI help, config prose, and the `discern.toml` template reach every project that installs discern. Keep that text free of this repository's vocabulary and examples.

### Link without a context cliff

A link adds depth. It must not hold the premise the current page needs. Before linking away, give the reader the key fact, why it matters, and what to do next. Then link, with text that says what the destination adds.

Link to published manual pages. Don't send a manual reader to a map page because it holds the implementation detail. When no public destination exists, keep the minimum true fact on the page and record the gap for its owner.

### Frontmatter

- Keep `id`, `kind`, `order`, `publish`, and `aliases` stable. When you retitle a page, add the old title as an alias.
- Write `description` as one plain sentence about what the reader gets. Search results and link previews show it.
- Keep a page's file name, and so its web address, unless the owner approves a change. When the address changes, list the old page route in `redirect_from` and update every link to it. [The docs section](../../90-site/the-docs-section.md) explains the steps.

## Before and after

Each pair shows one move. Reuse the move, in your own words.

| Before                                                                                                                                                                                                    | After                                                                                                                                                                             | The move                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| "When one of your project's checks fails, your agent gets the failing check, its output, and a command that reproduces that failure on its own."                                                          | "When a test or linter fails, your agent gets the failing command, its output, and the command that reruns that step on its own."                                         | Name what the project runs.                              |
| "The **gate** is the set of checks your project requires before a change counts as finished."                                                                                                             | "The **gate** runs your project's own commands, such as its formatter, linter, type checker, and test suite, and a change counts as finished only when every one of them passes." | Define a term by what it's made of.                      |
| "Your agent checks where the project stands and creates a **worktree**, a separate copy of the project on its own branch. It makes the change there. Your shared branch, the **trunk**, stays as it was." | "Your agent makes the change in a **worktree**, a separate copy of the project on its own branch, so your shared branch, the **trunk**, stays untouched while it works."          | Connect the reasoning.                                   |
| "**Declared met** means your agent reached that conclusion. discern doesn't check whether it's right. discern has no AI model of its own, so it can't judge a design."                                    | "**Declared met** is your agent's conclusion. discern has no AI model of its own, so it records the answer without judging whether it's right."                                   | Keep the cause with its effect.                          |
| "This guide follows one failure in a recipe app, from the red result to a passing gate."                                                                                                                  | "Say your agent adds search to your recipe app, and the test for clearing the search box fails."                                                                                  | Put the reader in the scene.                             |
| "Use discern-set-the-standard to propose a limit for the app's initial download size."                                                                                                                    | "We made the app's first download smaller. Can you make sure it stays that way? Show me what you'd measure and today's number before you add it."                                 | Write the request as the reader's intent.                |
| "Proof shows your change works."                                                                                                                                                                          | "Proof shows which of your project's commands passed on this exact commit."                                                                                                       | Make the strong claim exact.                             |
| "A checkpoint can help flag some risky changes, although it may not catch every case."                                                                                                                    | "A checkpoint makes your agent answer your question whenever a change touches the files it watches, and the answer goes into the Proof for you to read."                          | Replace the hedge with the mechanism.                    |
| "Evidence needs to describe the version that will become part of the project."                                                                                                                            | "Proof belongs to one commit. discern records it only when every change in the worktree is committed, so the checks describe exactly what would land."                            | Replace the abstraction with the actor and the reason.   |
| A 188-word paragraph on integration worktrees, served composition receipts, and continuation commands.                                                                                                    | "Another task may land on `main` while yours waits for review. That doesn't send your change back to the start."                                                                  | Lead with the situation and the benefit, then the facts. |

## Shapes to reject

Reject a draft that turns into any of these:

- **feature catalog:** a list of mechanisms instead of one promise to the reader;
- **mechanism-first opening:** a command, subsystem, schema, or internal object before the reader has a reason to care;
- **announced example:** "This guide follows one example" where the page could put the reader in the scene;
- **generic noun:** "checks", "the work", or "the process" where the reader has a precise word such as tests, linter, or commit;
- **chopped reasoning:** a cause and its effect split into separate sentences, leaving the reader to supply the "so";
- **abstract actor:** "the project carries", "evidence establishes", or "the practice consists of" where a person or discern does the work;
- **acting object:** a worktree, a report, or a file doing what a person, an agent, or discern does;
- **hedge stack:** "can help", "may be able to", or "is designed to" around behavior that is certain;
- **lawyer's caveat:** a true claim wrapped in qualifications when a more exact word would do;
- **caveat pile:** limits collected at the end of a page instead of at the step they affect;
- **defensive repetition:** the same caveat stated again for safety;
- **roaming example:** a scenario that changes partway through the page;
- **unfinished example:** a scenario dropped before it reaches an outcome;
- **undefined term:** a product noun used before the page explains it;
- **vocabulary request:** an example request built from discern's commands or skill names where the reader's intent would do;
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
- a stock trailing fragment such as ", every time" or ", by design";
- a count that introduces a list ("does two things:"), which the lint blocks;
- moral or dramatic adverbs on ordinary claims;
- noun-phrase negation. Write "a guessed branch name won't resolve" instead of "a guessed name resolves to no branch".

Comparisons that carry product meaning stay: green versus landed, unfinished versus refused, and checked versus declared. So does naming the real alternative a design choice avoids.

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
deno run --allow-read scripts/manual_reading_grade.ts --pages
```

The first must report no findings; the lint blocks counted introductions, scope intensifiers, and British spellings. The second shows editorial advice. Take the suggestions that make a sentence clearer and ignore the rest; don't shorten a sentence or drop a meaningful contrast only to clear an advisory.

The third lists each page's reading grade, hardest first, then the corpus grade that the `manual_reading_grade` standard holds as a ceiling. The grade measures sentence and word length, so connected reasoning raises it. Use the list to find the hardest pages, then read their longest sentences: split any that makes two separate claims, and leave a single line of reasoning whole. Reference pages don't appear because the standard doesn't measure them. The measure reads text without a full stop as part of the next sentence, which includes headings, table cells, and list items that end in semicolons. When list items are full sentences, give each its own capital and full stop.

Search for each concept the page explains, and confirm the top result points to the right section:

```sh
discern docs --search "<concept>"
```

Then confirm that:

- the opening tells the reader what they get, above the first `##` heading;
- the page uses the words the reader's project uses, with the plain category first where a newcomer needs it;
- each sentence carries its reasoning, and no cause is split from its effect;
- it's clear who acts at every step, and the pronouns are unambiguous;
- one example runs through the page, set as a scene and followed to its outcome;
- every term is defined where it first appears;
- each limit appears once, where it changes a decision, and strong claims are exact instead of hedged;
- requests read as the reader's intent, in quotation marks;
- where it reads naturally, the page shows one real artifact;
- every claim and example matches the live product;
- every benefit the page owns is stated in the reader's terms;
- headings carry their concept's term, and headings that other pages link to still resolve;
- website, terminal, MCP, and raw Markdown show the same authored text.
