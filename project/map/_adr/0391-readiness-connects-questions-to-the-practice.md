# ADR 0391: Readiness connects questions to the practice

**Status**: accepted on 2026-09-13

## Context

The founder's experience leading a software engineering team supplies the starting point: the questions considered before a release remain important when coding agents carry implementation. Preparing discern for launch brings those concerns back into view. discern already provides ways for a project to answer them through configured checks, judgment, evidence, retained knowledge, and taught methods.

The feature and benefit canons explain the product from its mechanisms and outcomes. A person approaching the product can instead recognize a question: “Have we checked the other places affected by this change?” That question should lead to Coupling without requiring the visitor to know its name first. The same connection can help an agent choose how to investigate a concern during commissioning or review.

Maintaining those connections in separate checklists and campaign copy would duplicate the question inventory. Treating every question as a new automatic check would overstate the implementation. Flattening the public expression into evidence qualifications would lose the invitation the brand exists to make.

## Decision

The Readiness Canon owns question families, stable question identities, practical approaches, and routes to existing features. Each routed feature has a selected lead question and an introduction explaining its contribution. Its authority is `scripts/brand/readiness.ts`, rendered by `scripts/brand/docs/readiness.ts` through the brand registry into `project/map/_internal/brand/readiness-canon.md`. Feature names and benefit prose stay in their existing registries. Every route names a human and agent benefit whose product basis includes that feature, retaining the agent benefit's direct or supporting role; practice connections derive from the tenets' mechanism citations.

Intent frames the effort, concern families examine its consequences, Evidence qualifies the answers, and Authority identifies permission for the next action. A primary feature route is a discovery destination. Feature entries derive their lead question links from this registry, and a reverse view collects every question that routes to each feature. The lead question must belong to that feature’s connections; question wording and relationship membership are never copied into the feature registry. Its contribution states whether the project receives checks, declared judgment, advice, a method, knowledge, completion evidence, or landing authority. A reference to project checks requires the project to supply the relevant tests or analysis. A taught practice does not become an automatically enforced property of the application.

The canon is an internal reference and introduces no runtime assessment, mandatory questionnaire, readiness score, or additional shipping authority. It connects the installed practice to concerns the project can choose to address. Coverage runs from questions to existing capabilities; a feature with no question needs no exception record.

Consequential Code remains the worldview and the engineering practice remains the category. Readiness gives them a practical expression. Public copy leads with recognition, ambition, and human value. The supporting mechanism carries the relevant evidence distinction. “Ready is the Gate's question; shipping is yours” retains its brand role. The register bridge records this division of work between a headline and its explanation.

## Consequences

Questions can serve the canon and a future discovery surface through the same identities and destinations. A new question enters rendering and the reference guard automatically. The guard checks each route against live feature, benefit, and documentation sources; the existing brand codegen guard holds the generated page current.

A route still needs editorial judgment: a valid link does not prove that a feature is a useful answer. The practical approach must explain the connection. Shared evidence distinctions are stated once in the reference so each question can concentrate on the work it helps someone do.

The founder's motivating account is observational demand evidence. Predictions about new builders, larger releases, or adoption retain their own evidence classes. The interactive question cloud, commissioning experiments, and a possible readiness account remain backlog work. Canon Editor enrollment is deferred alongside the other unimplemented canon editing surfaces.

## Alternatives considered

- Author questions independently in feature entries: this makes the feature inventory own the reader's concerns and scatters families across mechanisms.
- Publish an independent checklist: its wording and destinations would drift from the canons that already own the product account.
- Make every family a required checkpoint: relevance and the useful checking method vary by project and change; a question earns a stop only when the interruption is justified.
