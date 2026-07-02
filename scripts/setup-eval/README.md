# Clean-Room Setup Eval Protocol

This is a dev-side harness for measuring the human-facing `discern setup`
experience. It is not shipped, not part of CI, and not part of `discern finish`.
The operator runs it locally with their own agent subscriptions, then grades the
captured transcripts against `rubric.md`.

## What It Measures

Unit tests prove the setup strings exist on stdout. This protocol checks the
harder thing: whether real coding agents relay those strings in chat, wait at
the consent boundary, narrate the run, and close only after `discern setup done`
passes.

## Baseline Then Change

1. Create a pinned baseline checkout:

   ```sh
   git worktree add /tmp/discern-setup-baseline-37ff892 37ff892
   ```

2. Create one fixture per stack:

   ```sh
   deno task setup-eval:fixture -- --flavor deno --json
   deno task setup-eval:fixture -- --flavor node --json
   ```

3. Run Claude Code and Codex against the baseline checkout from each fixture.
   Follow `run.md` for the two-turn first/continue commands. Save the printed
   result directories.

4. Grade each transcript with `rubric.md`. Record pass/fail and notes in a copy
   of the rubric outside `results/` if the notes should be committed; raw
   transcripts stay ignored.

5. Apply the setup change under evaluation.

6. Create fresh fixtures and re-run the same agent, model, stack, and docs
   choices against the changed checkout.

7. Grade again and compare before/after. The first-message rows are the key
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

1. Pick the checkout: baseline SHA or working tree.
2. Make a fixture with `deno task setup-eval:fixture -- --flavor deno`.
3. Run the agent first phase.
4. Confirm the first transcript waited at consent.
5. Run the continuation phase with the same result directory.
6. Grade the transcript with `rubric.md`.
7. Repeat for the second agent, and for the Node fixture when the change could
   be stack-sensitive.

Use the default docs-bearing fixtures for ordinary comparisons. Add `--no-docs`
only when you specifically want to isolate the no-existing-docs branch of the
setup conversation.
