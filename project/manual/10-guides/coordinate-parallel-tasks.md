---
id: guide-coordinate-parallel-tasks
title: "Coordinate parallel tasks"
description: "Start, inspect, compose, open, and resource parallel work without treating separate checkouts as separate products."
order: 60
publish: true
kind: guide
aliases:
  - "guide-coordinate-parallel-tasks"
  - "The fleet test-run cap"
  - "concurrent_test_runs"
  - "test slots"
  - "fleet test-run cap"
  - "Per-worktree resources"
  - "worktree resources"
  - "resource lifecycle"
  - "resource garbage collection"
  - "worktree database"
  - "Parallel and team work"
  - "team workflow"
  - "parallel agents"
  - "worktree fleet"
  - "Multi-repo workspaces"
  - "multi-repo work"
  - "polyrepo"
  - "workspace"
  - "local packages"
  - "submodules"
  - "Open another worktree"
  - "switch worktrees"
  - "worktree shell picker"
redirect_from:
  - "/docs/quality-gate/concurrent-test-runs"
  - "/docs/worktrees/the-resources"
  - "/docs/worktrees/team-workflow"
  - "/docs/worktrees/multi-repo-workspaces"
  - "/docs/worktrees/opening-worktrees"
---

# Coordinate parallel tasks

Start, inspect, compose, open, and resource parallel work without treating separate checkouts as separate products.

## The fleet test-run cap

_`[gate].concurrent_test_runs` bounds how many test-stage runs execute at once across the main checkout and every linked worktree._

Linked worktrees share one machine. Set `1` when one suite fills it:

```toml
[gate]
concurrent_test_runs = 1
```

`0`, the default, disables the cap.

### What the cap counts

A slot covers a test-stage group: `done`, `test`, a `standards` measurement, or acceptance's landing-checkout smoke. Runner workers remain unchanged. Fix and check stages never wait, so a broken check fails before admission ([ADR 0212](https://discern.sh/docs/decisions/0212-fleet-test-run-cap-os-lock-slots)).

### Wrap direct test invocations

Gate verbs acquire automatically. Wrap the project's canonical test command so direct full and targeted runs also count:

```sh
discern queue -- <command> [args...]
```

`queue` holds a slot for the child's lifetime and preserves its arguments, streams, interrupts, and status. A missing or zero cap touches no slot files. Unusable slots warn once, then run uncapped.

