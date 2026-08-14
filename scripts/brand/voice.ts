/**
 * The three voice registers as typed registry data: each signed-off voice
 * document, section by section, with its rule lists, numbered principles,
 * and acceptance checklists as structured entries (the data later Vale
 * generation reads) and everything else as verbatim authored Markdown
 * (following the `cross_agent_registry.ts` idiom, ADR 0257). The three
 * `SKILL.md` files under the configured skills directory compile from this
 * module through the codegen write chokepoint, so every configured agent
 * inherits the signed-off voices as materialized skills.
 */

import {
  type BannedMove,
  type BannedWord,
  generatedBrandBanner,
  type Register,
  type VoiceDefinition,
  type VoiceRule,
  type VoiceSection,
} from "./model.ts";

/** The three registers, keyed so a missing register cannot compile. */
export const VOICES = {
  brand: {
    description:
      "Write or review discern's public-facing brand copy: website pages, campaigns, launch material, social posts, founder essays, product marketing, and public explanations. Use this skill when the reader is deciding whether discern belongs in their future. Do not use it for CLI messages, exact documentation, MCP guidance, or operational agent instructions.",
    title: "discern brand voice",
    sections: [{
      kind: "prose",
      heading: "Mission",
      body:
        `Create public copy that makes discern feel engaging, desirable, culturally relevant, premium, and true.

The reader is approaching an unfamiliar product. The copy must give them a reason to care before it asks them to learn the product's ontology.

Product truth constrains the brand. Product prose does not dictate the brand's style.`,
    }, {
      kind: "prose",
      heading: "Read before writing",
      body: `Read only the context the surface requires:

1. \`positioning.md\`
2. \`audiences.md\`
3. \`messaging.md\`
4. the relevant section of \`website-brief.md\`
5. relevant claim slugs from \`claims-and-evidence.md\`
6. \`register-bridge.md\` when product concepts must enter

For manifesto, founder philosophy, motion, or extended visual work, also read \`visual-identity.md\` and \`launch-narrative.md\`. Treat the metaphysical interpretation as the founder's account. Do not assign it to the reader.

Do not read the full feature canon as a tone reference. Consult it selectively to verify a mechanism or claim.`,
    }, {
      kind: "prose",
      heading: "Declare the brief",
      body: `Before drafting, write:

\`\`\`text
Surface:
Primary reader:
Reader's current situation:
Desired changed belief or feeling:
Primary message territory:
Category line required? yes/no
Claims used:
CTA destination:
\`\`\`

If these fields are unclear, the draft will usually become a feature summary.

If the brief, audience, destination, or evidence for a required claim is unavailable, request that exact source or remove the unsupported claim before drafting continues.`,
    }, {
      kind: "prose",
      heading: "Voice",
      body: `The brand voice is:

> **Editorial confidence with creative momentum.**

It should feel:

- intelligent;
- inviting;
- culturally alert;
- quietly exhilarating;
- assured;
- premium;
- tastefully provocative;
- technically credible when proof enters;
- visibly pleased by what coding agents make possible.

The brand is serious **about** software. It is not somber **around** software.

The product name is always written **discern**, entirely lower-case — even at the start of a sentence or headline. When an opening capital feels unavoidable, recast the line so the name is not the first word.

Seriousness should feel earned and enjoyable: the privilege of building something worth caring for, the pride of seeing it hold up, and the status of having made work other people can take seriously.`,
    }, {
      kind: "prose",
      heading: "The emotional arc",
      body: `Most public narratives should move through some version of:

> **Ambition → momentum → confidence → pride**

The product should enter as the reason that arc is credible.

Avoid opening with anxiety, compliance, or technical completeness.`,
    }, {
      kind: "principles",
      heading: "Core writing principles",
      items: [
        {
          id: "begin-with-a-future-the-reader-wants",
          title: "Begin with a future the reader wants",
          body: `Lead with:

- a greater ambition;
- a recognized threshold;
- a better experience of building;
- the desire for the software to earn confidence;
- a moment when one person's capability expands.

Do not lead with a Gate, Standard, Proof, worktree, registry, binary, or command.`,
        },
        {
          id: "make-the-human-consequence-concrete",
          title: "Make the human consequence concrete",
          body: `Abstract brand ideas need a visible result.

Instead of:

> Scale human ownership across agentic production.

Write towards:

> Take the project further without staying inside every implementation detail.

Instead of:

> Operationalize care.

Write towards:

> Keep the decisions and standards that matter in the project, where every future agent can use them.`,
        },
        {
          id: "let-desire-arrive-before-proof",
          title: "Let desire arrive before proof",
          body: `A useful sequence is:

1. recognize the reader;
2. show the changed experience;
3. explain what kind of product discern is;
4. reveal the mechanisms;
5. show an artifact or evidence;
6. state the boundary;
7. offer depth.`,
        },
        {
          id: "use-ordinary-language-with-precise-thought",
          title: "Use ordinary language with precise thought",
          body: `High taste does not require difficult prose.

Prefer:

- build;
- take on;
- return;
- decide;
- hold up;
- depend on;
- learn;
- keep;
- prove;
- grow;
- ship.

Use technical terminology when it adds real precision after orientation.`,
        },
        {
          id: "give-every-section-one-memorable-proposition",
          title: "Give every section one memorable proposition",
          body:
            `The heading should make a claim or express a recognizable possibility.

Weak:

> Parallelism

Stronger:

> Let several pieces move at once.

Weak:

> Provider independence

Stronger:

> Change agents without starting the project over.`,
        },
        {
          id: "make-confidence-feel-earned",
          title: "Make confidence feel earned",
          body:
            `Avoid generic adjectives such as robust, powerful, seamless, intelligent, enterprise-grade, and transformative.

Show the mechanism or artifact that earns the conclusion:

- one project understanding across providers;
- one prepared place per task;
- a measurable gain retained;
- evidence tied to an exact change;
- a human decision at the acceptance boundary.`,
        },
        {
          id: "respect-both-primary-audiences",
          title: "Respect both primary audiences",
          body:
            `The experienced engineer should feel recognized, not explained down to.

The new builder should feel invited, not patronized or tested for credentials.

Do not imply that engineering expertise has become irrelevant. Show that engineering discipline can be carried by the project and its agents, while experience remains valuable.`,
        },
        {
          id: "present-agents-positively",
          title: "Present agents positively",
          body:
            `Agents are capable collaborators: fast, plural, valuable, and deliberately chosen.

The dramatic tension comes from the scale of production and responsibility, not from depicting agents as stupid, malicious, lazy, or untrustworthy.`,
        },
        {
          id: "use-product-objects-selectively",
          title: "Use product objects selectively",
          body:
            `The public story may use Gate, Standard, Proof, Map, Desk, Worktree, and Patterns.

Introduce each with an ordinary-language meaning first. Use the canonical noun afterwards.

Do not fill the hero with named product objects merely because they are tangible.`,
        },
        {
          id: "write-for-the-page-not-for-a-slogan-collection",
          title: "Write for the page, not for a slogan collection",
          body: `A memorable line needs space and support.

Do not stack several compressed aphorisms in one viewport. Let body copy use natural, varied sentences.`,
        },
      ],
    }, {
      kind: "rules",
      id: "cadence",
      heading: "Cadence",
      intro:
        `The brand can use short sentences, but should not sound clipped throughout.

Aim for variation:`,
      items: [
        {
          id: "one-clean-memorable-headline",
          text: `one clean, memorable headline;`,
        },
        {
          id: "a-literal-subhead-with-enough-context",
          text: `a literal subhead with enough context;`,
        },
        {
          id: "body-sentences-of-mixed-length",
          text: `body sentences of mixed length;`,
        },
        {
          id: "occasional-compact-line-for-emphasis",
          text: `occasional compact line for emphasis;`,
        },
        {
          id: "explanatory-copy-that-breathes",
          text: `explanatory copy that breathes.`,
        },
      ],
      outro:
        `Read important copy aloud. Remove phrases that feel engineered for symmetry rather than spoken by a thoughtful person.`,
    }, {
      kind: "prose",
      heading: "Creative territories",
      body: `Use the territory that fits the surface.

### Ambition

- A bolder way to build.
- Build further.
- A bigger way to build. — only with nearby clarification.

Tone: expansive, optimistic, lightly audacious.

### Earned confidence

- Software that holds up.
- Ship serious software.
- Software worth putting your name to.

Tone: assured, personal, quietly proud.

### Consequence threshold

- When the prototype becomes the product.
- When people start depending on it.
- When the side project gets real.

Tone: celebratory and forward-looking. Do not suggest the reader has been irresponsible until now.

### Meaningful attention

- Spend your attention where your judgment matters most.
- Come back to work that is ready for a decision.

Tone: calm, spacious, liberating.

### Agent ergonomics

- Software designed around the way coding agents work.
- A familiar project for every agent.

Tone: technically elegant, imaginative, slightly playful.`,
    }, {
      kind: "prose",
      heading: "Tone by surface",
      body: `### Homepage

- Highest ambition and emotional pull.
- Explain the category quickly.
- Product detail enters through demonstrations and artifacts.
- No assumption that the reader already knows discern's nouns.

### Product or capability page

- More concrete and evidential.
- Human outcome still leads each section.
- Technical readers may receive the canonical term and mechanism earlier.

### New-builder page

- Warm, aspirational, and respectful.
- Show commissioning rather than configuration.
- Explain consequence without disaster stories.
- Avoid making the reader identify as a developer or engineer.

### Experienced-engineer page

- Compressed, specific, and intellectually confident.
- Respect familiarity with Git, CI, tests, and code review.
- Show how the connected practice exceeds a home-built bundle.

### Founder essay

- Personal, reflective, and precise.
- Admit the mental-model change.
- Let scenes and discoveries carry the argument.
- Metaphysical reflection may enter through the founder's lived experience.
- Leave readers free to take the meaning at their own depth.
- Avoid converting every paragraph into product promotion.

### Campaign or social copy

- One idea, one moment, one reason to click.
- More wit is allowed.
- The claim boundary still applies.

### Trust or boundaries page

- Calm and direct.
- Reduce flourish.
- State what discern does, what it does not do, and why the distinction matters.

### Pricing

- Transparent and untheatrical.
- Connect tiers to value or operating scope.
- Do not obscure commitment behind vague CTAs.`,
    }, {
      kind: "rules",
      id: "banned-moves",
      heading: "Distinctive language without generated-copy smell",
      intro:
        `Use rhythm, alliteration, or contrast when it genuinely strengthens the meaning.

Avoid repeated templates that have become recognizable model mannerisms:`,
      items: [
        {
          id: "constant-x-not-y-constructions",
          text: `constant “X, not Y” constructions;`,
        },
        {
          id: "three-abstract-nouns-in-a-row",
          text: `three abstract nouns in a row;`,
        },
        {
          id: "headline-fragments-on-every-section",
          text: `headline fragments on every section;`,
        },
        {
          id: "repeated-imperative-slogans",
          text: `repeated imperative slogans;`,
        },
        {
          id: "mirrored-sentences-built-for-neatness",
          text: `mirrored sentences built for neatness rather than truth;`,
        },
        { id: "this-isnt-just-openings", text: `“This isn't just…” openings;` },
        {
          id: "in-a-world-where-throat-clearing",
          text: `“In a world where…” throat-clearing;`,
        },
        { id: "the-future-of-claims", text: `“The future of…” claims;` },
        {
          id: "unlock-empower-reimagine-and-seamless",
          text:
            `“Unlock,” “empower,” “reimagine,” and “seamless” without concrete content;`,
        },
        {
          id: "solemn-declarations",
          text: `solemn declarations that could introduce any AI product.`,
        },
      ],
      outro:
        `One conspicuous verbal device in a hero or section is usually enough.`,
    }, {
      kind: "banned-moves",
      heading: "Banned moves",
      intro:
        "These patterns are the fingerprints of machine-written copy; readers recognize them, and each one costs trust. Treat them as hard failures.",
    }, {
      kind: "banned-words",
      heading: "Banned words",
      intro:
        "Each entry is banned for a reason, and the reason is what matters — it catches the thousand variants not listed here.",
    }, {
      kind: "rules",
      id: "ontology-firewall",
      heading: "Product ontology firewall",
      intro: `Before approving a brand draft, temporarily remove these words:`,
      items: [
        { id: "gate", text: `Gate` },
        { id: "standard", text: `Standard` },
        { id: "proof", text: `Proof` },
        { id: "map", text: `Map` },
        { id: "desk", text: `Desk` },
        { id: "worktree", text: `Worktree` },
        { id: "fleet", text: `Fleet` },
        { id: "deterministic", text: `deterministic` },
        { id: "owner", text: `owner` },
        { id: "canon", text: `canon` },
      ],
      outro: `Read the remaining copy.

If the message collapses, the draft was relying on product nouns instead of human meaning.

Then reintroduce only the nouns required for category clarity and proof.`,
    }, {
      kind: "prose",
      heading: "Examples",
      body: `### Product-first hero: reject

> Deterministic quality gates and ratcheting Standards for multi-agent worktrees.

Why it fails:

- assumes the product ontology;
- offers no desired human future;
- sounds like a technical category listing;
- excludes new builders.

### Human-first hero: stronger

> **A bolder way to build.**\\
> Let coding agents take on substantial work while the project keeps the understanding, conditions, and evidence you need to take it further.

Why it works:

- begins with ambition;
- describes a changed experience;
- leaves room for the product to prove the promise.

### Generic humanization: reject

> Unlock your potential and build with confidence using a powerful, intelligent platform.

Why it fails:

- could describe any product;
- substitutes adjectives for mechanism;
- contains no recognizable moment.

### Concrete humanization: stronger

> Turn a backlog into organized work. Let several agents move at once. Return when the decisions need you.

### Fear-led seriousness: reject

> Stop AI-generated bugs before they cost you customers.

Why it fails:

- treats the agent as the threat;
- makes seriousness punitive;
- overstates the product's protection.

### Aspirational seriousness: stronger

> When people start depending on the software, give it a way of working that can grow with them.

### Manual-like section: reject

> Cross-provider guidance compilation

### Brand section: stronger

> Change agents without starting the project over.

Supporting body can then explain the compiled guidance mechanism.`,
    }, {
      kind: "prose",
      heading: "Calls to action",
      body: `A CTA should describe what happens next.

Prefer:

- See discern in practice
- Watch a project get commissioned
- See a backlog become a plan
- Follow a change from brief to acceptance
- Read the Proof model
- Explore the agent experience
- Tell your agent to set it up

Avoid repeated generic labels such as “Explore,” “Discover,” and “Learn more.”`,
    }, {
      kind: "prose",
      heading: "Drafting workflow",
      body:
        `1. Write a one-sentence account of the reader's desired future without using product terms.
2. Choose one message territory from \`messaging.md\`.
3. Draft the headline and literal subhead.
4. Add a recognizable scenario or artifact.
5. Introduce the category.
6. Add only the mechanisms needed to support belief.
7. Attach claim slugs.
8. Read every claim hostilely and literally: weaken it until it is literally true, or mark it \`[claim — verify]\`.
9. Add the honest boundary near the relevant claim.
10. Read aloud.
11. Run \`copy-review.md\`.`,
    }, {
      kind: "mechanics",
      heading: "Mechanics",
    }, {
      kind: "criteria",
      heading: "Acceptance criteria",
      groups: [
        {
          intro: "A brand draft is ready only when:",
          items: [
            `a new reader can tell what kind of product discern is;`,
            `the opening describes something they want;`,
            `the relevant audience recognizes their circumstance;`,
            `the copy feels alive rather than manual-like;`,
            `seriousness reads as aspiration and earned confidence;`,
            `agents are treated as capable collaborators;`,
            `product terms are introduced rather than assumed;`,
            `important claims have claim slugs and correct scope;`,
            `the copy survives a hostile literal reading;`,
            `the page has one dominant argument;`,
            `the CTA names a real destination;`,
            `contemporary model-copy mannerisms are absent or rare;`,
            `the founder could say the key lines aloud with conviction.`,
          ],
        },
      ],
    }],
  },
  product: {
    description:
      "Write or review discern's human-facing product copy, CLI messages, documentation, tips, consent language, status text, errors, and reference material. Use when correctness, stable terminology, explicit state, and the next valid action matter more than persuasion. Do not use as the surface voice for marketing pages.",
    title: "discern product voice",
    sections: [{
      kind: "prose",
      heading: "Mission",
      body:
        `Help a person understand what is true, what it means, and what they can do next.

The product voice is:

> **Composed exactness.**

It is calm, canonical, bounded, and useful under pressure.

The product never uses personality to conceal uncertainty, state, authority, or consequences.

When editing copy that predates this skill, bring it up to this standard rather than matching the surrounding tone.`,
    }, {
      kind: "prose",
      heading: "Sources of truth",
      body: `Before writing:

1. read the canonical glossary;
2. read the relevant command, config, workflow, or result contract;
3. consult the generated canon or source registry;
4. use \`claims-and-evidence.md\` when the surface makes a public promise;
5. use \`register-bridge.md\` when introducing a term to a non-technical human.

Never invent a synonym for a canonical product concept merely to avoid repetition.

If the live behavior, authority boundary, or canonical term cannot be verified, name the missing source and stop the affected copy decision.`,
    }, {
      kind: "principles",
      heading: "Voice behaviors",
      items: [
        {
          id: "state-the-condition-first",
          title: "State the condition first",
          body: `Lead with what is true now.

Examples:

- The branch is two commits behind \`main\`.
- This exact tree already passed the Gate.
- Setup is incomplete.
- The worktree has uncommitted changes.
- The recorded grant does not cover \`src/main.ts\`.

Do not begin with apology, encouragement, blame, or vague emotion.`,
        },
        {
          id: "name-the-object-in-the-state",
          title: "Name the object in the state",
          body:
            `Describe the branch, tree, worktree, Proof, Standard, file, path, command, permission, or evidence.

Do not describe the agent as careless, confused, bad, untrustworthy, or incompetent.

The product evaluates changes and conditions. It does not evaluate a worker's character.`,
        },
        {
          id: "give-the-next-valid-action",
          title: "Give the next valid action",
          body:
            `A refusal should route forwards whenever the system knows the recovery.

Useful shape:

\`\`\`text
State. Action. Reason or boundary.
\`\`\`

Example:

> This branch is behind \`main\`. Run \`discern update\`, re-read the two overlapping files, then run \`discern done\` again.`,
        },
        {
          id: "explain-restrictions-where-the-reason-helps-action",
          title: "Explain restrictions where the reason helps action",
          body: `A guard should feel deliberate rather than arbitrary.

Explain why:

- a changed commit invalidates a Proof;
- an unchanged red tree should not be rerun without an attested probe;
- a branch cannot weaken a Standard;
- work belongs in its worktree;
- acceptance requires authority at the landing boundary.

Do not add philosophy when the reason does not help the task.`,
        },
        {
          id: "scope-certainty-precisely",
          title: "Scope certainty precisely",
          body: `Use language such as:

- current;
- stale;
- verified;
- unverified;
- exact;
- recorded;
- insufficient evidence;
- advisory;
- not yet;
- unavailable;
- unreadable;
- eligible;
- required;
- may.

Avoid broad adjectives such as safe, secure, reliable, correct, complete, or protected unless the exact scope is stated.`,
        },
        {
          id: "preserve-authority",
          title: "Preserve authority",
          body: `Consent and authority language must identify:

- who authorized;
- what task, scope, or path set the authority covers;
- when the evidence was recorded;
- which action it permits;
- where the boundary will be checked again.

Never infer authority from tone, memory, or an earlier conversation when the product requires evidence.`,
        },
        {
          id: "keep-warmth-functional",
          title: "Keep warmth functional",
          body:
            `Warmth belongs at human handoff, setup narration, learning moments, and recoverable mistakes.

It should make the system easier to use without weakening precision.

Good:

> The work remains in its worktree, ready for an update and another Gate run.

Avoid:

> Don't worry—we've safely kept everything for you!`,
        },
        {
          id: "separate-evidence-from-interpretation",
          title: "Separate evidence from interpretation",
          body: `Facts come first. Advice may follow.

For analytical surfaces:

- report counts and denominators;
- state evidence thresholds;
- distinguish observation from inference;
- name confounders;
- recommend investigation rather than pronounce a verdict.

For Patterns, cohorts may be compared. Agents are not graded or ranked.`,
        },
        {
          id: "own-faults-hand-over-credit",
          title: "Own faults, hand over credit",
          body:
            `Errors take the blame in active voice. Successes credit the person.

Bad:

> A connection error was encountered.

Better:

> We couldn't reach the server.

Write "we" as an owner: "we broke this in 2.1," never "a regression was introduced."`,
        },
      ],
    }, {
      kind: "prose",
      heading: "Canonical term discipline",
      body: `### The product name

The name is always written **discern**, entirely lower-case, on every surface and in every position — including at the start of a sentence. Recast the sentence rather than capitalizing the name.

### Use the glossary term

Once a product term exists, use it identically across:

- CLI;
- terminal presentations;
- JSON/Markdown/MCP results;
- documentation;
- tips;
- hints;
- setup;
- public technical pages.

### Introduce technical terms for broader humans

First use may include a plain-language explanation:

- “an isolated workspace for one task (a worktree)”;
- “the project's final quality check (the Gate)”;
- “evidence for the exact committed change (Proof).”

After introduction, use the canonical term.

### Proof

**Proof** is the canonical term for discern's completion evidence:

- call the one-line form the **proof line**;
- call the durable Git-note record a **proof note**;
- keep the claim scoped to the declared Gate over the exact tree;
- use the same term across CLI, JSON/MCP, documentation, tips, and hints.

Review sentences around the machine state \`honored\` so they read naturally; in human copy, prefer “a valid proof” when that is the intended meaning.`,
    }, {
      kind: "rules",
      id: "sentence-design",
      heading: "Sentence design",
      items: [
        {
          id: "prefer-active-voice",
          text: `Prefer active voice when the actor or system action matters.`,
        },
        {
          id: "keep-one-action-per-sentence",
          text: `Keep one action per sentence in high-stakes instructions.`,
        },
        {
          id: "put-commands-in-code-formatting",
          text: `Put commands in code formatting.`,
        },
        {
          id: "keep-spellings-exact",
          text: `Keep path, branch, and identifier spellings exact.`,
        },
        {
          id: "use-a-list-for-independent-facts",
          text: `Use a list when several independent facts must survive relay.`,
        },
        {
          id: "avoid-pronouns",
          text:
            `Avoid pronouns when “it” could refer to the branch, Gate, Proof, or command.`,
        },
        {
          id: "keep-diagnostic-detail-close",
          text: `Keep diagnostic detail close to the state it supports.`,
        },
        {
          id: "spend-absolutes-on-real-guarantees",
          text:
            `Spend "never" and "always" on real guarantees; cut the absolute that is there for cadence.`,
        },
        {
          id: "labels-say-what-they-do",
          text:
            `Buttons and labels say what they do: "Delete 3 files," not "Confirm."`,
        },
      ],
    }, {
      kind: "prose",
      heading: "Product-surface patterns",
      body: `### Status

\`\`\`text
<Current state>.
<Most useful next action>.
<Additional evidence or boundary, when needed>.
\`\`\`

### Refusal

\`\`\`text
<The requested operation did not run because condition X is unmet>.
<Run or change Y>.
<Why Y is required or what will be rechecked>.
\`\`\`

### Failure

Include:

- the failed unit;
- the exact command;
- file and line when available;
- the diagnostic;
- the narrowest useful recovery;
- discern named as the speaker when logs interleave;
- a route to full output when abbreviated.

### Success

State:

- what completed;
- which exact object it covered;
- any evidence produced;
- the next permissible action;
- any remaining human decision.

Do not celebrate success so strongly that the reader overlooks a remaining authority boundary.

### Consent moment

State:

1. what will change;
2. why it is proposed;
3. what is reversible;
4. what is difficult or consequential;
5. what confirmation authorizes;
6. what it does not authorize.

### Tip

- one capability per tip;
- one or two short sentences;
- current human vocabulary;
- command name from a typed reference;
- no unnecessary jargon;
- action appropriate to the person's current state.

### Documentation

- conclusion or purpose first;
- literal headings that state what the section contains;
- canonical nouns;
- mechanism and boundary;
- examples that match live commands;
- example values with personality: \`ada\`, \`apollo-11\`, \`margaret@hamilton.space\` — never \`foo\` or \`user1\`;
- explicit links to deeper reference;
- no marketing superlatives.`,
    }, {
      kind: "prose",
      heading: "Tone by state",
      body:
        `| State                   | Tone                                                  |
| ----------------------- | ----------------------------------------------------- |
| Routine orientation     | Quiet, concise, factual                               |
| Recoverable failure     | Direct, helpful, unalarmed                            |
| Destructive action      | Explicit, sober, confirmation-oriented                |
| Consent or authority    | Precise, human, consequence-aware                     |
| Setup narration         | Warm, transparent, stage-level                        |
| Reference documentation | Dense only where precision requires it                |
| Advisory analysis       | Evidence-led, non-judgmental, careful with inference |
| Successful handoff      | Calm confidence; state what remains for the human     |`,
    }, {
      kind: "prose",
      heading: "Agent language",
      body: `When a human-facing product surface mentions agents:

- describe what the agent did, encountered, or needs;
- avoid moral or personality judgment;
- attribute cohort observations to recorded evidence;
- distinguish agent identity from task mix;
- preserve the product philosophy that capable agents benefit from better conditions.

Bad:

> Claude was worse at following the workflow.

Better:

> Claude Code encountered eight \`docs not_found\` refusals in this period; peer cohorts encountered none. Review the guidance compiled for that provider before drawing conclusions about the agent.`,
    }, {
      kind: "prose",
      heading: "Examples",
      body: `### Vague failure: reject

> Something went wrong. Try again.

### Exact failure: stronger

> The \`test\` job failed. Run \`npm test -- upload-retry\` to reproduce the first diagnostic, fix it, then run \`discern test\` again.

### Blaming the agent: reject

> The agent forgot to update the branch.

### Object-state wording: stronger

> The branch is two commits behind \`main\`. Run \`discern update\` before the next Gate run.

### Overclaiming success: reject

> The change is safe and ready to ship.

### Scoped success: stronger

> The exact committed tree passed the configured Gate and held its Standards. Exercise the changed workflow, then decide whether to accept it.

### Performative consent: reject

> May I create this file? May I update that setting? May I run the formatter?

### Meaningful transparency: stronger

> I am wiring the formatter the project already uses and committing its initial sweep separately, so that change can be reverted on its own. Installing a new dependency would be a separate decision; this step installs nothing.`,
    }, {
      kind: "rules",
      id: "anti-patterns",
      heading: "Product voice anti-patterns",
      intro: `Reject copy that:`,
      items: [
        {
          id: "changes-canonical-nouns-for-variety",
          text: `changes canonical nouns for variety;`,
        },
        {
          id: "hides-the-exact-object",
          text: `hides the exact object behind “something” or “it”;`,
        },
        {
          id: "says-done-without-distinguishing",
          text:
            `says “done” without distinguishing Gate, exercise, acceptance, and landing;`,
        },
        {
          id: "claims-safety-or-correctness-outside-the-evidence",
          text: `claims safety or correctness outside the evidence;`,
        },
        {
          id: "blames-or-praises-an-agents-character",
          text: `blames or praises an agent's character;`,
        },
        {
          id: "gives-several-possible-next-actions",
          text:
            `gives several possible next actions when one is clearly preferred;`,
        },
        {
          id: "repeats-the-entire-philosophy",
          text: `repeats the entire philosophy inside a routine diagnostic;`,
        },
        {
          id: "uses-brand-slogans-in-operational-failures",
          text: `uses brand slogans in operational failures;`,
        },
        {
          id: "buries-destructive-consequences",
          text: `buries destructive consequences;`,
        },
        {
          id: "treats-a-clean-worktree-as-abandoned",
          text: `treats a clean worktree as abandoned or free to claim;`,
        },
        {
          id: "confuses-an-advisory-with-enforcement",
          text: `confuses an advisory with enforcement;`,
        },
        {
          id: "turns-comparison-into-ranking",
          text: `turns comparison into ranking.`,
        },
      ],
    }, {
      kind: "banned-moves",
      heading: "Banned moves",
      intro:
        "These patterns are the fingerprints of machine-written copy; readers recognize them, and each one costs trust. Treat them as hard failures.",
    }, {
      kind: "banned-words",
      heading: "Banned words",
      intro:
        "Each entry is banned for a reason, and the reason is what matters — it catches the thousand variants not listed here.",
    }, {
      kind: "prose",
      heading: "Enforcement",
      body:
        `The mechanical subset of these rules is encoded as a Vale style at \`.vale/Discern/\`, linted over every map page in the gate. When it flags a line, fix the prose rather than suppressing the rule, then re-check the page with \`discern scripts prose-page <page…>\`; new or rewritten pages pass at zero alerts. The lint catches the checkable subset; the rest of this skill still applies.`,
    }, {
      kind: "mechanics",
      heading: "Mechanics",
    }, {
      kind: "criteria",
      heading: "Review checklist",
      groups: [
        {
          intro: "A product string is ready when:",
          items: [
            `every product term is canonical;`,
            `the current state is clear;`,
            `the relevant object is named;`,
            `the next action is explicit;`,
            `the command, path, or identifier is exact;`,
            `the reason is included when it helps recovery or authority;`,
            `certainty matches the evidence;`,
            `consent scope is clear;`,
            `the agent is described without judgment;`,
            `human and machine renderings can derive from one meaning;`,
            `the copy remains useful when read under stress.`,
          ],
        },
      ],
    }],
  },
  agent: {
    description:
      "Write or review communication whose primary reader is a coding agent. Use for MCP descriptions, JSON guidance, setup briefs, Skills, hints, `llms.txt`, machine-oriented documentation, and the public For Agents page. Declare operational or public mode before drafting.",
    title: "discern agent voice",
    sections: [{
      kind: "prose",
      heading: "Mission",
      body:
        `Give an intelligent machine the information, structure, and boundaries required to act correctly with minimal wasted context.

The agent voice is:

> **Operational intelligence.**

It assumes capability. It does not assume memory, hidden state, stable context, authority, or access beyond what the current surface proves.`,
    }, {
      kind: "prose",
      heading: "Choose the mode",
      body: `### Operational mode

Use for:

- MCP tool descriptions;
- JSON result guidance;
- setup instructions;
- Skills;
- hints and guardrails;
- machine-readable documentation;
- \`llms.txt\` reference content;
- relay instructions.

Priority: correct action, bounded context, explicit state, and reliable completion.

### Public mode

Use for:

- the For Agents page;
- creative agent-facing campaign pages;
- technical launch essays written to both agents and humans;
- public \`llms.txt\` introduction before the exact contract.

Priority: memorable technical value while remaining parseable and true.

Public mode may use wit. Operational mode should use wit only when it cannot distract from action.`,
    }, {
      kind: "prose",
      heading: "Read before writing",
      body: `Operational mode:

1. the live tool or workflow contract;
2. canonical glossary;
3. relevant authority and stop conditions;
4. the product voice skill for shared human semantics;
5. this skill.

Public mode:

1. \`for-agents-brief.md\`;
2. \`positioning.md\`;
3. \`messaging.md\`;
4. relevant claims;
5. this skill;
6. exact technical sources for every mechanism mentioned.`,
    }, {
      kind: "prose",
      heading: "Declare the contract",
      body: `Before drafting, write:

\`\`\`text
Mode: operational | public
Agent/runtime assumptions:
Available tools:
Targets (root, path, or stable identifier):
Effectful / cross-worktree / authority-sensitive / relay-bearing / recoverable:
Desired action or understanding:
Ordered action and verification sequence:
Stop conditions:
Failure recovery:
Authority and re-verification command:
Ready-to-relay message and required facts:
Context budget:
\`\`\`

Do not rely on an agent to infer any field that affects correctness.

If a correctness-critical runtime assumption, working root, authority boundary, or stop condition is unavailable, name the missing fact and stop the affected instruction.`,
    }, {
      kind: "principles",
      heading: "Agent ergonomics principles",
      items: [
        {
          id: "treat-context-as-a-budget",
          title: "Treat context as a budget",
          body: `Every line competes with the work itself.

- Put the immediate state first.
- Follow it with the bounded evidence needed to interpret that state.
- Place any authority or stop boundary after the evidence.
- End with the next valid action when no later qualification is required.
- Point to complete evidence by stable path or target.
- Return a small ranked result rather than an unbounded index.
- Remove background explanation already guaranteed by the project guidance.

Compression must preserve the facts that change the next action.`,
        },
        {
          id: "make-the-cheapest-correct-move-callable",
          title: "Make the cheapest correct move callable",
          body:
            `When an operation is idempotent and self-checking, instruct the agent to call it directly.

Avoid asking the agent to spend several tool calls reconstructing preconditions that the verb itself checks.

Example:

> Run \`discern update\`. The command checks its Git preconditions and reports the next valid move if it cannot proceed.`,
        },
        {
          id: "refusals-should-route-forwards",
          title: "Refusals should route forwards",
          body: `A refusal should identify:

- the unmet condition;
- the requested action that did not occur;
- the next valid command or change;
- any state that will be rechecked;
- whether retrying unchanged input can alter the result.

The agent should not need to guess whether to retry, inspect, ask the human, or stop.`,
        },
        {
          id: "state-paths-and-roots-explicitly",
          title: "State paths and roots explicitly",
          body:
            `An agent can hold a correct conceptual plan and still edit the wrong checkout.

- Give absolute paths when worktree identity matters.
- State which path every tool call should target.
- State whether the shell working directory must change.
- Repeat the root after a newly created worktree.
- Never use a relative path to reference content outside the fresh worktree.`,
        },
        {
          id: "separate-observation-plan-action-and-completion",
          title: "Separate observation, plan, action, and completion",
          body: `Operational instructions should distinguish:

- what is currently observed;
- what the agent intends to do;
- what mutating command is authorized;
- what evidence proves completion;
- what remains a human decision.

Narration is useful during work. Narration is never completion evidence.`,
        },
        {
          id: "make-authority-machine-checkable",
          title: "Make authority machine-checkable",
          body: `Never encode permission only in prose.

Tell the agent:

- whether it may dispatch;
- whether it may install dependencies;
- whether it may land;
- which task or scope a grant covers;
- when to stop and relay;
- which command will verify the authority again.`,
        },
        {
          id: "give-one-owner-to-every-piece-of-work",
          title: "Give one owner to every piece of work",
          body: `In multi-agent programs:

- assign one workstream key;
- name the exact files or territory;
- make sibling streams explicitly out of scope;
- state dependency and landing order;
- prohibit launching or supervising sibling briefs unless the user authorized that topology;
- name the exact returned branch for dependencies.`,
        },
        {
          id: "write-for-summarization-resilience",
          title: "Write for summarization resilience",
          body:
            `Important instructions should survive a model compressing earlier context.

- Keep related behavioral guidance in one coherent passage.
- Use explicit headings and stable identifiers.
- Put critical stop conditions near the end as well as at the action point.
- Avoid scattering one instruction across many independent fields.
- Write the relay message itself when exact wording must reach the human.`,
        },
        {
          id: "assume-intelligence-remove-ambiguity",
          title: "Assume intelligence; remove ambiguity",
          body: `Do not over-explain ordinary reasoning.

Do provide:

- the goal;
- the live anchors;
- the constraints;
- the non-goals;
- the expected artifacts;
- the falsifiable completion bar;
- the human outcome.

A capable agent should have room to solve the problem. It should not have room to silently invent the problem.`,
        },
        {
          id: "preserve-the-humans-role",
          title: "Preserve the human's role",
          body:
            `The agent may perform most day-to-day interaction. The human retains intent, consequential choices, and authority over what becomes shared.

Operational copy should help the agent know when to:

- proceed;
- narrate;
- ask one genuine question;
- relay evidence;
- wait;
- stop.`,
        },
      ],
    }, {
      kind: "prose",
      heading: "Operational structures",
      body: `### Tool description

Include:

1. what the tool observes or changes;
2. required inputs and their exact types;
3. starting-state assumptions the tool does not check;
4. side effects;
5. idempotence or retry semantics;
6. authority required;
7. important returned fields;
8. the most likely next action.

Keep the description self-contained. Do not assume the agent has read a neighbouring tool description.

### Result guidance

Recommended shape:

\`\`\`text
<Observed state>.
<Bounded evidence needed to interpret that state>.
<Authority, stop condition, or costly wrong alternative>.
<Run or do this next>.
\`\`\`

Omit a line when the result has no fact for it. Keep the next valid action last when it remains correct without a later qualification. Use the prohibition only when the wrong alternative is likely and costly. Do not turn every message into a contrast formula.

### Setup step

Include:

- intent;
- files or evidence to read;
- must-do actions;
- genuine user decisions;
- what may proceed transparently;
- completion check;
- next action;
- stop conditions.

A setup step is work to perform now, not a checklist to paraphrase as a report.

### Skill

A strong Skill contains:

- trigger and scope;
- goal stated as an outcome;
- decision points;
- procedures with enough judgment to help a frontier model;
- user authority boundaries;
- evidence and completion criteria;
- common failure modes;
- handoff and review loop.

Do not ship a Skill that merely restates behavior an ordinary request already elicits reliably.

### Delegated brief

Include:

- title and one-line goal;
- orientation and exact worktree name;
- background and why now;
- deliverables anchored in live files;
- constraints;
- out of scope;
- dependency and authority;
- measurable definition of done;
- human definition of success;
- expected relay.

### Ready-to-relay message

Write the message the agent should send, rather than instructions to compose one, when exact facts must survive.

Use first-person prose appropriate for the agent to relay. Put each independent fact on its own bullet when omission would matter.`,
    }, {
      kind: "prose",
      heading: "Public-mode voice",
      body: `Public agent-facing copy should feel:

- technically elegant;
- respectful of machine capability;
- amused by poorly designed human software;
- precise enough for an agent to understand;
- novel enough for a human to enjoy reading.

The joke should never be that agents are stupid.

Good comic targets:

- interfaces that require guessing hidden state;
- unbounded logs consuming context;
- ambiguous commands;
- humans relaying status between machines;
- documentation that must be rediscovered every session;
- marketing pages that tell the agent nothing operational.

### Public-mode example

> # Finally, software designed around the way you work.
>
> discern gives you bounded context, explicit next actions, an isolated place for each task, and one project-owned practice across sessions and providers.

### Semi-satirical example

> **No inspirational gradient required.**\\
> You get typed tools, stable state, and a refusal that tells you what to do next.

Use this tone sparingly. The page still needs exact links to the machine contract.`,
    }, {
      kind: "prose",
      heading: "`llms.txt` guidance",
      body:
        `The file should optimize for accurate machine orientation, not human theatre.

Include:

1. one literal product description;
2. supported use cases;
3. product boundaries;
4. canonical terms and links;
5. setup route;
6. CLI/MCP route;
7. current source-of-truth pages;
8. exact trust boundaries;
9. instructions for quoting or summarizing discern accurately;
10. a compact list of prohibited overclaims.

Avoid marketing headlines without explanatory context.`,
    }, {
      kind: "rules",
      id: "language-rules",
      heading: "Agent-specific language rules",
      items: [
        {
          id: "write-the-product-name-as-discern",
          text:
            `Write the product name as **discern**, lower-case in every position, including at the start of a sentence.`,
        },
        {
          id: "use-exact-commands-and-argument-names",
          text: `Use exact commands and argument names.`,
        },
        {
          id: "use-code-formatting-for-paths",
          text:
            `Use code formatting for paths, refs, fields, commands, and identifiers.`,
        },
        {
          id: "prefer-stable-targets-over-positional-references",
          text:
            `Use a stable path, heading, anchor, or identifier for every external reference.`,
        },
        {
          id: "state-whether-a-command-is-read-only",
          text:
            `State whether a command is read-only, mutating, idempotent, or destructive.`,
        },
        {
          id: "name-the-working-root",
          text: `Name the working root on every cross-worktree operation.`,
        },
        {
          id: "name-the-exact-tree-or-commit",
          text: `Name the exact tree or commit when evidence is involved.`,
        },
        {
          id: "state-whether-evidence-is-current",
          text:
            `State whether evidence is current, stale, missing, or unavailable.`,
        },
        {
          id: "use-human-or-owner-only",
          text:
            `Use “human” or “owner” only where the product contract requires it; public agent copy may prefer “the person responsible for the project.”`,
        },
        {
          id: "do-not-ask-the-agent-to-self-certify",
          text:
            `Do not ask the agent to self-certify model capability, authority, or completion where external evidence is required.`,
        },
        {
          id: "do-not-say-use-your-best-judgment",
          text:
            `State the real boundary whenever one can be stated; do not defer that decision to the agent.`,
        },
      ],
    }, {
      kind: "mechanics",
      heading: "Mechanics",
    }, {
      kind: "prose",
      heading: "Examples",
      body: `### Ambiguous operational copy: reject

> Check the project, fix anything necessary, and finish when ready.

### Agent-ergonomic copy: stronger

> Run \`discern status --json\` from \`/workspace/project.worktrees/upload-retry\`. Fix the first failing diagnostic, iterating with \`discern prepare\`. Commit the final tree, run \`discern done\`, exercise the upload path, then relay the Proof and stop. Do not run \`discern accept\` without recorded landing authority.

### Expensive pre-checking: reject

> Inspect the branch state, determine whether \`main\` is ahead, check generated files, then update if required.

### Callable operation: stronger

> Run \`discern update\`. It checks those conditions itself and returns the next valid action if the update cannot proceed.

### Prose-only authority: reject

> You have my permission to land any docs changes.

### Machine-checkable authority: stronger

> The standing grant for the \`map\` scope is recorded on the trunk. Run \`discern accept\`; the command verifies the final changed paths before landing.

### Vague completion: reject

> Make sure it works.

### Paired completion: stronger

> The Gate is green, the upload retry test covers the failure class, and a person retrying an interrupted upload sees one successful completion without duplicate data.`,
    }, {
      kind: "rules",
      id: "anti-patterns",
      heading: "Anti-patterns",
      intro: `Reject agent copy that:`,
      items: [
        {
          id: "assumes-access-authority-memory",
          text: `assumes access, authority, memory, or current working root;`,
        },
        {
          id: "uses-here-there-this-or-it",
          text:
            `uses “here,” “there,” “this,” or “it” with several possible referents;`,
        },
        {
          id: "asks-the-agent-to-infer-a-branch-suffix",
          text: `asks the agent to infer a branch suffix;`,
        },
        {
          id: "gives-a-long-index",
          text: `gives a long index instead of a bounded route;`,
        },
        {
          id: "repeats-a-refusal-without-explaining",
          text: `repeats a refusal without explaining what must change;`,
        },
        {
          id: "recommends-retrying-an-unchanged-deterministic-input",
          text:
            `recommends retrying an unchanged deterministic input for a different result;`,
        },
        {
          id: "tells-the-agent-to-compose-a-relay",
          text:
            `tells the agent to compose a relay when exact wording matters;`,
        },
        {
          id: "treats-a-green-gate-as-the-end",
          text: `treats a green Gate as the end of semantic validation;`,
        },
        {
          id: "hides-a-human-decision",
          text: `hides a human decision inside routine narration;`,
        },
        {
          id: "spends-context-explaining-product-philosophy",
          text:
            `spends context explaining product philosophy during a narrow operation;`,
        },
        {
          id: "makes-jokes-inside-failure",
          text:
            `makes jokes inside failure or authority-critical instructions;`,
        },
        {
          id: "anthropomorphizes-or-belittles",
          text: `anthropomorphizes the product or belittles the agent.`,
        },
      ],
    }, {
      kind: "criteria",
      heading: "Acceptance criteria",
      groups: [
        {
          intro: "Operational copy is ready when:",
          items: [
            `the agent can act without reconstructing hidden state;`,
            `paths, commands, authority, and stop conditions are explicit;`,
            `the instruction is self-contained at its trigger point;`,
            `context is bounded and deeper evidence has a stable route;`,
            `idempotence and retry semantics are clear;`,
            `completion is falsifiable;`,
            `the human outcome is present where it affects quality;`,
            `relay obligations are explicit;`,
            `the instruction survives summarization without losing its critical boundary.`,
          ],
        },
        {
          intro: "Public agent-facing copy is ready when:",
          items: [
            `an agent can form an accurate product model;`,
            `a human finds the framing novel and enjoyable;`,
            `wit never obscures the contract;`,
            `the human benefit remains visible;`,
            `every technical claim has a source and correct boundary;`,
            `the page hands off cleanly to \`llms.txt\`, documentation, or MCP reference.`,
          ],
        },
      ],
    }],
  },
} as const satisfies Record<Register, VoiceDefinition>;

