# ADR 0113: installing a new dependency is a consent point in setup

**Status**: accepted. Refines the transparency-not-interrogation interaction model ([ADR 0077](0077-setup-agent-is-the-configuration-engine.md), revising [ADR 0044](0044-setup-involve-not-gate.md)) and extends the staged-consent handshake ([ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

## Context

The setup brief encourages the authoring agent to raise a project's quality floor: where a stack is missing a standard tool (a formatter, a linter, a type-checker), proposing the conventional one is a real improvement, not overreach. Until now the brief classed _adding_ such a tool — including installing it — as a narrate-and-proceed: low-stakes, reversible, committed on its own, no question asked.

That classification was inconsistent with the brief's own rules. Its list of genuine decisions — the ones the agent escalates rather than makes — already included "anything with cost, security, privacy, or data implications" and "a command that would … hit a paid or networked service". Installing a dependency is exactly that: it reaches the network, pulls third-party code onto the user's machine, may execute install-time scripts, and edits the manifest and lockfile. The revert story is also weaker than the narrate-and-proceed framing implies — a commit revert removes the lockfile entry, not whatever an install script did.

The opposing pressure is real too: the interaction model exists because a wall of "may I?" prompts is its own black box, and a per-tool consent gate would recreate it.

## Decision

**Installing a new dependency is a genuine decision — one batched go-ahead, not a silent proceed and not a per-tool interrogation.**

- The agent still proposes missing tools through the five beats, but where the proposal requires an install, it asks one clear go/no-go covering every proposed install ("adding a formatter here means installing ‹the tool› — OK?"), asked alongside the capability recommendation, and proceeds on the answer.
- _Wiring a tool the project already has_ remains narrate-and-proceed — running and recording an existing command has none of an install's supply-chain surface.
- The brief's Step 7 carries the boundary in its spine (`must_do` / `what_not_to_do`), so a paraphrasing agent still inherits it.

## Consequences

- Setup asks at most one more question than before, batched — the interrogation failure mode stays out.
- A user watching setup can no longer discover post-hoc that third-party code was pulled onto their machine without a yes. The trust cost of that discovery is far higher than the cost of one question.
- Agents that would have silently "fixed" a missing tool now surface the choice, which also records it: the go-ahead lands in the conversation, and a declined install lands in the deferred-work ledger as an open recommendation.
