# Clean-Room Setup Eval Protocol

This is a dev-side runner for measuring the human-facing `discern setup`
experience. It is not shipped, not part of CI, and not part of `discern done`.
The operator runs it locally with their own agent subscriptions, then grades the
captured transcripts against `rubric.md`.

## One-Command Run

For the guided path, run:

```sh
deno task setup-eval
```

That TUI prompts for the checkout(s), agent CLI(s), fixture flavor(s), model
labels, and cleanup policy, then runs both setup-eval turns end to end.

For a non-interactive current-checkout run using detected agent CLIs:

```sh
deno task setup-eval -- --yes
```

For a baseline-versus-current comparison pinned to the planning anchor:

```sh
deno task setup-eval -- --yes --baseline --baseline-sha 37ff892
```

The command creates disposable fixture repos, creates and removes the managed
baseline checkout when requested, runs the first consent turn and continuation
turn for each selected agent, then keeps nudging with generic resume turns until
the fixture's own `discern.toml` records `bootstrapped = true` (capped at three;
the count appears in the summary), writes a summary, and cleans up temporary
fixtures unless `--keep-fixtures` is set.

## What It Measures

Unit tests prove the setup strings exist on stdout. This protocol checks the
harder thing: whether real coding agents relay those strings in chat, wait at
the consent boundary, narrate the run, and close only after `discern setup done`
passes.

## Measurement Validity

The scripted user turns in `run-agent.ts` simulate a plausible novice: "run
`discern setup`", then plain answers to the consent questions. They must never
instruct a behavior the rubric grades — explaining discern, relaying messages,
narrating stages, atomic commits, running `discern setup done`, or the closing
summary. Coaching any of those turns the eval into an instruction-following
test, inflates the baseline, and erases the before/after delta the protocol
exists to measure. If an agent stalls or abandons the run without that coaching,
grade it as a finding — that is the experience a real novice gets.

Two known constants to keep in mind while grading:

- The agent CLIs load the operator's own global configuration (a global
  `CLAUDE.md`, `~/.codex` instructions), which can push the agent's register —
  for example toward terseness. This bias is constant across baseline and
  change, so comparisons hold, but check what your global config says before
  reading a transcript as the absolute novice experience.
- The first turn's "ask me and then stop" line is a deliberate exception, needed
  so headless phase one ends at the consent conversation. Grade the
  Wait-boundary row as necessary-but-not-sufficient because of it.
- The turn count is the agent's, not the runner's. An agent that honors the
  brief's discovery batch ends its continuation turn waiting for answers, so the
  runner sends a generic keep-going nudge ("my earlier answers stand, anything I
  didn't specify is your call") until setup genuinely completes — checked from
  the fixture's `discern.toml`, never from transcript text. The nudge is a
  scripted user turn under the same novice-words rule: it decides nothing and
  coaches nothing. One resume is normal and even good (a real collaborative
  touchpoint); hitting the cap means the agent is stalling — grade it, don't
  retry past it.

One operational caution: the Codex continuation resumes the most recent session
(`--last`). Do not run other Codex work while an eval is in flight, or pin the
session with `--session-id`.

## Baseline Then Change

1. Run the baseline matrix:

   ```sh
   deno task setup-eval -- --yes --baseline-only --baseline-sha 37ff892 --agents claude,codex
   ```

2. Grade each transcript with `rubric.md`. Record pass/fail and notes in a copy
   of the rubric outside `results/` if the notes should be committed; raw
   transcripts stay ignored.

3. Apply the setup change under evaluation.

4. Re-run the same matrix against the changed checkout:

   ```sh
   deno task setup-eval -- --yes --agents claude,codex
   ```

5. Grade again and compare before/after. The first-message rows are the key
   regression detector: they catch agents that execute the commands while
   compressing the human-facing setup into a checklist.

The planning anchor for the pre-enhancement baseline is `main` at `37ff892`.
Keep baselines named by discern SHA, not by "before" or "old", so later setup
iterations can be compared without ambiguity.

## Result Layout

Each run writes to:

```text
scripts/setup-eval/results/<date>-<agent>-<discern-sha>/
```

Important files:

- `<timestamp>-summary.json` and `<timestamp>-summary.md` — the top-level matrix
  summary from `deno task setup-eval`.
- `prompt-01-first.md`, `prompt-02-continue.md`, and `prompt-03-resume-1.md`
  onward — the scripted user turns (resume files exist only when the run needed
  keep-going nudges).
- `transcript-*.stdout.jsonl` — the agent event stream, including messages and
  tool output where the CLI exposes it.
- `transcript-*.stderr.log` — CLI warnings or errors.
- `metadata-*.json` — timing, exit code, fixture path, checkout path, and SHA.
- `index.md` — a short human index for the result directory.
- `bin/discern` — the generated PATH shim for the chosen checkout.

The whole `results/` tree is ignored. Do not commit transcripts, tokens, local
paths, or subscription-specific output.

## Fifteen-Minute Checklist

1. Run `deno task setup-eval`.
2. Choose the checkout(s), agent(s), and fixture flavor(s).
3. Let it run first and continuation phases automatically.
4. Open the printed summary.
5. Grade the transcript directories with `rubric.md`.
6. Repeat for the second agent, and for the Node fixture when the change could
   be stack-sensitive.

Use the default docs-bearing fixtures for ordinary comparisons. Add `--no-docs`
only when you specifically want to isolate the no-existing-docs branch of the
setup conversation. Use `run.md` only when debugging one low-level agent phase
by hand.