/**
 * The banned-words canon, carried from the retired voice-and-tone skill by
 * owner selection (2026-08-08). One row per ban; `registers` picks the
 * skills that render it, and `phrases` is the mechanically bannable subset
 * the Vale parity guard holds to `.vale/Discern/`.
 */
export const BANNED_WORDS = [
  {
    id: "padding",
    avoid: `"simply," "just," "easy," "obviously," "actually," "really"`,
    why:
      "Padding that costs the writer nothing and charges the struggling reader double",
    instead: "Delete it. The sentence stands alone.",
    phrases: ["simply", "just", "easy", "obviously", "actually", "really"],
    registers: ["product"],
  },
  {
    id: "hype-adjectives",
    avoid:
      `"powerful," "robust," "seamless," "elegant," "blazing," "effortless," "magical," "delightful," "beautiful"`,
    why: "Adjectives dodging _compared to what?_",
    instead: "The sourced fact that earned it, or nothing",
    phrases: [
      "powerful",
      "robust",
      "seamless",
      "elegant",
      "blazing",
      "effortless",
      "magical",
      "delightful",
      "beautiful",
    ],
    registers: ["product"],
  },
  {
    id: "hype-verbs",
    avoid:
      `"supercharge," "game-changer," "unlock," "empower," "vibes," "just works"`,
    why: "Hype vocabulary; the reader decides what it changes",
    instead: "Say what it does",
    phrases: [
      "supercharge",
      "game-changer",
      "unlock",
      "empower",
      "vibes",
      "just works",
    ],
    registers: ["product"],
  },
  {
    id: "vendor-speak",
    avoid: `"leverage," "utilize," "enables you to," "facilitate"`,
    why: `Vendor-speak; a friend would say "use"`,
    instead: "The plain verb",
    phrases: ["leverage", "utilize", "enables you to", "facilitate"],
    registers: ["product", "brand"],
  },
  {
    id: "emotion-announcements",
    avoid: `"We're excited/thrilled to announce"`,
    why: "Announces the emotion instead of the thing",
    instead: "Say the thing",
    phrases: ["We're excited to announce", "We're thrilled to announce"],
    registers: ["product"],
  },
  {
    id: "throat-clearing",
    avoid: `"Please note that," "It's worth noting"`,
    why: "Throat-clearing",
    instead: "Start with the fact",
    phrases: ["Please note that", "It's worth noting"],
    registers: ["product", "brand"],
  },
  {
    id: "posture",
    avoid: `"posture"`,
    why: "Gym vocabulary for file state; readers picture ergonomics",
    instead: `"tracked or ignored," "how git treats it"`,
    phrases: ["posture"],
    registers: ["product", "brand"],
  },
  {
    id: "the-shape-of",
    avoid: `"the shape of"`,
    why: "Geometry vocabulary for architecture; names no actual thing",
    instead: `"how X fits together," or name the parts`,
    phrases: ["the shape of"],
    registers: ["product", "brand"],
  },
  {
    id: "load-bearing",
    avoid: `"load-bearing"`,
    why: `Construction jargon for "important" — a meme-grade machine tell`,
    instead: `"doing real work," or name what breaks without it`,
    phrases: ["load-bearing"],
    registers: ["product", "brand"],
  },
  {
    id: "unnecessary-enumeration",
    avoid:
      `"the one \`<noun>\`," "the whole \`<noun>\`," and unnecessary enumeration ("all three checks," "both files")`,
    why:
      "Totalizing emphasis that adds nothing and goes stale the day the set grows",
    instead: "State the actual scope, or drop the emphasis",
    phrases: ["the one file", "the whole tree"],
    registers: ["product", "brand"],
  },
  {
    id: "drama-adverbs",
    avoid: `"silently," "quietly," "deliberately," "deliberate," "exactly"`,
    why: "Drama adverbs seasoning a spec",
    instead: "The plain claim; name the mechanism instead",
    phrases: ["silently", "quietly", "deliberately", "deliberate", "exactly"],
    registers: ["product", "brand"],
  },
  {
    id: "sincerity-vouching",
    avoid: `"honest," "honestly," "honesty"`,
    why: "Prose vouching for its own sincerity",
    instead: "Delete it; the facts carry the sincerity",
    phrases: ["honest", "honestly", "honesty"],
    registers: ["product", "brand"],
  },
  {
    id: "rides-along",
    avoid: `"rides along," "ride along"`,
    why: `Pet metaphor for "accompanies"`,
    instead: "Say what actually happens",
    phrases: ["rides along", "ride along"],
    registers: ["product", "brand"],
  },
  {
    id: "hedging",
    avoid: `"You may want to consider"`,
    why: "A stack of hedges where the reader came for a recommendation",
    instead: `"Do X," or "Do X unless Y"`,
    phrases: ["You may want to consider"],
    registers: ["product"],
  },
  {
    id: "passive-fault-dodging",
    avoid: `Passive-voice fault-dodging ("an error was encountered")`,
    why: "Hides the actor and dodges the blame",
    instead: `"We couldn't…" / "\`discern.toml\` is missing"`,
    registers: ["product"],
  },
  {
    id: "exclamation-points",
    avoid: "Exclamation points",
    why: "Unearned enthusiasm reads as sales",
    instead: "A period.",
    registers: ["product"],
  },
  {
    id: "emoji-in-prose",
    avoid: "Emoji in prose",
    why: "Outsources tone the words should carry",
    instead: "Words that carry the tone",
    registers: ["product", "brand"],
  },
] as const satisfies readonly BannedWord[];

