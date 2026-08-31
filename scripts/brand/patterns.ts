/**
 * The copy patterns as typed registry data: the seventeen reusable
 * structures, the per-draft procedure, and the anti-abuse rules.
 * `copy-patterns.md` compiles from this module; a pattern's number is its
 * position in `COPY_PATTERNS`, so the sequence can never skip or repeat.
 */

import type { CopyPattern } from "./model.ts";

/** The per-draft procedure, in order. */
export const DRAFT_STEPS: readonly string[] = [
  "choose the audience circumstance;",
  "choose one dominant message territory;",
  "select the pattern that fits the surface;",
  "insert only the proof required for belief;",
  "attach claim slugs;",
  "apply the brand voice skill;",
  "run the copy review.",
];

/** The seventeen copy patterns, in document order. */
export const COPY_PATTERNS = [
  {
    id: "category-led-hero",
    title: "Category-led hero",
    useWhen: `- the page needs launch energy;
- the category contrast is the strongest entry point;
- the reader should leave with the one claim no rival can sign.`,
    structure: `<Audience signature or short recognition line>

# <The contrast's first half: what the rest of the industry is doing>

<The discern half, completed immediately, then the category in plain language.>

<Primary demonstration CTA>    <Secondary action or explanation CTA>

<Optional category line>`,
    sections: [
      {
        heading: "Working example",
        body: `> **For people who take their software seriously.**
>
> # The labs are making agents better.
>
> discern makes your project a better place for them to work: an engineering practice installed into your repository and inherited by every agent that works there.
>
> **Watch a project get commissioned**\\
> Tell your agent to set it up
>
> _An engineering practice for agent-built software._`,
      },
    ],
    requirements: [
      "The discern half must arrive in the first line below the headline; the headline alone is a compliment to the labs.",
      "The subhead must clarify the human benefit.",
      "The next section should show a recognizable moment. Use feature details only as supporting evidence.",
    ],
  },
  {
    id: "fact-led-hero",
    title: "Fact-led hero",
    useWhen: `- the shared problem is recognizable before any product vocabulary;
- the mechanism is the differentiator;
- the page can show an artifact immediately below.`,
    structure: `# <The problem, stated as a plain fact the reader already lives with>

<The practice, answering the headline in one sentence.>

<CTA to a demonstration>    <CTA to literal explanation>`,
    sections: [
      {
        heading: "Working example",
        body: `> # Every session, your agent starts from zero.
>
> discern is the practice your project keeps: every agent arrives already briefed, every change faces your project's own checks, and you decide what ships.
>
> **See discern in practice**\\
> Read how discern works`,
      },
    ],
    requirements: [
      "The answer must arrive in the next sentence; the headline alone is only the problem.",
      "Follow with the artifact that makes the answer literal.",
    ],
  },
  {
    id: "earned-confidence-hero",
    title: "Earned-confidence hero",
    useWhen: `- the reader's project has users or consequences;
- the page serves a new builder or trust-sensitive audience;
- pride and credibility are stronger than raw ambition.`,
    structure: `# <Personal or social outcome>

<What changes as the software gains users, change, or responsibility.>

<Category explanation.>

<CTA to the practice or evidence>`,
    sections: [
      {
        heading: "Working example",
        body: `> # Software worth putting your name to.
>
> As the project gains users and responsibility, discern gives its coding agents a serious way to keep building it.
>
> An engineering practice, installed in your project.
>
> **See the practice**`,
      },
    ],
    requirements: [
      "Keep the tone proud; leave fear out of the argument.",
      "Avoid implying a universal guarantee.",
    ],
  },
  {
    id: "consequence-threshold-campaign",
    title: "Consequence-threshold campaign",
    useWhen:
      `- targeting projects becoming operationally or commercially meaningful;
- creating a focused landing page, essay, advert, or lifecycle message.`,
    structure: `# When <specific success threshold>.

<Celebrate what the builder achieved.>
<Explain the new need created by success.>
<Show how discern helps the project grow into that responsibility.>

<Context-specific CTA>`,
    sections: [
      {
        heading: "Working territories",
        body: `- When the prototype becomes the product.
- When people start depending on it.
- When the side project gets real.
- When your app becomes part of someone's workday.`,
      },
    ],
    requirements: [
      "Open by congratulating or recognizing the builder's achievement.",
      "Name a specific threshold. Avoid the vague `after it works`.",
    ],
  },
  {
    id: "recognisable-moment-section",
    title: "Recognizable-moment section",
    useWhen:
      "A product capability is abstract until placed in an everyday moment.",
    structure: `## <What becomes easier or possible>

When <triggering situation>, <changed action or experience>.

<One or two sentences explaining the product mechanism.>

<Visual or artifact showing the moment.>`,
    sections: [
      {
        heading: "Examples",
        body: `> ## Change agents without starting the project over.
>
> When one provider reaches its quota, move the next task elsewhere. The project instructions, Skills, Map, checks, and working practice remain with the repository.

> ## Let several pieces move at once.
>
> When a backlog contains real independent streams, divide it into complete briefs and give each task its own prepared workspace. Dependencies can wait on one another without turning you into the courier.`,
      },
    ],
  },
  {
    id: "human-outcome-mechanism-evidence",
    title: "Human outcome → mechanism → evidence",
    useWhen: "Explaining a major pillar on the homepage or a product page.",
    structure: `## <Human proposition>

<Short account of the burden today and the changed experience.>

<Literal mechanism introduced in plain language.>

<Named product object, if useful.>

<Evidence artifact or deep link.>`,
    sections: [
      {
        heading: "Working example",
        body: `> ## Lock in the gains the project earns.
>
> Better test coverage or a lower complexity ceiling should not disappear because the next branch needs more room.
>
> discern holds measurable floors and ceilings against the shared branch. Once an improvement is worth keeping, pin it as a Standard.
>
> **See a Standard trajectory**`,
      },
    ],
  },
  {
    id: "artefact-specimen",
    title: "Artifact specimen",
    useWhen: "The website needs to make an invisible CLI/MCP product tangible.",
    structure: `<Artifact label>

# <What this artifact lets the reader know or decide>

<Rendered authentic artifact>

<Three compact annotations pointing at meaningful evidence.>

<Optional link to technical definition>`,
    sections: [
      {
        heading: "Suitable artifacts",
        body: `- a delegation brief;
- a wave plan;
- a worktree fleet view;
- a Standard trajectory;
- a Proof summary;
- a Map page;
- a Pattern finding;
- a landing grant.`,
      },
      {
        heading: "Caption rules",
        body: `- Explain what the reader can infer.
- Do not caption every field.
- Keep the authentic product object visually primary.
- State limits near the artifact when the object could overclaim.`,
      },
    ],
  },
  {
    id: "proof-block",
    title: "Proof block",
    useWhen: "A strong promise needs nearby credibility.",
    structure: `### <The claim in human language>

<One sentence stating the exact product behavior.>

**What it covers**
<Scope.>

**What it does not claim**
<Relevant boundary.>

<Artifact, source, or technical link>`,
    sections: [
      {
        heading: "Working example",
        body: `> ### Evidence belongs to one change.
>
> A discern Proof identifies the exact clean committed tree that passed the project's declared Gate and held its configured Standards.
>
> **What it covers**\\
> That tree, those declared checks, and that result.
>
> **What it does not claim**\\
> Universal correctness, security, or permission to ship.`,
      },
    ],
  },
  {
    id: "commissioning-story",
    title: "Commissioning story",
    useWhen: "Explaining setup to either audience.",
    structure: `# <Setup as a meaningful beginning>

1. The agent studies the repository.
2. It asks for the intent the code cannot reveal.
3. It establishes the project's checks, principles, instructions, and working conditions.
4. It proves the practice in a fresh worktree.
5. Every future agent inherits the result.

<CTA to tell the agent to begin>`,
    sections: [
      {
        heading: "Copy instructions",
        body: `- Prefer **commission** when describing the complete experience.
- Use **setup** when naming the actual command or documentation.
- Explain that zero manual configuration still involves substantial agent work.
- Describe the setup conversation as transparent and purposeful.`,
      },
    ],
  },
  {
    id: "experienced-engineer-section",
    title: "Experienced-engineer section",
    useWhen:
      "The reader understands the components and needs to see the value created by the connected practice.",
    structure: `## <A high-impact engineering outcome>

<Compressed acknowledgment of the current home-built workflow.>

<How discern connects the lifecycle into a maintained practice.>

<Precise mechanisms and trade-offs.>

<Inspect source, docs, or live artifact CTA>`,
    sections: [
      {
        heading: "Working direction",
        body:
          `> You could assemble worktrees, scripts, CI jobs, instruction files, and review prompts yourself. The value comes from connecting them into a maintained practice that every agent inherits and every change moves through.

Do not disparage home-built engineering. Demonstrate the value of coherence, transferability, and maintained contracts.`,
      },
    ],
  },
  {
    id: "new-builder-section",
    title: "New-builder section",
    useWhen:
      "The reader has outcome-level standards but limited engineering vocabulary.",
    structure: `## <Aspirational outcome>

<Recognize what they have already achieved.>

<Explain what the agent will do on their behalf.>

<Show the decisions that remain theirs.>

<State the relevant boundary.>`,
    sections: [
      {
        heading: "Working direction",
        body:
          `> You already built something worth continuing. Tell your agent to commission discern, and it will study the project, propose the working practice, explain the meaningful choices, and prove the setup before it finishes.

Do not call the reader a novice. Do not imply discern makes engineering expertise unnecessary.`,
      },
    ],
  },
  {
    id: "audience-bridge",
    title: "Audience bridge",
    useWhen:
      "A page can show experienced engineers and new builders without splitting the product.",
    structure: `<Shared human circumstance>

For experienced engineers: <how existing judgment scales>.

For new builders: <how the project acquires discipline they value but cannot fully specify>.

<The shared product practice beneath them.>`,
    sections: [
      {
        heading: "Working direction",
        body:
          `> People arrive with different forms of judgment: accumulated engineering standards or clarity about the consequences they care about. discern helps the project turn that judgment into a working practice future agents can follow.

Use this pattern sparingly; avoid making every section branch into two audiences.`,
      },
    ],
  },
  {
    id: "trust-boundary",
    title: "Trust boundary",
    useWhen: "A claim could be mistaken for security, certainty, or autonomy.",
    structure: `## <Direct trust proposition>

<What discern does.>

<What remains outside its boundary.>

<Why the distinction benefits the reader.>

<Link to exact model>`,
    sections: [
      {
        heading: "Working example",
        body: `> ## Local, deterministic evidence.
>
> discern contains no AI model and needs no API key. It runs the commands the project declares and keeps its Logbook on the machine.
>
> It is not a sandbox and does not contain an untrusted agent. Use the security environment appropriate to your project; discern is designed to work inside it.

Direct boundary language belongs here because the distinction is the purpose of the section. Avoid turning that language into a repeated rhetorical form.`,
      },
    ],
  },
  {
    id: "founder-story-scene",
    title: "Founder story scene",
    useWhen: "Turning the origin story into credible narrative.",
    structure: `<Concrete scene or progression>

<What the founder expected>
<What happened>
<The new bottleneck>
<The conceptual shift>
<The product principle extracted>`,
    sections: [
      {
        heading: "Strong scenes",
        body: `- fixing one bug while another part broke;
- increasing test coverage until confidence grew;
- adding a second agent and becoming the bottleneck;
- realizing line-by-line review was no longer the most valuable contribution;
- extracting the practice from the knowledge-graph project;
- developing discern under discern itself.

Avoid beginning with a company mission statement. Begin with the lived discovery.`,
      },
    ],
  },
  {
    id: "case-study",
    title: "Case study",
    structure: `# <Human result>

**Before**${"  "}
<Specific workflow and burden.>

**The moment**${"  "}
<What discern changed or revealed.>

**After**${"  "}
<Specific working outcome.>

**What made it possible**${"  "}
<Selected mechanisms.>

**Boundaries**${"  "}
<What the story does not establish.>`,
    structureNote:
      "Use exact dates, project context, and permissions. Separate observed outcomes from the participant's interpretation.",
  },
  {
    id: "closing-cta",
    title: "Closing CTA",
    useWhen: "The page has already established desire and belief.",
    structure: `# <A concise invitation consistent with the page>

<One sentence describing the next step and commitment.>

<Primary action CTA>    <Low-commitment alternative>`,
    sections: [
      {
        heading: "Working examples",
        body: `> # Ship serious software.
>
> Tell your coding agent to commission discern for the project.
>
> **Install discern**\\
> Read the setup guide

> # Take the project further than one pair of hands.
>
> See how one project turns agent capability into a working practice.
>
> **See discern in practice**\\
> Explore the documentation`,
      },
    ],
  },
  {
    id: "short-campaign-post",
    title: "Short campaign post",
    structure: `<One surprising or recognisable observation.>

<One changed possibility.>

<One specific reason to believe.>

<One destination-specific CTA.>`,
    structureLang: "text",
    sections: [
      {
        heading: "Example direction",
        body:
          `> Coding agents can empty a backlog faster than one person can coordinate it.
>
> discern turns the work into complete streams, gives each one a place to run, and brings back exact evidence for the change.
>
> See a backlog become a plan.

Do not compress an entire product page into a social post.`,
      },
    ],
  },
] as const satisfies readonly CopyPattern[];

