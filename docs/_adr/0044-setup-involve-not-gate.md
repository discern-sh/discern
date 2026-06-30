# ADR 0044: Setup involves the user and proceeds — it does not gate every step

**Status**: accepted

Revises the setup-brief interaction model established by
[ADR 0036](0036-unify-setup.md) (unify init + bootstrap into `discern setup`)
and preserves the incompleteness signaling hardened by
[ADR 0037](0037-setup-incompleteness-observable.md). Where 0036's brief told the
agent to _propose and wait for confirmation_, this shifts to _recommend,
narrate, proceed on reversible changes, and commit atomically_ — pausing only
for genuine decisions.
[ADR 0076](0076-setup-agent-is-the-configuration-engine.md) later revises the
_emphasis_ of this stance — the agent is the configuration engine; transparency
over interrogation — after cold runs showed "don't gate" degrading into "don't
involve."

## Context

`discern setup`'s headline user is someone building software **through** coding
agents without the background to ship reliable software unaided — and,
crucially, someone who gets spooked when an agent silently installs outside
tools or changes their project without explanation. Setup is their first contact
with the harness; it sets the tone for whether `discern` reads as help or as a
black box.

The brief ADR 0036 wrote optimised for safety-by-consent: "propose, don't
overwrite … show it and let them confirm rather than silently committing," and a
stop-condition that capability fills are "committed only if the user confirms."
Every routine, reversible step — wiring a formatter, adding a missing
type-checker — became a "may I?" the user had to answer.

For that user the consent gate backfires three ways:

- **Decision fatigue.** A novice asked to approve a dozen changes they don't yet
  understand has no basis to say yes — so the safe-feeling answer is "no," or a
  rubber-stamp "yes" that confers no real understanding. Either way the gate
  taught them nothing and slowed them down.
- **It mistakes interrogation for control.** Being asked permission is not the
  same as being informed. The user can approve every step and still not know
  what changed, why, or how to undo it.
- **It buries the teaching moment.** The most valuable thing setup can do for
  this user is explain _why_ a missing capability matters and that `discern` is
  the thing that will catch the problem later. A bare "add a linter? [y/N]"
  carries none of that.

Meanwhile the safety the gate reached for is already available structurally.
Every change setup makes is reversible, and discern's whole workflow is built on
**atomic, revertible commits**. A commit _is_ an undo. The gate was guarding
against an irreversibility that, for setup's changes, does not exist — while
paying for that phantom guard in fatigue and silence.

## Decision

**The setup brief prescribes "involve, don't gate": recommend → explain →
proceed on the reversible change while narrating → commit it atomically →
(revertible). The agent pauses to ask only for genuine decisions.** The change
is entirely in `templates/setup/instructions.md` (the brief printed to the
agent); no engine behaviour changes.

Four parts:

1. **A five-beat narration pattern** for each meaningful recommendation (adding
   a tool/dependency/config the project is missing): recommend it as a shared
   step; say why it helps in terms the user cares about; **name `discern` as the
   source** of the suggestion (so the user learns the tool is watching their
   back); preserve their authority and name the risk of skipping while pointing
   at the revert; then proceed and state the action. Warm, transparent, and
   _teaching_ — not a checkbox.

2. **An atomic commit per stage.** Each coherent stage — the principles, the
   guidance, the orientation docs, each capability wired — lands as its own
   focused commit with a plain-language message, and the agent says so. This is
   the mechanism that makes "proceed without asking" safe: beat 4's "we can
   revert later" is literally true _because_ beat 5 made the change its own
   commit. The promise is **backed by** the commit, not merely asserted.

3. **Involve, don't gate — but interrupt for real decisions.** Default to
   proceeding (with narration) on reversible, low-stakes, single-obvious-answer
   changes. Stop and genuinely ask when a decision is hard to reverse, a real
   fork between legitimate alternatives only the user can choose, carries
   cost/security/privacy/data implications, or depends on intent the agent can't
   infer. The Step 1 discovery questions stay — that is information-gathering,
   not a permission gate; what goes away is the reflexive "may I?".

4. **Volume calibration.** Narrate at the level of meaningful stages and
   decisions, not every file write — the user should feel informed, not buried.

The explicit **no**s:

- **Incompleteness signaling is untouched.** The loud "SETUP STARTED — NOT
  FINISHED" frame, the stop-conditions close, and the `discern setup done` gate
  (ADR 0037) all stay exactly as hardened. The brief states outright that
  per-stage commits and reassuring narration are transparency _during_ setup and
  must **not** be paraphrased to the user as "setup complete." Warmer narration
  must not become a second "looks done" signal — the exact failure 0037 exists
  to prevent.
- **Not a licence to act irreversibly.** "Proceed without asking" is scoped to
  reversible, low-stakes changes; the genuine-decision carve-out is the
  boundary, and it is enumerated in the brief. External per-worktree resources
  (a database, an emulator) are explicitly routed to that carve-out, not wired
  silently.
- **No new CLI interactivity.** `discern setup` the _command_ stays
  non-interactive (ADR 0036): it prints the brief and exits. This ADR governs
  the _agent's_ subsequent conversation, which always should converse — a
  distinction the brief now draws explicitly so "non-interactive" isn't misread
  as "stay silent."

## Consequences

- The novice gets a setup that **explains itself and teaches** — each
  recommendation says why it matters and names `discern` as the safety net —
  while staying fully in control through the ability to review and revert any
  single commit. Control comes from reversibility, not from an approval prompt.
- Fewer interruptions, each higher-signal: when the agent _does_ stop, it is a
  genuine decision, so the question carries weight instead of being lost in a
  stream of rubber-stamps.
- The brief now carries **one** interaction model end to end. The old
  propose-and-confirm language (the operating principle, the Step 7 gate, the
  stop-condition) is reconciled to recommend-narrate-commit, and
  `tests/engine_setup_test.ts` asserts the new stance is present and the old
  "committed only if the user confirms" gate cannot silently return.
- The model leans on the user actually having atomic commits to revert. That is
  already discern's house style and the brief now makes it explicit, but a user
  who squashes everything loses the fine-grained undo the promise relies on — an
  accepted trade, since the per-stage commits are advice the brief gives loudly.
- Setup's _tone_ now depends on the agent's narration quality, which the brief
  can shape but not enforce — unlike the structural incompleteness signal.
  Accepted: narration is inherently a prose concern, and the five-beat pattern
  gives it a concrete shape to follow rather than leaving it to taste.

## Alternatives considered

- **Keep propose-and-confirm.** Rejected: for the target novice the consent gate
  produces fatigue and uninformed rubber-stamps and mistakes interrogation for
  control — while the reversibility it reaches for is already guaranteed by
  atomic commits.
- **Proceed silently and let the diff speak.** Rejected: silent tool
  installation is precisely what spooks this user. The point is not to skip the
  conversation but to make it warm, explanatory, and non-blocking. The narration
  is the product, not overhead.
- **A per-change approval toggle (gate level as config).** Rejected as
  premature: it re-introduces a decision (which level?) onto the user who least
  wants one, and the genuine-decision carve-out already routes the few truly
  user-owned choices to a prompt. Revisit only if real use shows the boundary is
  mis-drawn.
- **Drop the consent framing without adding narration.** Rejected: that loses
  the teaching value — the single best thing setup can do for a non-expert is
  explain _why_ each capability matters and that `discern` is what enforces it.
