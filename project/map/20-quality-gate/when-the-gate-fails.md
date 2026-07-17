# When the gate fails

_Your first red `discern done` — how to read it, what usually causes it, and what to hand back to your agent._

The gate (`discern done`) is the check that decides whether a change is done. When it fails, nothing is broken — the gate did its job and caught something before it landed. This page is how to read that failure without digging into source.

## What a failure looks like

Your agent runs `discern done` and reports that it didn't pass. Underneath, discern runs each part of your gate — formatting, building, linting, type-checking, testing — as its own labelled job, so a failure points at the exact one rather than a wall of output. For every genuine failure you get three things:

- **the tool** that failed (your test runner, your linter, …);
- **a reproduce command** — the exact command to re-run just that failure on its own;
- **the captured output** — what the tool actually printed.

Your agent reads these directly and usually fixes the problem and re-runs on its own. You rarely have to read the raw output yourself — but when you want to, the reproduce command is the one to run.

## The usual causes, by stage

Most failures fall into a handful of buckets:

- **"Your branch is behind `main`."** The gate stops immediately, before running anything, because other work landed while yours was in progress. Fix: your agent runs `discern update` to bring `main` in, then `discern done` again. discern doesn't merge silently — it waits for that step.
- **A generated file is out of date.** The gate reports that the compiled agent files or skills have drifted from their source. Fix: `discern refresh` rebuilds them.
- **The gate left changes.** A stage rewrote tracked files you had already committed — the format step rewriting style, a build step regenerating an artifact. The diagnostic names each file and its stage. Fix: commit the gate's changes — or run the gate before your final commit so they ride along.
- **Lint or type errors.** A linter or type-checker found a real problem in the code; the captured output names the file and line.
- **A test failed.** The reproduce command re-runs that one test on its own. A test that passes alone but fails in the full run is usually leaning on shared state — those cases live in [gate gotchas](../80-development/done-gate-gotchas.md).

## What to paste to your agent

If your agent didn't fix it on its own, give it the failure to work from. The most useful form is the machine-readable one:

```
discern done --json
```

That prints one structured object — every job, and for each failure the tool, the reproduce command, and the captured output — which is exactly what an agent needs to loop _fix → re-run_ without guessing. Paste that, or just tell your agent "the gate failed, here's the output" and let it run `discern done` itself.

## Still stuck?

- Run `discern doctor` — it checks the install, the config, and that every command your gate calls is actually available. A missing tool is a common first-week cause.
- For failures the error message alone doesn't explain — a test that only fails in parallel, a stale build artifact, a dependency a merge pulled in — [gate gotchas](../80-development/done-gate-gotchas.md) is the symptom → cause → fix reference.
- The [FAQ](../10-getting-started/faq.md) covers the most common setup and environment problems.
