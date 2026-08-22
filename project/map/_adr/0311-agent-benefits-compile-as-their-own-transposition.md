# ADR 0311: Agent benefits compile as their own transposition

**Status**: accepted. Extends the feature-registry projection in [ADR 0175](0175-the-feature-canon-compiles-from-a-feature-registry.md), replaces the optional inline agent axis in [ADR 0179](0179-the-feature-canon-carries-an-agent-experience-axis.md), and distinguishes the human-value transposition in [ADR 0268](0268-the-benefit-canon-transposes-the-feature-registry.md) and [ADR 0270](0270-the-benefit-canon-separates-value-from-claim-qualification.md).

## Context

The feature registry describes the product at mechanism altitude. ADR 0179 added an optional `agent` sentence beside a feature when the coding-agent experience differed from the owner's benefit, plus optional references to registered hints. It rejected a separate page until a consumer needed one.

The resulting axis cannot establish completeness. A missing sentence may mean that the owner benefit also applies, that the feature only supports a larger agent outcome, that the feature is interactive-only, or that nobody wrote the account. No guard distinguishes those cases. The generated agent view lists feature titles instead of composing outcomes, and the optional hint references leave agent-audience instructions without a benefit home. Existing sentences also mix the agent outcome with implementation details because one field must carry both.

The commercial Benefit Canon now supplies the forcing function the agent account lacks: every feature cites a human outcome or records an absence, and each outcome separates value from mechanism. Its audience and ordering remain human and commercial. Adding coding-agent labels to those clusters would make one tree serve incompatible jobs. The public For Agents surface and agent-facing product work now need a separate, complete source.

## Decision

**Agent benefits form an outcome-first transposition of the feature registry and compile to their own generated page.**

`AGENT_BENEFIT_CANON` groups benefits by the coding agent's operating jobs. Each entry carries an agent outcome, the product facts that produce it, a boundary, direct feature citations, supporting feature citations, relevant agent-audience hints, and public claim citations. Direct and supporting citations stay separate so infrastructure can contribute without acquiring strained standalone value prose.

Every feature node appears in an agent benefit or in an explicit absence table. Every registered agent-audience hint appears in an agent benefit or in its own explicit absence table. Every public claim classified for coding agents or shared audiences has an agent-benefit home. Stranded feature, hint, and claim citations fail the Gate.

The generated `feature-canon-agent-benefits.md` page leads with bounded outcome clusters and renders feature, hint, and claim traceability in appendices. The technical feature page links the projection and summarizes its clusters. Feature nodes no longer author `agent`, `plain.agent`, or `hints`; generated citations and the transposition replace those duplicate prose authorities.

The existing commercial transposition becomes the **Human Benefit Canon** in its types, exports, generated title, file name, and canonical-set registration. It keeps the human value, commercial ordering, feature coverage, and public-claim coverage established by ADRs 0268 and 0270. Demand and practice continue to cite that human account.

Canon Editor treats the agent transposition as a prose registry and generated editing surface. Agent value stays separate from operating instructions: `value` states the outcome without command or config syntax, `whyItFollows` names the mechanisms, and `boundary` states the limit. The live instruction and result contracts remain the authorities for what an agent should do next.

## Consequences

- A feature change now has explicit agent-value enrollment. Omission has a recorded meaning instead of an ambiguous absent field.
- Agent-only hints and agent-relevant public claims cannot grow without an outcome-shaped home.
- Technical, plain, human-value, and agent-value projections share one feature identity while keeping their registers and readers separate.
- The registry and generated map grow. The agent page is exhaustive in its appendices and bounded in its opening summary.
- Agent benefit prose becomes another canonical set maintained by codegen, Canon Editor, and Gate guards. Adding a benefit requires value, mechanism, boundary, and traceability decisions.
- Existing inline agent sentences move rather than survive as a second authority. Historical wording remains available in Git history and the earlier decision record.

## Alternatives considered

- **Make the inline agent field required.** Rejected because one sentence per feature duplicates supporting mechanisms, cannot compose cross-pillar outcomes, and keeps the feature tree mechanism-first.
- **Add coding agents to every Human Benefit Canon cluster.** Rejected because human commercial value and coding-agent operating value use different ordering, language, and boundaries.
- **Generate an agent page from the existing optional fields.** Rejected because a filtered incomplete set preserves the ambiguity and yields no coverage contract.
- **Keep hint references soft.** Rejected for agent-audience hints because those instructions implement central agent outcomes. Hints for all audiences remain outside this enrollment requirement.
