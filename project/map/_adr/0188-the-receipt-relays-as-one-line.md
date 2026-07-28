# ADR 0188: The receipt relays as one line; the page is pulled

> **Landing-line amendment (2026-07-28; [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md)):** A successful `accept` now derives `data.receipt_line` from the validated gate-receipt line and appends the recorded consent source, including scope names for a standing grant. The pre-landing line remains the review claim this record defines; the derived landing line is its authority-bearing acceptance record.

**Status**: accepted; amends the relay contract of [ADR 0114](0114-the-gate-emits-the-receipt.md) (the derivation, storage, and no-review-verb decisions stand).

## Context

ADR 0114 made a green `done` render the receipt and instructed the agent to relay the markdown verbatim to its owner. In practice that relay contract worked against the review moment it serves:

- **Verbatim relay through an agent proves nothing.** The receipt's value is that discern authored it, yet the owner reads it out of the agent's own message and cannot tell a faithful relay from a paraphrase or a fabrication. The artifact reads like mechanical proof without being one. The mechanical guarantee already lives elsewhere: `accept` re-verifies the marker (sha + clean tree) before landing, so the chat message was never the enforcement point.
- **On the happy path the page carries almost no information.** Each job line reports ok; the commit and file lists duplicate what `git diff`, the coding agent's own diff view, and any PR page show better. The single fact that matters — the gate passed on this exact commit — is one line. The signal (a deferred standard, an unverified-limits disclosure, a moved standard) sits below a screen of routine.
- **The paste displaces the account only the agent can give.** The owner's attention at review is finite. What it should go to — what changed and why, trade-offs, what was exercised beyond the gate (the `gate-prove-it-works` observations) — competes with a screen of boilerplate that is cheaper to produce, so the boilerplate wins.

## Decision

**A green `done` renders two artifacts from the one derivation: the receipt line, the only receipt content an agent puts in a message, and the receipt page, which the owner pulls from discern directly.**

- **The line** is one sentence built from the same envelope facts as the page: the branch and validated commit (abbreviated sha), the diffstat vs the trunk, the standards state (held / N deferred / UNVERIFIED), and the command that prints the full page. It travels in `data.receipt.line`, is stored in the marker beside the markdown, and is returned by `status` as `data.gate_receipt.receipt_line` while honored. The sha makes the claim checkable against the marker instead of trusted.
- **The relay hints become a composition contract.** `gate-relay-receipt` and `status-ready-for-review` now instruct: report the change in your own words — what you did, trade-offs, what you exercised beyond the gate — and close with the receipt line. The full page is never pasted into a message.
- **The page is owner-side pull.** It remains in the result envelope (`data.receipt.markdown`) and the marker; `status` returns it whenever honored in `--json`/MCP (the local view, and ready fleet rows from the main checkout) and prints it in the terminal only under the new `--verbose` flag. `done` at a terminal still prints it (the person running `done` is the owner), and `accept` still prints it as the landing record.
- **The page sheds the commit and file lists and leads with standards.** Git owns the commit and file facts; the `Inspect:` command is the pointer to them. The standards section — the only section that can carry a deviation — renders before the job table. The claim line names the validated sha. The envelope drops the structured `commits`/`commits_total`/`files` mirrors and gains `head` and `line`.

## Consequences

- The proof in a final message shrinks to one verifiable sentence, and the message's body reverts to the agent's account of the work.
- The marker gains a second component: sha, then `line: <receipt line>`, then the markdown. An old marker still parses (its line is absent); an old binary reading a new marker treats the line as leading markdown — cosmetic, and the sha rule is unchanged.
- `status` grows `--verbose` (terminal-only presentation; the JSON payload does not change with the flag) and its fleet rows carry `receipt`/`receipt_line` when a row's clean HEAD is honored, so a supervisor at the main checkout reviews without visiting the worktree.
- Consumers of the removed `commits`/`files` envelope fields (tests only, at the time of this record) read git directly instead.

## Alternatives considered

- **Keep the paste but collapse it** (e.g. `<details>`). Rejected: rendering depends on the chat surface, and the habit being trained — receipt as final message — is the defect.
- **No receipt content in messages at all.** Rejected: the one-line claim with a sha is what lets an owner act on a message without asking "did the gate pass?".
- **Sign the receipt so a paste is tamper-evident.** Rejected: key machinery to guarantee at message time what `accept` already guarantees at the only moment with consequences.
