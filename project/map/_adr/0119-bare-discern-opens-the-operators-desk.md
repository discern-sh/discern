# ADR 0119: bare `discern` opens the operator's desk

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `graduate` → `accept`; the decision and reasoning are unchanged.

> **Interaction amendment (2026-08-13; [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md)):** The transactional list → pick → act → loop and lifecycle-core authority survive. `src/lib/terminal_interaction.ts` now maps the product flow into the published package's interaction graph; the package owns terminal I/O, editing, painting, cancellation, and restoration. Discern still owns interaction admission, decision state, action legality, orchestration, and effects. The shared admission policy includes global `--json` alongside `--plain`, CI, and both stream attachments; the named Desk also refuses its local JSON option before entering that path. The later Desk programme may enrich the product decision model without moving lifecycle truth or reusable terminal mechanics.

**Status**: accepted. Builds on [ADR 0036](0036-unify-setup.md) (the pre-setup redirect), [ADR 0028](0028-result-envelope-and-diagnostics.md) (one result envelope), and [ADR 0027](0027-plan-apply-engine-execution.md) (plan/apply).

## Context

Every discern surface was designed for agents: the MCP tools return structured results, the CLI verbs speak `--json`, and the human-facing output of `status` is a report. But the human operating a fleet of agent worktrees has a different job — not doing the work, but deciding about it: accept a finished handoff and land it, discard abandoned work, arbitrate overlap, go look at something. Each of those decisions is a _selection followed by a choice_, and a report is a bad menu: the operator reads `status` output, copies a branch name, and composes a second command by hand. The friction is small but constant, and it lands on exactly the person discern has no surface for.

Meanwhile bare `discern` — post-setup, with no verb — printed the same help as `--help`. Nobody is ever instructed to run it bare, so the invocation is an unclaimed surface; and the operator, who has no verbs of their own, is the natural owner of the easiest invocation there is.

Pre-setup, bare `discern` is NOT unclaimed: it prints the setup welcome that dual-addresses the human and their agent (ADR 0036/0075). That behaviour is load-bearing and out of scope here.

## Decision

**Bare `discern`, run post-setup in an interactive terminal, opens the operator's desk: an interactive picker over the worktree fleet where selecting an effort offers exactly the actions legal for its state.** The same screen has a named verb, `discern desk`; the bare invocation is its alias, and the named verb is what tests, docs plumbing, and parity guards see.

- **The gate is the shared interaction policy.** The desk shows when `canInteract` (`src/lib/terminal_interaction.ts`) holds — stdin AND stdout are terminals, `--plain` is absent, and the process is not under an enabled `CI` environment — and never otherwise. There is deliberately NO detection of agent or vendor markers. `discern desk` invoked without a TTY (or with `--json`) refuses with a structured `invalid_arguments` result pointing at `status`.
- **Pre-setup behaviour is untouched.** The desk sits strictly behind the existing welcome/help split: only after `shouldWelcomeBare` declines does the TTY branch run.
- **The desk is a renderer, never a source of truth.** It reads state through `statusResult` (the fleet survey) and dispatches the same lifecycle cores the CLI and MCP surfaces share (`acceptResult`, `updateResult`, `worktreeDrop`). It computes no state of its own; its only owned logic is presentation — bucketing rows into decision order and mapping row state to legal actions — and that logic is pure and unit-tested.
- **Every action echoes the CLI command it ran.** The desk teaches the verb vocabulary instead of becoming a second dialect; an operator who watches the desk work can drive the CLI, and transcripts stay legible next to agent transcripts.
- **Destructive weight is preserved.** Dropping a worktree with uncommitted changes or unlanded commits requires typing the branch name; the desk never weakens a refusal a core would have raised — a core's `WorktreeGitError` is rendered, not bypassed.

## Consequences

- Humans get one memorable command — bare `discern` — and it is the one they cannot be confused about, because nothing ever instructs an agent to run it. Human-facing docs can sell exactly that simplicity; the `desk` verb exists for guards, plumbing, and prose that needs a name.
- The desk enrols in the existing forcing functions as an ordinary engine verb: the verb-parity guard, the help-group coverage guard, and the MCP-surface guard (the desk is deliberately CLI-only, like `worktree drop`, and for the same reason — it wields human supervisory actions no agent should reach).
- An agent that runs bare `discern` in a harness that allocates a PTY would see the desk instead of help. Accepted residual: the desk is read-only until a human presses a key, quits on Ctrl-C or its Quit entry, and every mutation sits behind a confirm — an agent that wanders in can only leave or deliberately act, and an agent deliberately acting through the desk is no more empowered than one running the underlying verbs it already has.
- The v0 desk is a prompt-flow (list → pick → act → loop), not a persistent alt-screen application. If living with it proves the sessions are ambient rather than transactional, a render-loop upgrade is additive and changes no contract in this ADR.

## Alternatives considered

- **Make `status` interactive on a TTY.** Rejected: `status` is the orientation verb both populations run reflexively, its report shape is baked into docs and agent guidance, and forking its behaviour by caller would make the shared vocabulary ambiguous.
- **Detect agent environments (CI/agent env markers) as a belt to the TTY brace.** Rejected: vendor sniffing against the repo's convention, a treadmill of markers, and the TTY gate plus the desk's read-only-at-rest posture already bound the blast radius.
- **A dashboard that watches rather than a queue that acts.** Rejected as the framing: the operator's sessions are transactional (open, decide, quit), and monitoring UI would add a second place state can be wrong without adding a decision the picker cannot express.
