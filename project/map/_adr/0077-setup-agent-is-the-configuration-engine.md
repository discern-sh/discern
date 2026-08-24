# ADR 0077: The setup agent is the configuration engine — transparency over interrogation

> **Amendments.**
>
> - **Job-model vocabulary ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use gate `capability` / custom `check` → known/custom `job`; the decision and reasoning are unchanged.
> - **Neutral capability boundary ([ADR 0322](0322-setup-is-one-bounded-operational-journey.md)):** the agent remains the configuration engine, but it no longer authors or selects a self-certifying capability label. Neutral options do not require neutral advice: discern recommends the strongest suitable reasoning model, explains how setup quality affects later sessions, gives the owner the model-selector and fresh-session route, and makes the current agent wait. Provider/model facts remain separate advisory provenance.

**Status**: accepted; revises the _emphasis_ of [ADR 0044](0044-setup-involve-not-gate.md) (involve, don't gate) and preserves the incompleteness signaling of [ADR 0037](0037-setup-incompleteness-observable.md), the promise-keeping of [ADR 0065](0065-setup-keeps-its-promises.md), and the staged handshake of [ADR 0075](0075-setup-staged-handshake.md). Touches only the agent-facing surfaces those ADRs govern — the printed brief (`templates/setup/instructions.md`) and the read-only `verify`/welcome surfaces — never the engine or the phase set.

## Context

ADR 0044 replaced setup's propose-and-confirm gate with "involve, don't gate": recommend, narrate, proceed on reversible changes, commit atomically, pause only for genuine decisions. It was the right correction to a consent gate that produced decision fatigue. But two cold setup runs — one Codex, one Claude, each meeting discern for the first time — showed a consistent failure pattern the brief's prose could not reach: **everything structurally enforced happened reliably; everything merely advised degraded.**

- **The model check didn't fire.** Step 0 asked the agent to _self-assess_ ("if you know you're a lightweight model, stop and recommend a switch"). Both capable models silently assumed they were the user's best model and skipped it — the single highest-leverage moment, since setup quality is inherited by every later session, and a self-assessment is exactly what a capable-looking model rationalizes past.

- **The agent narrated _what_, never _why_.** Both models reported which docs they wrote but never that the docs and guidance _are the single source of truth every future agent session and discern itself read from_. To a novice watching, the long authoring step looked like a frivolous writing spree for human readers — when it is the load-bearing artifact of reliable agentic development.

- **"Don't gate" collapsed into "don't involve."** Told not to gate, and handed a well-documented repo, a capable agent resolves toward _never asking_. Human involvement shrank to "run setup" plus "read the summary." For the novice the brief targets — someone unsettled by silent changes — a monologue they don't read is functionally no involvement at all. The thinness is partly _by design_ (the agent **is** the magic of zero-config), so the fix is not more questions; it is meaningful transparency plus a few genuine touchpoints.

- **The brief overwhelmed on first read.** At ~200 lines it truncated (agents `head`/`tail` it across passes) and restated the "this is work, not a summary" warning ~5×. The weaker models Step 0 worries about are the ones most likely to lose the thread in the volume.

The unifying root is that ADR 0044 told the agent _how to behave_ (don't gate) without telling it _what it is_ (the engine of a zero-configuration setup). A capable agent without that self-model optimizes "don't gate" into silence.

## Decision

**Reframe the brief and the consent surfaces so the agent understands it IS the configuration engine, and recasts ADR 0044's stance as _transparency, not interrogation_: narrate generously — above all _why_ — and ask only genuine decisions.** The change is entirely in the agent-facing prose; no engine behaviour, gating logic, or handshake phase changes.

1. **The agent is the engine; the human watches and trusts.** The brief's opening principles and its _How to work with the user_ section now tell the agent plainly that zero-configuration means _it_ does the work and the human's job is to watch and trust — not to field a stream of questions. The stance is transparency, not interrogation: do the reversible work, narrate it (the _why_ most of all), commit it in small revertible steps.

2. **The model check is a required relayed owner decision.** The welcome and consent message explain that the setup model studies the repository and authors the Gate, worktree policy, Map, and instructions later sessions inherit. discern recommends the strongest suitable reasoning model available. Before the owner chooses, the agent reports its current self-declared provider/model identifier, or `unreported`, separately. The owner can use the coding tool's model selector, open a fresh project session, and restart the setup funnel; the current agent then stops. Continuing in the current session is a separate neutral option. The agent never labels itself capable, expert, qualified, or safe.

3. **WHY documentation is stated, twice.** Before authoring and again in the closing summary, the agent states that the docs and guidance are the single source of truth future sessions and discern work from — load-bearing infrastructure, not prose for human readers — so the novice understands the lengthy step is the point, not busywork.

4. **Genuine touchpoints stay; reflexive permission goes.** The Step 1 discovery batch (2–3 questions the repo can't answer — purpose, audience, non-negotiables) remains an expected, collaborative step. The five-beat narration is reserved for genuine additions and forks; the obvious jobs a stack plainly already supports (formatter, linter, type-checker, tests) are batched into one concise recommendation, not five beats apiece — restoring ADR 0044's intent that the beats were for adding _new_ things.

5. **The volume is tamed.** The loud header frame and the tail-survivable footer stay (the deliberate weak-model guards of ADR 0037/0065), but the mid-body restatements of the "this is work" warning are cut, and each `## Step N` block is made self-contained so `discern setup step <n>` serves it cleanly. The goal is a brief that survives a single read without losing the thread.

The explicit **no**s:

- **No pre-setup state marker.** ADR 0075 rejected a `verify → begin` state gate. The stateless `--confirmed` attestation re-serves the complete choice, including the stop-versus-continue boundary, without recording a preflight state.
- **Incompleteness signaling is untouched (ADR 0037/0065).** The "SETUP STARTED — NOT FINISHED" frame, the stop-conditions footer, and the `discern setup done` gate all stand; warmer, more confident narration must still never read as "setup complete."
- **Not a return to silent action (ADR 0044).** Transparency-over-interrogation means _more_ narration, not less — the genuine-decision carve-out (cost, security, privacy, data, irreversibility, intent the repo can't supply) is unchanged.

## Consequences

- A coding agent reading the brief cold relays the model choice, the recommendation, the reason, and the switch action. It explains why the documentation matters and performs routine reversible authoring without turning setup into a stream of permission prompts.
- The novice watching comes away understanding _what_ discern did and _why_, feeling informed and in control — not buried, and not wondering why their tokens went to a writing spree.
- Setup's tone still depends on narration quality, which prose can shape but not enforce (the same accepted limit as ADR 0044). This ADR strengthens the shaping — a self-model plus concrete touchpoints — without making it structural, because the one thing that _is_ structural (the `done` gate) already guards the outcome.
- The reframe leans harder on the agent's judgment of what counts as a "genuine decision." The enumerated carve-out bounds it, but a model that misjudges will still over- or under-ask; the cold-run evidence is that under-asking was the real failure, and naming the touchpoints explicitly is the mitigation.

## Alternatives considered

- **Leave ADR 0044 as-is and only sharpen the prose.** Rejected: the degradation was systemic across two capable models, and traced to a missing self-model ("you are the engine"), not to insufficiently stern wording. Sharper sentences alone reproduce the same drift.
- **Persist a model-choice confirmation before `begin`.** Rejected because it needs state before any config exists and breaks the read-only boundary before `begin`. The served choice and stateless consent attestation preserve that boundary.
- **Re-introduce per-step confirmation for the novice.** Rejected for the same reasons ADR 0044 gave: it produces fatigue and uninformed rubber-stamps and mistakes interrogation for control. The fix is transparency, not consent.
