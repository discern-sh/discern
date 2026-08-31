# ADR 0360: The Project Script namespace holds only commands

**Status**: accepted. Constrains the Project Script surface established in [ADR 0137](0137-project-scripts-live-under-the-script-command.md) and follows the enrolling-guard practice from [ADR 0051](0051-canonical-set-parity.md).

## Context

`[scripts].dir` is a command namespace. Discovery walks its regular files, `discern scripts` lists the executable ones, and the Desk presents every one of them as something to run. Nothing about the directory announces that contract: it is an ordinary folder with an inviting name, sitting beside the map, the instruction source, and authored skills in this repository's `project/` tree.

Six implementation modules accumulated there across three weeks of agent sessions — three checkpoint `when` matchers, their shared input reader, the private-overlay ensure script, and the project-control integrity checker. Every one is invoked as `deno run <path>` from `discern.toml` or imported by a sibling. None is a command.

The two surfaces then disagreed about what the project offers. `discern scripts` filters to executables and reported nine commands; the Desk, which deliberately keeps a non-executable file visible so a real command that lost its bit does not silently vanish, reported fifteen. Its offered repair made the misplacement worse: `chmod +x` on a matcher module produces a listed Project Script that still cannot run, because the module needs `deno run` with specific permission flags.

A gate job had also bound itself to the namespace. `[jobs.project-control]` ran the `project-control` script rather than the module beneath it, so a check stage depended on a project-owned file and on its executable bit surviving the checkout.

## Decision

Every file directly inside `[scripts].dir` is a command: executable in Git's index, beginning with a shebang, and carrying a `# desc:` line. Implementation lives in the repository's ordinary source tree; a command that needs one calls it through a shim, the shape `canary-audit` already had.

Each clause answers a distinct failure. The index mode is what other checkouts receive, so a file executable only on its author's disk fails rather than arriving inert everywhere else. The shebang separates a command that lost its bit from a module that was never a command — without it, `chmod +x` alone would satisfy the guard, teaching exactly the wrong repair. The `# desc:` line is what the listing and the Desk render, so a command arrives self-describing.

Subdirectories stay outside the rule because discovery never descends into them. That is not a nested escape hatch for implementation; it is the same set the engine walks.

The gate binds implementation modules directly. A Project Script may wrap the same module for by-hand use, but a job never depends on the project-owned namespace.

## Consequences

- `discern scripts` and the Desk report the same set, and a Desk entry is always a command whose advertised repair is the correct one.
- `tests/project_scripts_namespace_test.ts` derives its scan set from `[scripts].dir` through the structural-guard scope declaration, so aiming the config elsewhere moves the guard with it and any new file in the namespace enrols without being listed anywhere. Planted fixtures hold the predicate itself, including the case where a local `chmod` disagrees with the recorded mode.
- The rule is stated where it is broken rather than in always-loaded instructions: the diagnostic names the file, the failed clause, and both exits.
- Editing a Project Script can no longer break the gate.

## Alternatives considered

- **Permit a nested `lib/` inside the namespace.** Rejected because it splits implementation across two trees to keep one directory's name convenient, and the engine would never present those files anyway.
- **Maintain an exemption list for known non-commands.** Rejected because the list would grow with each session that repeated the mistake, which is the failure mode rather than its cure.
- **Check only the executable bit.** Rejected because it makes `chmod +x` a passing repair for a module, ratifying the misleading remedy that surfaced the problem.
- **Read the filesystem mode instead of the index.** Rejected because the working-tree bit is local: a file staged at `100644` arrives inert in every other checkout while passing on the author's machine.
