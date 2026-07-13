# discern

**Code got cheap. Judgment didn't.**

Your AI writes the code now — **`discern` makes sure it holds up.**

<!-- HERO ASSET — TERMINAL RECORDING GOES HERE.
     Embed the ~30-second setup-handshake cast (asciinema / VHS) once it's
     recorded: the human installs, hands off to the agent, and watches it wire the
     whole project up. Owner-supplied — don't fake one. The two-step below stands
     in until then. -->

`discern` drops the guardrails a serious team relies on into your project — and
lets your coding agent set them up for you. In plain terms, three things:

- **Quality checks on every change** (the _gate_) — your formatter, linter, and
  tests, run together before any change counts as done, so mistakes get caught
  before they ship.
- **A safe, separate copy of the project for each task** (an isolated _git
  worktree_) — so a handful of agents can work at once and never step on one
  another.
- **One set of instructions every AI reads** — write how your project works
  once, and Claude Code, Cursor, Copilot, Codex, and Gemini all follow it (along
  with any other tool that reads an `AGENTS.md` file).

The catch that isn't one: **you don't configure any of it — your AI does.**

---

## Get started in two steps

**1 — Install the binary.** One command, once:

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

One self-contained binary — no runtime to manage, no account, no API key. Your
project needs nothing but `git`. macOS and Linux (Windows via WSL).
[Build from source →](project/map/80-development/)

**2 — Hand it to your agent.** Open your coding agent in the project and tell
it:

> _"Run `discern setup` in this project."_

That's the whole handoff. Your agent reads the repo, proposes the format / lint
/ typecheck / test commands, drafts your docs and guidance, wires the gate, and
proves it green — committing each step for you to review, and writing nothing
until you say go. Budget 20–40 minutes for the one-time conversation, and point
your **most capable** model at it: every later session inherits what it sets up.

> `discern` doesn't write your code, run a model, or need an API key. It works
> with the agents you already use, in the language you already write. What it
> owns in your project is **one root file and one visible folder** — plus the
> small config files your coding tools require, wired for you — a boundary an
> architectural test keeps true. Change your mind later? `discern uninstall`
> takes the wiring back out and leaves what's yours.

---

## Why

Coding agents turn out days of work in minutes. Trusting that work — and getting
it safely into a shared codebase — never sped up. `discern` closes that gap:

- **Point as many agents at a problem as you like.** Each works in its own
  sealed git worktree, so they never trip over each other and you never untangle
  a mess two of them made at once.
- **Switch agents freely.** One source of truth compiles into every agent's
  instructions, so Claude Code, Cursor, Copilot, Codex, and Gemini all treat
  your repo the same way — even several at once.
- **Stop babysitting.** What your agents hand back has already cleared the same
  bar you'd hold a person to — every check green, coverage held, regressions
  guarded. To make that the rule for `main` itself,
  [run the gate in CI](project/map/20-quality-gate/ci.md).

More time _building_, less time _babysitting_.

---

## Then, day to day

Once setup is done, this is the rhythm — and **your coding agent runs almost all
of it as it works**, not you:

```sh
discern status      # what's true right now, and what to do next
discern start       # carve a fresh isolated worktree for a task
discern prepare     # fast inner loop: format + checks
discern done        # the full gate — the bar for "done"
discern accept      # land the reviewed branch back on main
```

Agents can drive every one of these through **MCP tools** (`discern_status`,
`discern_done`, …) just as well as the CLI — same engine, structured results
either way.

---

## What you get

- **A gate that _is_ your definition of done.** Declare what your project can do
  — format, lint, typecheck, test — once; `discern` runs them as a single `done`
  command, in parallel, before anything is called done.
  [The quality gate →](project/map/20-quality-gate/)
- **Isolated worktrees.** A throwaway `git worktree` per change — its own
  branch, port, and database — so parallel agents never collide in your main
  checkout. [Worktrees →](project/map/30-worktrees/)
- **Author-once agent instructions.** Write your guidance once; `discern`
  compiles it into each agent's own file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`)
  — so every agent, and any other tool that reads `AGENTS.md`, works from one
  source of truth. [Agent guidance →](project/map/40-agent-guidance/)
- **Standards.** Numbers that can never get worse — coverage, bundle size, lint
  counts — so quality climbs and never slips back.
- **A docs & decision discipline.** A living, agent-maintained map of your
  codebase and Architecture Decision Records, kept current by the gate itself.

What `discern` itself owns in your repo is **one root file, `discern.toml`, plus
one visible `discern/` folder**; beyond that it wires only the config files your
coding tools require — your own tools' integration files, updated in the open.
Everything else is bundled in the binary or generated, an architectural test
fails the moment `discern` writes anywhere else, and `discern uninstall` removes
the wiring whenever you want out.
[Config reference →](project/map/10-installer/config-reference.md)

---

## How it works

The engine is **deliberately ignorant of your stack.** It never learns what "a
test" is — it runs _the test capability_, a command you name once in
`discern.toml`. That one idea is what lets a single quality harness drop into
any repo and any language — and answer to whichever agent is driving it.

Read the [concepts and system map](project/map/00-orientation/) for the full
model, or browse the docs right in your terminal with `discern help`.

---

## Built honestly

`discern` runs on its own gate: this repo is checked by the very engine it
ships, so the gate we run is the gate you get. The practices were extracted from
a production agentic-development workflow and generalised until nothing
stack-specific remained.

**[discern.sh](https://discern.sh)** · [Documentation](project/map/) ·
[Decisions](project/map/_adr/) · [License](LICENSE)

---

AI writes your code now. **`discern` holds it accountable.**
