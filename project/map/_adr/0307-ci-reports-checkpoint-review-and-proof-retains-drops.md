# ADR 0307: CI reports checkpoint review and Proof retains drops

**Status**: accepted

## Context

Checkpoint declarations live in a worktree's Git administrative state. A fresh pull-request checkout cannot read a developer worktree's open questions or declarations. Strict `discern done` can therefore refuse before machine jobs even when the developer already reviewed the question. Putting declaration flags in workflow YAML would turn a judgment into an unconditional assertion.

Checkpoint enforcement also has deliberate fail-open paths. Policy, diff, `when`, subject, or local-store uncertainty previously survived mainly as advisory text. A green Proof could outlive that transient account, leaving the owner unable to tell which checkpoint was not enforced.

## Decision

**Continuous integration has an explicit report lane, and every checkpoint fail-open is structured Proof evidence.**

- `discern done --ci` selects report mode. Environment variables may tailor a strict refusal hint but never select the mode.
- Report mode evaluates the same governing policy and obligations, runs `when` during an actual run, and runs the same Gate jobs. Fired stop checkpoints await review. Machine jobs alone control the exit.
- Report mode accepts no declaration flags and writes no open question, declaration, or checkpoint lifecycle observation. Its Proof states that review was reported and was not enforced.
- Report Proof has its own identity. Status reports it as `report_only`; acceptance preview, acceptance apply, validation during execution, and durable-note writing all reject it. Ordinary `discern done` is required before landing.
- One typed registry classifies checkpoint drops. A checkpoint-level record carries id, mode, governing policy commit, reason, and a normalized account of at most 500 characters. A policy-level record uses `null` for unknowable id and mode and carries the policy commit only when known.
- Every Gate, Proof, status, acceptance review, and DSSE projection derives from those records. A green drop remains fail-open evidence and does not become a variance.

## Consequences

- A required pull-request job can run all machine checks and expose relevant questions without counterfeiting review.
- Passing CI proves the machine Gate and reports checkpoint review state. It does not prove that an agent reviewed a question.
- Owners can audit a green Proof for enforcement lost to uncertainty, including the reason and governing identity available at the failure point.
- Strict local behavior and its existing marker shape remain unchanged. Push-to-trunk CI normally sees an empty effort diff.
- Declaration transport remains a later owner design. This decision adds no remote store, signed review bundle, workflow conclusion, or implicit environment switch.

## Alternatives considered

- **Transport local declarations into CI.** Deferred: identity, signature, replay, and owner trust policy need a separate design.
- **Treat machine success as checkpoint success.** Rejected: machine results cannot answer judgment questions.
- **Skip checkpoints silently in CI.** Rejected: a green check would conceal the policy that was not enforced.
- **Make every drop block.** Rejected: it changes deliberate fail-open policy into an undeclared stop and can wedge work on unreadable local state.
