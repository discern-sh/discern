---
id: guide-write-project-instructions
title: "Write project instructions"
description: "Put durable provider-neutral rules in one source and regenerate every supported agent surface safely."
order: 100
publish: true
kind: guide
aliases:
  - "instructions"
  - "guide-write-project-instructions"
  - "instruction sources"
  - "instructions.md"
  - "project instructions"
  - "remember this rule"
  - "Compile and check agent instructions"
  - "refresh instructions"
  - "agent files"
  - "generated instructions"
redirect_from:
  - "/docs/agent-instructions/write-project-instructions"
  - "/docs/agent-instructions/compile-and-check-instructions"
---

# Write project instructions

Use this guide when every future coding-agent session must inherit a durable project rule. Author the rule once in the configured instruction source, compile every selected provider surface, and commit source and outputs together.

Instructions are always-loaded policy. A multi-step method belongs in a Skill, a judgment tied to a narrow change belongs in a Checkpoint, and a fact already enforced by code does not need a second prose authority.

## Starting state

- The project has completed discern setup.
- The person has approved the rule as durable project policy, or has asked the agent to capture a correction in the project's instructions.
- The coding agent is in the task's worktree and has read the current compiled instruction file.
- `[instructions].sources` names the authored file or files. Its default is `discern/instructions.md`.

## 1. Find the authored source

**Coding agent:** Read `discern.toml` and resolve `[instructions].sources`. Edit only those authored paths.

```toml
[instructions]
sources = ["discern/instructions.md", "docs/agent-policy/*.md"]
```

Source order is declared order, with each glob resolved deterministically. discern's built-in operating instructions are prepended. Project sources extend them; they do not replace them.

Do not edit `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or materialized provider files directly. They are generated outputs and the Gate rejects drift from their sources.

## 2. Write one rule for every selected provider

**Coding agent:** State the present rule in provider-neutral language. Use the project's names and paths, identify the condition that triggers the rule, and say why when the reason is not apparent.

Keep always-loaded prose scarce:

- Put commands, flags, and exhaustive file lists in a Reference page.
- Put a repeatable procedure in a Skill and leave at most a short instruction pointing to it.
- Put a hard-to-reverse decision and its rationale in an ADR, with the instruction carrying only the standing rule.
- Update an existing authority instead of adding the same fact to another source.

Write for a future session with no memory of the conversation. Avoid provider UI vocabulary unless the rule applies only to that provider and the source boundary says so.

## 3. Preview the compilation

**Coding agent:** Run the read-only plan:

```sh
discern refresh --dry-run
```

The result lists every create, update, and removal across compiled instructions, materialized Skills, provider integration, and the maintained ADR index. Check that only the intended source-driven outputs will change.

A refusal names an invalid source path, malformed provider configuration, or inaccessible target. Correct that authority and rerun the dry plan.

## 4. Compile and inspect the result

**Coding agent:** Apply the refresh:

```sh
discern refresh
```

Review `data.instruction_refresh` and the Git diff. A complete result can list no changed files when everything was already current. A partial result preserves completed effects, sets top-level `ok` false, and gives a safe `discern refresh` retry. Do not infer success from an empty list or from files that happen to exist.

Inspect one compiled output for ordering and wording, then confirm the other outputs are source-derived mirrors or pointers as declared by their providers. Do not correct a compiled copy independently.

## 5. Prove and commit source with output

**Coding agent:** Run `discern prepare`. It refreshes instruction surfaces again and checks that the tree converges. Review any rewrite, then commit the authored source and every tracked generated change in the same logical commit.

Run `discern done` on the clean commit. The Gate must leave no stale generated or integration artifact. Any edit after that run stales its Proof and requires another final Gate.

## 6. Confirm future sessions receive it

After the change lands, **person or coding agent:** start a fresh selected-provider session and inspect the loaded project instructions. The new rule should appear from the provider's generated entry point without a second authored copy.

If the file is current but the session does not show the rule, restart the provider session and use [Connect a coding agent](connect-a-coding-agent.md) to verify activation. Generated files establish repository state, not what an already-running provider loaded.

## Completion

The instruction change is complete when one authored source owns the rule, `discern refresh --dry-run` reports no pending change after compilation, source and tracked outputs are committed together, the full Gate passes, and a fresh configured provider reads the rule.

Read [Instructions, Skills, and the Map](../20-understand/instructions-skills-and-map.md) for placement choices, [Config reference](../30-reference/config-reference.md) for source syntax, and [Files and ownership](../30-reference/files-and-ownership.md) for generated boundaries.