/** The pattern anti-abuse rules, in rendering order. */
export const ANTI_ABUSE_RULES: readonly string[] = [
  "Do not use the audience signature on every page.",
  "Do not stack several headline-inventory lines in one viewport.",
  "Do not use a Proof block before the page creates desire.",
  "Do not force every capability into a recognisable-moment formula.",
  "Do not split every paragraph into engineer and new-builder variants.",
  "Do not make every heading a two-part aphorism.",
  "Do not use artifacts as decoration; each should support a claim.",
  "Do not substitute a template for factual research or product verification.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render a fenced code block. */
function fence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

/** Render one pattern's section, numbered by its registry position. */
function renderPattern(pattern: CopyPattern, index: number): string {
  const parts = [`## Pattern ${index + 1} — ${pattern.title}`];
  if (pattern.useWhen !== undefined) {
    parts.push("", "### Use when", "", pattern.useWhen);
  }
  parts.push(
    "",
    "### Structure",
    "",
    fence(pattern.structureLang ?? "markdown", pattern.structure),
  );
  if (pattern.structureNote !== undefined) {
    parts.push("", pattern.structureNote);
  }
  for (const section of pattern.sections ?? []) {
    parts.push("", `### ${section.heading}`, "", section.body);
  }
  if (pattern.requirements !== undefined) {
    parts.push("", "### Requirements", "", bullets(pattern.requirements));
  }
  return parts.join("\n");
}

/** The whole copy-patterns document, ready for the barrel to stamp. */
export function renderCopyPatternsDoc(): string {
  return [
    "# Copy patterns",
    "",
    "**Status:** Operational\\",
    "**Purpose:** Give humans and agents reusable structures for writing new public copy without recycling one approved slogan across every page.",
    "",
    "## How to use patterns",
    "",
    "A pattern defines the work a piece of copy must do. It does not prescribe exact wording.",
    "",
    "For every draft:",
    "",
    ...DRAFT_STEPS.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Do not combine several patterns because each contains a good line.",
    "",
    COPY_PATTERNS.map(renderPattern).join("\n\n---\n\n"),
    "",
    "## Rewriting feature-first copy",
    "",
    "When a draft starts with a feature, use this ladder:",
    "",
    fence(
      "text",
      "Feature → capability → user moment → removed burden → human payoff → brand meaning",
    ),
    "",
    "Example:",
    "",
    fence(
      "text",
      `Feature: compiled provider instructions
Capability: every supported provider receives the same project instructions
User moment: one quota runs out and the next task moves to another agent
Removed burden: no re-teaching or provider-specific project explanation
Human payoff: momentum continues
Brand meaning: the project owns its way of working`,
    ),
    "",
    "Possible public line:",
    "",
    "> Change agents without starting the project over.",
    "",
    "## Pattern anti-abuse rules",
    "",
    bullets(ANTI_ABUSE_RULES),
  ].join("\n");
}
