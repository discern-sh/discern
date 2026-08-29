# Manual authoring

**Status:** Binding procedure for the public manual\
**Applies to:** `project/manual/` tutorials, guides, explanations, reference, and troubleshooting\
**Reference pair:** `project/manual/20-understand/proof.md` and `project/manual/10-guides/wait-for-another-task.md`

The public manual helps a human understand, adopt, and direct discern while giving a coding agent the same accurate body to act from. It is human product documentation: warmer and more explanatory than a specification, more exact than marketing, and independent of the surface that renders it.

Use the [product-voice Skill](../../../skills/discern-product-voice/SKILL.md) as the surface register. The [register bridge](register-bridge.md) is the drafting method. Brand material can supply a real human situation, but the manual never switches to `discern-brand-voice`.

## The voice lock

### Give the reader a reason to care before the first H2

Every page states its human value in the opening paragraphs, above the first `##` heading. That opening is where a reader decides whether the rest deserves attention.

Start with a recognizable situation, consequence, or desired outcome. Then connect it to the page's promise. Even a capability operated entirely by an agent has human value: better agent ergonomics returns time, attention, confidence, or coordination capacity to the person responsible for the project.

The opening must remain product truth. State the strongest benefit the live authorities support, then place its scope close enough that a novice cannot reasonably mistake it for a broader claim. This is the intended balance:

> discern uses Proof to do that checking for you. It confirms that the project's declared checks ran and passed, records the exact commit they covered, and shows whether the evidence is still current.

The first sentence is appealing because the second sentence gives “checking” a concrete, supportable meaning. Do not weaken it into legal prose, and do not let it imply that Proof finds every defect.

### Write for the human, name the actor

The human's surface-level impression matters first because the human decides whether to trust, install, and use discern. Coding agents remain equally important readers, but the body normally describes them rather than addressing them as an ambiguous “you.”

Treat the human, the coding agent, and the project as distinct participants. This is the same three-part relationship used by the [visual identity](visual-identity.md):

- the **human** sets intent, supplies judgment, and grants authority;
- the **coding agent** operates discern, changes the project, answers checkpoints, and follows recovery;
- the **project** carries its instructions, checks, history, and durable evidence.

Use “you” when the human reader is genuinely the actor, such as reviewing Proof or deciding whether a change should land. When a command belongs to the coding agent, say “the agent runs…” This keeps responsibility clear without making either participant feel like an afterthought.

### Show the product when there is something worth seeing

Prefer one authentic artifact over another paragraph of description. A Proof line, a short result, a configuration fragment, or an observable file can make an abstract promise tangible. The artifact must come from, or be validated against, the current product and must work in an external project; repository-only fixtures are not public examples.

Do not force an artifact into a page whose subject has no useful visible form. Demonstrate a real product object only when it materially improves understanding.

### Explain why the facts matter

A sequence of correct “what” sentences can still leave the reader without a mental model. Add the causal bridge: why the state exists, why two states stay separate, why a later edit changes the answer, or why the next step follows.

Vary sentence length and structure. Use contractions where they sound natural, familiar situations a reader can recognize, and an occasional question the reader is likely to ask. A short sentence can land an important fact; a paragraph of short subject–verb–object sentences becomes tiring.

Repeat a central distinction when the reader meets it in a new context. The Proof explanation establishes green versus landed in prose, reinforces it in the state table, and applies it again in the next-action list. That repetition teaches. Repeating the same wording without adding a new use does not.

## Evidence before prose

Complete the [manual evidence worksheet](../../_private/planning/public-manual-workstreams/evidence/README.md) before treating a draft as settled. Work through the sources in this order:

1. Verify live commands, config, code, tests, and the relevant technical feature entry. These establish product truth.
2. Read the paired entry in `project/map/_internal/feature-canon-plain.md` for coverage and translation ideas. Never copy it as final wording.
3. Select the public value from the [Human Benefit Canon](../feature-canon-human-benefits.md). Read the paired [Agent Benefit Canon](../feature-canon-agent-benefits.md) entry for the agent's operating consequence, and the [Demand Canon](demand-canon.md) for the human situation that makes the capability matter. Agent ergonomics is also a human benefit, but it does not justify a claim beyond the live product basis.
4. Apply the register bridge in order: product truth → human moment → plain proposition → product nouns as proof.
5. Draft in product voice. Define canonical terms at first use, validate every literal example, and check that every linked destination is published for the manual reader.

If the sources disagree, stop at the live code and tests. Elegance cannot resolve a product fact. Record a shared defect for the owning stream rather than smoothing it over in prose.

## The five page jobs and spines

