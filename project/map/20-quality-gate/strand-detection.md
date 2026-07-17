# Strand detection

_A green `discern done` must leave the tracked tree exactly as it found it — any
stage that dirties a committed-clean file blocks the gate, with the origin stage
named._

## The invariant

The fix stage mutates by design — a formatter, a codemod. Any other stage can
mutate by accident of wiring: a build step that regenerates a tracked manifest
or schema, a test that rewrites a golden file, a scope gate that runs a
generator. Whatever the origin, a change left on a file that was committed-clean
when the run began is work a green gate would otherwise hide — until
`discern accept` refuses the dirty tree, one long gate run later.

So `done` checks. The tracked-dirty set is captured before any stage group runs
and again after each green group. A file dirty at the end that was not dirty at
the start fails the gate (`failed_stage: "tree_drift"`); the diagnostic names
each file with the stage that produced it, embeds a capped `git diff`, and says
what to do: review, commit, re-run.

Files already dirty when the run began never trip the check — a stage reworking
your own uncommitted edits is the normal inner loop. Untracked files a stage
creates are out of scope by design: they show plainly as `??` in `git status`,
and a codemod that emits a new file (with a scope gate to validate it) is a
legitimate pattern. They still block the receipt, whose refusal names the
blocking paths.

## Why it blocks instead of hinting

Agents key on `ok`. A hint riding on a green result is what gets ignored — the
observed failure was an agent paying a long gate run, reading green, then paying
a second run after guessing "the formatter" had rewritten files a build step
actually regenerated. A red gate with the diff in hand is the same one commit
either way, with the cause in view
([ADR 0047](../_adr/0047-fix-stage-strand-detection.md),
[ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).

The gate never commits for you: a gate is not a committer, and discern cannot
know your commit boundary or message.
