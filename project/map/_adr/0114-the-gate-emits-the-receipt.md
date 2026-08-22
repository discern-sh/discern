# ADR 0114: a green gate emits the receipt

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0168](0168-the-gate-declares-jobs.md), [ADR 0245](0245-receipt-renamed-to-proof.md)):** current spellings are `standards` (formerly `ratchets`), `done` (formerly `finish`), `accept` (formerly `graduate`), and known/custom `job` (formerly gate `capability` / custom `check`); the gate-pass artifact became the receipt, and ADR 0245 renames the receipt-family terms to **proof**; the decision and reasoning are unchanged.

**Status**: accepted. Builds on [ADR 0028](0028-result-envelope-and-diagnostics.md) (the one-object result rule) and [ADR 0067](0067-accept-validates-the-landed-tree.md) (the gate receipt vouch); the review moment it serves is the landing model's ([ADR 0110](0110-the-landing-model.md)) handoff point.

## Context

The product's agent-facing surface is rich; the human's is transient terminal text — yet the human is the one who must approve work before it lands. When the gate went green and the guidance said "stop and wait for owner confirmation", nothing showed the human what to approve: no hint carried an inspection command, and the human's only view of the work was the agent describing its own output — exactly the self-grading the product exists to replace. The result envelope already carried everything a summary needs, and the gate already wrote a per-worktree marker; what was missing was surfacing an artifact, not inventing one.

Naming note (10 July): the artifact is **the receipt** — "pass" is overloaded at exactly the relay moment (the gate passes, checks pass/fail), and receipts are the audience's own proof idiom. The envelope field `gate_receipt` already agreed; the marker file is renamed `discern-gate-pass` → `discern-gate-receipt` so field and marker share one spelling.

## Decision

**A green `done` over a clean committed tree ahead of the trunk renders the receipt — a compact, deterministic markdown review summary — derives it once from the result envelope, and every later surface relays that one artifact.**

- **One derivation.** "What ran" (each declared job or scope gate with its command, outcome, duration) is read from the envelope's `steps[]`; the git facts (branch, diffstat vs the trunk, the branch's commits, capped with pre-cap totals) are gathered once and carried structured in `data.receipt` beside the rendered `markdown`. Same tree, same result → same receipt, durations excepted; a golden test pins the exact rendering.
- **Clean trees only.** A dirty green run earns no receipt: its diff vs the trunk would describe a different tree than the one the gate validated. The receipt therefore exists exactly when the ADR 0067 vouch records — and the marker now stores the markdown beside the validated sha, so `status` and `accept` surface the receipt without re-running the gate, under the same identity rule (any commit, amend, or edit silently invalidates both).
- **No review verb.** Nobody calls "review": the receipt plus the hints are the affordance. `done` prints it and hints relay-then-wait; the review-ready `status` hint carries the stored receipt and the exact inspection command (`git diff <trunk>...<branch>`); `accept` prints it as the landing record, pasteable into a PR body.

## Consequences

- **The review moment has content.** A non-git-fluent owner reads, in one screen of discern-authored output, exactly what was proven and what would land — and approves or digs deeper without the agent narrating its own grade.
- **The marker is now two things in one file:** the machine vouch (line one, the sha) and the human summary (the rest). A pre-receipt marker still parses (its markdown is simply empty), and an old binary reading a new marker sees a sha that cannot match HEAD — fail-closed, the gate just re-runs.
- **`standards --pin`'s carry-forward drops the markdown.** The pin commit moves HEAD, so the stored commit list would be stale; the carried vouch is written sha-only, and acceptance after a pin simply lands without printing a receipt. Honest over convenient.
- **The envelope grew** (`data.receipt` on `done`, `receipt` on `accept` and on the honored `gate_receipt` check), through the result-schema codegen, so the MCP output schemas and published contracts stay tied to reality.

## Alternatives considered

- **A `review`/`land` verb.** Rejected: it adds a verb nobody needs to call — the moment is a relay, not an operation. The receipt plus hints carry it.
- **Markdown only, no structured fields.** Rejected: the envelope is the single source every rendering derives from (ADR 0028); a consumer that wants the facts should not parse markdown discern itself rendered.
- **Render at relay time instead of storing in the marker.** Rejected: after the `done` run that proved the tree, only the marker knows what ran without re-running the gate — and re-rendering later would fabricate durations for a run that isn't the one that vouched.