Every page has one primary job. The page kind determines what the reader must be able to do after reading it and what its checkpoint must judge.

| Kind                | Its job                                                                    | The reader leaves able to…                                             |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Tutorial**        | Teach one first success through a complete learning journey.               | reach and recognize the promised result, then choose the next step.    |
| **Guide**           | Help someone accomplish one outcome from a named starting state.           | take the steps, handle an unfinished or refused path, and verify done. |
| **Explanation**     | Build a usable mental model for a concept and its consequences.            | restate it, distinguish nearby states and authority, and predict why.  |
| **Reference**       | Provide the complete current contract for exact lookup.                    | find the relevant type, field, default, limit, or supported boundary.  |
| **Troubleshooting** | Recover safely from an observable symptom without guessing at destruction. | identify the likely cause, take recovery, and know when to stop.       |

Use these spines to guide the sequence. The headings may vary with the subject.

### Tutorial spine

1. Above the first H2, name the first success and why it is worth the effort.
2. State prerequisites, the starting state, and a realistic expectation of time or agent effort.
3. Lead through ordered actions, naming human and agent responsibilities at each handoff.
4. Show the visible result after each meaningful phase and place recovery links where failure can occur.
5. End with the observable first success and one valid next step.

### Guide spine

1. Above the first H2, name the situation, desired outcome, and practical benefit.
2. State the required starting state and any decision the reader must make before acting.
3. Give the shortest complete procedure, with one realistic validated example where it helps.
4. Separate an unfinished state from a refusal or error, and identify who owns any decision.
5. State the observable completion condition and the next action; link exact flags, fields, and limits to Reference.

### Explanation spine

1. Above the first H2, begin at the human review or decision moment and explain why the concept matters.
2. Introduce the concept in plain language, then show an authentic artifact when one makes it concrete.
3. Explain the causal model: what establishes the state, why its boundary exists, and what changes it.
4. Distinguish adjacent states, machine results, declared judgment, and human authority where relevant.
5. Close with common next paths and links to exact formats or procedures.

### Reference spine

1. Above the first H2, state what this lookup lets the reader answer and why that answer matters.
2. Define its scope and prerequisites without requiring another page first.
3. Organize exact fields, types, defaults, limits, states, and supported values under stable headings.
4. State exceptions and unsupported cases explicitly; use validated examples only where they clarify the contract.
5. Link outward to a guide, explanation, or troubleshooting page for tasks and mental models.

### Troubleshooting spine

1. Above the first H2, name the observable symptom, the recovery promise, and why the safe route matters.
2. Repeat the text or state the reader can observe.
3. Give the likely cause and the evidence that distinguishes it from nearby causes.
4. Put the recommended safe recovery first and alternatives or escape hatches last.
5. State what recovery success looks like and when to stop for human judgment or further diagnosis.

## Spend the vocabulary budget on terms that matter

Canonical product terms earn their place because they make state and authority exact. Define a term in plain language at first use, then use the same term consistently:

- “the project's final quality check (the Gate)”;
- “evidence for one exact completed change (Proof)”;
- “the project's shared branch (the trunk).”

Do not replace `Gate`, `Proof`, `checkpoint`, `grant`, `variance`, or `trunk` with a rotating set of friendlier synonyms. Equally, do not surround those terms with incidental abstractions such as “candidate,” “subject,” “surface,” “product-managed,” or “observed work” when “change,” “branch,” “page,” or “files” says the same thing. Plain words leave the reader more attention for the vocabulary that carries product meaning.

## Link detail without creating a context cliff

A link deepens an answer; it must not contain the missing premise that makes the current page intelligible.

Before linking away, give the reader the minimum useful fact, its consequence, and the local next action. Then link the exact material with a label that says what it adds. For example, the wait guide explains that `data.met: false` is an unfinished window and tells the agent to follow `data.resume`; Reference owns handle storage, timeout bounds, and the exit-code table.

Prefer a published Guide, Explanation, Reference, or Troubleshooting destination. Do not link a public manual reader into a repository Map page merely because it holds the current implementation detail. When no public destination exists, keep the minimum truthful fact in the page and record the missing destination for the stream that owns it.

## Approved transformations

These before/after patterns describe reusable moves from the pilot pair. Adapt them to the subject.

