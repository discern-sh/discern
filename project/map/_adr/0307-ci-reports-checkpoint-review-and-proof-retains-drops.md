# ADR 0307: CI reports checkpoint review and Proof retains drops

**Status**: accepted

## Context

Checkpoint declarations live in a worktree's Git administrative state. A fresh pull-request checkout cannot read a developer worktree's open questions or declarations. Strict `discern done` can therefore refuse before machine jobs even when the developer already reviewed the question. Putting declaration flags in workflow YAML would turn a judgment into an unconditional assertion.

Checkpoint enforcement also has evidence-loss paths. Policy, diff, `when`, subject, or local-store uncertainty previously survived mainly as advisory text. A green result could outlive that transient account, leaving the owner unable to tell which checkpoint was not enforced.

## Decision

**Continuous integration has an explicit report lane, and every checkpoint evidence drop is structured Proof evidence.**

- `discern done --ci` selects report mode. Environment variables may tailor a strict refusal hint but never select the mode.
- Report mode evaluates the same governing policy and obligations, runs `when` during an actual run, and runs the same Gate jobs. Fired stop checkpoints await review. Machine jobs alone control the exit.
- Report mode accepts no declaration flags and writes no open question, declaration, or checkpoint lifecycle observation. Its Proof states that review was reported and was not enforced.
- Report Proof has its own identity. Status reports it as `report_only`; acceptance preview, acceptance apply, validation during execution, and durable-note writing all reject it. Ordinary `discern done` is required before landing. A report run on the same `HEAD` preserves an already honored strict marker instead of replacing stronger local evidence with report-only evidence.
- One typed registry classifies checkpoint drops. A checkpoint-level record carries id, mode, governing policy commit, reason, and a normalized account of at most 500 characters. A policy-level record uses `null` for unknowable id and mode and carries the policy commit only when known.
- Every Gate, Proof, status, acceptance review, and DSSE projection derives from those records. A green evidence drop does not become a variance, and a dropped indeterminate stop prevents Proof reuse.

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
- **Make every drop block.** Rejected: policy-level evidence loss is not itself an authored review question. Executable stop uncertainty is the narrower exception: it serves the governed question rather than inventing a predicate answer.