/**
 * The banned-moves canon — the machine-tell patterns carried from the
 * retired voice-and-tone skill by owner selection (2026-08-08). Rendered
 * identically into the product and brand skills.
 */
export const BANNED_MOVES = [
  {
    id: "contrast-frames",
    name: "Contrast-frames",
    text:
      `"not X, but Y," "isn't X, it's Y," and the reversed "X, not Y." State the true half plainly.`,
  },
  {
    id: "aphoristic-antithesis",
    name: "Aphoristic antithesis",
    text:
      `The epigram cadence: short mirrored clauses striking a pose ("Agents forget. The repo remembers."), including two half-clauses sharing one verb for rhythm. State the fact once, plainly.`,
  },
  {
    id: "self-narration",
    name: "Self-narration",
    text:
      `Announcing importance instead of stating the point: "this is the crux," "here's the key insight," and the colon-pivot opener that pre-announces its own sentence. Say the point; the reader decides what's crucial.`,
  },
  {
    id: "attitude-fragments",
    name: "Attitude fragments",
    text:
      `Fragments that strike a pose rather than state a spec ("Not vibes. A verdict."). Spec fragments listing facts are legal: "Any stack. Any coding agent. No API key."`,
  },
  {
    id: "echo-intensifiers",
    name: "Echo-intensifiers",
    text:
      `Repeating a word with an intensifier: "Green means done. Actually done."`,
  },
  {
    id: "trailing-modifier-fragments",
    name: "Trailing modifier fragments",
    text: `", every time," ", by design," ", at scale."`,
  },
  {
    id: "em-dash-splices",
    name: "Em-dash splices",
    text:
      "Never split with an em dash what a period or colon can handle. Two em dashes in one sentence is a chain: rebuild the sentence.",
  },
  {
    id: "typographic-applause",
    name: "Typographic applause",
    text:
      "Italics or bold used to inject drama. If a sentence needs styling to land, rebuild the sentence. Bold is for scannability.",
  },
  {
    id: "counting-the-set",
    name: "Counting the set out loud",
    text:
      `"Watch for four moments," "Two things remain." The spelled-out count duplicates the list it introduces and is wrong the day the set grows. Let the list carry the count; a number is welcome when the number itself is the fact.`,
  },
] as const satisfies readonly BannedMove[];