| Before shape                                        | Approved move                                                                                                                    | Reusable rule                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| “Proof records evidence for a clean commit.”        | Begin with the owner receiving an agent's completion claim, then explain how Proof removes the need to reconstruct the checks.   | Put the human consequence before the mechanism.                                           |
| A description of Proof with no visible output.      | Show one real Proof line near the opening, then explain the full view and durable note by link.                                  | Demonstrate an authentic artifact when it turns an abstraction into something reviewable. |
| “A later edit invalidates Proof. Generated output…” | Explain the formatter or generator scenario, why the checked code would differ, and then list the changes that make Proof stale. | Give the causal “why” before the rule list.                                               |
| “Wait for the dependency, then update your branch.” | Name the coding agent as operator, the owner as beneficiary, and the project state that satisfies the wait.                      | Resolve actor ambiguity before giving steps.                                              |
| A familiar speed idiom after the wait.              | Say that the owner can begin the dependent task without coordinating the exact time its agent should return.                     | Preserve the practical benefit in words that describe the interaction.                    |
| Full timeout, handle, and exit-status mechanics.    | Teach `met: false`, continuation, refusal, and the successful hint; send exact transport limits and exit codes to Reference.     | Keep the guide sufficient for action and let Reference own exhaustive transport detail.   |

“Proof does the checking for you” remains a useful product statement when the next sentence defines the checking: the declared checks ran and passed on the exact committed state, and the evidence is current. It must never stand in for defect discovery, security review, or release judgment.

## Answer the checkpoint with evidence

The per-kind checkpoint judges comprehension. Before declaring it met, write a short answer against the actual page in the stream's evidence file:

- restate what the named reader can now understand or accomplish;
- name the starting state and observable completion, where the kind requires them;
- identify the adjacent states, actor responsibilities, and authority boundaries the page distinguishes;
- name facts left to a link and explain why the page remains usable without following it;
- answer any launch distinction the page touches: green versus landed, who can authorize an unmet checkpoint, and why a later edit makes Proof stale.

The approved Proof answer is that a reader can explain what green establishes for one exact tree, move through ready for review, accepted, landed, and released, separate verified machine results from declared checkpoint conclusions, and identify the owner as the only source of an unmet variance. The reader can also predict that an edit or generated rewrite stales Proof because the code waiting to land no longer matches the code that passed. Exact note fields and checkpoint protocols remain in Reference.

The approved wait answer is that a reader can direct the coding agent to choose green, landed, or moved trunk from the dependency; start one MCP or command-line wait; continue `met: false`; treat `ok: false` as a separate refusal; follow the successful composition hint; and verify that the dependency is present in the agent's tree. Exact timeout derivation, continuation storage, and exit behavior remain in Reference.

A checkpoint that can be declared met without making these judgments is defective. Strengthen its question, matcher, or tests in the checkpoint's owning authority instead of recording a ceremonial answer.

## Prohibited shapes

Reject a draft that becomes any of these:

- **feature catalogue:** completeness of the mechanism list substitutes for one page promise;
- **mechanism-first opening:** a command, subsystem, schema, or internal artifact appears before the reader has a reason to care;
- **repository-only shorthand:** local paths, test fixtures, ADR numbers, or team vocabulary are required to understand the page;
- **duplicate reference:** a guide or explanation carries exhaustive flags, fields, defaults, limits, or transport tables already owned by Reference;
- **marketing flourish:** emotional language hides the exact state, scope, or next valid action;
- **agent blame:** prose mocks, judges, or anthropomorphizes the coding agent instead of describing the product boundary;
- **false certainty:** green becomes “correct,” Proof becomes defect detection, landed becomes live, or old conversation becomes authority;
- **surface-specific body copy:** website, terminal, MCP, or raw readers receive a different authored explanation.

Also remove common machine-written mannerisms when they carry no product meaning:

- a decorative reversal between uncertainty and a capitalized proof claim;
- paired slogan fragments that make evidence appear to remove uncertainty;
- trailing modifier fragments added to imply repeatability or intent;
- counts that add no information about the checks or sequence;
- moral or dramatic adverbs added to ordinary claims;
- noun-phrase negation that makes a simple failure harder to parse. Write “a guessed branch name won't resolve,” not “a guessed name resolves to no branch.”

Necessary comparison remains welcome. Green versus landed, unfinished versus refused, and verified versus declared carry required product meaning.

## Final author check

Before committing a page, confirm that:

- its promise, kind, and intended reader agree;
- the reason to care appears above the first H2;
- human, agent, and project responsibilities are unambiguous;
- at least one causal “why” supports the important rules;
- any artifact and literal example match the live product;
- canonical terms receive plain first definitions and incidental jargon has been cut;
- linked detail deepens a complete local explanation and resolves on every public surface;
- the checkpoint answer names comprehension, states, authority, links, and observable completion;
- website, terminal, MCP, and raw Markdown project the same authored body.
