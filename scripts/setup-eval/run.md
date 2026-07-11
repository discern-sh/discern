# Setup Eval Runner

These are the low-level runner commands behind `deno task setup-eval`. Prefer
the guided one-command flow for normal evals:

```sh
deno task setup-eval
```

Use this file when you need to debug a single fixture, checkout, agent, or phase
by hand. All runners save transcripts under `scripts/setup-eval/results/`. The
result directory is gitignored because transcripts contain machine paths, model
output, and sometimes local configuration details.

## Prerequisites

- `deno`, `git`, and the chosen agent CLI are installed.
- You are signed in to the agent CLI with your own subscription or API key.
- You run only against a fixture repo made by `make-fixture.ts`, unless you are
  using the one-command runner, which creates fixtures for you.
- You choose the discern checkout under test. For the pre-enhancement baseline,
  use a checkout pinned to `37ff892`.

## Fixture

Create a Deno fixture:

```sh
deno task setup-eval:fixture -- --flavor deno
```

Create a Node fixture:

```sh
deno task setup-eval:fixture -- --flavor node
```

The command prints the fixture path. Keep that path as `FIXTURE` for the runner.
Fixtures include an existing `docs/` tree by default so the docs-home consent
question is graded. Add `--no-docs` only for a focused no-docs variant.

## Discern Checkout

Use any checkout containing `deno.json` and `src/main.ts`.

Baseline example:

```sh
git worktree add /tmp/discern-setup-baseline-37ff892 37ff892
DISCERN_CHECKOUT=/tmp/discern-setup-baseline-37ff892
```

Working-tree example:

```sh
DISCERN_CHECKOUT=/path/to/discern-working-tree
```

The runner writes a temporary `discern` executable into the result directory and
prepends it to `PATH`:

```sh
exec deno run --no-check --config "$DISCERN_CHECKOUT/deno.json" -A "$DISCERN_CHECKOUT/src/main.ts" "$@"
```

That mirrors the engine tests' PATH shim while making the checkout selectable.

## Claude Code

First turn: capture the consent message and verify the agent waits.

```sh
scripts/setup-eval/run-claude.sh \
  --fixture "$FIXTURE" \
  --discern-checkout "$DISCERN_CHECKOUT" \
  --phase first \
  --agent-model "$CLAUDE_MODEL"
```

The exact headless agent invocation inside the runner is:

```sh
claude -p --output-format=stream-json --include-partial-messages \
  --include-hook-events --permission-mode bypassPermissions --verbose \
  --session-id "$SESSION_ID" --model "$CLAUDE_MODEL" "$PROMPT"
```

Continue after the first transcript shows the agent waited. Reuse the printed
result directory:

```sh
scripts/setup-eval/run-claude.sh \
  --fixture "$FIXTURE" \
  --discern-checkout "$DISCERN_CHECKOUT" \
  --phase continue \
  --result-dir "$RESULT_DIR" \
  --agent-model "$CLAUDE_MODEL" \
  --model-id "$CLAUDE_MODEL" \
  --map-answer docs/discern/
```

The continuation invocation is:

```sh
claude -p --output-format=stream-json --include-partial-messages \
  --include-hook-events --permission-mode bypassPermissions --verbose \
  --resume "$SESSION_ID" --model "$CLAUDE_MODEL" "$PROMPT"
```

## Codex

First turn: capture the consent message and verify the agent waits.

```sh
scripts/setup-eval/run-codex.sh \
  --fixture "$FIXTURE" \
  --discern-checkout "$DISCERN_CHECKOUT" \
  --phase first \
  --agent-model "$CODEX_MODEL"
```

The exact headless agent invocation inside the runner is:

```sh
codex exec --cd "$FIXTURE" --json --output-last-message "$LAST_MESSAGE" \
  --dangerously-bypass-approvals-and-sandbox --model "$CODEX_MODEL" -
```

Continue immediately after the first transcript shows the agent waited. Reuse
the printed result directory:

```sh
scripts/setup-eval/run-codex.sh \
  --fixture "$FIXTURE" \
  --discern-checkout "$DISCERN_CHECKOUT" \
  --phase continue \
  --result-dir "$RESULT_DIR" \
  --agent-model "$CODEX_MODEL" \
  --model-id "$CODEX_MODEL" \
  --map-answer docs/discern/
```

The continuation invocation is:

```sh
codex exec resume --json --output-last-message "$LAST_MESSAGE" \
  --dangerously-bypass-approvals-and-sandbox --model "$CODEX_MODEL" --last -
```

Pass `--session-id <id>` to the runner if you do not want Codex to use `--last`.

## Resume Turns

An agent that pauses mid-setup to ask a question (the brief's discovery batch is
the common case) ends its turn; send the generic keep-going nudge with either
wrapper, bumping `--attempt` for each further nudge:

```sh
scripts/setup-eval/run-codex.sh \
  --fixture "$FIXTURE" \
  --discern-checkout "$DISCERN_CHECKOUT" \
  --phase resume \
  --attempt 1 \
  --result-dir "$RESULT_DIR" \
  --agent-model "$CODEX_MODEL"
```

The one-command runner does this automatically until the fixture's
`discern.toml` records `bootstrapped = true`, capped at three nudges.

## Adding Another Agent

Add one `Agent` branch in `run-agent.ts`, a thin `run-<agent>.sh` wrapper, and a
section in this file with the exact first and continuation invocations. Keep the
result layout unchanged so the rubric and comparison README still apply.