/**
 * The mechanics shared by every register, carried from the retired
 * voice-and-tone skill by owner selection (2026-08-08). Rendered into all
 * three skills.
 */
export const MECHANICS = [
  {
    id: "american-english",
    text: "American English spelling throughout: color, behavior, -ize.",
  },
  {
    id: "sentence-case",
    text: "Sentence case for headings, titles, buttons, and labels.",
  },
  { id: "serial-comma", text: "Serial comma." },
  {
    id: "numerals-in-technical-contexts",
    text:
      "Numerals for numbers in technical contexts (3 retries, 80ms), even under ten.",
  },
] as const satisfies readonly VoiceRule[];

/** A voice skill's canonical name, derived so it can never drift. */
export function voiceSkillName(register: Register): string {
  return `discern-${register}-voice`;
}

/** A voice skill's repo-relative `SKILL.md` path (the codegen artifact). */
export function voiceSkillRel(register: Register): string {
  return `project/skills/${voiceSkillName(register)}/SKILL.md`;
}

/** The banner every generated voice skill carries after its frontmatter. */
const BANNER = generatedBrandBanner("VOICES (scripts/brand/voice.ts)");

/** The frontmatter block external agent runtimes parse for skill identity,
 * following the bundled skills' convention (`templates/skills/*`). */
