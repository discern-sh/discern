# Clean-Room Setup Eval Protocol

This is a dev-side harness for measuring the human-facing `discern setup`
experience. It is not shipped, not part of CI, and not part of `discern finish`.
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
turn for each selected agent, writes a summary, and cleans up temporary fixtures
unless `--keep-fixtures` is set.

## What It Measures

Unit tests prove the setup strings exist on stdout. This protocol checks the
harder thing: whether real coding agents relay those strings in chat, wait at
the consent boundary, narrate the run, and close only after `discern setup done`
passes.

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
- `prompt-01-first.md` and `prompt-02-continue.md` — the scripted user turns.
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