Nested gate and queue processes inherit an internal marker when an ancestor accounted for the cap, including after fail-open. A marked process skips another acquisition and passes the marker onward, so every nesting direction consumes one slot. This provides cooperative back-pressure. It cannot enforce a security boundary ([ADR 0252](https://discern.sh/docs/decisions/0252-fleet-test-run-cap-at-test-command-boundary)).[^raw-test-task]

[^raw-test-task]: Without discern, keep a separately named raw task. Default to the wrapper.

### What a queued run looks like

A waiting run names the slot holder:

```text
Tests queued: 1 of 1 concurrent test runs in use across this repository's
checkouts ([gate].concurrent_test_runs); the tests start the moment a slot
frees. In flight: queue on agent/profile-tests, typically ~3m.
```

The [Logbook](../30-reference/logbook.md) begins an unmarked `queue` before admission and completes it after the child. Marker bypass writes no duplicate. Recording off omits the holder and estimate. Result `hints[]` carries the notice over JSON and Model Context Protocol.

Timing stays split:

- `duration_ms`: end-to-end wall time.
- `waited_ms`: summed slot wait; `0` for immediate capped admission, absent for uncapped and older events.
- execution time: `duration_ms - (waited_ms ?? 0)`, used by duration priors.

Positive waits sit beside step timings:

```text
Tests passed.

Waited 1m 10s for a test-run slot.
```

`waited_ms` stays in the live result and Logbook, outside Proofs and durable Proof notes ([ADR 0253](https://discern.sh/docs/decisions/0253-durable-proofs-project-runtime-receipts)). End-to-end duration and execution-time priors remain separate ([ADR 0212](https://discern.sh/docs/decisions/0212-fleet-test-run-cap-os-lock-slots), [ADR 0252](https://discern.sh/docs/decisions/0252-fleet-test-run-cap-at-test-command-boundary)).

### Slot release after process exit

Slots are OS advisory locks under the shared git directory. Process death releases them without a daemon or cleanup ([ADR 0212](https://discern.sh/docs/decisions/0212-fleet-test-run-cap-os-lock-slots)).

### Where it lives in code

| Concern                            | Source                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Slot primitive and wait policy     | [`test_run_slots.ts`](https://github.com/jackwh/discern/blob/main/src/engine/test_run_slots.ts)                                                                           |
| Gate and wrapper presentation      | [`test_slots.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/test_slots.ts), [`queue.ts`](https://github.com/jackwh/discern/blob/main/src/engine/queue.ts)                                  |
| Plan split and the enrollment seam | [`plan.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/plan.ts), [`execute.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/execute.ts)                                     |
| The config key                     | [`config_schema.ts`](https://github.com/jackwh/discern/blob/main/src/shared/config_schema.ts)                                                                             |
| Behavioral coverage                | [`engine_gate_slots_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_gate_slots_test.ts), [`engine_queue_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_queue_test.ts) |

### Current state & gotchas

- Advisory locks bound concurrency without promising arrival order.
- During config transitions, the loosest in-flight cap wins.
- Slot files persist for lock identity; excess files are inert.
## Per-worktree resources

_Give each worktree the external state it needs, then remove that state when the worktree goes away._

A resource is an external thing a worktree needs in isolation: a database, emulator, container, queue, bucket, or namespace. discern runs the lifecycle. The project supplies the commands. A fresh installation declares no resources, so worktree creation remains stack-neutral ([ADR 0025](https://discern.sh/docs/decisions/0025-worktree-resources)).

The deterministic development port belongs to [identity](../30-reference/worktrees-and-status.md). It names a port and provisions nothing.

### Configure a resource

Declare resources in `discern.toml` in dependency order:

```toml
[worktree.resources.db]
create = "createdb -T @project_slug@_template @db@"
destroy = "dropdb --if-exists @db@"
ensure = "pg_isready -d @db@"
required = true
retries = 0
gc = true
```

| Key        | Default | Behavior                                                 |
| ---------- | ------- | -------------------------------------------------------- |
| `create`   | `""`    | Runs once during first setup.                            |
| `destroy`  | `""`    | Runs during teardown or orphan cleanup.                  |
| `ensure`   | `""`    | Reconciles readiness on session start.                   |
| `required` | `true`  | Aborts first setup when creation fails.                  |
| `retries`  | `0`     | Retries failed create and destroy commands, capped at 5. |
| `gc`       | `true`  | Lets `worktree prune` reclaim an orphan.                 |

Commands run through `sh -c` after token expansion. discern creates resources from top to bottom and destroys them in reverse order. A dependency declared first remains available until discern removes its dependents.

### Follow the resource lifecycle

| Worktree phase                | Resource behavior                                             |
| ----------------------------- | ------------------------------------------------------------- |
| First setup                   | Writes a ledger entry, then runs `create`.                    |
| Repeated setup                | Skips `create`; the ledger entry records that it already ran. |
| Session start                 | Runs `ensure` when configured.                                |
| Normal work                   | Reuses the same resource handle.                              |
| `accept`, `drop`, or teardown | Runs the frozen `destroy` command in reverse order.           |
| `worktree prune`              | Reclaims recorded resources whose worktree is provably gone.  |

discern writes the ledger entry before `create`. That intent record makes a crash during provisioning visible to garbage collection. discern reports a non-required creation failure and continues setup. A required failure stops setup with the command to fix.

Teardown is best-effort. A failed `destroy` leaves its ledger entry in place so a later prune can retry. Use `gc = false` for data-loss-sensitive resources that require explicit teardown.

### Understand the ledger

The ledger stores one JSON file per worktree and resource under `<git-common-dir>/discern/resources/`. Git worktrees share that directory, while separate repositories do not. Each entry records the Git worktree key, canonical path, resource handle, retry budget, and fully expanded destroy command.

Garbage collection acts only on entries in this project's ledger. It keeps live Git keys and paths, handles owned by live worktrees, entries with `gc = false`, and commands with unresolved tokens. Before each destroy, it checks live state and the ledger entry again. Those checks prevent an older orphan record from destroying a newly recycled handle owned by a concurrent worktree.

`discern worktree prune --dry-run` shows the candidates without destroying them. The apply path consumes that plan and rechecks every candidate immediately before the irreversible step ([ADR 0027](https://discern.sh/docs/decisions/0027-plan-apply-engine-execution)).

### Where it lives in code

| Responsibility                                 | Source                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Resource specs, ledger, and garbage collection | [`src/engine/worktree/resources.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/resources.ts)               |
| Lifecycle orchestration                        | [`src/engine/worktree/lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)               |
| Token expansion                                | [`src/engine/worktree/tokens.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/tokens.ts)                     |
| Resource behavior tests                        | [`tests/engine_worktree_resources_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_worktree_resources_test.ts) |

### Current state and gotchas

- Make `create`, `destroy`, and `ensure` idempotent. `ensure` runs routinely, and a failed destroy remains eligible for another attempt.
- Make `destroy` independent of the current directory. Orphan cleanup runs it from the main checkout after the worktree directory has disappeared.
- Use identity tokens or absolute paths in `destroy`; a relative path such as `./cache` points somewhere else during orphan cleanup.
- `@resource@` exists only inside that resource's commands. Use `@worktree@`, `@db@`, `@site@`, or `@port@` in `[worktree.setup]`.
## Parallel and team work

_Give each effort its own worktree, and use the main checkout to supervise the fleet._

A worktree represents an occupied line of work. It belongs to the agent or person handling that task until it lands or its owner discards it. Never adopt another worktree because it looks idle or clean. Git state says nothing about ownership.

### Survey concurrent work

Run `discern status` from the main checkout for the fleet view; pass `--all` in a worktree.

The survey preserves unknown states instead of guessing:

| State                                          | What status reports                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Tracked or untracked non-ignored files changed | `clean: false` with the changed-file count.                            |
| Checkout has no project config                 | `broken`, with the `worktree drop` recovery.                           |
| Git cannot read a checkout's status            | Sets `git_unavailable`. Clean and divergence values stay absent.       |
| Git returns a failed or malformed count        | Reports `"unknown"` for the affected ahead or behind value.            |
| Work remains idle for 7 days                   | A hint to resume or drop the stale worktree.                           |
| `agent/*` branch has no worktree               | `unlanded_branches`, with `start --from` and `update --from` recovery. |
| Local trunk is missing                         | Ahead remains `null` because discern cannot compare it.                |

If status reports a pristine worktree but a changed main checkout, file operations and validation are split. Work in the task worktree and pass its absolute path to Model Context Protocol (MCP) tools.

An unreadable index makes the row unknown even when Git identifies the checkout. Numeric `0` is verified; `"unknown"` is not. Neither can establish readiness or containment. Mutations recheck their preconditions at apply time ([ADR 0328](https://discern.sh/docs/decisions/0328-absence-and-unknown-observations-stay-distinct)).

### Compose work below the trunk

The trunk is the single landing target. Build dependent phases by pulling branches into worktrees:

- `discern start --from <ref>` creates a new worktree from any branch, tag, or commit.
- `discern update --from <ref>` merges any ref into an existing worktree.
- `discern accept` lands the composed result on the trunk once conversation consent or a recorded grant authorizes it ([ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model)).

This pull-side composition keeps unfinished phases away from the shared landing branch. If another worktree moves the trunk first, the later acceptance leaves its worktree and resources intact and asks for `update → done → accept`.

### Work across repositories

The MCP `discern_start` tool accepts an absolute `path` inside any discern project on disk. It creates the worktree from that project's trunk and re-aims later discern tools at the new root. Pass `path` to later tools when the client cannot change its own working directory ([ADR 0111](https://discern.sh/docs/decisions/0111-cross-project-path-and-strict-tool-schemas)).

Each repository keeps its own config, worktree root, resource ledger, and trunk. Cross-project starts share an agent session while retaining separate project state. [Multi-repo workspaces](coordinate-parallel-tasks.md) covers the workspace layouts themselves: local package links, registries, umbrella repos, and submodules.

### Bring a teammate into the workflow

A clone works without the discern binary. `discern.toml`, the `discern/` namespace, provider settings, and agent files travel in Git. The application still builds and tests through its ordinary commands, and coding agents read the committed instructions.

Without the binary, the clone lacks materialized Skills and the `discern_*` MCP tools. To add them:

1. Install discern.
2. Run `discern refresh` in the clone.
3. Start a fresh agent session so MCP tools and hooks load.

Some agents also require folder trust. `discern doctor` names the provider-specific step.

Claude Code can create and remove worktrees through `WorktreeCreate` and `WorktreeRemove` hooks. The binary parses the hook JSON itself, with no `jq` dependency, and calls the same create, setup, and teardown cores as `discern start`. After setup, hook-created worktrees also branch from the trunk. Its session-start hook reruns resources, checkout-shared `[repository].ensure`, and worktree-only setup convergence ([ADR 0040](https://discern.sh/docs/decisions/0040-worktree-hooks-in-the-binary)). Other agents use the shared lifecycle verbs directly.

### Where it lives in code

| Responsibility                  | Source                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Fleet status and recovery hints | [`src/engine/status/status.ts`](https://github.com/jackwh/discern/blob/main/src/engine/status/status.ts)             |
| Cross-project MCP routing       | [`src/engine/mcp/server.ts`](https://github.com/jackwh/discern/blob/main/src/engine/mcp/server.ts)                   |
| Claude Code hook adapter        | [`src/lib/worktree_hooks.ts`](https://github.com/jackwh/discern/blob/main/src/lib/worktree_hooks.ts)                 |
| Status truth tests              | [`tests/engine_status_truth_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_status_truth_test.ts) |

### Current state and gotchas

- The main checkout is the supervisory view. Make task changes only inside a worktree.
- `discern status` only inspects state. It creates, refreshes, and destroys no resources.
- The fleet's Git-clean signal excludes ignored provider-local and generated files.
## Multi-repo workspaces

_Each repository has its own install, linked to others through trunks, registries, or submodules._

discern's unit is the repository. Each repository holds its own `discern.toml`, Gate, [trunk](../30-reference/glossary.md#trunk), worktree fleet, and resource ledger. A workspace of several repositories runs an install in each one, and an agent session moves between them by passing `path` to the Model Context Protocol (MCP) tools ([ADR 0111](https://discern.sh/docs/decisions/0111-cross-project-path-and-strict-tool-schemas)). [Parallel and team work](coordinate-parallel-tasks.md) covers the mechanics. There is no workspace-level config. [Proofs](../20-understand/proof.md), Standards, and accepts never span repositories. A change that touches 2 repositories requires 2 worktrees, 2 Gate runs, and 2 landings.

### Link sibling repositories through their trunks

The common layout keeps repos side by side under one parent, with consumers wiring a library in through the package manager's local-path mechanism: `file:` dependencies in npm, `use` directives in a Go workspace, Cargo path dependencies, local Swift packages, Composer path repositories.

Point those links at the library's main checkout with an absolute path. The main checkout sits on the trunk, work happens in worktrees, and the trunk moves when `discern accept` lands a validated commit ([ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model)). A consumer linking the main checkout builds against landed states of the library and does not read an unlanded worktree branch.

Absolute paths hold on one machine only. A team keeps the committed manifest shared with one level of indirection: agree on a stable path such as `/opt/acme/shared-lib`, point the manifest there, and each developer symlinks that path to their own checkout. The symlink lives outside the repository, so every worktree resolves it with nothing to recreate. Otherwise, publish to a registry, or use relative links plus the placement below.

A relative link such as `file:../shared-lib` assumes the consumer's checkout sits beside the library. By default a worktree does not: `discern start` places it at `<parent>/<repo>.worktrees/<id>`, so `../shared-lib` may resolve to nothing even when the main checkout's Gate passes. Place worktrees in the workspace parent instead:

```toml
[worktree]
root = ".."
```

Worktrees then sit beside the repositories, and `../shared-lib` resolves from a worktree the same way it does from the repo.

### Depend through a registry

Repositories that consume each other's published releases (npm, JSR, PyPI, Maven, an internal registry) need no discern configuration. Each repository is self-contained, and its Gate builds against the declared versions.

A change that spans library and consumer lands in order. Land the library first, publish the release, then bump the consumer's dependency and land that. Each landing passes its own repository's Gate.

### Umbrella repositories

Some workspaces add a front-door repo holding compose files, scripts, and workspace docs. Install discern in each child repository. The umbrella may also carry its own install whose gate runs the integration checks. A worktree of the umbrella isolates the umbrella's files only: the child repositories underneath are separate repos and stay shared.

### Submodules

A superproject pins child repositories by commit with `git submodule`. `discern start` creates the checkout with `git worktree add`, and Git leaves submodule directories empty in a new worktree. Populate them with repository convergence:

```toml
[repository]
ensure = ["git submodule update --init --recursive"]
```

`[repository].ensure` runs on every managed worktree pass, including `discern update`, so a submodule pointer that moves with the trunk converges on the next pass.

### Where it lives in code

| Concept                                          | File                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Default worktree placement and `[worktree].root` | [`src/lib/paths.ts`](https://github.com/jackwh/discern/blob/main/src/lib/paths.ts)                                 |
| Project-root discovery                           | [`src/shared/env.ts`](https://github.com/jackwh/discern/blob/main/src/shared/env.ts)                               |
| Repository convergence (`[repository].ensure`)   | [`src/engine/worktree/lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts) |
| Cross-project MCP routing                        | [`src/engine/mcp/server.ts`](https://github.com/jackwh/discern/blob/main/src/engine/mcp/server.ts)                 |

### Current state and gotchas

- Root discovery walks up from the working directory to the nearest `discern.toml` and does not stop at a repository boundary ([`src/shared/env.ts`](https://github.com/jackwh/discern/blob/main/src/shared/env.ts)). A repo without its own config, nested under a directory that has one, resolves to the outer project; `discern doctor`, run from the nested repo, discloses the crossing.
- A consumer's Gate reads a linked library at whatever state the linked checkout holds at that moment. Linking the main checkout keeps that state landed, and the consumer's Proof still describes only its own repository.
- `discern start` runs no submodule population of its own: the `[repository].ensure` command above is the supported path, and `start` hints at it when the fresh worktree carries a `.gitmodules` no configured command mentions.
## Open another worktree

_`discern worktrees` moves sideways across the [fleet](../30-reference/glossary.md#fleet) without losing your place in the project tree._

Run it from any discern checkout in an interactive terminal:

```sh
discern worktrees
```

The menu derives its facts from `discern status --all`. It shows the main checkout and every registered worktree with its branch, Git state, [Proof](../20-understand/proof.md) state, recent activity, and path. The menu keeps the current checkout visible but does not let you select it. Unavailable checkouts, unlanded branches without a checkout, and [reclaimed stage branches](../40-troubleshooting/worktrees-and-resources.md) also stay visible as non-selectable context.

Selecting a worktree starts `$SHELL` as a child process. If the command starts in `src/engine`, the child shell starts in `src/engine` under the selected worktree. When that exact directory does not exist on the selected branch, discern warns and uses the nearest existing ancestor, stopping at the selected worktree's root.

Exit the child shell to return to the original shell and directory. A child process cannot change its parent's directory, so the command does not attempt to persist a `cd` after it exits ([ADR 0312](https://discern.sh/docs/decisions/0312-worktrees-opens-a-cwd-equivalent-child-shell)).

The picker never creates, updates, lands, or removes a worktree. Use the [lifecycle commands](finish-and-land-a-change.md) for those effects. Outside a terminal, use the status view instead:

```sh
discern status --all
discern status --all --json
```

There is no Model Context Protocol (MCP) tool for `worktrees`: an agent can read the same fleet facts through `discern_status`, while terminal ownership and the child shell remain CLI concerns.

### Where it lives in code

| Responsibility                  | Source                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| Picker, cwd mapping, and launch | [`shell_picker.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/shell_picker.ts)     |
| Fleet facts                     | [`status.ts`](https://github.com/jackwh/discern/blob/main/src/engine/status/status.ts)                   |
| Shared row wording              | [`model.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/model.ts)                       |
| Shared shell resolution         | [`user_shell.ts`](https://github.com/jackwh/discern/blob/main/src/engine/user_shell.ts)                  |
| Behavioral and terminal tests   | [`engine_worktrees_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_worktrees_test.ts) |