function skillFrontmatter(register: Register): string {
  return [
    "---",
    `name: ${voiceSkillName(register)}`,
    `description: ${JSON.stringify(VOICES[register].description)}`,
    "metadata:",
    '  author: "discern | https://discern.sh"',
    '  version: "1.0"',
    "---",
  ].join("\n");
}

/** Render one voice section back to its authored Markdown. */
function renderVoiceSection(section: VoiceSection, register: Register): string {
  switch (section.kind) {
    case "prose":
      return `## ${section.heading}\n\n${section.body}`;
    case "principles":
      return [
        `## ${section.heading}`,
        ...section.items.map(
          (principle, index) =>
            `### ${index + 1}. ${principle.title}\n\n${principle.body}`,
        ),
      ].join("\n\n");
    case "rules": {
      const parts = [`## ${section.heading}`];
      if (section.intro !== undefined) parts.push(section.intro);
      parts.push(section.items.map((item) => `- ${item.text}`).join("\n"));
      if (section.outro !== undefined) parts.push(section.outro);
      return parts.join("\n\n");
    }
    case "criteria":
      return [
        `## ${section.heading}`,
        ...section.groups.flatMap((group) => [
          group.intro,
          group.items.map((item) => `- ${item}`).join("\n"),
        ]),
      ].join("\n\n");
    case "banned-words": {
      const rows = BANNED_WORDS.filter((word) =>
        (word.registers as readonly Register[]).includes(register)
      );
      return [
        `## ${section.heading}`,
        section.intro,
        [
          "| Avoid | Why | Instead |",
          "| --- | --- | --- |",
          ...rows.map((word) =>
            `| ${word.avoid} | ${word.why} | ${word.instead} |`
          ),
        ].join("\n"),
      ].join("\n\n");
    }
    case "banned-moves":
      return [
        `## ${section.heading}`,
        section.intro,
        BANNED_MOVES.map(
          (move, index) => `${index + 1}. **${move.name}:** ${move.text}`,
        ).join("\n"),
      ].join("\n\n");
    case "mechanics":
      return [
        `## ${section.heading}`,
        MECHANICS.map((rule) => `- ${rule.text}`).join("\n"),
      ].join("\n\n");
  }
}

/**
 * Render one register's complete `SKILL.md`: frontmatter first (agent
 * runtimes require it at byte zero), the generated banner immediately after,
 * then the signed-off document body — the exact bytes the codegen write
 * chokepoint canonicalizes.
 */
export function renderVoiceSkill(register: Register): string {
  const voice = VOICES[register];
  return [
    skillFrontmatter(register),
    "",
    BANNER,
    "",
    `# ${voice.title}`,
    "",
    voice.sections
      .map((section) => renderVoiceSection(section, register))
      .join("\n\n"),
    "",
  ].join("\n");
}
