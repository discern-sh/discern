# The receipt

_The compact review summary a green gate hands the human — discern's own
account of what was proven and what would land._

## What it is

When `discern finish` passes on a clean committed tree ahead of the trunk, it
renders **the receipt**: one screen of markdown carrying the branch, what ran
(each capability, check, and scope gate with its command, outcome, and
duration), the diffstat vs the trunk, the branch's commit list, and the exact
`git diff` command for anyone who wants the raw change. It is deterministic —
same tree, same result → same receipt, durations excepted — and **derived once
from the result envelope**: "what ran" is read from the envelope's `steps[]`,
the git facts are gathered once and carried structured in `data.receipt`
(branch, trunk, commits, files, insertions, deletions), and the `markdown` is a
rendering of those fields, never a second computation
([ADR 0113](../_adr/0113-the-gate-emits-the-receipt.md); the one-object rule of
[ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

A dirty tree earns no receipt: the diff vs the trunk would describe a different
tree than the one the gate validated. Commit the intended final tree, then run
the final `finish` on the clean HEAD.

## Where it appears

- **`discern finish`** prints it at the tail of a green human run and carries
  it in the `--json`/MCP envelope as `data.receipt`, with a hint beside it:
  relay the receipt to your owner and stop; graduate only once they accept.
- **The marker.** The green run stores the markdown beside the validated sha in
  the per-worktree marker file (`discern-gate-receipt`, inside the git admin
  dir — the vouch of
  [ADR 0067](../_adr/0067-graduate-validates-the-landed-tree.md)), so later
  verbs can surface the receipt without re-running the gate. Any new commit,
  amend, or uncommitted edit silently invalidates it.
- **`discern status`**, when the clean HEAD has a recorded pass, carries the
  stored markdown in `data.gate_receipt.receipt`, and its review-ready hint
  names the moment's two affordances: relay the receipt, and inspect the raw
  diff with `git diff <trunk>...<branch>`.
- **`discern graduate`** prints it on a green landing — the landing record,
  pasteable into a PR body — and carries it as `data.receipt`.

## The review moment

Nobody calls a review verb; the receipt and the hints are the affordance. A
green finish emits the receipt, the compiled guidance tells the agent to relay
it and wait, and the owner reads discern's own deterministic account of what
was proven — instead of the agent narrating its own grade — digs into the raw
diff if they want to, and approves with a word: accept.

## See also

- [the-result-envelope.md](the-result-envelope.md) — the `DiscernResult`
  envelope the receipt derives from.
- [README.md](README.md) — the gate that produces it.
