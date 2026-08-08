# ◮ discern

**Build further.**\
An engineering practice for agent-built software.

Coding agents can take a project further than one person could build alone. discern installs a serious engineering practice into the repository: shared project understanding, isolated work for every task, deterministic checks, quality measures that retain gains, and evidence for the exact change. The agents do more of the work; you stay responsible for what gets launched.

It is for engineers who already direct more implementation than they can personally read, and for builders whose project has begun to matter: users arriving, data worth protecting, a name on the result.

[discern.sh](https://discern.sh) · [Documentation](https://discern.sh/docs) · [For coding agents](https://discern.sh/llms.txt)

## Start in two steps

**1. Install the binary.**

```sh
curl -fsSL https://discern.sh/install | sh
```

One self-contained binary for macOS and Linux (Windows via WSL2). Your project needs nothing beyond `git` — no runtime, no account, no API key.

**2. Hand the project to your coding agent.** Open the agent you already use and tell it:

> Set this project up with discern.

The agent studies the repository, proposes the checks that will define "done," asks for the decisions only you can make, and writes nothing until you agree. Setup refuses to record itself complete until the project's checks have run green in a throwaway worktree. Give the conversation a capable model and half an hour; every session after that inherits what it establishes.

## What the practice holds

- **Every agent starts with the project already in view.** Write your project guidance once; discern compiles it for every configured provider — Claude Code, Codex, Gemini, Cursor, GitHub Copilot, and any other tool that reads `AGENTS.md`. Change agents without starting the project explanation over.
- **Every task gets its own prepared place.** Each change happens in its own Git worktree, with its own branch, identity, environment values, and any resources the project declares. Parallel agents work in separate checkouts and cannot overwrite one another's working tree.
- **"Done" means your project's own bar was met.** Declare format, lint, typecheck, and test once in `discern.toml`; the Gate runs them against the final tree and reports what they returned.
- **A measurable gain becomes the new floor.** Standards hold quality numbers (coverage, bundle size, lint counts) at limits that may only improve. When a measure gets better, discern can pin the gain; a branch cannot weaken the limit.
- **Evidence belongs to the exact change.** A green Gate on a clean committed tree yields a Proof identifying what passed and which change it covers. Passing makes a change eligible for a decision; it does not decide what ships.
- **A backlog can become organized parallel work.** The bundled delegate-work skill turns discussed work into complete handoffs, parallel streams, or staged dependencies for fresh agents, while dispatch stays under your control.

## Day to day

Your agent drives the loop as it works — you read the results:

```sh
discern status      # what is true right now, and what to do next
discern start       # a fresh isolated worktree for the task
discern prepare     # the fast inner loop: fix, regenerate, check
discern test        # the project's tests on their own
discern done        # the full Gate — the bar for "done"
discern accept      # land the finished branch, with your consent
```

Every verb takes `--json` and returns one structured envelope; the MCP tools (`discern_status`, `discern_done`, …) return the same results from the same engine.

## Trust boundaries

- discern contains no AI model and needs no API key; it runs the commands the project declares.
- The Logbook, discern's local record of its own runs, stays on your machine and contains metadata rather than code or command output.
- All project-specific settings live in one root `discern.toml`. The guidance, skills, and agent files discern maintains are generated in the open, an architectural test enumerates every path it may write, and `discern uninstall` takes the wiring back out.
- discern is not a sandbox, and it does not guarantee correct or secure software. It gives you declared checks, evidence for the exact change, and the final say over what lands.

## Any repository, any stack

The engine never learns what "a test" is. It runs the commands your project names and judges nothing except their results — which is how one quality harness fits any repository, in any language, under whichever agent is driving.

## Built under its own Gate

discern is developed under its own Gate, worktrees, Standards, Map, and Logbook: the repository you are reading clears the same bar it ships. Its practices came out of a production agent-driven workflow and were generalized until nothing stack-specific remained.

---

**For people who take their software seriously.**

[discern.sh](https://discern.sh) · [Documentation](https://discern.sh/docs) · [Decisions](project/map/_adr/) · [License](LICENSE)
